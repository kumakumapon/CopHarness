import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  assertSafeHttpUrl,
  guardedLookup,
  isPrivateAddress,
  safeFetch,
  UnsafeUrlError,
} from '../../lib/core/utils/urlGuard';

// `import * as` would copy the namespace and defeat jest.spyOn; use the real module objects.
/* eslint-disable @typescript-eslint/no-require-imports */
const dns = require('node:dns') as typeof import('node:dns');
const dnsPromises = require('node:dns/promises') as typeof import('node:dns/promises');
/* eslint-enable @typescript-eslint/no-require-imports */

const ENV_KEYS = ['SKILL_HTTP_ALLOW_PRIVATE_NETWORKS', 'SKILL_HTTP_ALLOWED_HOSTS'] as const;

describe('urlGuard', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    jest.restoreAllMocks();
  });

  describe('isPrivateAddress', () => {
    it.each([
      '0.0.0.0', '10.1.2.3', '100.64.0.1', '100.127.255.254', '127.0.0.1', '169.254.169.254',
      '172.16.0.1', '172.31.255.255', '192.0.0.1', '192.168.0.1', '198.18.0.1', '198.19.255.255',
      '203.0.113.5', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
      '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'fec0::1', 'ff02::1',
      '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::ffff:10.0.0.1', '::ffff:100.64.0.1',
      '64:ff9b::7f00:1', '2002:7f00:1::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:db8::1', '100::1',
      'not-an-ip',
    ])('treats %s as private', (ip) => {
      expect(isPrivateAddress(ip)).toBe(true);
    });

    it.each([
      '8.8.8.8', '1.1.1.1', '93.184.216.34', '100.63.255.255', '100.128.0.1', '172.15.255.255', '172.32.0.1',
      '192.169.0.1', '198.17.255.255', '198.20.0.1', '2606:4700:4700::1111', '2a00:1450:4001::200e',
      '::ffff:8.8.8.8',
    ])('treats %s as public', (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    });
  });

  describe('assertSafeHttpUrl', () => {
    it.each([
      'http://127.0.0.1:3000/api',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.1/',
      'http://172.16.0.1/',
      'http://192.168.1.1/',
      'http://100.64.0.1/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:7f00:1]/',
      'http://[::ffff:a9fe:a9fe]/',
      'http://[64:ff9b::7f00:1]/',
      'http://[fd00::1]/',
      // WHATWG URL normalises these alternative IPv4 spellings to dotted-quad
      'http://2130706433/',
      'http://0x7f000001/',
      'http://0177.0.0.1/',
      'http://127.1/',
      'http://localhost./',
      'http://app.localhost/',
    ])('rejects %s', async (url) => {
      await expect(assertSafeHttpUrl(url)).rejects.toBeInstanceOf(UnsafeUrlError);
    });

    it('rejects localhost and non-HTTP schemes', async () => {
      await expect(assertSafeHttpUrl('http://localhost:3000/')).rejects.toBeInstanceOf(UnsafeUrlError);
      await expect(assertSafeHttpUrl('file:///etc/passwd')).rejects.toBeInstanceOf(UnsafeUrlError);
      await expect(assertSafeHttpUrl('http://user:pw@8.8.8.8/')).rejects.toBeInstanceOf(UnsafeUrlError);
    });

    it('rejects a hostname when ANY of its addresses is private', async () => {
      jest.spyOn(dnsPromises, 'lookup').mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '::ffff:10.0.0.1', family: 6 },
      ] as never);
      await expect(assertSafeHttpUrl('http://mixed.example/')).rejects.toBeInstanceOf(UnsafeUrlError);
    });

    it('accepts public literals', async () => {
      await expect(assertSafeHttpUrl('http://8.8.8.8/')).resolves.toBeInstanceOf(URL);
      await expect(assertSafeHttpUrl('https://[2606:4700:4700::1111]/')).resolves.toBeInstanceOf(URL);
    });

    it('permits private destinations only with the explicit operator opt-in', async () => {
      process.env.SKILL_HTTP_ALLOW_PRIVATE_NETWORKS = 'true';
      await expect(assertSafeHttpUrl('http://127.0.0.1:3000/')).resolves.toBeInstanceOf(URL);
    });

    it('permits an explicitly allowed host', async () => {
      process.env.SKILL_HTTP_ALLOWED_HOSTS = 'internal.example, localhost';
      await expect(assertSafeHttpUrl('http://localhost:3000/')).resolves.toBeInstanceOf(URL);
    });
  });

  describe('guardedLookup (connect-time validation)', () => {
    const resolverReturning = (...addresses: Array<{ address: string; family: number }>) =>
      ((_h: string, _o: unknown, cb: (e: Error | null, a: unknown) => void) => cb(null, addresses)) as unknown as typeof dns.lookup;

    it('refuses a name that resolves to a private address', (done) => {
      guardedLookup('rebind.example', { all: false }, (err) => {
        expect(err).toBeInstanceOf(UnsafeUrlError);
        done();
      }, resolverReturning({ address: '169.254.169.254', family: 4 }));
    });

    it('refuses when any returned address is private (all: true)', (done) => {
      guardedLookup('mixed.example', { all: true }, (err) => {
        expect(err).toBeInstanceOf(UnsafeUrlError);
        done();
      }, resolverReturning({ address: '8.8.8.8', family: 4 }, { address: '::ffff:127.0.0.1', family: 6 }));
    });

    it('returns a single address or the full list depending on options.all', (done) => {
      const resolver = resolverReturning({ address: '8.8.8.8', family: 4 }, { address: '1.1.1.1', family: 4 });
      guardedLookup('ok.example', { all: false }, (err, address, family) => {
        expect(err).toBeNull();
        expect(address).toBe('8.8.8.8');
        expect(family).toBe(4);
        guardedLookup('ok.example', { all: true }, (err2, list) => {
          expect(err2).toBeNull();
          expect(list).toHaveLength(2);
          done();
        }, resolver);
      }, resolver);
    });

    it('allows private results for allowed hosts', (done) => {
      process.env.SKILL_HTTP_ALLOWED_HOSTS = 'intranet.example';
      guardedLookup('intranet.example', { all: false }, (err, address) => {
        expect(err).toBeNull();
        expect(address).toBe('10.0.0.5');
        done();
      }, resolverReturning({ address: '10.0.0.5', family: 4 }));
    });
  });

  describe('safeFetch', () => {
    let server: http.Server;
    let port: number;
    beforeEach(async () => {
      server = http.createServer((req, res) => {
        if (req.url === '/redirect') {
          res.writeHead(302, { location: 'http://169.254.169.254/' });
          res.end();
          return;
        }
        res.end('hello');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = (server.address() as AddressInfo).port;
    });
    afterEach(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('blocks DNS rebinding: name looks public at validation time, private when dialed', async () => {
      jest.spyOn(dnsPromises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
      jest.spyOn(dns, 'lookup').mockImplementation(((_h: string, _o: unknown, cb: (e: Error | null, a: unknown) => void) =>
        cb(null, [{ address: '127.0.0.1', family: 4 }])) as never);
      await expect(safeFetch(`http://rebind.example:${port}/`)).rejects.toBeInstanceOf(UnsafeUrlError);
    });

    it('rejects private literals before connecting', async () => {
      await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(UnsafeUrlError);
    });

    it('still fetches an explicitly allowed host through the guarded dispatcher', async () => {
      process.env.SKILL_HTTP_ALLOWED_HOSTS = 'localhost';
      const res = await safeFetch(`http://localhost:${port}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('hello');
    });

    it('re-validates redirect targets', async () => {
      process.env.SKILL_HTTP_ALLOWED_HOSTS = 'localhost';
      await expect(safeFetch(`http://localhost:${port}/redirect`)).rejects.toBeInstanceOf(UnsafeUrlError);
    });
  });
});
