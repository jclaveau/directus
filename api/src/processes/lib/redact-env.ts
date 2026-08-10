import { useEnv, useEnvSources } from '@directus/env';
import type { ResolvedEnvVariable } from '@directus/types';

/**
 * An env dump is a credential dump by default, so redaction happens here — in the
 * process that resolved the value, before it is published — rather than at the
 * endpoint. The page being admin-only is the second lock, not the first.
 */
const SECRET_KEY_PATTERN =
	/PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|AUTH|SALT|PRIVATE|_URL$|_URI$|_DSN$/i;

/**
 * Keys the key-shape rule catches that carry nothing secret. `PUBLIC_URL` ends in
 * `_URL` and is a routine misconfiguration to diagnose, so it stays readable.
 */
const PUBLIC_KEYS = new Set(['PUBLIC_URL']);

/** `scheme://user:pass@host` — a credential whatever the key is called. */
const CREDENTIALED_URI_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i;

/** Long values are truncated: this is a diagnosis surface, not a config export. */
const MAX_VALUE_LENGTH = 512;

function formatValue(value: unknown): string {
	if (value === null || value === undefined) {
		return '';
	}

	if (typeof value === 'string') {
		return value;
	}

	if (typeof value === 'object') {
		return JSON.stringify(value);
	}

	return String(value);
}

function isSecret(key: string, value: string): boolean {
	if (PUBLIC_KEYS.has(key)) {
		return false;
	}

	return SECRET_KEY_PATTERN.test(key) || CREDENTIALED_URI_PATTERN.test(value);
}

function truncate(value: string): string {
	return value.length > MAX_VALUE_LENGTH
		? `${value.slice(0, MAX_VALUE_LENGTH)}…`
		: value;
}

/**
 * This process's resolved environment, redacted, with the layer each value came
 * from. A redacted key still reports whether it is set and where it was set — the
 * half of the answer that a leaked value was never needed for.
 */
export function resolveReportedEnv(): ResolvedEnvVariable[] {
	const env = useEnv();
	const sources = useEnvSources();

	return Object.keys(env)
		.sort()
		.map((key) => {
			const value = formatValue(env[key]);
			const redacted = isSecret(key, value);

			return {
				key,
				value: redacted
					? null
					: truncate(value),
				redacted,
				isSet: value !== '',
				source: sources[key] ?? 'default',
			};
		});
}
