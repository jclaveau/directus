import type { PrimaryKey, UpdateEntry, UpdateGroup } from '@directus/types';
import { cloneDeep, isEqual } from './lodash-es-used.js';

type MappedUpdateRow<Item> = Partial<Item> | PrimaryKey | null;

/**
 * Map the rows of an `items.update` filter's groups one at a time, for a hook
 * that handles a single row. The mapping returns the change to write, the
 * row's key when the hook wrote the row itself, or null to cancel it. A row an
 * earlier hook already took over is left as it was.
 *
 * The rows of one group that come back equal stay one group: the caller sent
 * them as one change, so they still write as one statement, and a nested item
 * the change creates is created once. Two groups never merge.
 */
export async function mapUpdateRows<Item = any>(
	entries: UpdateEntry<Item>[],
	mapRow: (
		data: Partial<Item>,
		key: PrimaryKey,
	) => MappedUpdateRow<Item> | Promise<MappedUpdateRow<Item>>,
): Promise<UpdateEntry<Item>[]> {
	const mappedEntries: UpdateEntry<Item>[] = [];

	for (const entry of entries) {
		if (!('data' in entry)) {
			mappedEntries.push(entry);
			continue;
		}

		const entriesOfThisGroup: UpdateEntry<Item>[] = [];

		for (const key of entry.keys) {
			// One row after another, so the rows map in the caller's order.
			const rowData = await mapRow(cloneDeep(entry.data), key);

			if (rowData === null) {
				continue;
			}

			if (typeof rowData === 'string' || typeof rowData === 'number') {
				entriesOfThisGroup.push({ key: rowData });
				continue;
			}

			const equalGroup = entriesOfThisGroup.find(
				(candidate): candidate is UpdateGroup<Item> => {
					return 'data' in candidate && isEqual(candidate.data, rowData);
				},
			);

			if (equalGroup) {
				equalGroup.keys.push(key);
			}
			else {
				entriesOfThisGroup.push({ data: rowData, keys: [key] });
			}
		}

		mappedEntries.push(...entriesOfThisGroup);
	}

	return mappedEntries;
}
