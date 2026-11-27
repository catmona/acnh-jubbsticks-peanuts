// node test/run.mjs <port Atmosphere .7z or zip> [<out zip>] [<other mod .zip, .7z or folder> ...]
// Builds the port through docs/app.js (the same code as docs/engine.js), then rebuilds the size table over the output and the
// other mods with acnh-rstb-fixer (docs/rstb, the page's only size-table code) and checks it with the fixer's checkFit.
// Exit 1 if the build or the rebuild throws, or checkFit finds a file over its entry or a lowered entry.
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
const t = await R.rebuild(mods, null, zstd), f = await R.checkFit(t.table, mods, zstd);
const by = {}; for (const x of t.rows) by[x.action] = (by[x.action] || 0) + 1;
console.log(`built ${r.romfs} files, ${(zbytes.length / 1048576).toFixed(1)} MB; size table over ${mods.length} mods in ${Date.now() - t0} ms: ${JSON.stringify(by)}`);
for (const n of t.notes) console.log(n);
console.log(`checkFit: ${f.sized} sized, ${f.removed} geometry models left to the game, ${f.fails.length} fails`);
for (const l of f.fails.slice(0, 200)) console.log('FAIL ' + l);
process.exitCode = f.fails.length ? 1 : 0;
