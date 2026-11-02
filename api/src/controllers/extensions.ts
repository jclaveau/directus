import { useEnv } from '@directus/env';
import { ErrorCode, ForbiddenError, InvalidPayloadError, isDirectusError, RouteNotFoundError } from '@directus/errors';
import express from 'express';
import { UUID_REGEX } from '../constants.js';
import { getExtensionManager } from '../extensions/index.js';
import { respond } from '../middleware/respond.js';
import useCollection from '../middleware/use-collection.js';
import { ExtensionReadError, ExtensionsService } from '../services/extensions.js';
import asyncHandler from '../utils/async-handler.js';
import { getCacheControlHeader } from '../utils/get-cache-headers.js';
import { getMilliseconds } from '../utils/get-milliseconds.js';
import type { ReadStream } from 'node:fs';

const router = express.Router();
const env = useEnv();

router.use(useCollection('directus_extensions'));

router.get(
	'/',
	asyncHandler(async (req, res, next) => {
		const service = new ExtensionsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const extensions = await service.readAll();
		res.locals['payload'] = { data: extensions || null };
		return next();
	}),
	respond,
);

router.patch(
	`/:pk(${UUID_REGEX})`,
	asyncHandler(async (req, res, next) => {
		if (req.accountability && req.accountability.admin !== true) {
			throw new ForbiddenError({
				reason: `'${req.accountability?.user}' cannot update extension`,
			});
		}

		if (typeof req.params['pk'] !== 'string') {
			throw new InvalidPayloadError({ reason: 'Extension primary key must be a string' });
		}

		const service = new ExtensionsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		try {
			const result = await service.updateOne(req.params['pk'], req.body);
			res.locals['payload'] = { data: result || null };
		} catch (error) {
			let finalError = error;

			if (error instanceof ExtensionReadError) {
				finalError = error.originalError;

				if (isDirectusError(finalError, ErrorCode.Forbidden)) {
					return next();
				}
			}

			throw finalError;
		}

		return next();
	}),
	respond,
);

router.delete(
	`/:pk(${UUID_REGEX})`,
	asyncHandler(async (req, _res, next) => {
		if (req.accountability && req.accountability.admin !== true) {
			throw new ForbiddenError({
				reason: `'${req.accountability?.user}' can't delete extension`,
			});
		}

		const service = new ExtensionsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const pk = req.params['pk'];

		if (typeof pk !== 'string') {
			throw new InvalidPayloadError({ reason: 'Extension primary key must be a string' });
		}

		await service.deleteOne(pk);

		return next();
	}),
	respond,
);

router.get(
	'/sources/:chunk',
	asyncHandler(async (req, res) => {
		const chunk = req.params['chunk'] as string;
		const extensionManager = getExtensionManager();

		let source: ReadStream | null;

		if (chunk === 'index.js') {
			source = await extensionManager.getAppExtensionChunk();
		} else {
			source = await extensionManager.getAppExtensionChunk(chunk);
		}

		if (source === null) {
			throw new RouteNotFoundError({ path: req.path });
		}

		res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');

		res.setHeader(
			'Cache-Control',
			getCacheControlHeader(req, getMilliseconds(env['EXTENSIONS_CACHE_TTL']), false, false),
		);

		res.setHeader('Vary', 'Origin, Cache-Control');
		source.pipe(res);
	}),
);

export default router;
