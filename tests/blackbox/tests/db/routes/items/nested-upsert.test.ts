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

			expect(await readChildrenOf(vendor, donor.id)).toEqual([]);

			expect(await readChildrenOf(vendor, receiver.id)).toEqual([
				{ id: child!.id, name: 'moved', parent: receiver.id },
			]);

			// Sending the same key again short-circuits: already this parent's child,
			// so it is neither rewritten nor duplicated.
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

			expect(await readChildrenOf(vendor, parent.id)).toEqual([]);

			// Deselected, not deleted — the rows survive with a null parent.
			const orphans = await request(getUrl(vendor))
				.get(`/items/${collectionChildren}`)
				.query({
					filter: JSON.stringify({
						id: { _in: before.map((child) => child.id) },
					}),
					fields: 'id,parent',
					limit: -1,
				})
				.set('Authorization', AUTH);

			expect(orphans.statusCode).toEqual(200);
			expect(orphans.body.data).toHaveLength(2);

			for (const orphan of orphans.body.data as Row[]) {
				expect(orphan.parent).toBeNull();
			}
		});
	});
});
