import type { MaybeWithMeta, User } from '@directus/types';

export function userName(user: MaybeWithMeta<Partial<User>>): string {
	if (!user) {
		return 'Unknown User';
	}

	if (user.first_name && user.last_name) {
		return `${user.first_name} ${user.last_name}`;
	}

	if (user.first_name) {
		return user.first_name;
	}

	const primaryIdentity = user.primary_identity;

	// An SSO identity's value is the provider's identifier, never shown
	if (
		typeof primaryIdentity === 'object'
		&& primaryIdentity?.kind === 'email'
		&& primaryIdentity.value
	) {
		return primaryIdentity.value;
	}

	return 'Unknown User';
}
