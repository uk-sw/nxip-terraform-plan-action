import type { NxipSubnetBody, PreviewResult } from './types.js';

export interface NxipClientOptions {
  apiKey: string;
  baseUrl: string;
}

// x-api-key, not Authorization: Bearer. client.go in terraform-provider-nxip
// documents that this API was once authenticated with the wrong header
// until its own HTTP client got centralized - worth not repeating here.
const API_KEY_HEADER = 'x-api-key';

/**
 * Resolves API key/URL the same way terraform-provider-nxip's provider.go
 * does: the action input wins, falling back to NXIP_API_KEY/NXIP_URL env
 * vars, then https://nxip.dev - so a workflow that already has
 * NXIP_API_KEY set for the provider gets this working with no extra wiring.
 */
export function resolveClientOptions(inputApiKey: string, inputUrl: string): NxipClientOptions {
  const apiKey = inputApiKey || process.env.NXIP_API_KEY || '';
  const baseUrl = inputUrl || process.env.NXIP_URL || 'https://nxip.dev';
  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, '') };
}

export class NxipApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'NxipApiError';
  }
}

/**
 * Calls POST /v1/subnets/preview. A non-200 here means the request
 * itself couldn't be evaluated (bad key, malformed body) - a genuine
 * failure, distinct from a 200 with wouldSucceed: false, which is a
 * successfully-computed "no" (pool full, tier limit, etc).
 */
export async function previewSubnet(options: NxipClientOptions, body: NxipSubnetBody): Promise<PreviewResult> {
  const response = await fetch(`${options.baseUrl}/v1/subnets/preview`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [API_KEY_HEADER]: options.apiKey,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  if (response.status !== 200) {
    const message =
      parsed && typeof parsed === 'object' && 'message' in parsed
        ? String((parsed as { message: unknown }).message)
        : text || `nxip API returned unexpected status ${response.status}`;
    throw new NxipApiError(response.status, message);
  }

  return parsed as PreviewResult;
}

/**
 * Runs `fn` over `items` with at most `concurrency` in flight at once -
 * a plan can list many subnet changes in one PR, and calling all of them
 * at once would be an unbounded fan-out against the caller's own API.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await fn(item);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
