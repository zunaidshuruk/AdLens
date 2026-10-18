import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const TARGET_DIRS = ['server', 'api', 'src/types', 'src/utils', 'src/config'];

function collectTsFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

test('all relative import/export specifiers in server/, api/, src/types/, src/utils/ and src/config/ end in .js or .json', () => {
  const violations: string[] = [];

  const fromOrSideEffectRegex =
    /(?:(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?|import\s*\(\s*)['"](\.\.?\/[^'"]+)['"]/g;

  for (const relDir of TARGET_DIRS) {
    const absDir = path.join(ROOT_DIR, relDir);
    const tsFiles = collectTsFiles(absDir);

    for (const filePath of tsFiles) {
      const relFile = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
      const rawContent = fs.readFileSync(filePath, 'utf8');

      // Strip block comments and line comments while preserving line numbers
      const stripped = rawContent
        .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
        .replace(/\/\/.*$/gm, '');

      let match: RegExpExecArray | null;
      fromOrSideEffectRegex.lastIndex = 0;

      while ((match = fromOrSideEffectRegex.exec(stripped)) !== null) {
        const specifier = match[1];
        if (!specifier.endsWith('.js') && !specifier.endsWith('.json')) {
          const offset = match.index + match[0].lastIndexOf(specifier);
          const line = stripped.slice(0, offset).split('\n').length;
          violations.push(`${relFile}:${line} -> "${specifier}"`);
        }
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Relative import/export specifiers missing .js/.json extension:\n${violations.join('\n')}`
  );
});
