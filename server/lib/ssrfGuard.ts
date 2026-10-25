/**
 * Outbound-request protection for user-supplied AI endpoints (Sprint 16). Without it, a user could
 * point an "agent" at http://169.254.169.254/ (cloud metadata), localhost or an internal network and
 * make the AdLens server fetch it for them (SSRF).
 *
 * Layers
 * 1. validateOutboundUrl: https only, no credentials, no IP literals, no internal-looking names, safe ports.
 * 2. createGuardedLookup: the address check happens at CONNECT time (not before), so a DNS name that
 *    resolves to a private address, or flips to one later (DNS rebinding), is refused. If a name resolves
 *    to several addresses and any is private, the request is refused.
 * 3. guardedRequest: no redirects, hard timeout, response size cap, fresh connection each time.
 *
 * Imports in this folder end in .js (guard test).
 */

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export type SsrfCode =
  | 'URL_INVALID'
  | 'URL_NOT_HTTPS'
  | 'URL_HAS_CREDENTIALS'
  | 'URL_BAD_PORT'
  | 'HOST_BLOCKED'
  | 'HOST_NOT_PUBLIC'
  | 'HOST_UNRESOLVED'
  | 'REDIRECT_BLOCKED'
  | 'RESPONSE_TOO_LARGE'
  | 'REQUEST_TIMEOUT'
  | 'REQUEST_ABORTED'
  | 'REQUEST_FAILED';

export class SsrfError extends Error {
  readonly code: SsrfCode;
  constructor(code: SsrfCode, message: string) {
    super(message);
    this.name = 'SsrfError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// IP classification (fails closed: anything unparseable counts as private)
// ---------------------------------------------------------------------------

function ipv4ToInts(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInts(ip);
  if (!n) return true;
  const [a, b, c] = n;
  return (
    a === 0 || // "this" network
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a === 127 ||
    (a === 169 && b === 254) || // link-local, incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast, reserved, broadcast
  );
}

/** Expands an IPv6 address to eight 16-bit groups, or null when invalid. */
function expandIpv6(input: string): number[] | null {
  let ip = input.split('%')[0]; // drop zone id
  if (!ip.includes(':')) return null;
  // IPv4 tail ("::ffff:1.2.3.4")
  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4ToInts(tail);
    if (!v4) return null;
    ip = `${ip.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function isPrivateIpv6(ip: string): boolean {
  const g = expandIpv6(ip);
  if (!g) return true;
  const embedded = (hi: number, lo: number) => isPrivateIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return embedded(g[6], g[7]); // IPv4-mapped
  if (g.slice(0, 6).every((x) => x === 0)) return true; // IPv4-compatible (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] === 0 && g.slice(3, 6).every((x) => x === 0) ? embedded(g[6], g[7]) : true; // NAT64
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link-local, site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2002) return embedded(g[1], g[2]); // 6to4
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // discard-only
  return false;
}

/** True for loopback, private, link-local, reserved and unparseable addresses. */
export function isPrivateIp(ip: string): boolean {
  const clean = ip.trim().replace(/^\[|\]$/g, '');
  const family = net.isIP(clean);
  if (family === 4) return isPrivateIpv4(clean);
  if (family === 6) return isPrivateIpv6(clean);
  return true;
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.corp', '.intranet', '.private', '.localdomain'];
const MAX_URL_LENGTH = 2048;

export interface OutboundUrlOptions {
  allowedPorts?: number[];
}

/** Syntax-level checks. Throws SsrfError; returns the parsed URL when acceptable. */
export function validateOutboundUrl(input: unknown, opts: OutboundUrlOptions = {}): URL {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_URL_LENGTH) {
    throw new SsrfError('URL_INVALID', 'Enter a valid web address.');
  }
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new SsrfError('URL_INVALID', 'Enter a valid web address.');
  }
  if (url.protocol !== 'https:') throw new SsrfError('URL_NOT_HTTPS', 'The address must start with https://.');
  if (url.username || url.password) throw new SsrfError('URL_HAS_CREDENTIALS', 'Remove the username and password from the address.');

  const allowed = opts.allowedPorts ?? [443, 8443];
  if (url.port && !allowed.includes(Number(url.port))) {
    throw new SsrfError('URL_BAD_PORT', `Only ports ${allowed.join(' and ')} are allowed.`);
  }

  const host = url.hostname.toLowerCase().replace(/\.+$/, '').replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    // The URL parser has already normalised decimal/octal/hex forms to dotted notation.
    throw new SsrfError('HOST_BLOCKED', 'Use a domain name, not an IP address.');
  }
  if (
    !host.includes('.') ||
    host === 'localhost' ||
    BLOCKED_SUFFIXES.some((s) => host.endsWith(s)) ||
    host === 'metadata.google.internal'
  ) {
    throw new SsrfError('HOST_BLOCKED', 'That address points to a private or internal host.');
  }
  return url;
}

// ---------------------------------------------------------------------------
// Connect-time address check
// ---------------------------------------------------------------------------

export interface ResolvedAddress { address: string; family: number }

export interface GuardedLookupDeps {
  resolveAll?: (hostname: string) => Promise<ResolvedAddress[]>;
  isAllowedAddress?: (address: string) => boolean;
}

/** A `lookup` function for http(s).request that only lets connections go to public addresses. */
export function createGuardedLookup(deps: GuardedLookupDeps = {}) {
  const resolveAll = deps.resolveAll ?? ((h: string) => dns.promises.lookup(h, { all: true, verbatim: true }));
  const allowed = deps.isAllowedAddress ?? ((a: string) => !isPrivateIp(a));

  return (hostname: string, options: unknown, callback: unknown): void => {
    const cb = (typeof options === 'function' ? options : callback) as (err: Error | null, a?: unknown, f?: number) => void;
    const wantsAll = typeof options === 'object' && options !== null && (options as { all?: boolean }).all === true;
    resolveAll(hostname).then(
      (addrs) => {
        if (addrs.length === 0) return cb(new SsrfError('HOST_UNRESOLVED', 'Could not find that server.'));
        if (addrs.some((a) => !allowed(a.address))) {
          return cb(new SsrfError('HOST_NOT_PUBLIC', 'That address points to a private or internal network.'));
        }
        if (wantsAll) cb(null, addrs);
        else cb(null, addrs[0].address, addrs[0].family);
      },
      () => cb(new SsrfError('HOST_UNRESOLVED', 'Could not find that server.'))
    );
  };
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface GuardedRequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  signal?: AbortSignal;
}

export interface GuardedResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}

export interface GuardedRequestDeps {
  transport?: typeof https | typeof http;
  lookup?: ReturnType<typeof createGuardedLookup>;
}

/** Function shape used by the agent providers, so tests can replace the network. */
export type RequestFn = (url: URL, opts: GuardedRequestOptions) => Promise<GuardedResponse>;

const HEADER_VALUE_RE = /^[\x20-\x7e]*$/; // printable ASCII only: blocks CR/LF header injection

export function guardedRequest(url: URL, opts: GuardedRequestOptions = {}, deps: GuardedRequestDeps = {}): Promise<GuardedResponse> {
  const transport = deps.transport ?? https;
  const lookup = deps.lookup ?? createGuardedLookup();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxBytes = opts.maxResponseBytes ?? 1_000_000;

  if (opts.signal?.aborted) return Promise.reject(new SsrfError('REQUEST_ABORTED', 'The request was cancelled.'));

  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (!/^[A-Za-z0-9-]+$/.test(k) || !HEADER_VALUE_RE.test(v)) {
      return Promise.reject(new SsrfError('REQUEST_FAILED', 'A request header contained invalid characters.'));
    }
  }

  return new Promise<GuardedResponse>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
    };

    const body = opts.body ?? '';
    const req = (transport as typeof https).request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: opts.method ?? 'POST',
        agent: false, // no connection reuse between users
        lookup: lookup as unknown as net.LookupFunction,
        headers: {
          'user-agent': 'AdLens-Agent/1',
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } : {}),
          ...(opts.headers ?? {}),
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return finish(() => reject(new SsrfError('REDIRECT_BLOCKED', 'The server tried to redirect the request, which is not allowed.')));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            return finish(() => reject(new SsrfError('RESPONSE_TOO_LARGE', 'The server sent a response that is too large.')));
          }
          chunks.push(chunk);
        });
        res.on('end', () => finish(() => resolve({ status, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') })));
        res.on('error', () => finish(() => reject(new SsrfError('REQUEST_FAILED', 'The connection was interrupted.'))));
      }
    );

    // Attach the error handler first: destroy() below emits an 'error' event that must never go unhandled.
    req.on('error', (err) => {
      finish(() => reject(err instanceof SsrfError ? err : new SsrfError('REQUEST_FAILED', 'Could not reach the server.')));
    });
    const timer = setTimeout(() => {
      finish(() => reject(new SsrfError('REQUEST_TIMEOUT', 'The server took too long to respond.')));
      req.destroy();
    }, timeoutMs);
    const onAbort = () => {
      finish(() => reject(new SsrfError('REQUEST_ABORTED', 'The request was cancelled.')));
      req.destroy();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    if (body) req.write(body);
    req.end();
  });
}
