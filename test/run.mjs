// node test/run.mjs <his Atmosphere .7z or zip> <patch.json> <out zip> [<other mod zip> --expect <zip whose size table the result must equal>]
// Format 2 patches also take --no-fix, --on id,id (the optional fixes) and --report <json> (the release found and each fix's state).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const fzstd = require('../tools/fzstd.umd.js');
const { build: build1, build2, report2, yaz0Dec, readZip } = require('../docs/app.js');
const argv = process.argv.slice(2), flag = k => { const i = argv.indexOf(k); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, k === '--no-fix' ? 1 : 2); return v ?? true; };
const noFix = flag('--no-fix') !== undefined, onArg = flag('--on'), reportTo = flag('--report');
const [zip, patch, out, other, , expect] = argv;
const P = JSON.parse(fs.readFileSync(patch, 'utf8')), mod = new Uint8Array(fs.readFileSync(zip)), z = d => fzstd.decompress(d);
const RS = 'System/Resource/ResourceSizeTable.srsizetable';
const table = async b => { const f = await readZip(b); return yaz0Dec(await f.get([...f.keys()].find(n => n.endsWith(RS)))()); };
const on = typeof onArg === 'string' ? new Set(onArg.split(',')) : null;
const build = P.format === 2 ? (m, p, zz, o = []) => build2(m, p, zz, o, !noFix, on) : (m, p, zz, o = []) => build1(m, p, zz, o, !noFix);
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
if (r.release) {
  const R = r.release; console.log('release', R.name, R.exact ? 'exact' : `(closest; ${R.changed.length} changed, ${R.new.length} new, ${R.gone.length} gone)`);
  for (const l of report2(P, r)) console.log(l);
  if (reportTo) fs.writeFileSync(reportTo, JSON.stringify({ release: R, fixes: r.rep }, null, 1));
}
console.log('built', r.romfs, 'files,', (r.zip.size / 1048576).toFixed(1), 'MB in', Date.now() - t0, 'ms');
