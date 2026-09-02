import { getUrl } from '@common/config';
import { CreateItem } from '@common/functions';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { collectionReadHookNull } from './read-hook-null.seed';

// `readByQuery` returns whatever the `items.read` filter hook handed back, cast
// with an unchecked `as Item[]` — emitFilter propagates a listener's return value
// verbatim and only ignores `undefined`. So a null return makes every read of that
// collection resolve to null, including the one updateMany runs to snapshot its rows
// for their revisions. The `Array.isArray(snapshots)` guard there is what keeps that
// from throwing inside the write's transaction.
//
// The read-null-hook extension supplies exactly that, scoped to this collection and
// to rows carrying the marker name.

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
			limit: -1,
		})
		.set('Authorization', AUTH);

	expect(response.statusCode).toEqual(200);

	return response.body.data as { id: number; data: unknown }[];
}

describe('an items.read hook returning null', () => {
	describe.each(vendors)('%s', (vendor) => {
		it('does not break the update that snapshots its rows', async () => {
			const row = await createRow(vendor, 'starts-readable');

			// Renaming it to the marker is what arms the hook: the snapshot read
			// runs after the update, inside the transaction, so it sees the new
			// name and answers null.
			const response = await renameViaBatch(vendor, row.id, MARKER);

			// The write survived the null snapshot rather than throwing mid
			// transaction — the response is empty only because the hook nulled the
			// read the controller uses to echo it.
			expect(response.statusCode).toEqual(200);
			expect(response.body.data).toBeNull();

			// The row really was written, read back where the hook does not apply.
			const revisions = await revisionsFor(vendor, row.id);
			expect(revisions.length).toBeGreaterThan(0);

			// And the null arm is what produced this revision: a snapshot that
			// resolved would have filed the row's own fields here, the way the
			// control below does. Nothing but the null read yields an empty one.
			expect(revisions.at(-1)!.data).toBeNull();
		});

		it('leaves a row without the marker reading normally', async () => {
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
