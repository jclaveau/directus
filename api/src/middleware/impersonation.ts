import { useEnv } from '@directus/env';
import { ForbiddenError } from '@directus/errors';
import type { NextFunction, Request, Response } from 'express';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'SEARCH']);

// Writes an impersonation needs to work at all, and GraphQL, whose reads are
// POSTs: its own guard refuses the mutations.
const WRITE_ALLOWLIST = new Set([
	'/auth/impersonate',
	'/auth/logout',
	'/auth/refresh',
	'/users/me/track/page',
	'/graphql',
	'/graphql/system',
]);

// The target's credentials are never the impersonator's to touch, whatever
// IMPERSONATION_WRITES says: these are the paths that would end their real
// sessions (`clearUserSessions`) or hand them a new secret.
const CREDENTIAL_PATHS = [
	/^\/users\/me\/tfa\//,
	/^\/auth\/password\//,
	/^\/users\/invite$/,
	/^\/users\/register$/,
];

/**
 * The write guard of an impersonated request, after `authenticate`: reads
 * only unless IMPERSONATION_WRITES is on, and credentials never.
 */
export const handler = (req: Request, _res: Response, next: NextFunction) => {
	if (!req.accountability?.impersonator) {
		return next();
	}

	// Express routes `/Users/me/tfa/` and `/users/me/tfa` to the same handler
	const path = req.path.toLowerCase().replace(/\/+$/, '');

	if (CREDENTIAL_PATHS.some((credential) => credential.test(path))) {
		throw new ForbiddenError({ reason: 'impersonation_credentials' });
	}

	if (useEnv()['IMPERSONATION_WRITES'] === true) {
		return next();
	}

	if (READ_METHODS.has(req.method) || WRITE_ALLOWLIST.has(path)) {
		return next();
	}

	throw new ForbiddenError({ reason: 'impersonation_read_only' });
};

export default handler;
