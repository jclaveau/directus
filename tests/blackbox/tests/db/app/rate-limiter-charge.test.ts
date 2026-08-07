import config, { getUrl, paths, type Env } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The per-IP limiter guards the expensive path, so what it charges depends on where
// it sits. Registered above the cache it spends a token before the cache is
// consulted, and a burst of cacheable reads 429s at a 100% hit rate — the load
// caching exists to absorb (#340). Registered below it, only requests that reach a
// handler pay.
//
// Both instances run the same limiter (2 points, one-hour window) and differ only by
// `RATE_LIMITER_CHARGE`, so a difference in outcome can only come from that value.
// `chargeDefault` leaves it unset on purpose: the default is under test too.
//
// Each case sends its own `X-Forwarded-For`, giving it a private bucket — otherwise
// the harness's own startup polling would have spent part of the budget before the
// first assertion.
describe('Rate limiter charge', () => {
	const directusInstances = {} as { [vendor: string]: ChildProcess[] };
	const envs = {} as Record<Vendor, { chargeDefault: Env; chargeEveryRequest: Env }>;
	const cacheStatusHeader = 'x-cache-status';

	beforeAll(async () => {
		const promises = [];

		for (const vendor of vendors) {
			const chargeDefault = cloneDeep(config.envs);
			chargeDefault[vendor]['CACHE_ENABLED'] = 'true';
			chargeDefault[vendor]['CACHE_STORE'] = 'memory';
			chargeDefault[vendor]['CACHE_AUTO_PURGE'] = 'false';
			chargeDefault[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
			chargeDefault[vendor]['CACHE_NAMESPACE'] = `rate-limiter-charge-${vendor}`;
			chargeDefault[vendor]['RATE_LIMITER_ENABLED'] = 'true';
			chargeDefault[vendor]['RATE_LIMITER_STORE'] = 'memory';
			chargeDefault[vendor]['RATE_LIMITER_POINTS'] = '2';
			// An hour, so the window cannot quietly refill between two assertions.
			chargeDefault[vendor]['RATE_LIMITER_DURATION'] = '3600';

			const chargeEveryRequest = cloneDeep(chargeDefault);
			chargeEveryRequest[vendor]['RATE_LIMITER_CHARGE'] = 'every-request';

			const chargeDefaultPort = await getPort();
			const chargeEveryRequestPort = await getPort();
			chargeDefault[vendor].PORT = String(chargeDefaultPort);
			chargeEveryRequest[vendor].PORT = String(chargeEveryRequestPort);

			directusInstances[vendor] = [
				spawn('node', [paths.cli, 'start'], {
					cwd: paths.cwd,
					env: chargeDefault[vendor],
				}),
				spawn('node', [paths.cli, 'start'], {
					cwd: paths.cwd,
					env: chargeEveryRequest[vendor],
				}),
			];

			envs[vendor] = { chargeDefault, chargeEveryRequest };

			promises.push(
				awaitDirectusConnection(chargeDefaultPort),
				awaitDirectusConnection(chargeEveryRequestPort),
			);
		}

		await Promise.all(promises);
	}, 180_000);

	afterAll(() => {
		for (const vendor of vendors) {
			for (const instance of directusInstances[vendor]!) {
				instance.kill();
			}
		}
	});

	// A cacheable admin read. The query string is what varies the cache key, so a
	// distinct `key` is a guaranteed miss and a repeat is a guaranteed hit.
	function readAsIp(vendor: Vendor, env: Env, ip: string, key: string) {
		return request(getUrl(vendor, env))
			.get(`/users/me?fields=id&rateLimiterChargeKey=${key}`)
			.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
			.set('X-Forwarded-For', ip);
	}

	describe.each(vendors)('%s', (vendor) => {
		it('serves cache hits without spending the per-IP budget', async () => {
			const { chargeDefault } = envs[vendor]!;
			const ip = '10.40.0.1';

			const cold = await readAsIp(vendor, chargeDefault, ip, 'a');
			const warm = await readAsIp(vendor, chargeDefault, ip, 'a');

			// Non-vacuity: without this a run that cached nothing would still pass, since
			// two requests fit inside a 2-point budget either way.
			expect(cold.headers[cacheStatusHeader]).toBe('MISS');
			expect(warm.headers[cacheStatusHeader]).toBe('HIT');
			expect(cold.status).toBe(200);
			expect(warm.status).toBe(200);

			// One point left. Spend it on a second miss, then keep reading the warm key:
			// the budget is now empty and the hit must still be served.
			expect((await readAsIp(vendor, chargeDefault, ip, 'b')).status).toBe(200);

			const exhausted = await readAsIp(vendor, chargeDefault, ip, 'a');
			expect(exhausted.headers[cacheStatusHeader]).toBe('HIT');
			expect(exhausted.status).toBe(200);
		});

		it('still 429s a miss once the budget is gone', async () => {
			// The other half of the contract: exempting hits must not disarm the limiter
			// on the path it exists to protect.
			const { chargeDefault } = envs[vendor]!;
			const ip = '10.40.0.2';

			expect((await readAsIp(vendor, chargeDefault, ip, 'c')).status).toBe(200);
			expect((await readAsIp(vendor, chargeDefault, ip, 'd')).status).toBe(200);

			const overBudget = await readAsIp(vendor, chargeDefault, ip, 'e');
			expect(overBudget.status).toBe(429);
			expect(overBudget.headers['retry-after']).toBeDefined();
		});

		it('charges hits too when asked to charge every request', async () => {
			// Upstream's position, kept reachable by the env. This is the behaviour #340
			// reports — asserted here so the default's exemption is provably the env's
			// doing and not some other difference between the two instances.
			const { chargeEveryRequest } = envs[vendor]!;
			const ip = '10.40.0.3';

			const cold = await readAsIp(vendor, chargeEveryRequest, ip, 'f');
			const warm = await readAsIp(vendor, chargeEveryRequest, ip, 'f');

			expect(cold.status).toBe(200);
			expect(warm.headers[cacheStatusHeader]).toBe('HIT');
			expect(warm.status).toBe(200);

			// A third read of the same warm key: served from cache, and rejected anyway.
			expect((await readAsIp(vendor, chargeEveryRequest, ip, 'f')).status).toBe(429);
		});
	});
});
