import { InvalidPayloadError } from '@directus/errors';

// A user can hold several roles, so the role stamps became lists of them.
export const RENAMED_ROLE_STAMP_SPECIALS = new Map<unknown, string>([
	['role-created', 'roles-created'],
	['role-updated', 'roles-updated'],
]);

// `special` is sent as a list, or as the comma separated text it is stored as.
function listedSpecials(special: unknown): unknown[] {
	if (Array.isArray(special)) {
		return special;
	}

	if (typeof special === 'string') {
		return special.split(',');
	}

	return [];
}

export function refuseRemovedRoleStampSpecial(
	collection: string,
	payload: Record<string, unknown>,
) {
	if (collection !== 'directus_fields') {
		return;
	}

	for (const special of listedSpecials(payload['special'])) {
		const renamedSpecial = RENAMED_ROLE_STAMP_SPECIALS.get(special);

		if (renamedSpecial !== undefined) {
			throw new InvalidPayloadError({
				reason: `Field ${JSON.stringify(payload['field'] ?? null)} of`
					+ ` collection ${JSON.stringify(payload['collection'] ?? null)}`
					+ ` uses the removed special ${JSON.stringify(special)}: a user`
					+ ` can hold several roles, use ${JSON.stringify(renamedSpecial)}`
					+ ' on a json field',
			});
		}
	}
}
