// node test/run.mjs <his Atmosphere .7z or zip> <patch.json> <out zip> [<other mod zip> --expect <zip whose size table the result must equal>]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const fzstd = require('../tools/fzstd.umd.js');
const { build, yaz0Dec, readZip } = require('../docs/app.js');
const [zip, patch, out, other, , expect] = process.argv.slice(2);
const P = JSON.parse(fs.readFileSync(patch, 'utf8')), mod = new Uint8Array(fs.readFileSync(zip)), z = d => fzstd.decompress(d);
const RS = 'System/Resource/ResourceSizeTable.srsizetable';
const table = async b => { const f = await readZip(b); return yaz0Dec(await f.get([...f.keys()].find(n => n.endsWith(RS)))()); };
const t0 = Date.now();
const plain = await build(mod, P, z);
const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
let r = plain;
if (other) {
  r = await build(mod, P, z, [{ name: 'combined.zip', bytes: new Uint8Array(fs.readFileSync(other)) }]);
  const got = await table(new Uint8Array(await r.zip.arrayBuffer()));
  console.log('status:', r.merged.join('; '));
  if (expect) {
    const want = await table(new Uint8Array(fs.readFileSync(expect)));
    console.log('merged table equals', expect.split('/').pop(), ':', same(got, want), got.length, 'bytes');
    if (!same(got, want)) process.exitCode = 1;
  }
  console.log('no-others table differs from merged:', !same(await table(new Uint8Array(await plain.zip.arrayBuffer())), got));
}
fs.writeFileSync(out, Buffer.from(await r.zip.arrayBuffer()));
console.log('built', r.romfs, 'files,', (r.zip.size / 1048576).toFixed(1), 'MB in', Date.now() - t0, 'ms');
