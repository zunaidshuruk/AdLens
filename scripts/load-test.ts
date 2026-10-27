/**
 * Small load test (Sprint 18). No extra package.
 *
 *   npx tsx scripts/load-test.ts https://your-adlens-address            (public endpoints only)
 *   npx tsx scripts/load-test.ts https://your-adlens-address --token=<Firebase ID token> --path=/api/reports --seconds=20 --concurrency=20
 *
 * Be kind to live data sources: authenticated paths that call Google or Meta count against the shared daily quota. Test those
 * only on a staging copy, or keep --seconds and --concurrency low.
 * Prints requests per second, the 50th/95th/99th percentile response time, and how many answers were errors.
 */
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) ?? 'http://localhost:3000').replace(/\/$/, '');
const opt = (name: string, fallback: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const seconds = Math.min(120, Math.max(1, Number(opt('seconds', '10'))));
const concurrency = Math.min(100, Math.max(1, Number(opt('concurrency', '10'))));
const token = opt('token', '');
const paths = [...new Set(['/api/health', '/api/ops/ready', ...args.filter((a) => a.startsWith('--path=')).map((a) => a.slice(7))])];

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

async function main() {
  const times: number[] = [];
  let errors = 0;
  const byStatus = new Map<number, number>();
  const stopAt = Date.now() + seconds * 1000;
  let n = 0;
  const worker = async () => {
    while (Date.now() < stopAt) {
      const path = paths[n++ % paths.length];
      const start = performance.now();
      try {
        const res = await fetch(`${base}${path}`, { headers: token && path !== '/api/health' ? { Authorization: `Bearer ${token}` } : {} });
        await res.arrayBuffer();
        byStatus.set(res.status, (byStatus.get(res.status) ?? 0) + 1);
        if (res.status >= 500) errors++;
      } catch {
        errors++;
        byStatus.set(0, (byStatus.get(0) ?? 0) + 1);
      }
      times.push(performance.now() - start);
    }
  };
  console.log(`Load test: ${base}  ${concurrency} at a time for ${seconds}s  paths: ${paths.join(', ')}`);
  await Promise.all(Array.from({ length: concurrency }, worker));
  const sorted = [...times].sort((a, b) => a - b);
  console.log(`requests: ${times.length}  (${(times.length / seconds).toFixed(1)}/s)`);
  console.log(`response time ms: p50 ${pct(sorted, 50).toFixed(0)}  p95 ${pct(sorted, 95).toFixed(0)}  p99 ${pct(sorted, 99).toFixed(0)}`);
  console.log(`answers: ${[...byStatus].map(([s, c]) => `${s === 0 ? 'no answer' : s}: ${c}`).join('  ')}`);
  console.log(`server errors or no answer: ${errors}`);
  process.exitCode = errors > times.length * 0.01 ? 1 : 0;
}
void main();
