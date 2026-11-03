import { RouteNotFoundError } from '@directus/errors';
import { getNodeEnv } from '@directus/utils/node';
import type { RequestHandler } from 'express';

/**
 * The Marketplace installs, reinstalls and uninstalls extensions on a running
 * server. In production extensions change only with a deploy (#627), so it is
 * open outside production only. An unset NODE_ENV counts as production.
 */
export function isMarketplaceEnabled(): boolean {
	return (getNodeEnv() || 'production') !== 'production';
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
