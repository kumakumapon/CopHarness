import { assertSafeHttpUrl, UnsafeUrlError } from '../../lib/utils/urlGuard';

describe('assertSafeHttpUrl', () => {
  const oldOptIn = process.env.SKILL_HTTP_ALLOW_PRIVATE_NETWORKS;

  afterEach(() => {
    if (oldOptIn === undefined) delete process.env.SKILL_HTTP_ALLOW_PRIVATE_NETWORKS;
    else process.env.SKILL_HTTP_ALLOW_PRIVATE_NETWORKS = oldOptIn;
  });

  it.each([
    'http://127.0.0.1:3000/api',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://192.168.1.1/',
    'http://[::1]/',
  ])('rejects private address %s', async (url) => {
    await expect(assertSafeHttpUrl(url)).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('rejects localhost and non-HTTP schemes', async () => {
    await expect(assertSafeHttpUrl('http://localhost:3000/')).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertSafeHttpUrl('file:///etc/passwd')).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('permits private destinations only with the explicit operator opt-in', async () => {
    process.env.SKILL_HTTP_ALLOW_PRIVATE_NETWORKS = 'true';
    await expect(assertSafeHttpUrl('http://127.0.0.1:3000/')).resolves.toBeInstanceOf(URL);
  });
});
