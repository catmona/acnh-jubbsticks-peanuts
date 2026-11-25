// node test/release-check.mjs <patch.json> <report.json from run.mjs --report, or missing> <port tag> [<build error file>]
// Prints the issue body for the port-release check and writes clean=true|false to $GITHUB_OUTPUT (clean: the port's latest
// release is one the patch was made for and every fix went in).
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { report2 } = require('../docs/app.js');
const [patchPath, reportPath, tag, errPath] = process.argv.slice(2);
const P = JSON.parse(fs.readFileSync(patchPath, 'utf8')), out = [];
const err = errPath && fs.existsSync(errPath) ? fs.readFileSync(errPath, 'utf8').trim() : '';
let clean = false;
out.push(`The port's latest release is \`${tag}\`. This repo's released patch was made for ${P.format === 2 ? Object.keys(P.releases).map(r => '`' + r + '`').join(', ') : '`' + P.release + '`'}.`, '');
if (err) out.push('Building it with the released patch failed:', '', '```', err.slice(-3000), '```');
else if (P.format !== 2) out.push('The released patch is format 1, which fits only its own release and reports nothing per fix. Publish a format 2 `jub-port-patch.json` so this check can say which fixes still fit.');
else if (!fs.existsSync(reportPath)) out.push('The build wrote no report.');
else {
  const r = JSON.parse(fs.readFileSync(reportPath, 'utf8')), R = r.release, lines = report2(P, { rep: r.fixes });
  if (R.exact) out.push(`It is \`${R.name}\`, file for file.`);
  else {
    out.push(`It is not a release the patch knows. Closest: \`${R.name}\`, with ${R.changed.length} files changed, ${R.new.length} new and ${R.gone.length} gone.`);
    for (const [k, L] of [['Changed', R.changed], ['New', R.new], ['Gone', R.gone]])
      if (L.length) out.push('', `<details><summary>${k} (${L.length})</summary>`, '', ...L.slice(0, 300).map(x => '- `' + x + '`'), L.length > 300 ? `- and ${L.length - 300} more` : '', '</details>');
  }
  out.push('');
  if (lines.length) out.push('Fixes that did not go in as made:', '', ...lines.map(l => '- ' + l));
  else out.push('Every fix went in.');
  const off = r.fixes.filter(x => x.state === 'already').map(x => x.id);
  if (off.length) out.push('', 'Already as the fix wants (the port may have fixed these itself): ' + off.map(x => '`' + x + '`').join(', '));
  clean = R.exact && !lines.length;
}
out.push('', 'Made by the scheduled Port release check workflow. To refresh the patch, rerun `tools/make_fixes.py` and `tools/build_patch.py` on the new release (see docs/PORT.md).');
console.log(out.join('\n'));
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `clean=${clean}\n`);
