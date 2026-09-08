// Runs every tests/e2e/smoke-*.mjs script sequentially (each starts its own static server and
// launches headless Chromium via Playwright). Exit code is non-zero if any script fails.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const scripts = readdirSync(dir).filter((f) => /^smoke-.*\.mjs$/.test(f)).sort();
if (scripts.length === 0) {
  console.log('no e2e smoke scripts found');
  process.exit(0);
}
let failed = 0;
for (const s of scripts) {
  console.log(`\n=== ${s} ===`);
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(dir, s)], { stdio: 'inherit', env: process.env });
    child.on('exit', (c) => resolve(c ?? 1));
  });
  if (code !== 0) { failed++; console.log(`FAILED: ${s} (exit ${code})`); }
}
console.log(`\n${scripts.length - failed}/${scripts.length} e2e scripts passed`);
process.exit(failed ? 1 : 0);
