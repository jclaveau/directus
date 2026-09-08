import { getUrl } from '@common/config';
import { CreateItem } from '@common/functions';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { collectionReadHookNull } from './read-hook-null.seed';

// emitFilter propagates an `items.read` listener's return value verbatim, and
// `readByQuery` casts it with an unchecked `as Item[]` — so a hook returning null
// looks like it should make reads resolve to null. It does not: the last thing
// `readByQuery` does is `withMeta(...)`, whose `Object.defineProperty` refuses a
// non-object, so the read throws instead of answering.
//
// That matters most where a read runs inside somebody else's transaction. The
// snapshot `updateMany` takes for its revisions is one, and this pins what happens
// there: the request fails and the write rolls back, rather than the update landing
// with a corrupted revision beside it.
//
// The read-null-hook extension supplies the hook, scoped to this collection and to
// rows carrying the marker name so every other read here answers normally.

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;
const MARKER = 'read-returns-null';

async function createRow(vendor: Vendor, name: string) {
	const [row] = await CreateItem(vendor, {
		collection: collectionReadHookNull,
		item: [{ name }],
	});

	return row as { id: number; name: string };
}

// The batch route hands `readMany`'s value to the response untouched, where the
// single-item route would reach for `.length` on it first.
async function renameViaBatch(vendor: Vendor, id: number, name: string) {
	return await request(getUrl(vendor))
		.patch(`/items/${collectionReadHookNull}`)
		.send({ keys: [id], data: { name } })
		.set('Authorization', AUTH);
}

async function revisionsFor(vendor: Vendor, id: number) {
	const response = await request(getUrl(vendor))
		.get('/revisions')
		.query({
			filter: JSON.stringify({
				_and: [
					{ collection: { _eq: collectionReadHookNull } },
					{ item: { _eq: String(id) } },
				],
			}),
			fields: 'id,data',
			// `at(-1)` below means the newest, so the order has to be asked for
			// rather than inherited from however the rows come back.
			sort: 'id',
			limit: -1,
		})
		.set('Authorization', AUTH);

	expect(response.statusCode).toEqual(200);

	return response.body.data as { id: number; data: unknown }[];
}

describe('an items.read hook returning null', () => {
	describe.each(vendors)('%s', (vendor) => {
		it('fails the update that snapshots its rows, and rolls it back', async () => {
			const row = await createRow(vendor, 'starts-readable');

			// Creating the row already filed a revision of its own, so the check
			// below is that the failed update added none — not that there are none.
			const revisionsBefore = await revisionsFor(vendor, row.id);

			// Renaming it to the marker is what arms the hook: the snapshot read
			// runs after the update, inside the transaction, so it sees the new
			// name and the hook answers null for it.
			const response = await renameViaBatch(vendor, row.id, MARKER);

			// `withMeta` refuses the null before the caller ever sees it, and the
			// throw is not caught anywhere between there and the request.
			expect(response.statusCode).toEqual(500);

			// The rename was inside the transaction the snapshot ran in, so it went
			// back with it. Reading the row is safe: it never took the marker name,
			// so the hook does not fire for it.
			// The row and its revisions are two independent reads of the same
			// rolled-back write.
			const [after, revisionsAfter] = await Promise.all([
				request(getUrl(vendor))
					.get(`/items/${collectionReadHookNull}/${row.id}`)
					.query({ fields: 'id,name' })
					.set('Authorization', AUTH),
				revisionsFor(vendor, row.id),
			]);

			expect(after.statusCode).toEqual(200);
			expect(after.body.data).toEqual({ id: row.id, name: 'starts-readable' });

			// And no revision was added — the block that writes them is the one
			// that threw, and it went back with the rest of the transaction.
			expect(revisionsAfter).toEqual(revisionsBefore);
		});

		it('leaves a row without the marker writing and reading normally', async () => {
			const row = await createRow(vendor, 'stays-readable');

			// The control: same collection, same route, no marker — so the hook
			// returns the payload it was given and the snapshot is a real row.
			const response = await renameViaBatch(vendor, row.id, 'still-readable');

			expect(response.statusCode).toEqual(200);

			expect(response.body.data).toEqual([
				{ id: row.id, name: 'still-readable' },
			]);

			const revisions = await revisionsFor(vendor, row.id);

			expect(revisions.at(-1)!.data).toMatchObject({
				id: row.id,
				name: 'still-readable',
			});
		});
	});
});
