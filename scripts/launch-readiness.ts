/** Prints the launch checklist for the current environment: `npx tsx scripts/launch-readiness.ts`. Exit code 1 when something blocks launch. */
import 'dotenv/config';
import { evaluateLaunchReadiness, summariseReadiness } from '../server/lib/launchReadiness.js';

const checks = evaluateLaunchReadiness(process.env);
const icon = { pass: 'OK  ', warn: 'WARN', fail: 'FAIL' } as const;
for (const c of checks) console.log(`${icon[c.status]}  ${c.title}\n      ${c.detail}`);
const s = summariseReadiness(checks);
console.log(`\n${s.ready ? 'Ready to submit.' : `Not ready: ${s.failed} blocking item(s).`} ${s.warned} warning(s).`);
process.exit(s.ready ? 0 : 1);
