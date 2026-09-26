import { oneLine } from '@directus/utils';
import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('../services/versions.js', () => {
	return {
		VersionsService: class {
			async getVersionSaves() {
				return null;
			}
		},
	};
});

import { mergeContentVersions } from './merge-content-versions.js';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('mergeContentVersions scoped cache fingerprints', () => {
	test(oneLine`
		adds the bare directus_versions fingerprint to the item read's, so a write
		to the version purges the cached ?version= response
	`, async () => {
		const res = {
			locals: {
				payload: { data: { id: 1 } },
				scopedCacheFingerprints: [
					{ collection: 'articles', pinnedScope: { id: ['1'] } },
				],
			},
		} as unknown as Response;

		await mergeContentVersions(
			{
				sanitizedQuery: { version: 'draft' },
				collection: 'articles',
				params: { pk: '1' },
			} as unknown as Request,
			res,
			vi.fn() as NextFunction,
		);

		expect(res.locals['scopedCacheFingerprints']).toEqual([
			{ collection: 'articles', pinnedScope: { id: ['1'] } },
			{ collection: 'directus_versions' },
		]);
	});

	test(oneLine`
		keeps the bare item collection beside it when the item read pinned
		nothing, as respond would have fallen back to it
	`, async () => {
		const res = {
			locals: { payload: { data: { id: 1 } } },
		} as unknown as Response;

		await mergeContentVersions(
			{
				sanitizedQuery: { version: 'draft' },
				collection: 'articles',
				singleton: true,
				params: {},
			} as unknown as Request,
			res,
			vi.fn() as NextFunction,
		);

		expect(res.locals['scopedCacheFingerprints']).toEqual([
			{ collection: 'articles' },
			{ collection: 'directus_versions' },
		]);
	});
});
