const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(cjs|js)$/.test(file)) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  }
}
for (const dir of ['desktop', 'shared', 'coordinator', 'scripts', 'test']) walk(dir);
console.log('JavaScript syntax checks passed.');
