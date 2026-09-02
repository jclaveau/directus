import { getUrl } from '@common/config';
import { CreateItem } from '@common/functions';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { collectionBatched } from './batch-update.seed';

// `PATCH /items/<collection>` has three bodies and they reach three different
// methods: `{ keys, data }` is `updateMany`, `{ query, data }` is `updateByQuery`,
// and a bare array is `updateBatch` (controllers/items.ts:191-200). Only the array
// carries per-row data, so it is the one that loops `updateOne` instead of sharing
// one payload across every key — and it was the only one of the three with no
// blackbox witness at all.

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

type Row = { id: number; name: string; status: string };

async function seedRows(vendor: Vendor, names: string[]) {
	const rows = await CreateItem(vendor, {
		collection: collectionBatched,
		item: names.map((name) => ({ name, status: 'before' })),
	});

	return rows as Row[];
}

async function readRows(vendor: Vendor, ids: number[]) {
	const response = await request(getUrl(vendor))
		.get(`/items/${collectionBatched}`)
		.query({
			filter: JSON.stringify({ id: { _in: ids } }),
			fields: 'id,name,status',
			sort: 'id',
			limit: -1,
		})
		.set('Authorization', AUTH);

	expect(response.statusCode).toEqual(200);

	return response.body.data as Row[];
}

describe('batch update through an array body', () => {
	describe.each(vendors)('%s', (vendor) => {
		it('gives each row of the array its own data', async () => {
			// A fifth row nobody names in the payload: the witness that the batch
			// updates what it was given and not the whole collection.
			const rows = await seedRows(vendor, ['a', 'b', 'c', 'd', 'untouched']);

			const response = await request(getUrl(vendor))
				.patch(`/items/${collectionBatched}`)
				.send(
					rows.slice(0, 4).map((row, index) => {
						return { id: row.id, status: `after-${index}` };
					}),
				)
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);

			const after = await readRows(vendor, rows.map((row) => row.id));

			// Per-row data, so each row carries a different value — a shared payload
			// would give all four the same one.
			expect(after.map((row) => row.status)).toEqual([
				'after-0',
				'after-1',
				'after-2',
				'after-3',
				'before',
			]);

			// The rows the payload never mentioned kept their other fields too.
			expect(after.map((row) => row.name)).toEqual([
				'a',
				'b',
				'c',
				'd',
				'untouched',
			]);
		});

		it('returns the updated rows in the response body', async () => {
			const rows = await seedRows(vendor, ['returned-one', 'returned-two']);

			const response = await request(getUrl(vendor))
				.patch(`/items/${collectionBatched}`)
				.query({ fields: 'id,status', sort: 'id' })
				.send(rows.map((row) => ({ id: row.id, status: 'echoed' })))
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);

			expect(response.body.data).toEqual([
				{ id: rows[0]!.id, status: 'echoed' },
				{ id: rows[1]!.id, status: 'echoed' },
			]);
		});

		it('treats a payload naming only the key as no change', async () => {
			const rows = await seedRows(vendor, ['pk-only']);

			const response = await request(getUrl(vendor))
				.patch(`/items/${collectionBatched}`)
				.send({ keys: [rows[0]!.id], data: { id: rows[0]!.id } })
				.set('Authorization', AUTH);

			// The primary key is not a change to the row, so nothing is left to
			// write and the update is skipped rather than issued — the echo is the
			// empty list, not the row.
			expect(response.statusCode).toEqual(200);
			expect(response.body.data).toEqual([]);

			const after = await readRows(vendor, [rows[0]!.id]);

			expect(after).toEqual([
				{ id: rows[0]!.id, name: 'pk-only', status: 'before' },
			]);
		});

		it('refuses the whole batch when one element misses its key', async () => {
			const rows = await seedRows(vendor, ['keyed', 'keyless-neighbour']);

			const response = await request(getUrl(vendor))
				.patch(`/items/${collectionBatched}`)
				.send([
					{ id: rows[0]!.id, status: 'attempted' },
					{ status: 'no-key-here' },
				])
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(400);

			// The keyed element shares the batch's transaction, so the valid half is
			// rolled back rather than half-applied.
			const after = await readRows(vendor, rows.map((row) => row.id));
			expect(after.map((row) => row.status)).toEqual(['before', 'before']);
		});
	});
});
