import type { CreateEntry, PrimaryKey } from '@directus/types';
import { cloneDeep } from './lodash-es-used.js';

type MappedCreateRow<Item> = Partial<Item> | PrimaryKey | null;

/**
 * Map the rows of an `items.create` filter's entries one at a time, for a hook
 * that handles a single row. The mapping returns the row to insert, the key of a
 * stored row that answers it instead, or null to cancel it. A row an earlier
 * hook already answered is left as it was, and a create an earlier hook
 * cancelled whole (null) stays cancelled.
 */
export async function mapCreateRows<Item = any>(
	entries: (CreateEntry<Item> | null)[] | null,
	mapRow: (
		data: Partial<Item>,
		index: number,
	) => MappedCreateRow<Item> | Promise<MappedCreateRow<Item>>,
): Promise<(CreateEntry<Item> | null)[] | null> {
	if (entries === null) {
		return null;
	}

	const mappedEntries: (CreateEntry<Item> | null)[] = [];

	for (const [index, entry] of entries.entries()) {
		if (entry === null || !('data' in entry)) {
			mappedEntries.push(entry);
			continue;
		}

		// One row after another, so the rows map in the caller's order.
		const rowData = await mapRow(cloneDeep(entry.data), index);

		if (rowData === null) {
			mappedEntries.push(null);
		}
		else if (typeof rowData === 'string' || typeof rowData === 'number') {
			mappedEntries.push({ key: rowData });
		}
		else {
			mappedEntries.push({ data: rowData });
		}
	}

	return mappedEntries;
}
