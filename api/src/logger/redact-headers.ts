import { REDACTED_TEXT } from '@directus/utils';

/**
 * pino redact `censor` for the HTTP logger.
 *
 * Scalar paths (authorization / cookie / access_token) are fully replaced with
 * {@link REDACTED_TEXT}. For the `res.headers` object only the `set-cookie` entry is
 * redacted, leaving the rest of the headers intact.
 *
 * pino 10 types the censor `value` as `unknown` (it was implicitly `any` before), so
 * the object access is guarded before reading/writing `set-cookie`.
 */
export function redactHeaders(value: unknown, pathParts: string[]): unknown {
	if (pathParts.join('.') === 'res.headers') {
		if (value && typeof value === 'object' && 'set-cookie' in value) {
			(value as Record<string, unknown>)['set-cookie'] = REDACTED_TEXT;
		}

		return value;
	}

	return REDACTED_TEXT;
}
