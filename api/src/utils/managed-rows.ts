import type { Item, PrimaryKey, UpdateGroup } from '@directus/types';

/**
 * The checks a service with a `managed_by` column runs on a request's write:
 * a row some code manages is changed by that code alone, which writes it
 * without accountability.
 */

// A uuid key matches its row whatever its case.
export function lowerCaseRowKey(rowKey: PrimaryKey): string {
	return String(rowKey).toLowerCase();
}

export function groupDataByKey(
	groups: UpdateGroup<Item>[],
): Map<string, Partial<Item>[]> {
	const dataByKey = new Map<string, Partial<Item>[]>();

	for (const { keys, data } of groups) {
		for (const key of keys) {
			const rowKey = lowerCaseRowKey(key);
			const keyData = dataByKey.get(rowKey);

			if (keyData) {
				keyData.push(data);
			}
			else {
				dataByKey.set(rowKey, [data]);
			}
		}
	}

	return dataByKey;
}

function lowerCaseKey(relatedKey: unknown): unknown {
	return typeof relatedKey === 'string'
		? relatedKey.toLowerCase()
		: relatedKey;
}

export function setsManagedBy(item: Partial<Item>): boolean {
	return 'managed_by' in item && item['managed_by'] !== null;
}

export function changesManagedBy(
	data: Partial<Item>,
	managedRow: { managed_by: string },
): boolean {
	return 'managed_by' in data && data['managed_by'] !== managedRow.managed_by;
}

/** A relation may come as its key, or as an object holding it: `{ id, ... }`. */
export function changesGrantField<GrantField extends string>(
	data: Partial<Item>,
	managedRow: Record<GrantField, unknown>,
	grantFields: readonly GrantField[],
): boolean {
	return grantFields.some((grantField) => {
		if (!(grantField in data)) {
			return false;
		}

		const fieldValue = data[grantField];

		const isRelatedObject = typeof fieldValue === 'object' && fieldValue !== null;

		// `{ id: null }` finds no row, so the payload creates the related item.
		if (isRelatedObject && fieldValue.id === null) {
			return true;
		}

		const relatedKey = isRelatedObject
			? fieldValue.id
			: fieldValue;

		return lowerCaseKey(relatedKey) !== lowerCaseKey(managedRow[grantField]);
	});
}
