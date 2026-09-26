import type { ScopedCacheFingerprint } from '@directus/types';
import { isObject } from '@directus/utils';
import type { RequestHandler } from 'express';
import {
	mergedScopedCacheEpochs,
	readScopedCacheEpochs,
} from '../scoped-cache/index.js';
import { VersionsService } from '../services/versions.js';
import asyncHandler from '../utils/async-handler.js';
import { mergeVersionsRaw, mergeVersionsRecursive } from '../utils/merge-version-data.js';

export const mergeContentVersions: RequestHandler = asyncHandler(async (req, res, next) => {
	if (
		req.sanitizedQuery.version &&
		req.collection &&
		(req.singleton || req.params['pk']) &&
		'data' in res.locals['payload']
	) {
		const originalData = res.locals['payload'].data as unknown;

		// only act on single item requests
		if (!isObject(originalData)) return next();

		// The version saves are read below and never pinned, so a later write to
		// directus_versions (a delete, a key rename, a save) would leave the merged
		// response cached. The bare fingerprint makes any such write purge it; it
		// goes before the lookup because a missing version is an answer too.
		const itemFingerprints: readonly ScopedCacheFingerprint[] | undefined =
			res.locals['scopedCacheFingerprints'];

		res.locals['scopedCacheFingerprints'] = [
			...itemFingerprints?.length
				? itemFingerprints
				: [{ collection: req.collection }],
			{ collection: 'directus_versions' },
		];

		// The fill guard refuses a fingerprint whose collection it never read a
		// counter for, so the reading is taken here, before the lookup it guards.
		res.locals['scopedCacheEpochs'] = mergedScopedCacheEpochs(
			res.locals['scopedCacheEpochs'],
			await readScopedCacheEpochs(['directus_versions']),
		);

		const versionsService = new VersionsService({ accountability: req.accountability ?? null, schema: req.schema });

		const versionData = await versionsService.getVersionSaves(
			req.sanitizedQuery.version,
			req.collection,
			req.params['pk'],
		);

		if (!versionData || versionData.length === 0) return next();

		if (req.sanitizedQuery.versionRaw) {
			res.locals['payload'].data = mergeVersionsRaw(originalData, versionData);
		} else {
			res.locals['payload'].data = mergeVersionsRecursive(originalData, versionData, req.collection, req.schema);
		}
	}

	return next();
});
