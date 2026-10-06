import { createHash } from 'node:crypto';
import type { IncrementResponse, Options, Store } from 'express-rate-limit';
import { env } from '../env';

/**
 * Optional shared rate-limit store.
 *
 * The default express-rate-limit store keeps counters in process memory, which
 * is correct for a single instance but lets a serverless deployment (Vercel
 * runs many isolated instances) multiply every limit by the number of warm
 * containers. When Upstash Redis REST credentials are configured we keep the
 * counters there instead, so limits hold across instances.
 *
 * This is a deliberately tiny client: a single `/pipeline` call per increment,
 * no dependency on a Redis driver, and every failure degrades to "allow" rather
 * than taking the API down if Redis is briefly unreachable.
 */

const PREFIX = 'ciphernote:rl:';

type PipelineResult = { result?: unknown; error?: string };

class UpstashRateLimitStore implements Store {
  /** Counters live in Redis, so they are shared across instances. */
  readonly localKeys = false;
  readonly prefix = PREFIX;

  private windowMs = 60_000;
  private warned = false;

  constructor(
    private readonly restUrl: string,
    private readonly token: string,
  ) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private async pipeline(commands: unknown[][]): Promise<PipelineResult[] | null> {
    try {
      const response = await fetch(`${this.restUrl.replace(/\/$/, '')}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(commands),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      return (await response.json()) as PipelineResult[];
    } catch (error) {
      if (!this.warned) {
        this.warned = true;
        console.error('[rate-limit] shared store unavailable, falling back to allow', error);
      }
      return null;
    }
  }

  async increment(key: string): Promise<IncrementResponse> {
    const result = await this.pipeline([
      ['INCR', key],
      ['PTTL', key],
    ]);

    const totalHits = Number(result?.[0]?.result ?? 1);
    const pttl = Number(result?.[1]?.result ?? -1);

    // First hit in a window: start the expiry. Doing it here (rather than a
    // separate EXPIRE on every request) keeps the counter from sliding.
    if (totalHits === 1) {
      await this.pipeline([['PEXPIRE', key, this.windowMs]]);
    }

    const ttl = pttl > 0 ? pttl : this.windowMs;
    return { totalHits: Number.isFinite(totalHits) ? totalHits : 1, resetTime: new Date(Date.now() + ttl) };
  }

  async get(key: string): Promise<IncrementResponse | undefined> {
    const result = await this.pipeline([
      ['GET', key],
      ['PTTL', key],
    ]);
    const raw = result?.[0]?.result;
    if (raw === null || raw === undefined) return undefined;
    const totalHits = Number(raw);
    const pttl = Number(result?.[1]?.result ?? -1);
    if (!Number.isFinite(totalHits)) return undefined;
    return { totalHits, resetTime: new Date(Date.now() + (pttl > 0 ? pttl : this.windowMs)) };
  }

  async decrement(key: string): Promise<void> {
    await this.pipeline([['DECR', key]]);
  }

  async resetKey(key: string): Promise<void> {
    await this.pipeline([['DEL', key]]);
  }
}

/**
 * Returns a shared store when Upstash is configured, otherwise `undefined` so
 * express-rate-limit uses its in-memory store.
 */
export function createRateLimitStore(): Store | undefined {
  if (!env.upstashRedisRestUrl || !env.upstashRedisRestToken) return undefined;
  return new UpstashRateLimitStore(env.upstashRedisRestUrl, env.upstashRedisRestToken);
}

/**
 * Stable, non-reversible key for a request body field (e.g. the email on a
 * login attempt). Keying credential limits on the account rather than the IP
 * stops a botnet from spreading guesses for one account across many addresses,
 * while hashing keeps raw addresses out of the store keys.
 */
export function hashKeyPart(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 32);
}
