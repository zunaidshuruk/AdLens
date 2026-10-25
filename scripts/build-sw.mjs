/**
 * Builds the service worker (Sprint 16.5): src/sw/sw.ts → dist/sw.js, stamped with a build id so each
 * release gets its own cache. Run after `vite build`:   node scripts/build-sw.mjs
 * The build id sorts by time (YYYYMMDDHHmm-<git sha>) so old caches can be recognised and retired.
 */
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const now = new Date();
const stamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 12);
let sha = 'local';
try { sha = execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'local'; } catch { /* not a git checkout */ }
const buildId = process.env.BUILD_ID ?? `${stamp}-${sha}`;
if (!/^[0-9]{12}-[A-Za-z0-9]{1,16}$/.test(buildId)) throw new Error(`BUILD_ID must look like 202610251530-abc1234, got "${buildId}"`);

const outDir = process.env.OUT_DIR ?? 'dist';
if (!fs.existsSync(outDir)) throw new Error(`${outDir}/ not found: run "vite build" first.`);
await build({
  entryPoints: ['src/sw/sw.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  outfile: `${outDir}/sw.js`,
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  legalComments: 'none',
  logLevel: 'warning',
});
fs.writeFileSync(`${outDir}/version.json`, JSON.stringify({ buildId }) + '\n');
console.log(`service worker built: ${outDir}/sw.js (${fs.statSync(`${outDir}/sw.js`).size} bytes), build ${buildId}`);
