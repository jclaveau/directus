import { getUrl } from '@common/config';
import { CreateItem } from '@common/functions';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
	collectionPaths,
	collectionPathsChild,
	collectionPathsLog,
} from './update-paths.seed';

// Covers the update paths that no plain HTTP route reaches: the nested-revision
// bookkeeping a relational payload triggers, and the mutation options only a caller
// inside the process can pass. The latter go through update-paths-probe, an endpoint
// extension, which is still a blackbox view — an extension is an ordinary consumer.

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

async function createRow(vendor: Vendor, name: string) {
	const [row] = await CreateItem(vendor, {
		collection: collectionPaths,
		item: [{ name }],
	});

	return row as { id: number; name: string };
}

async function readLog(vendor: Vendor) {
	const response = await request(getUrl(vendor))
		.get(`/items/${collectionPathsLog}`)
		.query({ fields: 'id,phase', limit: -1 })
		.set('Authorization', AUTH);

	return response.body.data as { id: number; phase: string }[];
}

describe('update paths', () => {
	describe.each(vendors)('%s', (vendor) => {
		it('parents the revisions a nested write creates under the row', async () => {
			const parent = await createRow(vendor, 'has-children');

			// A relational payload makes the update create child rows, whose revisions
			// hang off the parent's — the `onRevisionCreate` and child-parenting
			// bookkeeping no flat update ever reaches.
			const update = await request(getUrl(vendor))
				.patch(`/items/${collectionPaths}/${parent.id}`)
				.send({
					name: 'has-children',
					children: {
						create: [{ name: 'first' }, { name: 'second' }],
						update: [],
						delete: [],
					},
				})
				.set('Authorization', AUTH);

			expect(update.statusCode).toEqual(200);

			const children = await request(getUrl(vendor))
				.get(`/items/${collectionPathsChild}`)
				.query({
					'filter[parent][_eq]': String(parent.id),
					fields: 'id,name',
					limit: -1,
				})
				.set('Authorization', AUTH);

			expect(children.body.data).toHaveLength(2);

			const revisions = await request(getUrl(vendor))
				.get(`/revisions`)
				.query({
					'filter[collection][_eq]': collectionPathsChild,
					fields: 'id,item,parent',
					limit: -1,
				})
				.set('Authorization', AUTH);

			expect(revisions.statusCode).toEqual(200);
			expect(revisions.body.data.length).toBeGreaterThanOrEqual(2);

			// Non-vacuous: the child revisions carry a parent, which is the whole point
			// of the bookkeeping.
			for (const revision of revisions.body.data) {
				expect(revision.parent).not.toBeNull();
			}
		});

		it('refuses an updateBatch payload that is not a list', async () => {
			const response = await request(getUrl(vendor))
				.post(`/update-paths/not-an-array`)
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);
			expect(response.body.threw).toBe(true);
			expect(response.body.message).toContain('array of items');
		});

		it('throws a preMutationError before anything is written', async () => {
			const row = await createRow(vendor, 'untouched');

			const response = await request(getUrl(vendor))
				.post(`/update-paths/pre-mutation`)
				.send({ key: row.id })
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);
			expect(response.body.threw).toBe(true);
			expect(response.body.message).toEqual('pre-mutation refusal');

			const after = await request(getUrl(vendor))
				.get(`/items/${collectionPaths}/${row.id}`)
				.set('Authorization', AUTH);

			expect(after.body.data.name).toEqual('untouched');
		});

		it('writes without firing the events when emitEvents is off', async () => {
			const row = await createRow(vendor, 'before-silent');
			const before = await readLog(vendor);

			const response = await request(getUrl(vendor))
				.post(`/update-paths/silent`)
				.send({ keys: [row.id], name: 'after-silent' })
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);

			const after = await request(getUrl(vendor))
				.get(`/items/${collectionPaths}/${row.id}`)
				.set('Authorization', AUTH);

			// The write landed...
			expect(after.body.data.name).toEqual('after-silent');

			// ...and nothing was announced.
			expect(await readLog(vendor)).toHaveLength(before.length);
		});

		it('fires the events for an ordinary update', async () => {
			const row = await createRow(vendor, 'before-loud');
			const before = await readLog(vendor);

			await request(getUrl(vendor))
				.patch(`/items/${collectionPaths}/${row.id}`)
				.send({ name: 'after-loud' })
				.set('Authorization', AUTH);

			expect((await readLog(vendor)).length).toBeGreaterThan(before.length);
		});
	});
});
