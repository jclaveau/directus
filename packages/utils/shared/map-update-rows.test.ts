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
		const groups = await mapUpdateRows(
			[{ data: { status: 'draft' }, keys: [1, 2, 3] }],
			(data) => ({ ...data, checked: true }),
		);

		expect(groups).toEqual([
			{ data: { status: 'draft', checked: true }, keys: [1, 2, 3] },
		]);
	});

	it('splits off only the row the mapping rewrote', async () => {
		const groups = await mapUpdateRows(
			[{ data: { status: 'draft' }, keys: [1, 2, 3] }],
			(data, key) => {
				return key === 2
					? { status: 'rewritten' }
					: data;
			},
		);

		expect(groups).toEqual([
			{ data: { status: 'draft' }, keys: [1, 3] },
			{ data: { status: 'rewritten' }, keys: [2] },
		]);
	});

	it('drops the key of a row the mapping returns null for', async () => {
		const groups = await mapUpdateRows(
			[{ data: { status: 'draft' }, keys: [1, 2, 3] }],
			(data, key) => {
				return key === 2
					? null
					: data;
			},
		);

		expect(groups).toEqual([
			{ data: { status: 'draft' }, keys: [1, 3] },
		]);
	});

	it('takes a row over when the mapping returns its key', async () => {
		const entries = await mapUpdateRows(
			[{ data: { status: 'draft' }, keys: [1, 2, 3] }],
			(data, key) => {
				return key === 2
					? key
					: data;
			},
		);

		expect(entries).toEqual([
			{ data: { status: 'draft' }, keys: [1, 3] },
			{ key: 2 },
		]);
	});

	it('leaves a row an earlier hook already took over as it was', async () => {
		const mappedKeys: unknown[] = [];

		const entries = await mapUpdateRows(
			[{ key: 7 }, { data: { status: 'draft' }, keys: [1] }],
			(data, key) => {
				mappedKeys.push(key);

				return data;
			},
		);

		expect(entries).toEqual([
			{ key: 7 },
			{ data: { status: 'draft' }, keys: [1] },
		]);

		expect(mappedKeys).toEqual([1]);
	});

	it('never merges rows of two groups, even when they end up equal', async () => {
		const groups = await mapUpdateRows(
			[
				{ data: { status: 'draft' }, keys: [1] },
				{ data: { status: 'published' }, keys: [2] },
			],
			() => ({ status: 'archived' }),
		);

		expect(groups).toEqual([
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
		const groups = await mapUpdateRows(
			[
				{ data: { status: 'draft', delayMs: 5 }, keys: [1, 2] },
				{ data: { status: 'published', delayMs: 0 }, keys: [1] },
			],
			async (data) => {
				await new Promise((resolve) => setTimeout(resolve, data.delayMs));

				return { status: data.status };
			},
		);

		expect(groups).toEqual([
			{ data: { status: 'draft' }, keys: [1, 2] },
			{ data: { status: 'published' }, keys: [1] },
		]);
	});

	it('passes an update an earlier hook cancelled whole through', async () => {
		const groups = await mapUpdateRows(null, (data) => data);

		expect(groups).toBeNull();
	});
});
