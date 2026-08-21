import { getUrl } from '@common/config';
import { CreateItem } from '@common/functions';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { collectionTracked } from './batch-update-revisions.seed';

// `updateMany` re-reads the updated rows to snapshot them onto their revisions,
// and that read carries no ORDER BY. It also sorts the keys with no comparator
// (`keys.sort()`), which orders integers lexicographically — so a key set that
// crosses a digit boundary becomes 10, 8, 9 while the read answers 8, 9, 10.
// The two then disagree on every row, which is what makes a positional pairing
// visible from the outside. Hence the explicit keys below.

type TrackedRow = { id: number; name: string; status: string | null };

const NAMES = ['alpha', 'beta', 'gamma'];

async function createRows(vendor: Vendor, ids: number[]): Promise<TrackedRow[]> {
	return await CreateItem(vendor, {
		collection: collectionTracked,
		item: ids.map((id, index) => ({ id, name: NAMES[index] })),
	});
}

describe('batch update revisions', () => {
	describe('files each revision under the item its snapshot describes', () => {
		it.each(vendors)('%s', async (vendor) => {
			const rows = await createRows(vendor, [8, 9, 10]);
			const nameByID = new Map(rows.map((row) => [row.id, row.name]));
			const keys = rows.map((row) => row.id).sort((left, right) => left - right);

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
			const rows = await createRows(vendor, [98, 99, 100]);
			const keys = rows.map((row) => row.id).sort((left, right) => left - right);

			await request(getUrl(vendor))
				.patch(`/items/${collectionTracked}`)
				.send({ keys, data: { status: 'archived' } })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			// The row whose sorted position moves furthest: lexicographically `100`
			// leads, so this one is paired with the lowest-numbered snapshot.
			const target = rows.find((row) => row.id === 100)!;

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
