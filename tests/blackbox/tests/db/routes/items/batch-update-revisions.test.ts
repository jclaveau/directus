import { getUrl } from '@common/config';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { collectionTracked } from './batch-update-revisions.seed';

// `updateMany` re-reads the updated rows to snapshot them onto their revisions, and
// that read carries no ORDER BY. Passing the keys in an order the database is
// unlikely to answer in — descending, against an ascending primary key — is what
// makes a positional pairing visible from the outside.
//
// The vendor is still free to answer in key order, in which case these assertions
// hold either way; they can never fail on a correctly paired revision.

type TrackedRow = { id: number; name: string; status: string | null };

async function createRows(vendor: string): Promise<TrackedRow[]> {
	const response = await request(getUrl(vendor))
		.post(`/items/${collectionTracked}`)
		.send([{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }])
		.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

	expect(response.statusCode).toEqual(200);

	return response.body.data;
}

describe('batch update revisions', () => {
	describe('files each revision under the item its snapshot describes', () => {
		it.each(vendors)('%s', async (vendor) => {
			const rows = await createRows(vendor);
			const nameByID = new Map(rows.map((row) => [row.id, row.name]));

			// Descending, so the ascending read order cannot line up positionally.
			const keys = rows.map((row) => row.id).sort((left, right) => right - left);

			const update = await request(getUrl(vendor))
				.patch(`/items/${collectionTracked}`)
				.send({ keys, data: { status: 'archived' } })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(update.statusCode).toEqual(200);

			const revisions = await request(getUrl(vendor))
				.get(`/revisions`)
				.query({
					'filter[collection][_eq]': collectionTracked,
					'filter[item][_in]': keys.join(','),
					fields: 'item,data',
					limit: -1,
				})
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(revisions.statusCode).toEqual(200);
			expect(revisions.body.data.length).toBeGreaterThanOrEqual(rows.length);

			for (const revision of revisions.body.data) {
				expect(revision.data).toMatchObject({
					name: nameByID.get(Number(revision.item)),
				});
			}
		});
	});

	describe('reverting one item does not write another item over it', () => {
		it.each(vendors)('%s', async (vendor) => {
			const rows = await createRows(vendor);
			const keys = rows.map((row) => row.id).sort((left, right) => right - left);

			await request(getUrl(vendor))
				.patch(`/items/${collectionTracked}`)
				.send({ keys, data: { status: 'archived' } })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			const target = rows.find((row) => row.id === keys[0])!;

			const revisions = await request(getUrl(vendor))
				.get(`/revisions`)
				.query({
					'filter[collection][_eq]': collectionTracked,
					'filter[item][_eq]': String(target.id),
					fields: 'id',
					sort: '-id',
					limit: 1,
				})
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(revisions.statusCode).toEqual(200);
			expect(revisions.body.data).toHaveLength(1);

			const revert = await request(getUrl(vendor))
				.post(`/utils/revert/${revisions.body.data[0].id}`)
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(revert.statusCode).toEqual(204);

			const reverted = await request(getUrl(vendor))
				.get(`/items/${collectionTracked}/${target.id}`)
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(reverted.statusCode).toEqual(200);
			expect(reverted.body.data.name).toEqual(target.name);
		});
	});
});
