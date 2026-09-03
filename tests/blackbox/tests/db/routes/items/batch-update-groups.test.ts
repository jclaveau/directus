import { getUrl } from '@common/config';
import { CreateItem } from '@common/functions';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { collectionGrouped, collectionGroupedLog } from './batch-update-groups.seed';

// The update events are observed through the update-groups-probe hook, which
// writes one row per event into the log collection. Reading them back over the
// API keeps this a blackbox view: what a hook author receives, not what the
// service passes around.

type GroupedRow = { id: number; name: string; status: string | null };
type LoggedEvent = { event: string; phase: string; payload: string };

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

async function createRows(vendor: Vendor, names: string[]): Promise<GroupedRow[]> {
	return await CreateItem(vendor, {
		collection: collectionGrouped,
		item: names.map((name) => ({ name })),
	});
}

async function clearLog(vendor: Vendor) {
	const existing = await request(getUrl(vendor))
		.get(`/items/${collectionGroupedLog}`)
		.query({ fields: 'id', limit: -1 })
		.set('Authorization', AUTH);

	const ids = existing.body.data.map((row: { id: number }) => row.id);

	if (ids.length > 0) {
		await request(getUrl(vendor))
			.delete(`/items/${collectionGroupedLog}`)
			.send(ids)
			.set('Authorization', AUTH);
	}
}

async function readLog(vendor: Vendor): Promise<LoggedEvent[]> {
	const response = await request(getUrl(vendor))
		.get(`/items/${collectionGroupedLog}`)
		.query({ fields: 'event,phase,payload', sort: 'id', limit: -1 })
		.set('Authorization', AUTH);

	expect(response.statusCode).toEqual(200);

	return response.body.data;
}

function eventsOf(log: LoggedEvent[], event: string, phase: string) {
	return log
		.filter((entry) => entry.event === event && entry.phase === phase)
		.map((entry) => JSON.parse(entry.payload));
}

async function readRows(vendor: Vendor, ids: number[]): Promise<GroupedRow[]> {
	const response = await request(getUrl(vendor))
		.get(`/items/${collectionGrouped}`)
		.query({
			'filter[id][_in]': ids.join(','),
			fields: 'id,name,status',
			sort: 'id',
			limit: -1,
		})
		.set('Authorization', AUTH);

	expect(response.statusCode).toEqual(200);

	return response.body.data;
}

describe('grouped update events', () => {
	describe.each(vendors)('%s', (vendor) => {
		beforeEach(async () => {
			await clearLog(vendor);
		}, 60_000);

		it('fires the grouped event once per update', async () => {
			const rows = await createRows(vendor, ['a-one', 'a-two', 'a-three']);
			const keys = rows.map((row) => row.id).sort((left, right) => left - right);

			const update = await request(getUrl(vendor))
				.patch(`/items/${collectionGrouped}`)
				.send({ keys, data: { status: 'archived' } })
				.set('Authorization', AUTH);

			expect(update.statusCode).toEqual(200);

			const log = await readLog(vendor);
			const grouped = eventsOf(log, 'items.update', 'filter');

			// One event for the whole update, carrying one group: the shared payload and
			// every key it applies to. This is what used to be impossible to see.
			expect(grouped).toHaveLength(1);
			expect(grouped[0]).toHaveLength(1);
			expect(grouped[0][0].data).toMatchObject({ status: 'archived' });
			const groupedKeys = [...grouped[0][0].keys];

			expect(groupedKeys.sort((l: number, r: number) => l - r)).toEqual(keys);

			// And once per row alongside it, each carrying its own key inline.
			const perRow = eventsOf(log, 'items.update.one', 'filter');

			expect(perRow).toHaveLength(3);
			const perRowKeys = perRow.map((payload) => payload.id);

			expect(perRowKeys.sort((l, r) => l - r)).toEqual(keys);
			expect(perRow[0]).toMatchObject({ status: 'archived' });

			expect(eventsOf(log, 'items.update', 'action')).toHaveLength(1);
			expect(eventsOf(log, 'items.update.one', 'action')).toHaveLength(3);
		});

		it('carries one group per row when the payloads differ', async () => {
			const rows = await createRows(vendor, ['b-one', 'b-two', 'b-three']);

			const update = await request(getUrl(vendor))
				.patch(`/items/${collectionGrouped}`)
				.send(rows.map((row, index) => ({ id: row.id, status: `s${index}` })))
				.set('Authorization', AUTH);

			expect(update.statusCode).toEqual(200);

			const grouped = eventsOf(await readLog(vendor), 'items.update', 'filter');

			// updateBatch used to fire this event once per row. Now it fires once, with a
			// group per row, so a hook sees the whole batch before anything is written.
			expect(grouped).toHaveLength(1);
			expect(grouped[0]).toHaveLength(3);

			expect(grouped[0].map((group: any) => group.data.status).sort()).toEqual([
				's0',
				's1',
				's2',
			]);

			for (const group of grouped[0]) {
				expect(group.keys).toHaveLength(1);
			}
		});

		it('cancels one row and writes its siblings', async () => {
			const rows = await createRows(vendor, ['cancel-me', 'c-two', 'c-three']);
			const keys = rows.map((row) => row.id).sort((left, right) => left - right);

			await request(getUrl(vendor))
				.patch(`/items/${collectionGrouped}`)
				.send({ keys, data: { status: 'archived' } })
				.set('Authorization', AUTH);

			const after = await readRows(vendor, keys);
			const cancelled = after.find((row) => row.name === 'cancel-me')!;

			expect(cancelled.status).toBeNull();

			const siblings = after.filter((row) => row.name !== 'cancel-me');

			for (const row of siblings) {
				expect(row.status).toEqual('archived');
			}

			// The cancelled row never reaches the action side.
			const log = await readLog(vendor);
			const acted = eventsOf(log, 'items.update.one', 'action');

			expect(acted).toHaveLength(2);
			expect(acted.map((payload) => payload.id)).not.toContain(cancelled.id);
		});

		it('splits the group when the per-row event rewrites one row', async () => {
			const rows = await createRows(vendor, ['d-one', 'rewrite-me', 'd-three']);
			const keys = rows.map((row) => row.id).sort((left, right) => left - right);

			await request(getUrl(vendor))
				.patch(`/items/${collectionGrouped}`)
				.send({ keys, data: { status: 'archived' } })
				.set('Authorization', AUTH);

			const after = await readRows(vendor, keys);
			const rewritten = after.find((row) => row.id === rows[1]!.id)!;

			// The rewrite reached the database rather than being dropped when the group
			// it came from was split around it.
			expect(rewritten.name).toEqual('rewritten');
			expect(rewritten.status).toEqual('archived');

			for (const row of after.filter((candidate) => candidate.id !== rewritten.id)) {
				expect(row.status).toEqual('archived');
				expect(row.name).not.toEqual('rewritten');
			}
		});

		it('answers with every row the caller named, no-op rows included', async () => {
			const rows = await createRows(vendor, ['noop-one', 'noop-two']);
			const [untouched, written] = rows as [GroupedRow, GroupedRow];

			// The first element carries nothing but its primary key, so it writes
			// nothing — but the caller still named it, and the response body is built
			// by reading back the keys the update returns.
			const update = await request(getUrl(vendor))
				.patch(`/items/${collectionGrouped}`)
				.query({ fields: 'id,name,status', sort: 'id' })
				.send([
					{ id: untouched.id },
					{ id: written.id, status: 'archived' },
				])
				.set('Authorization', AUTH);

			expect(update.statusCode).toEqual(200);

			expect(update.body.data).toEqual([
				{ id: untouched.id, name: 'noop-one', status: null },
				{ id: written.id, name: 'noop-two', status: 'archived' },
			]);
		});
	});
});
