import { ForbiddenError } from '@directus/errors';
import { isValidUuid } from './is-valid-uuid.js';
/**
 * Validate keys based on its type
 */
export function validateKeys(schema, collection, keyField, keys) {
    if (Array.isArray(keys)) {
        for (const key of keys) {
            validateKeys(schema, collection, keyField, key);
        }
    }
    else {
        const primaryKeyFieldType = schema.collections[collection]?.fields[keyField]?.type;
        if (primaryKeyFieldType === 'uuid' && !isValidUuid(String(keys))) {
            // Should this be a forbidden error? InvalidPayload?
            throw new ForbiddenError({
                reason: `Primary key of ${collection} must be a uuid instead of ${JSON.stringify(keys, null, 2)}`,
                values: {
                    collection,
                    key: keys,
                },
            });
        }
        else if (primaryKeyFieldType === 'integer' && !Number.isInteger(Number(keys))) {
            // Should this be a forbidden error? InvalidPayload?
            throw new ForbiddenError({
                reason: `Primary key of ${collection} must be an integer instead of ${JSON.stringify(keys, null, 2)}`,
                values: {
                    collection,
                    key: keys,
                },
            });
        }
    }
}
