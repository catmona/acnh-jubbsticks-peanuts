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

function yaz0Dec(b) {
  if (hex(b.subarray(0, 4)) !== '59617a30') throw new Error('not a Yaz0 file');
  const n = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(4, false), out = new Uint8Array(n);
  let i = 16, o = 0, code = 0, bits = 0;
  while (o < n) {
    if (!bits) { code = b[i++]; bits = 8; }
    if (code & 0x80) out[o++] = b[i++];
    else {
      const b1 = b[i++], b2 = b[i++]; let len = b1 >> 4; const src = o - (((b1 & 15) << 8) | b2) - 1;
      len = len ? len + 2 : b[i++] + 18;
      for (let k = 0; k < len && o < n; k++) out[o + k] = out[src + k];
      o += Math.min(len, n - o);
    }
    code = (code << 1) & 0xff; bits--;
  }
  return out;
}
// RSTC table: 'RSTC', u32 count, u32 version, count x (u32 crc, u32 size, u32 0) sorted by crc, then a tail
function rstcParse(t) {
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength); if (hex(t.subarray(0, 4)) !== '52535443') throw new Error('not a size table');
  const n = v.getUint32(4, true), ents = new Map();
  for (let i = 0; i < n; i++) ents.set(v.getUint32(12 + 12 * i, true), [v.getUint32(16 + 12 * i, true), v.getUint32(20 + 12 * i, true)]);
  return { ver: v.getUint32(8, true), ents, tail: t.subarray(12 + 12 * n) };
}
// Our table, with every size raised to the other mod's where that is larger, and its entries added
function rstcMerge(ours, theirs) {
  const A = rstcParse(ours), B = rstcParse(theirs); let raised = 0, added = 0;
  if (A.ver !== B.ver) throw new Error('Its size table is version ' + B.ver + ', ours is ' + A.ver + '.');
  for (const [k, e] of B.ents) {
    const a = A.ents.get(k);
    if (!a) { A.ents.set(k, e); added++; } else if (e[0] > a[0]) { a[0] = e[0]; raised++; }
  }
  const keys = [...A.ents.keys()].sort((x, y) => x - y), out = new Uint8Array(12 + 12 * keys.length + A.tail.length), v = new DataView(out.buffer);
  out.set([0x52, 0x53, 0x54, 0x43]); v.setUint32(4, keys.length, true); v.setUint32(8, A.ver, true);
  keys.forEach((k, i) => { const e = A.ents.get(k); v.setUint32(12 + 12 * i, k, true); v.setUint32(16 + 12 * i, e[0], true); v.setUint32(20 + 12 * i, e[1], true); });
  out.set(A.tail, 12 + 12 * keys.length);
  return { tab: out, raised, added };
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
  const A = find('ATR1'), es = A ? new DataView(A[1].buffer, A[1].byteOffset, A[1].byteLength).getUint32(4, true) : 0, attrs = [];
  for (const [name, t, a] of add) {   // a: the label's ATR1 entry, for files whose entries are not 0 bytes
    if (idx.has(name)) throw new Error('label already there: ' + name);
    const ab = a ? unb64(a) : new Uint8Array(0); if (ab.length !== es) throw new Error('attribute size for ' + name);
    idx.set(name, texts.length); texts.push(unb64(t)); attrs.push(ab);
  }
  if (attrs.length && es && A[1].length !== 8 + es * cnt) throw new Error('ATR1 has a string pool; not handled');
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
    const m = String.fromCharCode(...mg), d = m === 'LBL1' ? newL : m === 'TXT2' ? newT : m === 'ATR1' ? cat([u32(texts.length), d0.subarray(4), ...attrs]) : d0;
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

async function build(modBytes, patch, zstd, others = [], fix = true) {   // others: [{ name, bytes }] other mods' zips; fix: the memory fix goes in too
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
  // Message sarcs: put back the 3.0.3 labels the port's copies lack ('strings' is String_USen, 'messages' the others)
  for (const S of [patch.strings, ...(patch.messages || [])]) {
    const plain = zstd(await get(S.file));
    if (await sha256(plain) !== S.in_content_sha256) throw new Error(S.file + ' is not the one from ' + patch.release + '.');
    const sar = sarcParse(plain), repl = new Map();
    for (const [name, e] of Object.entries(S.msbt)) {
      const ent = sar.ents.find(x => x.name === name); if (!ent) throw new Error('missing ' + name);
      repl.set(name, msbtEdit(ent.data, e.add, e.set));
    }
    const nsar = sarcReplace(plain, repl);
    if (await sha256(nsar) !== S.out_content_sha256) throw new Error(S.file + ' came out wrong. Please open an issue.');
    done.set(S.file, zstdRaw(nsar));
  }
  const R = patch.rstb, tab = cat([utf8('RSTC'), u32(R.count), await inflateRaw(unb64(R.data))]);
  if (await sha256(tab) !== R.content_sha256) throw new Error('The size table came out wrong. Please open an issue.');
  // Peanuts takes a file from the first-installed mod, so this table must also allow every size the other mods raised
  const RS = 'System/Resource/ResourceSizeTable.srsizetable', merged = [];
  let mt = tab;
  for (const o of others) {
    const ob = o.bytes, o7 = ob[0] === 0x37 && ob[1] === 0x7A, of = o7 ? await read7z(ob) : await readZip(ob);
    const k = [...of.keys()].find(n => n.endsWith(RS));
    if (!k) { merged.push(o.name + ': no size table, skipped'); continue; }
    let t; try { t = yaz0Dec(await of.get(k)()); } catch (e) { throw new Error(o.name + ': ' + e.message); }
    let r; try { r = rstcMerge(mt, t); } catch (e) { throw new Error(o.name + ': ' + e.message); }
    mt = r.tab; merged.push(`raised ${r.raised}, added ${r.added} from ${o.name}`);
  }
  done.set(RS, yaz0Raw(mt));
  // EventFlow: only the listed new flows go in (the port's 2.x-era copies of 3.0.3 flows hang the load). The UnitIcon models
  // ('with_fix') overflow a fixed game heap and crash ACNH 3.0.3 at the title unless the memory fix is installed, so they go in
  // only with it. A patch without 'with_fix' predates the fix and keeps them out; one without 'messages' predates the label
  // fix of the other Message sarcs, so it keeps those out too.
  const BAD = patch.with_fix ? /^EventFlow\// : patch.messages ? /^(EventFlow\/|Model\/UnitIcon)/ : /^(EventFlow\/|Model\/UnitIcon|Message\/(?!String_USen))/;
  const needFix = new Set(fix ? [] : patch.with_fix || []);
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
    const r = name.slice(base.length); if (drop.has(r) || needFix.has(r) || done.has(r) || (BAD.test(r) && !okFlow.has(r))) continue;
    entries.push([out + r, await files.get(name)()]);
  }
  for (const [r, d] of done) entries.push([out + r, d]);
  return { zip: writeZip(entries), romfs: entries.length, merged, icons: (patch.with_fix || []).length - needFix.size };
}

// ---- Patch format 2: fixes by meaning, each checked against the file it finds (tools/fix2.py is the Python twin and says more) ----
const h16 = async u => (await sha256(u)).slice(0, 16);
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const hashg = (nm, g) => { let h = 0; for (const ch of utf8(nm)) h = (Math.imul(h, 0x492) + ch) >>> 0; return h % g; };
class Msg {   // an msbt that takes label edits; rebuilt only when edited
  constructor(b) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength), n = v.getUint16(0xE, true); let o = 0x20; this.b = b; this.secs = [];
    for (let i = 0; i < n; i++) { const sz = v.getUint32(o + 4, true); this.secs.push([String.fromCharCode(...b.subarray(o, o + 4)), b.subarray(o + 16, o + 16 + sz)]); o = (o + 16 + sz + 15) & ~15; }
    const sec = m => (this.secs.find(s => s[0] === m) || [])[1], L = sec('LBL1'), T = sec('TXT2'), A = sec('ATR1');
    const lv = new DataView(L.buffer, L.byteOffset, L.byteLength), tv = new DataView(T.buffer, T.byteOffset, T.byteLength);
    this.g = lv.getUint32(0, true); this.idx = new Map(); const lab = [];
    for (let i = 0; i < this.g; i++) {
      const c = lv.getUint32(4 + 8 * i, true); let p = lv.getUint32(8 + 8 * i, true);
      for (let k = 0; k < c; k++) { const ln = L[p]; lab.push([new TextDecoder().decode(L.subarray(p + 1, p + 1 + ln)), lv.getUint32(p + 1 + ln, true)]); p += 5 + ln; }
    }
    this.idx = new Map(lab);
    const cnt = tv.getUint32(0, true), offs = [...Array(cnt)].map((_, i) => tv.getUint32(4 + 4 * i, true)).concat([T.length]);
    this.T = [...Array(cnt)].map((_, i) => T.subarray(offs[i], offs[i + 1]));
    this.A = A ? A.slice() : null; this.es = A ? new DataView(A.buffer, A.byteOffset, A.byteLength).getUint32(4, true) : 0;
    this.n0 = cnt; this.nw = []; this.dirty = false;
  }
  atr(i) { return !this.es ? new Uint8Array(0) : i < this.n0 ? this.A.subarray(8 + this.es * i, 8 + this.es * (i + 1)) : this.nw[i - this.n0]; }
  get(l) { const i = this.idx.get(l); return i === undefined ? null : [this.T[i], this.atr(i)]; }
  put(l, t, a) {
    const i = this.idx.get(l);
    if (i === undefined) {
      a = a || new Uint8Array(0); if (a.length !== this.es) throw new Error('attribute size for ' + l);
      if (a.length && this.A.length !== 8 + this.es * this.n0) throw new Error('ATR1 has a string pool; not handled');
      this.idx.set(l, this.T.length); this.T.push(t); this.nw.push(a);
    } else {
      this.T[i] = t;
      if (a && this.es) { if (i < this.n0) this.A.set(a, 8 + this.es * i); else this.nw[i - this.n0] = a; }
    }
    this.dirty = true;
  }
  build() {
    const groups = [...Array(this.g)].map(() => []);
    for (const [nm, i] of [...this.idx].sort((a, c) => a[1] - c[1])) groups[hashg(nm, this.g)].push([nm, i]);
    const body = [], head = [u32(this.g)]; let off = 4 + 8 * this.g;
    for (const gr of groups) {
      head.push(u32(gr.length), u32(off));
      for (const [nm, i] of gr) { const nb = utf8(nm), e = cat([new Uint8Array([nb.length]), nb, u32(i)]); body.push(e); off += e.length; }
    }
    const newL = cat([...head, ...body]); let to = 4 + 4 * this.T.length; const toffs = [];
    for (const t of this.T) { toffs.push(to); to += t.length; }
    const newT = cat([u32(this.T.length), ...toffs.map(u32), ...this.T]);
    const out = [this.b.slice(0, 0x20)]; let len = 0x20;
    for (const [m, d0] of this.secs) {
      const d = m === 'LBL1' ? newL : m === 'TXT2' ? newT : m === 'ATR1' ? cat([u32(this.T.length), this.A.subarray(4), ...this.nw]) : d0;
      const hdr = new Uint8Array(16); hdr.set(utf8(m)); new DataView(hdr.buffer).setUint32(4, d.length, true); out.push(hdr, d); len += 16 + d.length;
      const pad = (16 - (len % 16)) % 16; if (pad) { out.push(new Uint8Array(pad).fill(0xab)); len += pad; }
    }
    const r = cat(out); new DataView(r.buffer).setUint32(0x12, r.length, true); return r;
  }
}
class Tab {   // a bcsv: header, then fixed-size rows to the end of the file; the row count is the first u32
  constructor(b) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength), n = v.getUint32(0, true), fc = v.getUint16(8, true);
    this.b = b; this.el = v.getUint32(4, true); const hdr = String.fromCharCode(...b.subarray(0xC, 0x10)) === 'VSCB' ? 0x1C : 0x0C;
    this.F = new Map(); for (let i = 0; i < fc; i++) this.F.set(v.getUint32(hdr + 8 * i, true).toString(16).padStart(8, '0'), v.getUint32(hdr + 8 * i + 4, true));
    const offs = [...this.F.values()].sort((a, c) => a - c).concat([this.el]); this.size = new Map([...this.F].map(([c, o]) => [c, offs[offs.indexOf(o) + 1] - o]));
    this.ds = hdr + 8 * fc; if (this.ds + this.el * n !== b.length) throw new Error('bcsv with a tail');
    this.rows = [...Array(n)].map((_, r) => b.slice(this.ds + this.el * r, this.ds + this.el * (r + 1))); this.dirty = false;
  }
  key(r, c) { const o = this.F.get(c), z = Math.min(this.size.get(c), 4); let k = 0; for (let i = z - 1; i >= 0; i--) k = k * 256 + r[o + i]; return k; }
  find(c, k) { const i = this.rows.findIndex(r => this.key(r, c) === k); return i < 0 ? null : i; }
  field(i, c) { const o = this.F.get(c); return this.rows[i].subarray(o, o + this.size.get(c)); }
  setf(i, c, v) { this.rows[i].set(v, this.F.get(c)); this.dirty = true; }
  insert(c, k, row) {
    const ks = this.rows.map(r => this.key(r, c)); let at = ks.length;
    if (ks.every((x, i) => i === 0 || ks[i - 1] <= x)) { const j = ks.findIndex(x => x > k); at = j < 0 ? ks.length : j; }
    this.rows.splice(at, 0, row.slice()); this.dirty = true;
  }
  build() { return cat([u32(this.rows.length), this.b.subarray(4, this.ds), ...this.rows]); }
}
function zsSize(b, zstd) {   // a zstd file's decompressed size: the frame header's content size when it has one
  if (b[0] === 0x28 && b[1] === 0xB5 && b[2] === 0x2F && b[3] === 0xFD) {
    const fhd = b[4], fcs = fhd >> 6, single = (fhd >> 5) & 1, did = [0, 1, 2, 4][fhd & 3], o = 5 + (single ? 0 : 1) + did, n = [single ? 1 : 0, 2, 4, 8][fcs];
    if (n) { let v = 0; for (let i = n - 1; i >= 0; i--) v = v * 256 + b[o + i]; return v + (n === 2 ? 256 : 0); }
  }
  return zstd(b).length;
}
const decSize = (rel, b, zstd) => rel.endsWith('.zs') ? zsSize(b, zstd) : (b[0] === 0x59 && b[1] === 0x61 && b[2] === 0x7a && b[3] === 0x30) ? new DataView(b.buffer, b.byteOffset).getUint32(4, false) : b.length;
function sizeTable(base, portTable, out, zstd) {   // build_rstb.py's rule over every file that goes out
  const T = rstcParse(base), P = portTable ? rstcParse(portTable).ents : new Map(), up = n => Math.ceil(n / 32) * 32;
  for (const rel of [...out.keys()].sort()) {
    if (rel === RS2) continue;
    const dec = decSize(rel, out.get(rel), zstd), k = crc32(utf8(rel.endsWith('.zs') ? rel.slice(0, -3) : rel)), e = T.ents.get(k);
    if (e) { const old = e[0], model = rel.includes('.Nin_NX_NVN'); e[0] = (model && old - dec < 16384) ? Math.max(old, up(dec) + old) : model ? old : Math.max(old, up(dec) + 1024); }
    else if (P.has(k)) T.ents.set(k, P.get(k).slice());
  }
  const keys = [...T.ents.keys()].sort((x, y) => x - y), o = new Uint8Array(12 + 12 * keys.length + T.tail.length), v = new DataView(o.buffer);
  o.set([0x52, 0x53, 0x54, 0x43]); v.setUint32(4, keys.length, true); v.setUint32(8, T.ver, true);
  keys.forEach((k, i) => { const e = T.ents.get(k); v.setUint32(12 + 12 * i, k, true); v.setUint32(16 + 12 * i, e[0], true); v.setUint32(20 + 12 * i, e[1], true); });
  o.set(T.tail, 12 + 12 * keys.length); return o;
}
const RS2 = 'System/Resource/ResourceSizeTable.srsizetable';
async function census(files) { const C = new Map(); for (const [r, b] of files) C.set(r, await h16(b)); return C; }
function closest(patch, C) {   // the release these files are, or the closest one and how far off
  let best = null;
  for (const [name, R] of Object.entries(patch.releases)) {
    const same = Object.entries(R).filter(([r, h]) => C.get(r) === h).length, s = [same, -Math.abs(C.size - Object.keys(R).length)];
    if (!best || s[0] > best.s[0] || (s[0] === best.s[0] && s[1] > best.s[1])) best = { s, name, R };
  }
  const R = best.R, changed = Object.keys(R).filter(r => C.has(r) && C.get(r) !== R[r]).sort(), gone = Object.keys(R).filter(r => !C.has(r)).sort();
  const nw = [...C.keys()].filter(r => !(r in R)).sort();
  return { name: best.name, exact: !(changed.length || gone.length || nw.length), changed, gone, new: nw };
}
class State {
  constructor(files, zstd) { this.files = files; this.zstd = zstd; this.S = new Map(); this.B = new Map(); this.Y = new Map(); this.drop = new Set(); this.repl = new Map(); }
  has(r) { return this.files.has(r) && !this.drop.has(r); }
  sarc(r) {
    if (!this.S.has(r)) {
      if (!this.has(r)) this.S.set(r, null);
      else { const raw = this.zstd(this.files.get(r)), sp = sarcParse(raw), M = new Map(); this.S.set(r, { raw, ents: new Map(sp.ents.map(e => [e.name, e])), M }); }
    }
    return this.S.get(r);
  }
  msg(S, name) { if (!S.M.has(name)) { const e = S.ents.get(name); if (!e) return null; S.M.set(name, new Msg(e.data)); } return S.M.get(name); }
  tab(r) { if (!this.B.has(r)) this.B.set(r, this.has(r) ? new Tab(this.files.get(r)) : null); return this.B.get(r); }
  yml(r) { if (!this.Y.has(r)) this.Y.set(r, this.has(r) ? [bymlRead(this.files.get(r)), false] : null); return this.Y.get(r); }
}
const jeq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function checkOp(st, op) {   // [state, why, apply or null]
  const k = op[0];
  if (k === 'msg') {
    const [, f, m, l, mode, pre, t0, a0] = op, S = st.sarc(f); if (!S) return ['gone', f];
    const M = st.msg(S, m); if (!M) return ['gone', f + ':' + m];
    const t = unb64(t0), a = a0 === null ? null : unb64(a0), cur = M.get(l);
    if (mode === 'add') return cur ? ['ok', ''] : ['done', '', () => M.put(l, t, a)];
    if (!cur) return ['gone', m + ':' + l];
    if (eq(cur[0], t) && (a === null || eq(cur[1], a))) return ['ok', ''];
    if (await h16(cat([cur[0], cur[1]])) !== pre) return ['diff', m + ':' + l];
    return ['done', '', () => M.put(l, t, a)];
  }
  if (k === 'cell' || k === 'row') {
    const f = op[1], T = st.tab(f); if (!T) return ['gone', f];
    const kc = op[2], key = op[3]; if (!T.F.has(kc)) return ['diff', f + ' has no column ' + kc];
    const i = T.find(kc, key);
    if (k === 'row') {
      const row = unb64(op[4]);
      if (i !== null) return eq(T.rows[i], row) ? ['ok', ''] : ['diff', `${f} row ${key}`];
      if (row.length !== T.el) return ['diff', f + ' row size'];
      return ['done', '', () => T.insert(kc, key, row)];
    }
    const c = op[4], pre = unb64(op[5]), nw = unb64(op[6]);
    if (i === null) return ['gone', `${f} row ${key}`];
    if (!T.F.has(c) || T.size.get(c) !== nw.length) return ['diff', f + ' column ' + c];
    const cur = T.field(i, c);
    if (eq(cur, nw)) return ['ok', '']; if (!eq(cur, pre)) return ['diff', `${f} row ${key} ${c}`];
    return ['done', '', () => T.setf(i, c, nw)];
  }
  if (k === 'byml') {
    const [, f, path, pre, nw] = op, Y = st.yml(f); if (!Y) return ['gone', f];
    let d = Y[0]; for (const p of path.slice(0, -1)) { d = d && typeof d === 'object' && !Array.isArray(d) ? d[p] : undefined; }
    if (!d || typeof d !== 'object' || Array.isArray(d)) return ['gone', f + ':' + path.join('/')];
    const last = path[path.length - 1], cur = last in d ? d[last] : null;
    if (jeq(cur, nw)) return ['ok', '']; if (!jeq(cur, pre)) return ['diff', f + ':' + path.join('/')];
    return ['done', '', () => { d[last] = nw; Y[1] = true; }];
  }
  if (k === 'drop') return st.has(op[1]) ? ['done', '', () => st.drop.add(op[1])] : ['ok', ''];
  if (k === 'delta') {
    const [, f, pre, parts] = op; if (!st.has(f)) return ['gone', f];
    const cur = st.repl.get(f) || st.files.get(f); if (await h16(cur) !== pre) return ['diff', f];
    return ['done', '', () => st.repl.set(f, cat(parts.map(p => typeof p === 'string' ? unb64(p) : cur.subarray(p[0], p[0] + p[1]))))];
  }
  throw new Error('unknown op ' + k);
}
// files: Map romfs path -> bytes. on: Set of the optional fix ids to apply (null: their defaults). others: other mods' plain size tables.
async function apply2(patch, files, zstd, on = null, memfix = true, others = []) {
  const st = new State(files, zstd), rep = [];
  for (const fx of patch.fixes) {
    const want = (on === null || !fx.optional) ? fx.default !== false : on.has(fx.id);
    if (!want) { rep.push({ id: fx.id, state: 'off' }); continue; }
    const res = []; for (const op of fx.ops) res.push(await checkOp(st, op));
    const bad = res.filter(r => r[0] === 'gone' || r[0] === 'diff'); let todo = res.filter(r => r[0] === 'done').map(r => r[2]), state;
    if (bad.length && !fx.partial) { state = 'skipped'; todo = []; } else state = bad.length ? 'partial' : todo.length ? 'applied' : 'already';
    for (const a of todo) a();
    rep.push({ id: fx.id, state, done: todo.length, ops: fx.ops.length, why: [...new Set(bad.map(b => b[1]))].sort().slice(0, 8), nbad: bad.length });
  }
  const gate = new Set(memfix ? [] : patch.with_fix || []), out = new Map();
  for (const [r, b] of files) { if (st.drop.has(r) || gate.has(r) || r === RS2) continue; out.set(r, st.repl.get(r) || b); }
  for (const [r, S] of st.S) {
    if (!S || !out.has(r)) continue;
    const repl = new Map([...S.M].filter(([, m]) => m.dirty).map(([n, m]) => [n, m.build()]));
    if (repl.size) out.set(r, zstdRaw(sarcReplace(S.raw, repl)));
  }
  for (const [r, T] of st.B) if (T && T.dirty && out.has(r)) out.set(r, T.build());
  for (const [r, Y] of st.Y) if (Y && Y[1] && out.has(r)) out.set(r, bymlWrite(Y[0]));
  const R = patch.rstb, base = cat([utf8('RSTC'), u32(R.count), await inflateRaw(unb64(R.data))]);
  if (await sha256(base) !== R.content_sha256) throw new Error('The size table came out wrong. Please open an issue.');
  let tab = sizeTable(base, files.has(RS2) ? yaz0Dec(files.get(RS2)) : null, out, zstd);
  const merged = [];
  for (const o of others) { const r = rstcMerge(tab, o.table); tab = r.tab; merged.push(`raised ${r.raised}, added ${r.added} from ${o.name}`); }
  out.set(RS2, tab);
  return { out, rep, merged };
}
// Format 2 build: the port's download in, one zip out, plus what was found and what each fix did.
async function build2(modBytes, patch, zstd, others = [], fix = true, on = null) {
  const m = modBytes, is7z = m[0] === 0x37 && m[1] === 0x7A && m[2] === 0xBC && m[3] === 0xAF && m[4] === 0x27 && m[5] === 0x1C;
  if (!is7z && !(m[0] === 0x50 && m[1] === 0x4B)) throw new Error("That is not the port's download. Pick the Atmosphere .7z from the port's Releases.");
  const all = is7z ? await read7z(m) : await readZip(m);
  const key = [...all.keys()].find(n => n.endsWith('romfs/Bcsv/ItemParam.bcsv'));
  if (!key) throw new Error('No romfs/Bcsv/ItemParam.bcsv in that file. Pick the Atmosphere download of the port (not the Emulator one).');
  const base = key.slice(0, -'Bcsv/ItemParam.bcsv'.length), files = new Map();
  for (const name of [...all.keys()].filter(k => k.startsWith(base)).sort()) files.set(name.slice(base.length), await all.get(name)());
  const rel = closest(patch, await census(files)), ot = [];
  for (const o of others) {
    const ob = o.bytes, of = ob[0] === 0x37 && ob[1] === 0x7A ? await read7z(ob) : await readZip(ob), k = [...of.keys()].find(n => n.endsWith(RS2));
    if (!k) continue; let t; try { t = yaz0Dec(await of.get(k)()); } catch (e) { throw new Error(o.name + ': ' + e.message); }
    ot.push({ name: o.name, table: t });
  }
  const r = await apply2(patch, files, zstd, on, fix, ot), out = `atmosphere/contents/${TID}/romfs/`, entries = [];
  for (const [p, d] of [...r.out].sort((a, b) => a[0] < b[0] ? -1 : 1)) entries.push([out + p, p === RS2 ? yaz0Raw(d) : d]);
  for (const o of others) if (!ot.find(x => x.name === o.name)) r.merged.push(o.name + ': no size table, skipped');
  return { zip: writeZip(entries), romfs: entries.length, merged: r.merged, rep: r.rep, release: rel, icons: fix ? (patch.with_fix || []).length : 0 };
}
// One line per fix that didn't go in as made, for the page and the release check
function report2(patch, r) {
  const F = new Map(patch.fixes.map(f => [f.id, f])), lines = [];
  for (const x of r.rep) {
    if (x.state === 'skipped') lines.push(`Skipped: ${F.get(x.id).title} (${x.why.join(', ')}${x.nbad > x.why.length ? ', ...' : ''} changed in this release)`);
    else if (x.state === 'partial') lines.push(`Partly applied: ${F.get(x.id).title} (${x.nbad} of ${x.ops} changes did not fit)`);
  }
  return lines;
}

// The memory fix: its own small mod, one IPS for ACNH 3.0.3's main (build ff1d1c05...). It makes the game's fixed
// draw-array heap bigger and grows its parent heap by the same amount, out of memory the game leaves unused. Same bytes
// as the standalone download in the QoL repo (tools/make_memfix.py there).
const MEMFIX = { name: 'acnh-memory-fix-peanuts.zip', set: 'acnh-memory-fix', build_id: 'ff1d1c05670db6021c85b624a710b963',
                 ips: 'SVBTMzIBVjygAAQAgKBSBATXeAAEAABwJkVFT0Y=' };
const memFixZip = () => writeZip([[`atmosphere/exefs_patches/${MEMFIX.set}/${MEMFIX.build_id}.ips`, unb64(MEMFIX.ips)]]);

// Cheap check used when a file is picked: is this the port's download that the patch fits? Throws a friendly message if not.
// A .7z is taken on trust (unpacking it takes seconds; build() checks every file again). A zip is checked by its ItemParam.
async function check(modBytes, patch) {
  if (patch.format !== 1 || patch.tid !== TID) throw new Error('That is not the jub-port-patch.json file.');
  const m = modBytes;
  if (m[0] === 0x37 && m[1] === 0x7A && m[2] === 0xBC && m[3] === 0xAF && m[4] === 0x27 && m[5] === 0x1C) return `Jubbsticks' Additions port ${patch.release.replace(/^UJAP-/, '')}`;
  const files = await readZip(m);
  const key = [...files.keys()].find(n => n.endsWith('romfs/Bcsv/ItemParam.bcsv'));
  if (!key) throw new Error('No romfs/Bcsv/ItemParam.bcsv in that file. Pick the Atmosphere download of the port (not the Emulator one).');
  const EF = patch.eventflow, f = EF && files.get(key.slice(0, -'Bcsv/ItemParam.bcsv'.length) + EF.file);   // the port's own, unedited info file
  if (EF && (!f || await sha256(await f()) !== EF.in_sha256))
    throw new Error('This is not the port ' + patch.release + ' (the patch only fits that release). If it is another mod, add it under "Using other mods too".');
  return `Jubbsticks' Additions port ${patch.release.replace(/^UJAP-/, '')}`;
}

// What the page calls: one zip out (fzstd is the global the page loads before this file).
async function make(modBytes, patch, o = {}) {
  const fix = o.fix !== false, r = await build(modBytes, patch, d => fzstd.decompress(d), o.others || [], fix);
  return { zip: r.zip, note: `${r.romfs} files` + (r.merged.length ? '. Size table: ' + r.merged.join('; ') : '') + (fix ? '' : '. The new fruit and gems have no icons without the memory fix') };
}

if (typeof module !== 'undefined') module.exports = { build, build2, apply2, report2, closest, census, check, make, writeZip, MEMFIX, memFixZip, yaz0Dec, rstcParse, rstcMerge, readZip, read7z, yaz0Raw, inflateRaw, unb64, cat, utf8, u32 };
