// Table-only check, needs no port download: node test/merge.mjs <base zip> <other mod zip> <zip with the expected table>
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { rstcMerge, yaz0Dec, readZip } = require('../docs/app.js');
const get = async p => { const f = await readZip(new Uint8Array(fs.readFileSync(p))); return yaz0Dec(await f.get([...f.keys()].find(n => n.endsWith('ResourceSizeTable.srsizetable')))()); };
const [base, other, expect] = process.argv.slice(2), b = await get(base), want = await get(expect);
const eq = (a, c) => Buffer.compare(Buffer.from(a), Buffer.from(c)) === 0, m = rstcMerge(b, await get(other));
console.log(`raised ${m.raised}, added ${m.added}; merged ${m.tab.length} bytes, expected ${want.length}; equal: ${eq(m.tab, want)}`);
console.log('merge with itself is a no-op:', eq(rstcMerge(b, b).tab, b));
process.exitCode = eq(m.tab, want) ? 0 : 1;
