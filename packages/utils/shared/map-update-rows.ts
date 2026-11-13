import type { PrimaryKey, UpdateEntries, UpdateGroup } from '@directus/types';
import { cloneDeep, isEqual } from './lodash-es-used.js';

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
 *
 * A row mapped to a key is taken over under that key, whichever row it names:
 * the service judges it. A payload that is no list of groups, such as the change
 * a `fields.update` filter carries to a hook registered on several events, comes
 * back unchanged.
 */
export async function mapUpdateRows<Item = any>(
	entries: UpdateEntries<Item> | null,
	mapRow: (
		data: Partial<Item>,
		key: PrimaryKey,
	) => MappedUpdateRow<Item> | Promise<MappedUpdateRow<Item>>,
): Promise<UpdateEntries<Item> | null> {
	if (entries === null) {
		return null;
	}

	if (!Array.isArray(entries)) {
		return entries;
	}

	const mappedEntries: UpdateEntries<Item> = [];

	for (const entry of entries) {
		if (!('data' in entry)) {
			mappedEntries.push(entry);
			continue;
		}

		const entriesOfThisGroup: UpdateEntries<Item> = [];

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
