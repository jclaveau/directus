import { useEnv } from '@directus/env';
import { ForbiddenError } from '@directus/errors';
import type { Request } from 'express';

/**
 * Linking B: the account an SSO login made with `link` adds its identity to,
 * the one of the session the request is made from. Null without `link`.
 *
 * OPEN(#772): the parameter is named `link`, in the query, or the LDAP body
 *
 * @throws ForbiddenError when `link` is asked without a logged-in session
 */
export function getLinkUser(req: Request, linkRequested: unknown): string | null {
	if (linkRequested !== true && linkRequested !== 'true') {
		return null;
	}

	const sessionUser = req.accountability?.user;
	const sessionToken = req.cookies?.[useEnv()['SESSION_COOKIE_NAME'] as string];

	// A query or header token is not the browser's session: a link URL carrying
	// another account's token would add the clicker's identity to that account
	if (!sessionUser || !sessionToken || req.token !== sessionToken) {
		throw new ForbiddenError({
			reason: 'Linking an identity requires a logged-in session',
		});
	}

	return sessionUser;
}
