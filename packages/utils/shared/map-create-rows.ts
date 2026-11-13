import type { CreateEntries, PrimaryKey } from '@directus/types';
import { cloneDeep } from './lodash-es-used.js';

type MappedCreateRow<Item> = Partial<Item> | PrimaryKey | null | void;

/**
 * Map the rows of an `items.create` filter's entries one at a time, for a hook
 * that handles a single row. The mapping returns the row to insert, the key of a
 * stored row that answers it instead, or null to cancel it; returning nothing
 * keeps the copy it was handed, edits included. A row an earlier
 * hook already answered is left as it was, and a create an earlier hook
 * cancelled whole (null) stays cancelled.
 *
 * A payload that is no list of rows, such as the field a `fields.create` filter
 * carries to a hook registered on several events, comes back unchanged.
 */
export async function mapCreateRows<Item = any>(
	entries: CreateEntries<Item> | null,
	mapRow: (
		data: Partial<Item>,
		index: number,
	) => MappedCreateRow<Item> | Promise<MappedCreateRow<Item>>,
): Promise<CreateEntries<Item> | null> {
	if (entries === null) {
		return null;
	}

	if (!Array.isArray(entries)) {
		return entries;
	}

	const mappedEntries: CreateEntries<Item> = [];

	for (const [index, entry] of entries.entries()) {
		if (entry === null || !('data' in entry)) {
			mappedEntries.push(entry);
			continue;
		}

		// One row after another, so the rows map in the caller's order.
		const rowCopy = cloneDeep(entry.data);
		const mappedRow = await mapRow(rowCopy, index);

		const rowData = mappedRow === undefined
			? rowCopy
			: mappedRow;

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
