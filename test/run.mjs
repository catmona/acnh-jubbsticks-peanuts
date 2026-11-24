// node test/run.mjs <his Atmosphere .7z or zip> <patch.json> <out zip>
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const fzstd = require('../tools/fzstd.umd.js');
const { build } = require('../docs/app.js');
const [zip, patch, out] = process.argv.slice(2);
const t0 = Date.now();
const r = await build(new Uint8Array(fs.readFileSync(zip)), JSON.parse(fs.readFileSync(patch, 'utf8')), d => fzstd.decompress(d));
fs.writeFileSync(out, Buffer.from(await r.zip.arrayBuffer()));
console.log('built', r.romfs, 'files,', (r.zip.size / 1048576).toFixed(1), 'MB in', Date.now() - t0, 'ms');
