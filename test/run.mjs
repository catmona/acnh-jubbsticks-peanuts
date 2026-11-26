// node test/run.mjs <port Atmosphere .7z or zip> [<out zip>] [<other mod zip> ...]
// Builds the port through docs/app.js (the same code as docs/engine.js) and checks that every output file fits its entry in the
// output's own size table (decompressed size for .zs and Yaz0 files). Exit 1 if the build throws or a file is over its entry.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const fzstd = require('../tools/fzstd.umd.js');
const { build, readZip, yaz0Dec, rstcParse, crc32, utf8 } = require('../docs/app.js');
const [src, out, ...others] = process.argv.slice(2);
if (!src) { console.error('usage: node test/run.mjs <port .7z or zip> [out zip] [other mod zips]'); process.exit(2); }
const RS = 'System/Resource/ResourceSizeTable.srsizetable', t0 = Date.now();
const zsSize = b => {   // frame header's content size, else decompress
  if (b[0] === 0x28 && b[1] === 0xB5 && b[2] === 0x2F && b[3] === 0xFD) {
    const fhd = b[4], single = (fhd >> 5) & 1, did = [0, 1, 2, 4][fhd & 3], o = 5 + (single ? 0 : 1) + did, n = [single ? 1 : 0, 2, 4, 8][fhd >> 6];
    if (n) { let v = 0; for (let i = n - 1; i >= 0; i--) v = v * 256 + b[o + i]; return v + (n === 2 ? 256 : 0); }
  }
  return fzstd.decompress(b).length;
};
const decSize = (rel, b) => rel.endsWith('.zs') ? zsSize(b) : (b[0] === 0x59 && b[1] === 0x61 && b[2] === 0x7a && b[3] === 0x30) ? new DataView(b.buffer, b.byteOffset).getUint32(4, false) : b.length;
const r = await build(new Uint8Array(fs.readFileSync(src)), d => fzstd.decompress(d), others.map(p => ({ name: p.split(/[\/]/).pop(), bytes: new Uint8Array(fs.readFileSync(p)) })));
const zbytes = new Uint8Array(await r.zip.arrayBuffer());
if (out) fs.writeFileSync(out, Buffer.from(zbytes));
const files = await readZip(zbytes), prefix = [...files.keys()].find(n => n.endsWith(RS)).slice(0, -RS.length);
const T = rstcParse(yaz0Dec(await files.get(prefix + RS)())), over = [], none = [];
for (const name of [...files.keys()].sort()) {
  const rel = name.slice(prefix.length); if (rel === RS) continue;
  const dec = decSize(rel, await files.get(name)()), e = T.ents.get(crc32(utf8(rel.endsWith('.zs') ? rel.slice(0, -3) : rel)));
  if (!e) none.push(rel); else if (dec > e[0]) over.push(`${rel}: ${dec} > ${e[0]}`);
}
console.log(`built ${r.romfs} files, ${(zbytes.length / 1048576).toFixed(1)} MB in ${Date.now() - t0} ms; ${r.merged.join('; ') || 'no other mods'}`);
console.log(`${none.length} files have no size entry (the game's default applies), ${over.length} are over their entry`);
for (const l of over.slice(0, 200)) console.log('OVER ' + l);
process.exitCode = over.length ? 1 : 0;
