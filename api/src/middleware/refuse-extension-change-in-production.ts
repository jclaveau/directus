import { useEnv } from '@directus/env';
import { RouteNotFoundError } from '@directus/errors';
import { getNodeEnv } from '@directus/utils/node';
import type { RequestHandler } from 'express';

/**
 * The Marketplace installs, reinstalls and uninstalls extensions on a running
 * server. In production extensions change only with a deploy (#627), so it is
 * open outside production only, unless `MARKETPLACE_ENABLED` is false. An unset
 * NODE_ENV counts as production.
 */
export function isMarketplaceEnabled(): boolean {
	if (useEnv()['MARKETPLACE_ENABLED'] === false) {
		return false;
	}

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
