import { getUrl } from '@common/config';
import { CreateCollection, CreateItem } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// End-to-end witness for the M2M pivot-dedup use case, driven by the `pivot-dedup`
// hook extension (tests/blackbox/extensions/pivot-dedup). That extension puts a
// `create` filter on `test_items_pivot_dedup` which looks the pair up by its two
// foreign keys and, when a row exists, returns its PK — Directus then skips the
// insert and reuses the row.
//
// Cache-handling note (investigated alongside #284): a dedup take-over makes
// `createMany` treat the row as "taken over" (more live keys than payloads), which
// currently falls back to a coarse whole-collection scoped-cache purge — even though
// nothing was written. The hook declares the precise slice via
// `context.scopedCache.addTag`, but the coarse purge still fires; suppressing it on
// a no-op take-over is a separate decision. This suite pins the FUNCTIONAL contract
// (dedup happens, the pair stays unique); the scoped purge behaviour is
// unit-tested in scoped-cache-purge.test.ts.

const collection = 'test_items_pivot_dedup';

beforeAll(async () => {
	for (const vendor of vendors) {
		await CreateCollection(vendor, {
			collection,
			fields: [
				{ field: 'left_id', type: 'integer', schema: {}, meta: {} },
				{ field: 'right_id', type: 'integer', schema: {}, meta: {} },
			],
		});
	}
}, 300000);

describe('M2M pivot dedup via a create filter hook', () => {
	describe('a duplicate (left_id, right_id) pair reuses the existing row', () => {
		it.each(vendors)('%s', async (vendor) => {
			const first = await CreateItem(vendor, {
				collection,
				item: { left_id: 10, right_id: 20 },
			});

			// Same pair again → the hook returns the existing PK, so nothing is inserted.
			const duplicate = await CreateItem(vendor, {
				collection,
				item: { left_id: 10, right_id: 20 },
			});

			expect(duplicate.id).toBe(first.id);

			const rows = await request(getUrl(vendor))
				.get(`/items/${collection}`)
				.query({ 'filter[left_id][_eq]': 10, 'filter[right_id][_eq]': 20 })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			// The pair stays unique — the duplicate create collapsed onto the first row.
			expect(rows.body.data).toHaveLength(1);
			expect(rows.body.data[0].id).toBe(first.id);
		});
	});

	describe('a distinct pair is created normally, not deduped', () => {
		it.each(vendors)('%s', async (vendor) => {
			const shared = await CreateItem(vendor, {
				collection,
				item: { left_id: 30, right_id: 40 },
			});

			// Same left, different right → a different pair → a real insert with a new PK.
			const distinct = await CreateItem(vendor, {
				collection,
				item: { left_id: 30, right_id: 41 },
			});

			expect(distinct.id).not.toBe(shared.id);
		});
	});
});
