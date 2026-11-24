'use strict';
const TID = '01006F8002326000';

async function readZip(u) {
  const v = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let e = u.length - 22;
  while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip file');
  const count = v.getUint16(e + 10, true); let c = v.getUint32(e + 16, true);
  const files = new Map(), dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (v.getUint32(c, true) !== 0x02014b50) throw new Error('broken zip directory');
    const method = v.getUint16(c + 10, true), csize = v.getUint32(c + 20, true), usize = v.getUint32(c + 24, true);
    const nlen = v.getUint16(c + 28, true), elen = v.getUint16(c + 30, true), clen = v.getUint16(c + 32, true);
    const lo = v.getUint32(c + 42, true), name = dec.decode(u.subarray(c + 46, c + 46 + nlen));
    c += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    const at = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true), raw = u.subarray(at, at + csize);
    files.set(name, async () => {
      if (method === 0) return raw;
      if (method !== 8) throw new Error(name + ': unsupported compression');
      const out = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      if (out.length !== usize) throw new Error(name + ': bad size');
      return out;
    });
  }
  return files;
}

// LZMA into one output buffer (a whole 7z folder, so the buffer is the dictionary), after the LZMA SDK's LzmaSpec.cpp.
// Prob layout: isMatch 0, isRep 192, isRepG0 204, isRepG1 216, isRepG2 228, isRep0Long 240, posSlot 432,
// specPos 688, align 803, len 819, repLen 1333, literals 1847
function lzma(out) {
  let lc = 0, lp = 0, pb = 0, pr = null, state = 0, r0 = 0, r1 = 0, r2 = 0, r3 = 0, pos = 0, start = 0;
  return {
    get pos() { return pos; },
    props(d) { lc = d % 9; d = (d / 9) | 0; lp = d % 5; pb = (d / 5) | 0; if (pb > 4) throw new Error('bad LZMA properties');
               if (!pr || pr.length !== 1847 + (0x300 << (lc + lp))) pr = new Uint16Array(1847 + (0x300 << (lc + lp))); },
    reset() { pr.fill(1024); state = 0; r0 = r1 = r2 = r3 = 0; },
    resetDict() { start = pos; },
    copy(src) { out.set(src, pos); pos += src.length; },
    run(inp, ip, end) {   // decode until pos == end; the range coder starts at ip
      let range = 0xFFFFFFFF, code = 0; ip++;
      for (let i = 0; i < 4; i++) code = code * 256 + inp[ip++];
      const bit = i => {
        const p = pr[i], bound = (range >>> 11) * p; let b = 0;
        if (code < bound) { range = bound; pr[i] = p + ((2048 - p) >>> 5); } else { range -= bound; code -= bound; pr[i] = p - (p >>> 5); b = 1; }
        if (range < 16777216) { range *= 256; code = code * 256 + inp[ip++]; }
        return b;
      };
      const tree = (base, n) => { let m = 1; for (let i = 0; i < n; i++) m = (m << 1) | bit(base + m); return m - (1 << n); };
      const rtree = (base, n) => { let m = 1, s = 0; for (let i = 0; i < n; i++) { const b = bit(base + m); m = (m << 1) | b; s |= b << i; } return s; };
      const len = (L, ps) => !bit(L) ? tree(L + 2 + ps * 8, 3) : !bit(L + 1) ? 8 + tree(L + 130 + ps * 8, 3) : 16 + tree(L + 258, 8);
      const pbMask = (1 << pb) - 1, lpMask = (1 << lp) - 1;
      while (pos < end) {
        const ps = (pos - start) & pbMask;
        if (!bit((state << 4) + ps)) {   // literal
          const prev = pos > start ? out[pos - 1] : 0, base = 1847 + 0x300 * ((((pos - start) & lpMask) << lc) + (prev >> (8 - lc)));
          let s = 1;
          if (state >= 7) {
            let mb = out[pos - r0 - 1];
            do { const m = (mb >> 7) & 1; mb <<= 1; const b = bit(base + ((1 + m) << 8) + s); s = (s << 1) | b; if (m !== b) break; } while (s < 0x100);
          }
          while (s < 0x100) s = (s << 1) | bit(base + s);
          out[pos++] = s - 0x100; state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
          continue;
        }
        let n;
        if (bit(192 + state)) {   // rep match
          if (!bit(204 + state)) {
            if (!bit(240 + (state << 4) + ps)) { state = state < 7 ? 9 : 11; out[pos] = out[pos - r0 - 1]; pos++; continue; }
          } else {
            let d;
            if (!bit(216 + state)) d = r1; else { if (!bit(228 + state)) d = r2; else { d = r3; r3 = r2; } r2 = r1; }
            r1 = r0; r0 = d;
          }
          n = len(1333, ps); state = state < 7 ? 8 : 11;
        } else {   // new match
          r3 = r2; r2 = r1; r1 = r0; n = len(819, ps); state = state < 7 ? 7 : 10;
          const slot = tree(432 + Math.min(n, 3) * 64, 6);
          if (slot < 4) r0 = slot;
          else {
            const nd = (slot >> 1) - 1; let d = (2 | (slot & 1)) * 2 ** nd;
            if (slot < 14) d += rtree(688 + d - slot, nd);
            else {
              let x = 0;
              for (let i = nd - 4; i > 0; i--) { range = Math.floor(range / 2); let b = 0; if (code >= range) { code -= range; b = 1; } x = x * 2 + b;
                                                 if (range < 16777216) { range *= 256; code = code * 256 + inp[ip++]; } }
              d += x * 16 + rtree(803, 4);
            }
            if (d === 0xFFFFFFFF) break;   // end marker
            r0 = d;
          }
        }
        n += 2;
        if (r0 >= pos - start || pos + n > end) throw new Error('The 7z data is damaged.');
        for (; n > 0; n--, pos++) out[pos] = out[pos - r0 - 1];
      }
      return ip;
    },
  };
}

function lzma2(inp, ip, out) {
  const L = lzma(out);
  for (let c; (c = inp[ip++]) !== 0;) {
    if (c < 0x80) {   // stored chunk; 1 also resets the dictionary
      if (c > 2) throw new Error('The 7z data is damaged.');
      const n = (inp[ip] << 8 | inp[ip + 1]) + 1; ip += 2;
      if (c === 1) L.resetDict();
      L.copy(inp.subarray(ip, ip + n)); ip += n; continue;
    }
    const u = ((c & 31) << 16) + (inp[ip] << 8) + inp[ip + 1] + 1, p = (inp[ip + 2] << 8) + inp[ip + 3] + 1, mode = (c >> 5) & 3; ip += 4;
    if (mode === 3) L.resetDict();
    if (mode >= 2) L.props(inp[ip++]);
    if (mode >= 1) L.reset();
    L.run(inp, ip, L.pos + u); ip += p;
  }
  if (L.pos !== out.length) throw new Error('The 7z data is damaged.');
}

// 7z: header (maybe LZMA-packed itself), then folders of LZMA/LZMA2 (or stored) data; files are runs inside their folder
async function read7z(u) {
  const bad = () => new Error('This 7z uses a feature the page cannot read. Extract it and zip the atmosphere folder instead.');
  const rd = b => {
    let p = 0; const r = {
      get pos() { return p; }, seek(x) { p = x; },
      byte: () => b[p++], bytes: n => b.subarray(p, p += n), u32() { p += 4; return (b[p - 4] | b[p - 3] << 8 | b[p - 2] << 16 | b[p - 1] << 24) >>> 0; },
      num() { const f = b[p++]; let v = 0; for (let i = 0, m = 0x80; i < 8; i++, m >>= 1) { if (!(f & m)) return v + (f & (m - 1)) * 2 ** (8 * i); v += b[p++] * 2 ** (8 * i); } return v; },
      bits(n) { const a = []; for (let i = 0, x = 0; i < n; i++) { if (!(i & 7)) x = b[p++]; a.push(!!(x & (0x80 >> (i & 7)))); } return a; },
      defs(n) { return b[p++] ? new Array(n).fill(true) : r.bits(n); },
    }; return r;
  };
  const folder = r => {
    const n = r.num(), coders = []; let ins = 0, outs = 0;
    for (let i = 0; i < n; i++) {
      const fl = r.byte(); if (fl & 0xC0) throw bad();
      const id = [...r.bytes(fl & 15)].map(x => x.toString(16).padStart(2, '0')).join('');
      let ni = 1, no = 1; if (fl & 16) { ni = r.num(); no = r.num(); }
      coders.push({ id, props: fl & 32 ? r.bytes(r.num()) : null }); ins += ni; outs += no;
    }
    for (let i = 0; i < outs - 1; i++) { r.num(); r.num(); }
    if (ins - (outs - 1) > 1) for (let i = 0; i < ins - (outs - 1); i++) r.num();
    return { coders, outs };
  };
  const streams = r => {
    const s = { packPos: 0, packSizes: [], folders: [] };
    for (let id; (id = r.num()) !== 0;) {
      if (id === 6) {
        s.packPos = r.num(); const n = r.num();
        for (let t; (t = r.num()) !== 0;) {
          if (t === 9) for (let i = 0; i < n; i++) s.packSizes.push(r.num());
          else if (t === 10) r.defs(n).forEach(x => x && r.u32()); else throw bad();
        }
      } else if (id === 7) {
        if (r.num() !== 11) throw bad(); const n = r.num(); if (r.byte()) throw bad();
        for (let i = 0; i < n; i++) s.folders.push(folder(r));
        if (r.num() !== 12) throw bad();
        for (const f of s.folders) f.sizes = Array.from({ length: f.outs }, () => r.num());
        for (let t; (t = r.num()) !== 0;) { if (t !== 10) throw bad(); const d = r.defs(n); s.folders.forEach((f, i) => { if (d[i]) f.crc = r.u32(); }); }
      } else if (id === 8) {
        const F = s.folders; let t = r.num();
        s.counts = F.map(() => 1);
        if (t === 13) { s.counts = F.map(() => r.num()); t = r.num(); }
        s.sizes = []; s.crcs = [];
        F.forEach((f, i) => {
          let sum = 0;
          if (t === 9) for (let k = 1; k < s.counts[i]; k++) { const x = r.num(); s.sizes.push(x); sum += x; }
          if (s.counts[i]) s.sizes.push(f.sizes[f.sizes.length - 1] - sum);
        });
        if (t === 9) t = r.num();
        const known = (f, i) => s.counts[i] === 1 && f.crc !== undefined;
        let vals = [];
        for (; t !== 0; t = r.num()) {
          if (t !== 10) throw bad();
          const need = F.reduce((a, f, i) => a + (known(f, i) ? 0 : s.counts[i]), 0);
          vals = r.defs(need).map(x => x ? r.u32() : undefined);
        }
        let k = 0;
        F.forEach((f, i) => { if (known(f, i)) s.crcs.push(f.crc); else for (let j = 0; j < s.counts[i]; j++) s.crcs.push(vals[k++]); });
      } else throw bad();
    }
    if (!s.counts) { s.counts = s.folders.map(() => 1); s.sizes = s.folders.map(f => f.sizes[f.sizes.length - 1]); s.crcs = s.folders.map(f => f.crc); }
    return s;
  };
  const unpack = (s, i) => {
    const f = s.folders[i]; if (f.coders.length !== 1) throw bad();
    let at = 32 + s.packPos; for (let k = 0; k < i; k++) at += s.packSizes[k];
    const c = f.coders[0], out = new Uint8Array(f.sizes[0]);
    if (c.id === '21') lzma2(u, at, out);
    else if (c.id === '030101') { const L = lzma(out); L.props(c.props[0]); L.reset(); L.run(u, at, out.length); }
    else if (c.id === '00') out.set(u.subarray(at, at + out.length));
    else throw bad();
    if (f.crc !== undefined && crc32(out) !== f.crc) throw new Error('The 7z data is damaged.');
    return out;
  };
  const v = new DataView(u.buffer, u.byteOffset, u.byteLength), q = o => v.getUint32(o, true) + v.getUint32(o + 4, true) * 2 ** 32;
  let r = rd(u.subarray(32 + q(12), 32 + q(12) + q(20))), id = r.num();
  if (id === 0x17) { const s = streams(r); r = rd(unpack(s, 0)); id = r.num(); }
  if (id !== 1) throw bad();
  let s = null, names = [], empty = [], emptyFile = [];
  for (let t; (t = r.num()) !== 0;) {
    if (t === 4) s = streams(r);
    else if (t === 5) {
      const n = r.num(); empty = new Array(n).fill(false);
      for (let p; (p = r.num()) !== 0;) {
        const e = r.num() + r.pos;
        if (p === 14) empty = r.bits(n);
        else if (p === 15) emptyFile = r.bits(empty.filter(Boolean).length);
        else if (p === 17) { if (r.byte()) throw bad(); names = new TextDecoder('utf-16le').decode(r.bytes(e - r.pos)).split('\0'); }
        r.seek(e);
      }
    } else throw bad();
  }
  const runs = [], cache = [];
  if (s) s.folders.forEach((f, i) => { for (let k = 0, off = 0; k < s.counts[i]; k++) { const j = runs.length; runs.push({ i, off, size: s.sizes[j], crc: s.crcs[j] }); off += s.sizes[j]; } });
  const files = new Map(); let j = 0, e = 0;
  names.slice(0, empty.length).forEach((nm, k) => {
    const name = nm.replace(/\\/g, '/');
    if (empty[k]) { if (emptyFile[e++]) files.set(name, async () => new Uint8Array(0)); return; }
    const x = runs[j++];
    files.set(name, async () => {
      const d = (cache[x.i] ||= unpack(s, x.i)).subarray(x.off, x.off + x.size);
      if (x.crc !== undefined && crc32(d) !== x.crc) throw new Error(name + ': the 7z data check failed.');
      return d;
    });
  });
  return files;
}

const CRC = new Uint32Array(256).map((_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xEDB88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crc32(u) { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

function writeZip(entries) {   // [name, bytes], stored (no compression)
  const enc = new TextEncoder(), parts = [], dir = []; let off = 0;
  for (const [name, data] of entries) {
    const n = enc.encode(name), crc = crc32(data), h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, n.length, true);
    const d = new DataView(new ArrayBuffer(46));
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true); d.setUint16(14, 0x21, true);
    d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true); d.setUint16(28, n.length, true);
    d.setUint32(42, off, true);
    parts.push(new Uint8Array(h.buffer), n, data); dir.push(new Uint8Array(d.buffer), n);
    off += 30 + n.length + data.length;
  }
  const size = dir.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
  e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...dir, new Uint8Array(e.buffer)], { type: 'application/zip' });
}

const hex = b => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
const sha256 = async u => hex(await crypto.subtle.digest('SHA-256', u));
const unb64 = s => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
const cat = parts => { const o = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let at = 0; for (const p of parts) { o.set(p, at); at += p.length; } return o; };
const u32 = n => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const utf8 = s => new TextEncoder().encode(s);

// zstd: fzstd decodes; we write uncompressed (raw-block) frames, which any zstd decoder accepts
function zstdRaw(d) {
  const f = new Uint8Array(13); f.set([0x28, 0xB5, 0x2F, 0xFD, 0xE0]); new DataView(f.buffer).setBigUint64(5, BigInt(d.length), true);
  const parts = [f];
  for (let o = 0; o < d.length; o += 131072) {
    const n = Math.min(131072, d.length - o), last = o + n >= d.length ? 1 : 0, h = (n << 3) | last;
    parts.push(new Uint8Array([h & 255, (h >> 8) & 255, (h >> 16) & 255]), d.subarray(o, o + n));
  }
  return cat(parts);
}
function yaz0Raw(d) {   // store-only Yaz0 (all literals)
  const out = new Uint8Array(16 + d.length + Math.ceil(d.length / 8)); out.set([0x59, 0x61, 0x7a, 0x30]);
  new DataView(out.buffer).setUint32(4, d.length, false); let o = 16;
  for (let i = 0; i < d.length; i += 8) { const n = Math.min(8, d.length - i); out[o++] = (0xff << (8 - n)) & 0xff; out.set(d.subarray(i, i + n), o); o += n; }
  return out.subarray(0, o);
}

// SARC
function sarcParse(b) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength); if (hex(b.subarray(0, 4)) !== '53415243') throw new Error('not a SARC');
  const doff = v.getUint32(0xC, true), n = v.getUint16(0x1A, true), so = 0x20 + 16 * n, nt = so + 8, dec = new TextDecoder(), ents = [];
  for (let i = 0; i < n; i++) {
    const h = v.getUint32(0x20 + 16 * i, true), attr = v.getUint32(0x24 + 16 * i, true), s = v.getUint32(0x28 + 16 * i, true), e = v.getUint32(0x2C + 16 * i, true);
    let name = null; if (attr >>> 24) { const o = nt + (attr & 0xffffff) * 4; let z = o; while (b[z]) z++; name = dec.decode(b.subarray(o, z)); }
    ents.push({ h, name, s, e, data: b.subarray(doff + s, doff + e) });
  }
  return { ents, doff, n };
}
function sarcReplace(b, repl) {
  const { ents, doff } = sarcParse(b), head = b.slice(0, doff), hv = new DataView(head.buffer);
  let al = 1; while (al < 0x2000 && ents.every(e => e.s % (al * 2) === 0)) al *= 2; al = Math.max(al, 4);
  const parts = []; let len = 0;
  ents.forEach((e, i) => {
    const d = repl.get(e.name) || e.data; while (len % al) { parts.push(new Uint8Array(1)); len++; }
    hv.setUint32(0x28 + 16 * i, len, true); hv.setUint32(0x2C + 16 * i, len + d.length, true); parts.push(d); len += d.length;
  });
  const out = cat([head, ...parts]); new DataView(out.buffer).setUint32(8, out.length, true); return out;
}

// MSBT: add or replace labels
function msbtEdit(b, add, set) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength), n = v.getUint16(0xE, true), secs = []; let o = 0x20;
  for (let i = 0; i < n; i++) { const sz = v.getUint32(o + 4, true); secs.push([b.subarray(o, o + 4), b.subarray(o + 16, o + 16 + sz)]); o = (o + 16 + sz + 15) & ~15; }
  const find = m => secs.find(s => String.fromCharCode(...s[0]) === m);
  const L = find('LBL1')[1], T = find('TXT2')[1], lv = new DataView(L.buffer, L.byteOffset, L.byteLength), tv = new DataView(T.buffer, T.byteOffset, T.byteLength);
  const g = lv.getUint32(0, true), labels = [];
  for (let i = 0; i < g; i++) {
    const c = lv.getUint32(4 + 8 * i, true); let p = lv.getUint32(8 + 8 * i, true);
    for (let k = 0; k < c; k++) { const ln = L[p]; labels.push([new TextDecoder().decode(L.subarray(p + 1, p + 1 + ln)), lv.getUint32(p + 1 + ln, true)]); p += 5 + ln; }
  }
  const cnt = tv.getUint32(0, true), offs = [...Array(cnt)].map((_, i) => tv.getUint32(4 + 4 * i, true)).concat([T.length]);
  const texts = [...Array(cnt)].map((_, i) => T.subarray(offs[i], offs[i + 1]));
  const idx = new Map(labels);
  for (const [name, t] of set) { if (!idx.has(name)) throw new Error('label missing: ' + name); texts[idx.get(name)] = unb64(t); }
  for (const [name, t] of add) { if (idx.has(name)) throw new Error('label already there: ' + name); idx.set(name, texts.length); texts.push(unb64(t)); }
  const hashg = nm => { let h = 0; for (const ch of utf8(nm)) h = (Math.imul(h, 0x492) + ch) >>> 0; return h % g; };
  const groups = [...Array(g)].map(() => []);
  for (const [nm, i] of [...idx].sort((a, c) => a[1] - c[1])) groups[hashg(nm)].push([nm, i]);
  const body = [], head = [u32(g)]; let off = 4 + 8 * g;
  for (const gr of groups) {
    head.push(u32(gr.length), u32(off));
    for (const [nm, i] of gr) { const nb = utf8(nm), e = cat([new Uint8Array([nb.length]), nb, u32(i)]); body.push(e); off += e.length; }
  }
  const newL = cat([...head, ...body]); let to = 4 + 4 * texts.length; const toffs = [];
  for (const t of texts) { toffs.push(to); to += t.length; }
  const newT = cat([u32(texts.length), ...toffs.map(u32), ...texts]);
  const out = [b.slice(0, 0x20)]; let len = 0x20;
  for (const [mg, d0] of secs) {
    const m = String.fromCharCode(...mg), d = m === 'LBL1' ? newL : m === 'TXT2' ? newT : m === 'ATR1' ? cat([u32(texts.length), d0.subarray(4)]) : d0;
    const hdr = new Uint8Array(16); hdr.set(mg); new DataView(hdr.buffer).setUint32(4, d.length, true); out.push(hdr, d); len += 16 + d.length;
    const pad = (16 - (len % 16)) % 16; if (pad) { out.push(new Uint8Array(pad).fill(0xab)); len += pad; }
  }
  const r = cat(out); new DataView(r.buffer).setUint32(0x12, r.length, true); return r;
}

async function inflateRaw(u) { return new Uint8Array(await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); }

// BYML v3 (strings, arrays, dicts only: that is all EventFlowInfoProduct.byml holds)
function bymlRead(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), td = new TextDecoder();
  if (b[0] !== 0x59 || b[1] !== 0x42) throw new Error('not a BYML');
  const ko = dv.getUint32(4, true), so = dv.getUint32(8, true), ro = dv.getUint32(12, true);
  const tab = o => { const n = dv.getUint32(o, true) >>> 8, r = []; for (let i = 0; i < n; i++) { const s = o + dv.getUint32(o + 4 + 4 * i, true); let e = s; while (b[e]) e++; r.push(td.decode(b.subarray(s, e))); } return r; };
  const K = tab(ko), S = tab(so);
  const val = (t, v) => { if (t === 0xA0) return S[v]; if (t === 0xC0 || t === 0xC1) return node(v); throw new Error('BYML value type 0x' + t.toString(16) + ' is not handled'); };
  const node = o => {
    const t = b[o], n = dv.getUint32(o, true) >>> 8;
    if (t === 0xC0) { const vo = (o + 4 + n + 3) & ~3; return Array.from({ length: n }, (_, i) => val(b[o + 4 + i], dv.getUint32(vo + 4 * i, true))); }
    if (t === 0xC1) { const d = {}; for (let i = 0; i < n; i++) { const e = o + 4 + 8 * i; d[K[dv.getUint32(e, true) & 0xFFFFFF]] = val(b[e + 3], dv.getUint32(e + 4, true)); } return d; }
    throw new Error('BYML node type 0x' + t.toString(16) + ' is not handled');
  };
  return node(ro);
}
function bymlWrite(root) {
  const keys = new Set(), strs = new Set();
  const scan = x => { if (Array.isArray(x)) x.forEach(scan); else if (x && typeof x === 'object') for (const k in x) { keys.add(k); scan(x[k]); } else strs.add(x); };
  scan(root);
  const K = [...keys].sort(), S = [...strs].sort(), ki = new Map(K.map((k, i) => [k, i])), si = new Map(S.map((s, i) => [s, i]));
  const table = L => {
    const offs = [], body = []; let off = 4 + 4 * (L.length + 1);
    for (const s of L) { const e = cat([utf8(s), new Uint8Array(1)]); offs.push(off); body.push(e); off += e.length; }
    offs.push(off); const o = cat([u32(0xC2 | (L.length << 8)), ...offs.map(u32), ...body]);
    return cat([o, new Uint8Array((4 - o.length % 4) % 4)]);
  };
  const kt = table(K), st = table(S);
  let out = new Uint8Array(1 << 20 | 0), len = 16, dv;
  const grow = n => { if (len + n > out.length) { const o2 = new Uint8Array(Math.max(out.length * 2, len + n)); o2.set(out); out = o2; } dv = new DataView(out.buffer); };
  grow(0); const ko = len; grow(kt.length); out.set(kt, len); len += kt.length; const so = len; grow(st.length); out.set(st, len); len += st.length;
  const node = x => {
    const isD = !Array.isArray(x), items = isD ? Object.entries(x).sort((a, b) => ki.get(a[0]) - ki.get(b[0])) : x.map((v, i) => [i, v]), n = items.length;
    const size = isD ? 4 + 8 * n : 4 + n + ((4 - (4 + n) % 4) % 4) + 4 * n, pos = len; grow(size); len += size;
    const vals = items.map(([k, v]) => typeof v === 'string' ? [k, 0xA0, si.get(v)] : [k, Array.isArray(v) ? 0xC0 : 0xC1, node(v)]);
    dv = new DataView(out.buffer);
    if (isD) { dv.setUint32(pos, 0xC1 | (n << 8), true); vals.forEach(([k, t, v], i) => { const e = pos + 4 + 8 * i; dv.setUint32(e, ki.get(k), true); out[e + 3] = t; dv.setUint32(e + 4, v, true); }); }
    else { dv.setUint32(pos, 0xC0 | (n << 8), true); const vo = pos + 4 + n + ((4 - (4 + n) % 4) % 4); vals.forEach(([k, t, v], i) => { out[pos + 4 + i] = t; dv.setUint32(vo + 4 * i, v, true); }); }
    return pos;
  };
  const ro = node(root); dv = new DataView(out.buffer);
  out[0] = 0x59; out[1] = 0x42; dv.setUint16(2, 3, true); dv.setUint32(4, ko, true); dv.setUint32(8, so, true); dv.setUint32(12, ro, true);
  return out.slice(0, len);
}

async function build(modBytes, patch, zstd) {
  if (patch.format !== 1 || patch.tid !== TID) throw new Error('That is not the jub-port-patch.json file.');
  const m = modBytes, is7z = m[0] === 0x37 && m[1] === 0x7A && m[2] === 0xBC && m[3] === 0xAF && m[4] === 0x27 && m[5] === 0x1C;
  if (!is7z && !(m[0] === 0x50 && m[1] === 0x4B)) throw new Error("That is not the port's download. Pick the Atmosphere .7z from the port's Releases.");
  const files = is7z ? await read7z(m) : await readZip(m);
  const key = [...files.keys()].find(n => n.endsWith('romfs/Bcsv/ItemParam.bcsv'));
  if (!key) throw new Error('No romfs/Bcsv/ItemParam.bcsv in that file. Pick the Atmosphere download of the port (not the Emulator one).');
  const base = key.slice(0, -'Bcsv/ItemParam.bcsv'.length);
  const get = async r => { const f = files.get(base + r); if (!f) throw new Error(r + ' is missing from that download.'); return f(); };
  const done = new Map();
  for (const [r, p] of Object.entries(patch.bcsv)) {
    const d = (await get(r)).slice();
    if (await sha256(d) !== p.in_sha256) throw new Error(r + ' is not the one from ' + patch.release + '. The patch only fits that release.');
    for (const [off, b] of p.edits) d.set(unb64(b), off);
    if (await sha256(d) !== p.out_sha256) throw new Error(r + ' came out wrong. Please open an issue.');
    done.set(r, d);
  }
  const S = patch.strings, plain = zstd(await get(S.file));
  if (await sha256(plain) !== S.in_content_sha256) throw new Error(S.file + ' is not the one from ' + patch.release + '.');
  const sar = sarcParse(plain), repl = new Map();
  for (const [name, e] of Object.entries(S.msbt)) {
    const ent = sar.ents.find(x => x.name === name); if (!ent) throw new Error('missing ' + name);
    repl.set(name, msbtEdit(ent.data, e.add, e.set));
  }
  const nsar = sarcReplace(plain, repl);
  if (await sha256(nsar) !== S.out_content_sha256) throw new Error(S.file + ' came out wrong. Please open an issue.');
  done.set(S.file, zstdRaw(nsar));
  const R = patch.rstb, tab = cat([utf8('RSTC'), u32(R.count), await inflateRaw(unb64(R.data))]);
  if (await sha256(tab) !== R.content_sha256) throw new Error('The size table came out wrong. Please open an issue.');
  done.set('System/Resource/ResourceSizeTable.srsizetable', yaz0Raw(tab));
  // Device-tested on ACNH 3.0.3: the port's 2.x-era EventFlow files hang the load, UnitIcon models crash it, other Message files are not 3.0.3's
  const BAD = /^(EventFlow\/|Model\/UnitIcon|Message\/(?!String_USen))/;
  const EF = patch.eventflow, okFlow = new Set((EF ? EF.flows : []).map(f => 'EventFlow/' + f + '.bfevfl'));
  if (EF) {   // 3.0.3's Info byml plus the port's additions: put back the 3.0.3 values of the entries the port changed
    const d = await get(EF.file);
    if (await sha256(d) !== EF.in_sha256) throw new Error(EF.file + ' is not the one from ' + patch.release + '. The patch only fits that release.');
    const m = bymlRead(d); for (const [k, x] of Object.entries(EF.revert)) Object.assign(m[k], x);
    const o = bymlWrite(m); if (await sha256(o) !== EF.out_sha256) throw new Error(EF.file + ' came out wrong. Please open an issue.');
    done.set(EF.file, o);
  }
  const drop = new Set(patch.drop), out = `atmosphere/contents/${TID}/romfs/`, entries = [];
  for (const name of [...files.keys()].filter(k => k.startsWith(base)).sort()) {
    const r = name.slice(base.length); if (drop.has(r) || done.has(r) || (BAD.test(r) && !okFlow.has(r))) continue;
    entries.push([out + r, await files.get(name)()]);
  }
  for (const [r, d] of done) entries.push([out + r, d]);
  return { zip: writeZip(entries), romfs: entries.length };
}

if (typeof document !== 'undefined') {
  const $ = id => document.getElementById(id), status = (t, cls) => { $('status').textContent = t; $('status').className = cls || ''; };
  const ready = () => { $('go').disabled = !($('mod').files.length && $('patch').files.length); };
  const picked = id => { const f = $(id).files[0]; $(id + '-name').textContent = f ? f.name : 'No file yet'; $('step-' + id).classList.toggle('done', !!f); ready(); };
  $('mod').onchange = () => picked('mod'); $('patch').onchange = () => picked('patch');
  $('go').onclick = async () => {
    $('go').disabled = true; status('Working…');
    try {
      let patch;
      try { patch = JSON.parse(await $('patch').files[0].text()); } catch { throw new Error('That is not the jub-port-patch.json file.'); }
      const r = await build(new Uint8Array(await $('mod').files[0].arrayBuffer()), patch, d => fzstd.decompress(d));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(r.zip); a.download = 'jubbsticks-additions-peanuts.zip'; document.body.append(a); a.click(); a.remove();
      status(`Done: jubbsticks-additions-peanuts.zip (${(r.zip.size / 1048576).toFixed(1)} MB, ${r.romfs} files). Install it in Peanuts, last in the mod order.`, 'ok');
    } catch (e) { status(e.message, 'err'); }
    ready();
  };
}
if (typeof module !== 'undefined') module.exports = { build };
