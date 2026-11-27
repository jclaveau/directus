import type { FieldMeta } from '@directus/types';
import { systemFieldRows } from '@directus/system-data';
import formatTitle from '@directus/format-title';
import { EMAIL_IDENTITY_KIND } from '../auth/utils/user-identities.js';
import { getAuthProviders } from './get-auth-providers.js';

// Dynamically populate auth providers field
export function getSystemFieldRowsWithAuthProviders(): FieldMeta[] {
	return systemFieldRows.map((systemField) => {
		const isIdentityKind = systemField.collection === 'directus_user_identities'
			&& systemField.field === 'kind';

		if (isIdentityKind) {
			if (!systemField.options) systemField.options = {};

			systemField.options['choices'] = [
				{ text: '$t:email', value: EMAIL_IDENTITY_KIND },
				...getAuthProviders().map(({ name }) => ({
					text: formatTitle(name),
					value: name,
				})),
			];
		}

		return systemField;
	});
}
