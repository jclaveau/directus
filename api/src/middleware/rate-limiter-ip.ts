import { useEnv } from '@directus/env';
import { HitRateLimitError } from '@directus/errors';
import type { RequestHandler } from 'express';
import type { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import { createRateLimiter } from '../rate-limiter.js';
import asyncHandler from '../utils/async-handler.js';
import { getIPFromReq } from '../utils/get-ip-from-req.js';
import { validateEnv } from '../utils/validate-env.js';

let checkRateLimit: RequestHandler = (_req, _res, next) => next();

export let rateLimiter: RateLimiterRedis | RateLimiterMemory;

const env = useEnv();

const RATE_LIMITER_CHARGES = ['cache-misses', 'every-request'] as const;

type RateLimiterCharge = typeof RATE_LIMITER_CHARGES[number];

/**
 * Which requests spend a per-IP token, from `RATE_LIMITER_CHARGE`. The answer picks
 * where `app.ts` registers this middleware, so it is read at boot, not per request.
 *
 * - `cache-misses` (default) — registered below the cache, which answers a HIT
 *   without calling `next()`. The limiter guards the expensive path and a HIT is not
 *   that. With caching off every request is a miss, so every request is charged.
 * - `every-request` — upstream's position, above `authenticate`. Charges before the
 *   cache is consulted, so a burst of cacheable reads can 429 at a 100% hit rate.
 *   The trade is that an invalid-token flood is rejected before it costs a lookup.
 */
export function rateLimiterChargesEveryRequest(): boolean {
	const charge = env['RATE_LIMITER_CHARGE'];

	if (!RATE_LIMITER_CHARGES.includes(charge as RateLimiterCharge)) {
		const accepted = RATE_LIMITER_CHARGES
			.map((value) => `"${value}"`)
			.join(' or ');

		throw new Error(
			`Invalid RATE_LIMITER_CHARGE "${charge}" — expected ${accepted}`,
		);
	}

	return charge === 'every-request';
}

if (env['RATE_LIMITER_ENABLED'] === true) {
	validateEnv(['RATE_LIMITER_STORE', 'RATE_LIMITER_DURATION', 'RATE_LIMITER_POINTS']);

	rateLimiter = createRateLimiter('RATE_LIMITER');

	checkRateLimit = asyncHandler(async (req, res, next) => {
		const ip = getIPFromReq(req);

		if (ip) {
			try {
				await rateLimiter.consume(ip, 1);
			} catch (rateLimiterRes: any) {
				if (rateLimiterRes instanceof Error) throw rateLimiterRes;

				res.set('Retry-After', String(Math.round(rateLimiterRes.msBeforeNext / 1000)));
				throw new HitRateLimitError({
					limit: +(env['RATE_LIMITER_POINTS'] as string),
					reset: new Date(Date.now() + rateLimiterRes.msBeforeNext),
				});
			}
		}

		next();
	});
}

export default checkRateLimit;
