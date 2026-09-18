/**
 * Copies non-TypeScript static assets (e.g. email logo) from src/ to dist/
 * after tsc runs, since tsc only emits compiled .js files.
 */

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'assets');
const dest = path.join(__dirname, '..', 'dist', 'assets');

if (fs.existsSync(src)) {
  fs.cpSync(src, dest, { recursive: true });
  console.log(`Copied assets: ${src} -> ${dest}`);
}
