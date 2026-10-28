// Copies files the built server reads at run time (PDF fonts) next to dist-server/index.js.
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist-server', { recursive: true });
cpSync('server/assets', 'dist-server/assets', { recursive: true });
console.log('copied server/assets to dist-server/assets');
