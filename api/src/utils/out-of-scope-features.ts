import { useEnv } from '@directus/env';
import { ServiceUnavailableError } from '@directus/errors';

/**
 * The features no blackbox scenario guards, by the name
 * `OUT_OF_SCOPE_FEATURES_ALLOWED` takes, each with the issue tracking it.
 */
export const OUT_OF_SCOPE_FEATURES: Record<string, string> = {
	'ldap': '#619',
	'oauth2': '#622',
	'openid': '#622',
	'saml': '#622',
	'websockets-graphql': '#756',
	'extensions-auto-reload': '#627',
	'shares': '#657',
	'comments': '#647',
};

/** The features `OUT_OF_SCOPE_FEATURES_ALLOWED` names, from a list or a string. */
export function allowedOutOfScopeFeatures(): string[] {
	return String(useEnv()['OUT_OF_SCOPE_FEATURES_ALLOWED'] ?? '')
		.split(',')
		.map((featureName) => featureName.trim())
		.filter((featureName) => featureName !== '');
}

/**
 * Refuse a feature `OUT_OF_SCOPE_FEATURES_ALLOWED` does not name, in the
 * feature's own service: an always-on feature has no variable turning it on
 * for the boot to refuse, and its service is reached by more than its routes
 * (GraphQL, nested writes, extensions).
 */
export function refuseOutOfScopeFeature(featureName: string): void {
	if (allowedOutOfScopeFeatures().includes(featureName)) {
		return;
	}

	throw new ServiceUnavailableError({
		service: featureName,
		reason: 'It is out of the tested scope '
			+ `(${OUT_OF_SCOPE_FEATURES[featureName]}): add `
			+ `${JSON.stringify(featureName)} to OUT_OF_SCOPE_FEATURES_ALLOWED `
			+ 'to run it untested',
	});
}
