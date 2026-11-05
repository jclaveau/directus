import type { PrimaryKey, SchemaOverview } from '@directus/types';

/**
 * A uuid names one row whatever the case of its letters (RFC 9562), an integer
 * or a bigInteger whatever zeros lead it. A string key is taken as spelled:
 * on a column comparing without case (citext) or padding (char), two
 * spellings of one row read as two rows, and a row named by the spelling
 * the read does not return is told missing.
 */
export function primaryKeyNameOf(
	key: PrimaryKey,
	keyCollection: string,
	schema: SchemaOverview,
): string {
	const primaryKeyField = schema.collections[keyCollection]!.primary;

	const primaryKeyType = schema.collections[keyCollection]!
		.fields[primaryKeyField]!.type;

	if (primaryKeyType === 'uuid') {
		return String(key).toLowerCase();
	}

	// A child key comes unvalidated: as numbers, 'abc' and 'xyz' would both be NaN.
	if (!/^[+-]?\d+$/.test(String(key))) {
		return String(key);
	}

	if (primaryKeyType === 'integer') {
		return String(Number(key));
	}

	// Past 2^53 a Number would round two rows onto one name.
	return primaryKeyType === 'bigInteger'
		? String(BigInt(key))
		: String(key);
}
