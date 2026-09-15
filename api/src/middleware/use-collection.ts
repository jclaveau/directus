/**
 * Set req.collection for use in other middleware. Used as an alternative on validate-collection for
 * system collections
 */
import type { RequestHandler } from 'express';
import { readScopedCacheEpochs } from '../scoped-cache.js';
import asyncHandler from '../utils/async-handler.js';

const useCollection = (collection: string): RequestHandler => {
	return asyncHandler(async (req, res, next) => {
		req.collection = collection;

		// The system controllers behind this middleware hand `respond` a payload with
		// no capture of their own, and the fill guard needs one taken BEFORE the rows
		// are read (`fill-guard.ts`). This is the earliest point that knows the
		// collection every such response is tagged with, so the capture lives here.
		if (req.method === 'GET') {
			res.locals['scopedCacheEpochsAtRequest'] =
				await readScopedCacheEpochs([collection]);
		}

		next();
	});
};

export default useCollection;
