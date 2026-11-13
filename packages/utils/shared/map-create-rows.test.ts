import { describe, expect, it } from 'vitest';
import { mapCreateRows } from './map-create-rows.js';

describe('mapCreateRows', () => {
	it('replaces the data of each row with what the mapping returns', async () => {
		const mappedEntries = await mapCreateRows(
			[{ data: { title: 'a' } }, { data: { title: 'b' } }],
			(data, index) => ({ ...data, position: index }),
		);

		expect(mappedEntries).toEqual([
			{ data: { title: 'a', position: 0 } },
			{ data: { title: 'b', position: 1 } },
		]);
	});

	it('takes the insert of a row over when the mapping returns a key', async () => {
		const mappedEntries = await mapCreateRows(
			[{ data: { title: 'a' } }, { data: { title: 'stored' } }],
			(data) => {
				return data.title === 'stored'
					? 7
					: data;
			},
		);

		expect(mappedEntries).toEqual([{ data: { title: 'a' } }, { key: 7 }]);
	});

	it('cancels a row the mapping returns null for', async () => {
		const mappedEntries = await mapCreateRows(
			[{ data: { title: 'a' } }, { data: { title: 'b' } }],
			(data) => {
				return data.title === 'b'
					? null
					: data;
			},
		);

		expect(mappedEntries).toEqual([{ data: { title: 'a' } }, null]);
	});

	it('leaves a row an earlier hook already answered as it was', async () => {
		const mappedIndexes: number[] = [];

		const mappedEntries = await mapCreateRows(
			[{ key: 7 }, { sameRowAs: 0 }, null, { data: { title: 'd' } }],
			(data, index) => {
				mappedIndexes.push(index);

				return data;
			},
		);

		expect(mappedEntries).toEqual([
			{ key: 7 },
			{ sameRowAs: 0 },
			null,
			{ data: { title: 'd' } },
		]);

		expect(mappedIndexes).toEqual([3]);
	});

	it('maps the rows one after another, in the order they were sent', async () => {
		const mappedTitles: unknown[] = [];

		await mapCreateRows(
			[
				{ data: { title: 'slow', delayMs: 5 } },
				{ data: { title: 'fast', delayMs: 0 } },
			],
			async (data) => {
				await new Promise((resolve) => setTimeout(resolve, data.delayMs));

				mappedTitles.push(data.title);

				return data;
			},
		);

		expect(mappedTitles).toEqual(['slow', 'fast']);
	});

	it('keeps the copy the mapping edited when it returns nothing', async () => {
		const mappedEntries = await mapCreateRows(
			[{ data: { title: 'a' } }, { data: { title: 'b' } }],
			(data, index) => {
				if (index === 1) {
					data.title = 'edited';
				}
			},
		);

		expect(mappedEntries).toEqual([
			{ data: { title: 'a' } },
			{ data: { title: 'edited' } },
		]);
	});

	it('hands the mapping a copy, so its edits leave the entry alone', async () => {
		const sentEntries = [{ data: { title: 'a', tags: ['x'] } }];

		await mapCreateRows(sentEntries, (data) => {
			data.tags!.push('y');

			return null;
		});

		expect(sentEntries).toEqual([{ data: { title: 'a', tags: ['x'] } }]);
	});

	it('passes a payload that is no list of rows through unchanged', async () => {
		const fieldCreate = { field: 'title', type: 'string' };

		const mappedEntries = await mapCreateRows(
			fieldCreate as never,
			() => null,
		);

		expect(mappedEntries).toBe(fieldCreate);
	});

	it('passes a create an earlier hook cancelled whole through', async () => {
		const mappedEntries = await mapCreateRows(null, (data) => data);

		expect(mappedEntries).toBeNull();
	});
});
