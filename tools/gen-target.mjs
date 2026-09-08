// Writes the printable calibration target to <repo>/target.svg (A4 portrait, mm units).
// Usage: node tools/gen-target.mjs
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { targetSvg } from '../src/testing/targetSvg.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'target.svg');
const svg = '<?xml version="1.0" encoding="UTF-8"?>\n' + targetSvg({}) + '\n';
writeFileSync(out, svg, 'utf8');
console.log(`wrote ${path.relative(root, out)} (${svg.length} bytes)`);
