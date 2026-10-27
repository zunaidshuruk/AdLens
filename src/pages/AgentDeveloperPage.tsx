import { ArrowLeft } from 'lucide-react';
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { NODE_VERIFY_SNIPPET, PYTHON_VERIFY_SNIPPET, WEBHOOK_REPLY_EXAMPLES } from '../utils/agentForm.js';
import { checkSignature, SIGNATURE_PROBLEM } from '../utils/webhookSignature.js';

const REQUEST_EXAMPLE = `POST https://your-service.example.com/adlens
Content-Type: application/json
X-AdLens-Protocol: 1
X-AdLens-Signature: t=1700000000,v1=3f2a…(64 hex characters)

{
  "protocolVersion": 1,
  "agent": { "id": "k3j2h1g0f9", "name": "My service" },
  "systemPrompt": "You are a careful marketing analyst…",
  "messages": [
    { "role": "user", "content": "How did organic search do?" }
  ],
  "tools": [
    { "id": "ga4.overview", "description": "Headline GA4 numbers…", "parameters": { "type": "object", "properties": {} } }
  ],
  "context": {
    "project": { "name": "My shop", "domain": "myshop.com" },
    "dateRange": { "startDate": "2026-10-01", "endDate": "2026-10-28" },
    "currency": "USD",
    "timezone": "Asia/Dhaka"
  }
}`;

function Code({ children, label }: { children: string; label: string }) {
  return (
    <pre aria-label={label} className="overflow-x-auto rounded-lg border border-line bg-fill-1 p-3 text-[12px] leading-relaxed text-fg"><code>{children}</code></pre>
  );
}

function SignatureChecker() {
  const [secret, setSecret] = useState('');
  const [header, setHeader] = useState('');
  const [body, setBody] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const run = async () => {
    try {
      const r = await checkSignature(secret.trim(), header, body, Math.floor(Date.now() / 1000));
      setOk(r.ok);
      setResult(r.ok ? 'Valid. This request was signed with your secret.' : SIGNATURE_PROBLEM[r.reason]);
    } catch {
      setOk(false);
      setResult('Your browser could not run the check.');
    }
  };
  const field = 'block w-full rounded-lg border border-line bg-surface text-fg text-xs font-mono px-3 py-2';
  return (
    <div className="rounded-xl border border-line bg-surface p-4 space-y-3">
      <p className="text-xs text-fg-muted">Paste a real request to check your code against. Everything stays in your browser; nothing is sent anywhere.</p>
      <label className="block text-xs text-fg-muted space-y-1"><span>Signing secret</span><input className={field} type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="whsec_…" /></label>
      <label className="block text-xs text-fg-muted space-y-1"><span>X-AdLens-Signature header</span><input className={field} value={header} onChange={(e) => setHeader(e.target.value)} placeholder="t=1700000000,v1=…" /></label>
      <label className="block text-xs text-fg-muted space-y-1"><span>Raw request body (exactly as received)</span><textarea className={field} rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></label>
      <button type="button" disabled={!secret.trim() || !header.trim()} onClick={() => void run()} className="rounded-lg bg-accent text-on-accent text-xs font-medium px-3 py-2 min-h-[36px] disabled:opacity-50">Check signature</button>
      {result && <p role="status" className={`text-xs ${ok ? 'text-accent-text' : 'text-danger'}`}>{result}</p>}
    </div>
  );
}

export const AgentDeveloperPage: React.FC = () => (
  <div className="space-y-8 max-w-3xl">
    <div className="space-y-2">
      <Link to="/agents" className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg"><ArrowLeft className="w-3.5 h-3.5" /> AI Agents</Link>
      <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-fg">Connect your own service (webhook)</h1>
      <p className="text-xs sm:text-sm text-fg-muted">A webhook agent lets any program you control answer questions about your marketing data: a script, a server, an automation tool, or a different AI. AdLens calls your web address, you reply, and AdLens shows the answer in the AI Analyst chat.</p>
    </div>

    <section className="space-y-2">
      <h2 className="text-base font-semibold text-fg">1. What AdLens sends</h2>
      <p className="text-xs text-fg-muted">A POST with a JSON body. <code>messages</code> is the conversation so far; <code>tools</code> are the reports your agent may ask for (only the ones you allowed). Report results come back to you as <code>tool</code> messages on the next call.</p>
      <Code label="Example request">{REQUEST_EXAMPLE}</Code>
    </section>

    <section className="space-y-2">
      <h2 className="text-base font-semibold text-fg">2. What you reply</h2>
      <p className="text-xs text-fg-muted">Reply with HTTP 200 and JSON. Either give the final answer, or ask AdLens to run reports first (you will be called again with the results). A question may use up to the number of report calls you set for the agent.</p>
      <Code label="Final answer">{WEBHOOK_REPLY_EXAMPLES.answer}</Code>
      <Code label="Ask for a report">{WEBHOOK_REPLY_EXAMPLES.toolCalls}</Code>
      <p className="text-xs text-fg-muted">Answer in Markdown if you like. Replies must arrive within 45 seconds and be under 1 MB.</p>
    </section>

    <section className="space-y-2">
      <h2 className="text-base font-semibold text-fg">3. Check every request is really from AdLens</h2>
      <p className="text-xs text-fg-muted">Each request carries <code>X-AdLens-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</code>. The value is an HMAC-SHA256 (with your signing secret) of <code>&lt;t&gt;.&lt;raw body&gt;</code>. Reject the request if the signature is wrong or the time is more than 5 minutes old. Use the exact bytes you received, not a re-built copy of the JSON.</p>
      <h3 className="text-sm font-medium text-fg">Node.js</h3>
      <Code label="Node.js verification code">{NODE_VERIFY_SNIPPET}</Code>
      <h3 className="text-sm font-medium text-fg">Python</h3>
      <Code label="Python verification code">{PYTHON_VERIFY_SNIPPET}</Code>
    </section>

    <section className="space-y-2">
      <h2 className="text-base font-semibold text-fg">4. Try it</h2>
      <p className="text-xs text-fg-muted">Use <strong>Test connection</strong> on your agent in <Link to="/agents" className="text-accent-text underline">AI Agents</Link>. AdLens sends a small test message (no analytics numbers) to your address and tells you what happened. To debug your signature code, paste a request below.</p>
      <SignatureChecker />
    </section>

    <section className="space-y-2">
      <h2 className="text-base font-semibold text-fg">Good to know</h2>
      <ul className="list-disc pl-5 text-xs text-fg-muted space-y-1">
        <li>Your address must be a public <code>https://</code> address. Private network addresses (like 192.168.x.x or localhost) are blocked for safety. To test on your own computer, use a tunnel service.</li>
        <li>Never share your signing secret. If it leaks, press <strong>New signing secret</strong> on the agent; the old one stops working at once.</li>
        <li>Only the numbers from reports your agent was allowed to read are sent to it. Your Google sign-in and raw accounts are never sent.</li>
      </ul>
    </section>
  </div>
);
