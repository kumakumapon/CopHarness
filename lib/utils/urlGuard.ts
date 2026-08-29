import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_REDIRECTS = 5;

function isPrivateIpv4(ip: string): boolean {
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || first >= 224 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
}

function isPrivateIpv6(ip: string): boolean {
  const value = ip.toLowerCase();
  return value === '::' || value === '::1' ||
    value.startsWith('fc') || value.startsWith('fd') ||
    value.startsWith('fe8') || value.startsWith('fe9') ||
    value.startsWith('fea') || value.startsWith('feb');
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

  const hostname = url.hostname.toLowerCase().replace(/^\\[|\\]$/g, '');
  if (hasPrivateNetworkOptIn() || allowedHosts().has(hostname)) return url;
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new UnsafeUrlError('private network destinations are not allowed');
  }

  const literalVersion = isIP(hostname);
  const addresses = literalVersion
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new UnsafeUrlError('host did not resolve to an address');
  for (const { address } of addresses) {
    const version = isIP(address);
    if (!version || (version === 4 ? isPrivateIpv4(address) : isPrivateIpv6(address))) {
      throw new UnsafeUrlError('private network destinations are not allowed');
    }
  }
  return url;
}

/** Fetch an untrusted URL while validating every redirect destination. */
export async function safeFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  let url = await assertSafeHttpUrl(rawUrl);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(url, { ...init, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    if (redirects === MAX_REDIRECTS) throw new UnsafeUrlError('too many redirects');
    url = await assertSafeHttpUrl(new URL(location, url).toString());
  }
  throw new UnsafeUrlError('too many redirects');
}
