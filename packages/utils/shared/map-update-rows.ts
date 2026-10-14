import type { PrimaryKey, UpdateEntry, UpdateGroup } from '@directus/types';
import { cloneDeep, isEqual } from './lodash-es-used.js';
import { oneLine } from './one-line.js';

type MappedUpdateRow<Item> = Partial<Item> | PrimaryKey | null | void;

/**
 * Map the rows of an `items.update` filter's groups one at a time, for a hook
 * that handles a single row. The mapping returns the change to write, the
 * row's key when the hook wrote the row itself, or null to cancel it; returning
 * nothing keeps the copy it was handed, edits included. A row an
 * earlier hook already took over is left as it was, and an update an earlier
 * hook cancelled whole (null) stays cancelled.
 *
 * The rows of one group that come back equal stay one group: the caller sent
 * them as one change, so they still write as one statement, and a nested item
 * the change creates is created once. Two groups never merge.
 */
export async function mapUpdateRows<Item = any>(
	entries: UpdateEntry<Item>[] | null,
	mapRow: (
		data: Partial<Item>,
		key: PrimaryKey,
	) => MappedUpdateRow<Item> | Promise<MappedUpdateRow<Item>>,
): Promise<UpdateEntry<Item>[] | null> {
	if (entries === null) {
		return null;
	}

	const mappedEntries: UpdateEntry<Item>[] = [];

	for (const entry of entries) {
		if (!('data' in entry)) {
			mappedEntries.push(entry);
			continue;
		}

		const entriesOfThisGroup: UpdateEntry<Item>[] = [];

		for (const key of entry.keys) {
			// One row after another, so the rows map in the caller's order.
			const rowCopy = cloneDeep(entry.data);
			const mappedRow = await mapRow(rowCopy, key);

			const rowData = mappedRow === undefined
				? rowCopy
				: mappedRow;

			if (rowData === null) {
				continue;
			}

			if (typeof rowData === 'string' || typeof rowData === 'number') {
				// Any other key would write a row the update never named.
				if (String(rowData) !== String(key)) {
					throw new Error(oneLine`
						The mapping of row ${key} answered with the key ${rowData}; return
						the row's own key to take it over, or null to cancel it
					`);
				}

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
