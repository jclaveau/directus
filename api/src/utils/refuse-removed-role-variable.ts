import { InvalidPayloadError, InvalidQueryError } from '@directus/errors';

// The stored settings a filter or a preset lives in. Anywhere else the string is
// data, and stays as written.
export const ROLE_VARIABLE_FIELDS: Record<string, string[]> = {
	directus_permissions: ['permissions', 'validation', 'presets'],
	directus_presets: ['filter'],
	directus_fields: ['options', 'conditions', 'validation'],
	directus_operations: ['options'],
	directus_panels: ['options'],
};

const REMOVED_VARIABLE_ADVICE = '"$CURRENT_ROLE" was removed, a user can hold'
	+ ' several roles: use "$CURRENT_MEMBER_ROLES" with "_in" or "_nin"';

/**
 * The first `$CURRENT_ROLE` or `$CURRENT_ROLE.<field>` found in the value, or
 * null. Left alone it would stay a literal string: a uuid cast error on
 * Postgres, a silent no-match elsewhere.
 */
export function findRemovedRoleVariable(value: unknown): string | null {
	if (typeof value === 'string') {
		const isRemovedVariable = value === '$CURRENT_ROLE'
			|| value.startsWith('$CURRENT_ROLE.');

		return isRemovedVariable
			? value
			: null;
	}

	if (value === null || typeof value !== 'object') {
		return null;
	}

	for (const nestedValue of Object.values(value)) {
		const removedVariable = findRemovedRoleVariable(nestedValue);

		if (removedVariable !== null) {
			return removedVariable;
		}
	}

	return null;
}

// A JSON column may be sent as its text.
function parsedFieldValue(fieldValue: unknown) {
	if (typeof fieldValue !== 'string') {
		return fieldValue;
	}

	try {
		return JSON.parse(fieldValue);
	}
	catch {
		return fieldValue;
	}
}

export function refuseRemovedRoleVariableInPayload(
	collection: string,
	payload: Record<string, unknown>,
) {
	for (const field of ROLE_VARIABLE_FIELDS[collection] ?? []) {
		const removedVariable = findRemovedRoleVariable(
			parsedFieldValue(payload[field]),
		);

		if (removedVariable !== null) {
			throw new InvalidPayloadError({
				reason: `Field ${JSON.stringify(field)} uses`
					+ ` ${JSON.stringify(removedVariable)}: ${REMOVED_VARIABLE_ADVICE}`,
			});
		}
	}
}

export function refuseRemovedRoleVariableInFilter(filter: unknown) {
	const removedVariable = findRemovedRoleVariable(filter);

	if (removedVariable !== null) {
		throw new InvalidQueryError({
			reason: `The filter uses ${JSON.stringify(removedVariable)}:`
				+ ` ${REMOVED_VARIABLE_ADVICE}`,
		});
	}
}
