import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

// Keep fetch and its dispatcher on the same Undici version. Node 26's bundled
// fetch uses a newer dispatcher handler API than the installed Undici Agent.
// This function accepts URLs and standard Fetch options, and returns a Fetch response.
const guardedFetch = undiciFetch as unknown as typeof fetch;

const MAX_REDIRECTS = 5;

/**
 * Destinations an untrusted URL must never reach: loopback, private, link-local
 * (cloud metadata), CGNAT, documentation/benchmark/reserved and multicast
 * ranges. `BlockList` also matches IPv4-mapped IPv6 (`::ffff:a.b.c.d`) against
 * the IPv4 rules, so those cannot be used to smuggle a private IPv4 address.
 */
const PRIVATE_RANGES = (() => {
  const list = new BlockList();
  const v4: Array<[string, number]> = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
    ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ];
  for (const [net, prefix] of v4) list.addSubnet(net, prefix, 'ipv4');
  const v6: Array<[string, number]> = [
    ['::', 128], ['::1', 128],
    ['64:ff9b::', 96], ['64:ff9b:1::', 48], // NAT64: embeds an arbitrary IPv4 address
    ['100::', 64], // discard-only
    ['2001::', 32], // Teredo: embeds an IPv4 address
    ['2001:db8::', 32], // documentation
    ['2002::', 16], // 6to4: embeds an IPv4 address
    ['fc00::', 7], // unique local
    ['fe80::', 10], // link-local
    ['fec0::', 10], // deprecated site-local
    ['ff00::', 8], // multicast
  ];
  for (const [net, prefix] of v6) list.addSubnet(net, prefix, 'ipv6');
  return list;
})();

/** True when `ip` is not a publicly routable address. Unparseable input counts as private. */
export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 0) return true;
  return PRIVATE_RANGES.check(ip, version === 4 ? 'ipv4' : 'ipv6');
}

function hasPrivateNetworkOptIn(): boolean {
  return process.env.SKILL_HTTP_ALLOW_PRIVATE_NETWORKS === 'true';
}

function allowedHosts(): Set<string> {
  return new Set((process.env.SKILL_HTTP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean));
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

const PRIVATE_DESTINATION = 'private network destinations are not allowed';

/** Lower-case, bracket-free hostname without a trailing root dot. */
function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function isLocalhostName(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost');
}

/** Validates an untrusted HTTP URL before any connection is made. */
export async function assertSafeHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError('invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('only http:// and https:// URLs are supported');
  }
  if (url.username || url.password) throw new UnsafeUrlError('URLs with credentials are not allowed');

  const hostname = normalizeHostname(url.hostname);
  if (hasPrivateNetworkOptIn() || allowedHosts().has(hostname)) return url;
  if (isLocalhostName(hostname)) throw new UnsafeUrlError(PRIVATE_DESTINATION);

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new UnsafeUrlError('host did not resolve to an address');
  if (addresses.some(({ address }) => isPrivateAddress(address))) throw new UnsafeUrlError(PRIVATE_DESTINATION);
  return url;
}

type LookupCallback = (err: Error | null, address: string | LookupAddress[], family?: number) => void;

/**
 * `net.connect`-style lookup that refuses to hand out private addresses.
 *
 * `assertSafeHttpUrl` resolves the name once and `fetch` would resolve it again
 * when connecting, so a DNS server could answer "public" first and "169.254.x"
 * second (DNS rebinding). Validating inside the connection's own lookup closes
 * that gap: the address that is checked is the address that is dialed.
 */
export function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number | string; hints?: number } | number,
  callback: LookupCallback,
  resolve: typeof dnsLookup = dnsLookup,
): void {
  const opts = typeof options === 'number' ? { family: options } : { ...options };
  const bypass = hasPrivateNetworkOptIn() || allowedHosts().has(normalizeHostname(hostname));
  resolve(hostname, { ...opts, all: true } as Parameters<typeof dnsLookup>[1] & { all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    const list = addresses as LookupAddress[];
    if (list.length === 0) return callback(new UnsafeUrlError('host did not resolve to an address'), '');
    if (!bypass && list.some(({ address }) => isPrivateAddress(address))) {
      return callback(new UnsafeUrlError(PRIVATE_DESTINATION), '');
    }
    if (opts.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

let guardedAgent: Agent | undefined;

/** Shared undici dispatcher whose connections go through `guardedLookup`. */
function getGuardedAgent(): Agent {
  guardedAgent ??= new Agent({ connect: { lookup: guardedLookup as never } });
  return guardedAgent;
}

/** Fetch an untrusted URL while validating every redirect destination and every dialed address. */
export async function safeFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  let url = await assertSafeHttpUrl(rawUrl);
  const guarded = { ...init, redirect: 'manual', dispatcher: getGuardedAgent() } as RequestInit;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    let response: Response;
    try {
      response = await guardedFetch(url, guarded);
    } catch (error) {
      // undici wraps connect-time failures as "fetch failed"; surface our own verdict.
      // Across realms (e.g. jest) the cause can arrive re-wrapped as `Error("UnsafeUrlError: ...")`,
      // so match on the name as well as instanceof.
      const cause = (error as { cause?: { name?: unknown; message?: unknown } | null }).cause;
      if (cause instanceof UnsafeUrlError) throw cause;
      if (cause && typeof cause.message === 'string') {
        const prefix = 'UnsafeUrlError: ';
        if (cause.name === 'UnsafeUrlError') throw new UnsafeUrlError(cause.message);
        if (cause.message.startsWith(prefix)) throw new UnsafeUrlError(cause.message.slice(prefix.length));
      }
      throw error;
    }
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    if (redirects === MAX_REDIRECTS) throw new UnsafeUrlError('too many redirects');
    url = await assertSafeHttpUrl(new URL(location, url).toString());
  }
  throw new UnsafeUrlError('too many redirects');
}
