import { afterEach, describe, expect, it, vi } from 'vitest';
import { NxipApiError, mapWithConcurrency, previewSubnet, resolveClientOptions } from '../src/nxipClient.js';

describe('resolveClientOptions', () => {
  const originalApiKey = process.env.NXIP_API_KEY;
  const originalUrl = process.env.NXIP_URL;

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.NXIP_API_KEY;
    else process.env.NXIP_API_KEY = originalApiKey;
    if (originalUrl === undefined) delete process.env.NXIP_URL;
    else process.env.NXIP_URL = originalUrl;
  });

  it('prefers the action input over the environment variable', () => {
    process.env.NXIP_API_KEY = 'nc_live_env';
    const options = resolveClientOptions('nc_live_input', '');
    expect(options.apiKey).toBe('nc_live_input');
  });

  it('falls back to NXIP_API_KEY / NXIP_URL when inputs are empty, matching terraform-provider-nxip', () => {
    process.env.NXIP_API_KEY = 'nc_live_env';
    process.env.NXIP_URL = 'https://staging.nxip.dev';
    const options = resolveClientOptions('', '');
    expect(options).toEqual({ apiKey: 'nc_live_env', baseUrl: 'https://staging.nxip.dev' });
  });

  it('defaults the URL to https://nxip.dev when nothing is set, and strips a trailing slash', () => {
    delete process.env.NXIP_URL;
    const options = resolveClientOptions('nc_live_input', '');
    expect(options.baseUrl).toBe('https://nxip.dev');

    const trimmed = resolveClientOptions('nc_live_input', 'https://nxip.dev/');
    expect(trimmed.baseUrl).toBe('https://nxip.dev');
  });
});

describe('previewSubnet', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends x-api-key, not Authorization - the exact header mistake client.go documents avoiding', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ wouldSucceed: true }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await previewSubnet({ apiKey: 'nc_live_abc', baseUrl: 'https://nxip.dev' }, { family: 'IPV4', prefixLength: 24 });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('nc_live_abc');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('returns the parsed body on a 200 response', async () => {
    const body = { wouldSucceed: true, subnet: { cidr: '10.0.0.0/24' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })));

    const result = await previewSubnet({ apiKey: 'k', baseUrl: 'https://nxip.dev' }, { family: 'IPV4', prefixLength: 24 });
    expect(result).toEqual(body);
  });

  it('throws NxipApiError with the API message on a non-200 - a request that could not be evaluated at all', async () => {
    const errorBody = { message: 'Missing or invalid API key' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(errorBody), { status: 401 })));

    await expect(previewSubnet({ apiKey: 'bad', baseUrl: 'https://nxip.dev' }, { family: 'IPV4', prefixLength: 24 })).rejects.toMatchObject(
      { status: 401, message: 'Missing or invalid API key' }
    );
  });

  it('is an instance of NxipApiError specifically, so main.ts can distinguish it from other failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 500 })));
    await expect(
      previewSubnet({ apiKey: 'k', baseUrl: 'https://nxip.dev' }, { family: 'IPV4', prefixLength: 24 })
    ).rejects.toBeInstanceOf(NxipApiError);
  });
});

describe('mapWithConcurrency', () => {
  it('processes every item and preserves result order regardless of completion order', async () => {
    const items = [50, 10, 30, 5, 20];
    const results = await mapWithConcurrency(items, 2, async (n) => {
      await new Promise((resolve) => setTimeout(resolve, n));
      return n * 2;
    });
    expect(results).toEqual([100, 20, 60, 10, 40]);
  });

  it('never runs more than `concurrency` callbacks at once', async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);

    await mapWithConcurrency(items, 3, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return n;
    });

    expect(maxActive).toBeLessThanOrEqual(3);
  });
});
