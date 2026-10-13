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
});
