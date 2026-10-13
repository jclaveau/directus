import type { PrimaryKey, UpdateGroup } from '@directus/types';
import { cloneDeep, isEqual } from './lodash-es-used.js';

/**
 * Map the rows of an `items.update` filter's groups one at a time, for a hook
 * that handles a single row. A row the mapping returns null for is cancelled.
 *
 * The rows of one group that come back equal stay one group: the caller sent
 * them as one change, so they still write as one statement, and a nested item
 * the change creates is created once. Two groups never merge.
 */
export async function mapUpdateRows<Item = any>(
	groups: UpdateGroup<Item>[],
	mapRow: (
		data: Partial<Item>,
		key: PrimaryKey,
	) => Partial<Item> | null | Promise<Partial<Item> | null>,
): Promise<UpdateGroup<Item>[]> {
	const mappedGroups: UpdateGroup<Item>[] = [];

	for (const group of groups) {
		const groupsOfThisGroup: UpdateGroup<Item>[] = [];

		for (const key of group.keys) {
			// One row after another, so the rows map in the caller's order.
			const rowData = await mapRow(cloneDeep(group.data), key);

			if (rowData === null) {
				continue;
			}

			const equalGroup = groupsOfThisGroup.find((candidateGroup) => {
				return isEqual(candidateGroup.data, rowData);
			});

			if (equalGroup) {
				equalGroup.keys.push(key);
			}
			else {
				groupsOfThisGroup.push({ data: rowData, keys: [key] });
			}
		}

		mappedGroups.push(...groupsOfThisGroup);
	}

	return mappedGroups;
}
