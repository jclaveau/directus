import { useEnv } from '@directus/env';
import { RouteNotFoundError } from '@directus/errors';
import type { RequestHandler } from 'express';

/**
 * The Marketplace installs, reinstalls and uninstalls extensions on a running
 * server, so it is open only when `MARKETPLACE_ENABLED` is true, which the boot
 * refuses in production: there extensions change only with a deploy (#627).
 */
export function isMarketplaceEnabled(): boolean {
	return useEnv()['MARKETPLACE_ENABLED'] === true;
}

export const refuseExtensionChangeInProduction: RequestHandler = (
	req,
	_res,
	next,
) => {
	if (!isMarketplaceEnabled()) {
		throw new RouteNotFoundError({ path: req.originalUrl.split('?')[0]! });
	}

	next();
};
