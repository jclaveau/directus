import type { User } from '@directus/types';

/**
 * The value of the user's primary identity when it is an email: an SSO
 * identity's value is the provider's identifier, never shown.
 */
export function userEmail(
	user?: Pick<Partial<User>, 'primary_identity'> | null,
): string | null {
	const primaryIdentity = user?.primary_identity;

	if (typeof primaryIdentity === 'object' && primaryIdentity?.kind === 'email') {
		return primaryIdentity.value;
	}

	return null;
}
