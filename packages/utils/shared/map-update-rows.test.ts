import { describe, expect, it } from 'vitest';
import { mapUpdateRows } from './map-update-rows.js';

describe('mapUpdateRows', () => {
	it('hands each row its own copy of the change, with its key', async () => {
		const handedRows: unknown[] = [];

		await mapUpdateRows(
			[{ data: { tags: ['a'] }, keys: [1, 2] }],
			(data, key) => {
				handedRows.push([key, structuredClone(data)]);
				data.tags!.push('b');

				return data;
			},
		);

		expect(handedRows).toEqual([
			[1, { tags: ['a'] }],
			[2, { tags: ['a'] }],
		]);
	});

	it('keeps the rows of a group the mapping leaves equal in one group', async () => {
		const mappedGroups = await mapUpdateRows(
			[{ data: { status: 'draft' }, keys: [1, 2, 3] }],
			(data) => ({ ...data, checked: true }),
		);

		expect(mappedGroups).toEqual([
			{ data: { status: 'draft', checked: true }, keys: [1, 2, 3] },
		]);
	});

	it('splits off only the row the mapping rewrote', async () => {
		const mappedGroups = await mapUpdateRows(
			[{ data: { status: 'draft' }, keys: [1, 2, 3] }],
			(data, key) => {
				return key === 2
					? { status: 'rewritten' }
					: data;
			},
		);

		expect(mappedGroups).toEqual([
			{ data: { status: 'draft' }, keys: [1, 3] },
			{ data: { status: 'rewritten' }, keys: [2] },
		]);
	});

	it('drops the key of a row the mapping returns null for', async () => {
		const mappedGroups = await mapUpdateRows(
			[{ data: { status: 'draft' }, keys: [1, 2, 3] }],
			(data, key) => {
				return key === 2
					? null
					: data;
			},
		);

		expect(mappedGroups).toEqual([
			{ data: { status: 'draft' }, keys: [1, 3] },
		]);
	});

	it('takes a row over when the mapping returns its key', async () => {
		const mappedEntries = await mapUpdateRows(
			[{ data: { status: 'draft' }, keys: [1, 2, 3] }],
			(data, key) => {
				return key === 2
					? key
					: data;
			},
		);

		expect(mappedEntries).toEqual([
			{ data: { status: 'draft' }, keys: [1, 3] },
			{ key: 2 },
		]);
	});

	it('leaves a row an earlier hook already took over as it was', async () => {
		const mappedKeys: unknown[] = [];

		const mappedEntries = await mapUpdateRows(
			[{ key: 7 }, { data: { status: 'draft' }, keys: [1] }],
			(data, key) => {
				mappedKeys.push(key);

				return data;
			},
		);

		expect(mappedEntries).toEqual([
			{ key: 7 },
			{ data: { status: 'draft' }, keys: [1] },
		]);

		expect(mappedKeys).toEqual([1]);
	});

	it('never merges rows of two groups, even when they end up equal', async () => {
		const mappedGroups = await mapUpdateRows(
			[
				{ data: { status: 'draft' }, keys: [1] },
				{ data: { status: 'published' }, keys: [2] },
			],
			() => ({ status: 'archived' }),
		);

		expect(mappedGroups).toEqual([
			{ data: { status: 'archived' }, keys: [1] },
			{ data: { status: 'archived' }, keys: [2] },
		]);
	});

	it('maps the rows one after another, in the order they were sent', async () => {
		const mappedKeys: unknown[] = [];

		await mapUpdateRows(
			[
				{ data: { status: 'draft' }, keys: [3, 1] },
				{ data: { status: 'published' }, keys: [2] },
			],
			async (data, key) => {
				await new Promise((resolve) => setTimeout(resolve, 4 - Number(key)));
				mappedKeys.push(key);

				return data;
			},
		);

		expect(mappedKeys).toEqual([3, 1, 2]);
	});

	it('keeps a later change to a row after an earlier one', async () => {
		const mappedStatuses: unknown[] = [];

		const mappedGroups = await mapUpdateRows(
			[
				{ data: { status: 'draft', delayMs: 5 }, keys: [1, 2] },
				{ data: { status: 'published', delayMs: 0 }, keys: [1] },
			],
			async (data) => {
				await new Promise((resolve) => setTimeout(resolve, data.delayMs));
				mappedStatuses.push(data.status);

				return { status: data.status };
			},
		);

		expect(mappedStatuses).toEqual(['draft', 'draft', 'published']);

		expect(mappedGroups).toEqual([
			{ data: { status: 'draft' }, keys: [1, 2] },
			{ data: { status: 'published' }, keys: [1] },
		]);
	});

	it('keeps the copy the mapping edited when it returns nothing', async () => {
		const mappedGroups = await mapUpdateRows(
			[{ data: { status: 'draft' }, keys: [1, 2] }],
			(data, key) => {
				if (key === 2) {
					data.status = 'checked';
				}
			},
		);

		expect(mappedGroups).toEqual([
			{ data: { status: 'draft' }, keys: [1] },
			{ data: { status: 'checked' }, keys: [2] },
		]);
	});

	it('takes a row over under the key spelling the mapping returns', async () => {
		const mappedGroups = await mapUpdateRows(
			[{
				data: { status: 'draft' },
				keys: ['0e1f6e8a-1b2c-4d5e-8f90-a1b2c3d4e5f6'],
			}],
			() => '0E1F6E8A-1B2C-4D5E-8F90-A1B2C3D4E5F6',
		);

		expect(mappedGroups).toEqual([
			{ key: '0E1F6E8A-1B2C-4D5E-8F90-A1B2C3D4E5F6' },
		]);
	});

	it('leaves the service to judge a key that names another row', async () => {
		const mappedGroups = await mapUpdateRows(
			[{ data: { status: 'draft' }, keys: [1, 2] }],
			(data, key) => {
				return key === 2
					? 5
					: data;
			},
		);

		expect(mappedGroups).toEqual([
			{ data: { status: 'draft' }, keys: [1] },
			{ key: 5 },
		]);
	});

	it('passes a payload that is no list of groups through unchanged', async () => {
		const fieldChange = { field: 'title', meta: { note: 'x' } };

		const mappedGroups = await mapUpdateRows(
			fieldChange as never,
			() => null,
		);

		expect(mappedGroups).toBe(fieldChange);
	});

	it('passes an update an earlier hook cancelled whole through', async () => {
		const mappedGroups = await mapUpdateRows(null, (data) => data);

		expect(mappedGroups).toBeNull();
	});
});
