import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const read = (env: Record<string, string>) =>
  execFileSync(process.execPath, ['--import', 'tsx', '-e', "import('./server/config/plans.js').then((m) => console.log(m.DEFAULT_NEW_WORKSPACE_PLAN))"], {
    env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8',
  }).trim();

test('Default plan — new workspaces start on Free unless the setting says otherwise', () => {
  assert.equal(read({}), 'free');
  assert.equal(read({ DEFAULT_NEW_WORKSPACE_PLAN: 'beta' }), 'beta');
  assert.equal(read({ DEFAULT_NEW_WORKSPACE_PLAN: 'pro' }), 'pro');
  assert.equal(read({ DEFAULT_NEW_WORKSPACE_PLAN: 'nonsense' }), 'free', 'an unknown value falls back to Free');
});
