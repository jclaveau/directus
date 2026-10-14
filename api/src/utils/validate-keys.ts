import { InvalidPayloadError } from '@directus/errors';
import type { PrimaryKey, SchemaOverview } from '@directus/types';
import { isValidUuid } from './is-valid-uuid.js';

/**
 * Validate keys based on its type
 */
export function validateKeys(
	schema: SchemaOverview,
	collection: string,
	keyField: string,
	keys: PrimaryKey | PrimaryKey[],
) {
	if (Array.isArray(keys)) {
		for (const key of keys) {
			validateKeys(schema, collection, keyField, key);
		}
	} else {
		const primaryKeyFieldType = schema.collections[collection]?.fields[keyField]?.type;

		if (primaryKeyFieldType === 'uuid' && !isValidUuid(String(keys))) {
			throw new InvalidPayloadError({
				reason: `Primary key of ${collection} must be a uuid instead of ${JSON.stringify(keys, null, 2)}`,
			});
		}
		else if (
			(primaryKeyFieldType === 'integer' || primaryKeyFieldType === 'bigInteger')
			&& !isIntegerKey(keys)
		) {
			throw new InvalidPayloadError({
				reason: `Primary key of ${collection} must be an integer instead of ${JSON.stringify(keys, null, 2)}`,
			});
		}
	}
}

// A decimal spelling only: Number() also reads '', ' 5', '0x10' and '1e2'.
function isIntegerKey(key: PrimaryKey): boolean {
	return typeof key === 'number'
		? Number.isInteger(key)
		: /^[+-]?\d+$/.test(key);
}
