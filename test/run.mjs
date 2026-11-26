// node test/run.mjs <port Atmosphere .7z or zip> [<out zip>] [<other mod .zip, .7z or folder> ...]
// Builds the port through docs/app.js (the same code as docs/engine.js), then rebuilds the size table over the output and the
// other mods with acnh-rstb-fixer (docs/rstb, the page's only size-table code) and checks every output file fits its entry.
// Exit 1 if the build or the rebuild throws, or a file is over its entry.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const fzstd = require('../tools/fzstd.umd.js'), { build } = require('../docs/app.js');
const F = require('../docs/rstb/lib/formats.js'), R = require('../docs/rstb/lib/rstb.js');
const [src, out, ...others] = process.argv.slice(2);
if (!src) { console.error('usage: node test/run.mjs <port .7z or zip> [out zip] [other mods]'); process.exit(2); }
const t0 = Date.now(), zstd = d => fzstd.decompress(d);
const r = await build(new Uint8Array(fs.readFileSync(src)));
const zbytes = new Uint8Array(await r.zip.arrayBuffer());
if (out) fs.writeFileSync(out, Buffer.from(zbytes));
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const mods = [{ name: 'port', files: await F.readZip(zbytes) }];
for (const p of others) {
  let files;
  if (fs.statSync(p).isDirectory()) { files = new Map(); for (const f of walk(p)) files.set(path.relative(p, f).split(path.sep).join('/'), async () => fs.readFileSync(f)); }
  else { const u = new Uint8Array(fs.readFileSync(p)); files = p.toLowerCase().endsWith('.7z') ? await F.read7z(u) : await F.readZip(u); }
  mods.push({ name: path.basename(p), files });
}
const t = await R.rebuild(mods, null, zstd), T = R.tableParse(t.table), over = [], portOver = [];
const own = [...mods[0].files].find(([n]) => R.romfsPath(n) === R.TABLE), T0 = own && R.tableParse(await own[1]());
for (const [name, get] of mods[0].files) {
  const p = R.romfsPath(name); if (!p || p === R.TABLE) continue;
  const key = p.endsWith('.zs') ? p.slice(0, -3) : p, e = R.tableGet(T, key); if (!e) continue;
  let d = await get(); if (p.endsWith('.zs')) d = zstd(d);
  if (d[0] === 0x59 && d[1] === 0x61 && d[2] === 0x7a && d[3] === 0x30) d = { length: new DataView(d.buffer, d.byteOffset).getUint32(4, false) };
  if (d.length > e[0]) over.push(`${key}: ${d.length} > ${e[0]}`);
  const e0 = T0 && R.tableGet(T0, key); if (e0 && d.length > e0[0]) portOver.push(`${key}: ${d.length} > ${e0[0]}`);
}
const by = {}; for (const x of t.rows) by[x.action] = (by[x.action] || 0) + 1;
console.log(`built ${r.romfs} files, ${(zbytes.length / 1048576).toFixed(1)} MB; size table over ${mods.length} mods in ${Date.now() - t0} ms: ${JSON.stringify(by)}`);
for (const n of t.notes) console.log(n);
for (const l of portOver) console.log(`bigger than the port's own entry (the rebuilt table covers it): ${l}`);
console.log(`${over.length} files over their entry in the rebuilt table`);
for (const l of over.slice(0, 200)) console.log('OVER ' + l);
process.exitCode = over.length ? 1 : 0;
