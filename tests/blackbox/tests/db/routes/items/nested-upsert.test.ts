import { getUrl } from '@common/config';
import { CreateItem } from '@common/functions';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { collectionChildren, collectionParents } from './nested-upsert.seed';

// A nested o2m payload has two shapes, and only one of them reaches
// `ItemsService.upsertMany`. The alterations shape — `{ children: { create, update,
// delete } }` — is handed to `createMany`, which already batches. The bare array
// shape — `{ children: [ … ] }` — goes to `upsertMany`, which loops `upsertOne` one
// row at a time. These pin what that loop decides per row (create vs update, the
// key it returns, the order it writes in) before the loop is replaced by a batch.
//
// The second block covers the guard that decides which shape is even a change:
// `updateMany` treats an alterations object carrying no item as changing nothing and
// skips the whole transaction, while a bare array never counts as empty because for
// an o2m it deselects every child.
//
// The third block reaches `upsertMany` through an endpoint extension, which is the
// only way to call it as its own caller never does: with no mutation tracker, and
// with the returned keys actually read. `processO2M` consumes those keys internally,
// so nothing else can check that they line up with the payloads.

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

type Row = { id: number; name: string; parent: number | null };

async function createParent(vendor: Vendor, name: string) {
	const [row] = await CreateItem(vendor, {
		collection: collectionParents,
		item: [{ name }],
	});

	return row as { id: number; name: string };
}

async function readChildrenOf(vendor: Vendor, parent: number) {
	const response = await request(getUrl(vendor))
		.get(`/items/${collectionChildren}`)
		.query({
			'filter[parent][_eq]': String(parent),
			fields: 'id,name,parent',
			sort: 'id',
			limit: -1,
		})
		.set('Authorization', AUTH);

	expect(response.statusCode).toEqual(200);

	return response.body.data as Row[];
}

async function writeChildren(vendor: Vendor, parent: number, children: unknown[]) {
	const response = await request(getUrl(vendor))
		.patch(`/items/${collectionParents}/${parent}`)
		.send({ children })
		.set('Authorization', AUTH);

	expect(response.statusCode).toEqual(200);

	return response;
}

describe('nested upsert through the array shape', () => {
	describe.each(vendors)('%s', (vendor) => {
		it('writes every child of a multi-row array in input order', async () => {
			const parent = await createParent(vendor, 'many');

			// Four rows so the assertion reads an order rather than a swap, with the
			// first and last acting as fixed witnesses.
			await writeChildren(vendor, parent.id, [
				{ name: 'first' },
				{ name: 'second' },
				{ name: 'third' },
				{ name: 'fourth' },
			]);

			const children = await readChildrenOf(vendor, parent.id);

			expect(children.map((child) => child.name)).toEqual([
				'first',
				'second',
				'third',
				'fourth',
			]);
		});

		it('updates an existing child and creates a new one in one array', async () => {
			const parent = await createParent(vendor, 'mixed');

			await writeChildren(vendor, parent.id, [{ name: 'before' }]);
			const [existing] = await readChildrenOf(vendor, parent.id);

			// One payload carrying both arms: a keyed row upsertOne resolves to an
			// update, and a keyless row it resolves to a create.
			await writeChildren(vendor, parent.id, [
				{ id: existing!.id, name: 'after' },
				{ name: 'added' },
			]);

			const children = await readChildrenOf(vendor, parent.id);

			// The keyed row was updated in place, not duplicated.
			expect(children).toHaveLength(2);
			expect(children[0]!.id).toEqual(existing!.id);
			expect(children[0]!.name).toEqual('after');
			expect(children[1]!.name).toEqual('added');
		});

		it('creates a child carrying a key that has no row yet', async () => {
			const parent = await createParent(vendor, 'explicit-key');
			const unusedKey = 900_001;

			await writeChildren(vendor, parent.id, [
				{ id: unusedKey, name: 'explicit' },
			]);

			const children = await readChildrenOf(vendor, parent.id);

			// A key that matches no row is an insert with that key, not an update.
			expect(children).toEqual([
				{ id: unusedKey, name: 'explicit', parent: parent.id },
			]);
		});

		it('relinks a child given by bare key, and repeating it is inert', async () => {
			const [donor, receiver] = await Promise.all([
				createParent(vendor, 'donor'),
				createParent(vendor, 'receiver'),
			]);

			await writeChildren(vendor, donor.id, [{ name: 'moved' }]);
			const [child] = await readChildrenOf(vendor, donor.id);

			// A bare key, not an object: the child is reparented onto the receiver.
			await writeChildren(vendor, receiver.id, [child!.id]);

			const [donorChildren, receiverChildren] = await Promise.all([
				readChildrenOf(vendor, donor.id),
				readChildrenOf(vendor, receiver.id),
			]);

			expect(donorChildren).toEqual([]);

			expect(receiverChildren).toEqual([
				{ id: child!.id, name: 'moved', parent: receiver.id },
			]);

			// Sending the same key again is idempotent. processO2M short-circuits on
			// a child already pointing at this parent, but that is a skipped lookup
			// rather than a visible difference: without the short-circuit the child
			// would be upserted with nothing but its own key, which changes no field
			// either. So this pins the outcome, not the shortcut.
			await writeChildren(vendor, receiver.id, [child!.id]);

			expect(await readChildrenOf(vendor, receiver.id)).toEqual([
				{ id: child!.id, name: 'moved', parent: receiver.id },
			]);
		});

		it('nullifies every child when the array is empty', async () => {
			const parent = await createParent(vendor, 'emptied');

			await writeChildren(vendor, parent.id, [
				{ name: 'kept-row' },
				{ name: 'also-kept' },
			]);

			const before = await readChildrenOf(vendor, parent.id);
			expect(before).toHaveLength(2);

			// An empty array is not a no-op: it deselects every child.
			await writeChildren(vendor, parent.id, []);

			// Deselected, not deleted — the second read looks the rows up by the
			// keys they had, where the first only asks who still points at the
			// parent. Neither depends on the other.
			const [detached, orphans] = await Promise.all([
				readChildrenOf(vendor, parent.id),
				request(getUrl(vendor))
					.get(`/items/${collectionChildren}`)
					.query({
						filter: JSON.stringify({
							id: { _in: before.map((child) => child.id) },
						}),
						fields: 'id,parent',
						limit: -1,
					})
					.set('Authorization', AUTH),
			]);

			expect(detached).toEqual([]);

			expect(orphans.statusCode).toEqual(200);
			expect(orphans.body.data).toHaveLength(2);

			for (const orphan of orphans.body.data as Row[]) {
				expect(orphan.parent).toBeNull();
			}
		});
	});
});

describe('the alterations shape decides whether anything changed', () => {
	describe.each(vendors)('%s', (vendor) => {
		it('treats an alterations object with no item as no change', async () => {
			const parent = await createParent(vendor, 'no-change');

			await writeChildren(vendor, parent.id, [{ name: 'kept' }]);

			// The batch route echoes the rows updateMany reports, so an update it
			// skips entirely comes back as an empty list rather than the parent.
			const response = await request(getUrl(vendor))
				.patch(`/items/${collectionParents}`)
				.send({
					keys: [parent.id],
					data: { children: { create: [], update: [], delete: [] } },
				})
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);
			expect(response.body.data).toEqual([]);

			// Skipped, not applied: the child an empty array would have deselected
			// is still attached.
			expect(await readChildrenOf(vendor, parent.id)).toHaveLength(1);
		});

		it('refuses an alterations object carrying an unknown operation', async () => {
			const parent = await createParent(vendor, 'unknown-operation');

			const response = await request(getUrl(vendor))
				.patch(`/items/${collectionParents}`)
				.send({
					keys: [parent.id],
					data: { children: { create: [], replace: [{ name: 'nope' }] } },
				})
				.set('Authorization', AUTH);

			// An unknown key means the value is not an alterations object, so it is
			// not treated as "no change" — it reaches the nested write and is
			// rejected there.
			expect(response.statusCode).toEqual(400);
		});
	});
});

describe('upsertMany called the way processO2M never calls it', () => {
	describe.each(vendors)('%s', (vendor) => {
		it('returns one key per payload, in input order', async () => {
			const parent = await createParent(vendor, 'probe-order');

			await writeChildren(vendor, parent.id, [
				{ name: 'one' },
				{ name: 'two' },
				{ name: 'three' },
			]);

			const children = await readChildrenOf(vendor, parent.id);

			// Deliberately not the order they were written in: a call that grouped
			// or sorted its payloads would return the keys in a different order and
			// mis-pair every child with its data.
			const response = await request(getUrl(vendor))
				.post('/nested-upsert-probe/upsert-many')
				.send({
					payloads: [
						{ id: children[2]!.id, name: 'third-first' },
						{ id: children[0]!.id, name: 'first-second' },
						{ id: children[1]!.id, name: 'second-third' },
					],
				})
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);

			expect(response.body.keys).toEqual([
				children[2]!.id,
				children[0]!.id,
				children[1]!.id,
			]);

			// Each payload landed on the row its own key named, not on the row at
			// its position.
			expect(await readChildrenOf(vendor, parent.id)).toEqual([
				{ id: children[0]!.id, name: 'first-second', parent: parent.id },
				{ id: children[1]!.id, name: 'second-third', parent: parent.id },
				{ id: children[2]!.id, name: 'third-first', parent: parent.id },
			]);
		});

		it('accepts no payloads at all', async () => {
			const response = await request(getUrl(vendor))
				.post('/nested-upsert-probe/upsert-many')
				.send({ payloads: [] })
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);
			expect(response.body.keys).toEqual([]);
		});
	});
});
