import config, { getUrl, paths } from '@common/config';
import { CreateCollections, CreateItem, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// End-to-end witness for the DELETE-side purge channel (#292): an `items.delete`
// hook declares a foreign slice via `context.scopedCache.purgeBy`, reaching a cache
// the framework's own purge never touches.
//
// Deleting a `charge` should invalidate the owner's cached `invoice` (a separate
// collection that aggregates charges). The framework purges the deleted charge's own
// slice, but nothing reaches the invoice. The delete hook resolves the deleted
// charge's owner and passes an invoice[owner] lookup's returned `scopedCacheTags` to
// `purgeBy`. Since we observe the INVOICE read, the only thing that can drop it is
// the hook — a clean attribution. Read via `x-cache-status` on a scoped instance:
//
//   - deleting an owner's charge invalidates that owner's invoice → MISS.
//   - a sibling owner's invoice is untouched → HIT (the hook resolved the real
//     owner, it isn't a coarse whole-collection purge).

const CHARGE = 'test_items_charge';
const INVOICE = 'test_items_invoice';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	delete-hook purgeBy: a delete reaches another collection's cached slice, precisely
	for the deleted row's owner (#292)
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-delete-scope-${vendor}`;

		let instance: ChildProcess;
		let acmeCharge: number;
		let globexCharge: number;

		beforeAll(async () => {
			// Seed on the default instance BEFORE the scoped instance spawns, so it sees
			// both collections (+ their `scoped_cache_fields`) on boot. Both partitioned
			// per owner; the delete hook bridges charge → invoice.
			await CreateCollections(vendor, {
				collections: [CHARGE, INVOICE].map((collection) => {
					return {
						collection,
						meta: { scoped_cache_fields: ['owner'] },
						fields: [
							{ field: 'owner', type: 'string' },
							{ field: 'amount', type: 'string' },
						],
					};
				}),
			});

			// Independent seeds → one round-trip. Capture the charge PKs to delete later.
			const [charges] = await Promise.all([
				CreateItem(vendor, {
					collection: CHARGE,
					item: [
						{ owner: 'acme', amount: '5' },
						{ owner: 'globex', amount: '7' },
					],
				}),
				CreateItem(vendor, {
					collection: INVOICE,
					item: [
						{ owner: 'acme', amount: '100' },
						{ owner: 'globex', amount: '200' },
					],
				}),
			]);

			[acmeCharge, globexCharge] = charges.map(
				(charge: { id: number }) => charge.id,
			);

			const port = await getPort();
			env[vendor].PORT = String(port);

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			await awaitDirectusConnection(port);
		}, 60_000);

		afterAll(async () => {
			instance.kill();

			await Promise.all([
				DeleteCollection(vendor, { collection: CHARGE }),
				DeleteCollection(vendor, { collection: INVOICE }),
			]);
		});

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		function readInvoice(owner: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${INVOICE}`)
				.query({ 'filter[owner][_eq]': owner })
				.set('Authorization', auth);
		}

		function deleteCharge(id: number) {
			return request(getUrl(vendor, env))
				.delete(`/items/${CHARGE}/${id}`)
				.set('Authorization', auth);
		}

		it(oneLine`
			deleting a charge invalidates the owner's cached invoice via the hook's
			purgeBy, leaving a sibling owner's invoice warm
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// Warm both invoice slices (independent reads).
			await Promise.all([readInvoice('acme'), readInvoice('globex')]);

			// Delete acme's charge: the hook resolves owner=acme and purges invoice[acme].
			await deleteCharge(acmeCharge);

			const [acme, globex] = await Promise.all([
				readInvoice('acme'),
				readInvoice('globex'),
			]);

			expect(acme.headers[cacheStatusHeader]).toBe('MISS');
			expect(globex.headers[cacheStatusHeader]).toBe('HIT');

			// Non-vacuity: the invoice itself is untouched (a charge was deleted, not the
			// invoice) — only its cache entry was dropped.
			expect(acme.body.data).toHaveLength(1);
		});

		it(oneLine`
			deleting a different owner's charge purges only that owner's invoice — the
			resolution is per-row, not a coarse collection purge
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			await Promise.all([readInvoice('acme'), readInvoice('globex')]);

			// Delete globex's charge → the hook purges invoice[globex] only.
			await deleteCharge(globexCharge);

			const [acme, globex] = await Promise.all([
				readInvoice('acme'),
				readInvoice('globex'),
			]);

			expect(acme.headers[cacheStatusHeader]).toBe('HIT');
			expect(globex.headers[cacheStatusHeader]).toBe('MISS');
			expect(globex.body.data).toHaveLength(1);
		});
	});
});
