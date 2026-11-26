import type { ExtensionEnv } from './define-env.js';

const ENV_PREFIX_PATTERN = /^[A-Z][A-Z0-9]*_$/;

/**
 * Throws when `prefix` is malformed, or a variable ends in "_" or is not
 * named under it.
 */
export function refuseInvalidExtensionEnv({ prefix, vars }: ExtensionEnv): void {
	if (!ENV_PREFIX_PATTERN.test(prefix)) {
		throw new Error(
			`Env prefix ${JSON.stringify(prefix)} must be upper case, with one "_"`
				+ ' at its end, like "SUBSCRIPTIONS_"',
		);
	}

	for (const name of Object.keys(vars)) {
		if (name.endsWith('_')) {
			throw new Error(
				`Env variable ${JSON.stringify(name)} must not end with "_"`,
			);
		}

		if (!name.startsWith(prefix)) {
			throw new Error(
				`Env variable ${JSON.stringify(name)} is not named under its`
					+ ` prefix ${JSON.stringify(prefix)}`,
			);
		}
	}
}
