import { ForbiddenError } from '../errors/index.js';
import type { SchemaOverview } from '@directus/types';
import validateUUID from 'uuid-validate';
import type { PrimaryKey } from '../types/index.js';

/**
 * Validate keys based on its type
 */
export function validateKeys(
	schema: SchemaOverview,
	collection: string,
	keyField: string,
	keys: PrimaryKey | PrimaryKey[]
) {
	if (Array.isArray(keys)) {
		for (const key of keys) {
			validateKeys(schema, collection, keyField, key);
		}
	} else {
		const primaryKeyFieldType = schema.collections[collection]?.fields[keyField]?.type;

		if (primaryKeyFieldType === 'uuid' && !validateUUID(String(keys))) {
			console.error(`Key of ${collection} must be an uuid or an array of uuid instead of`, JSON.stringify(keys, null, 2));
			throw new ForbiddenError();
		} else if (primaryKeyFieldType === 'integer' && !Number.isInteger(Number(keys))) {
			console.error(`Key of ${collection} must be an integer or an array of integers instead of`, JSON.stringify(keys, null, 2));
			throw new ForbiddenError();
		}
	}
}
