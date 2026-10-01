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

vi.mock('../scoped-cache/index.js', async (importOriginal) => {
	return {
		...await importOriginal<typeof import('../scoped-cache/index.js')>(),
		readScopedCacheEpochs: vi.fn(async () => ({ '*': '1', directus_versions: '7' })),
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

	test(oneLine`
		reads the directus_versions counter beside the item read's, so the fill
		guard does not refuse the ?version= response as unguarded
	`, async () => {
		const res = {
			locals: {
				payload: { data: { id: 1 } },
				scopedCacheFingerprints: [
					{ collection: 'articles', pinnedScope: { id: ['1'] } },
				],
				scopedCacheEpochs: { '*': '1', articles: '2' },
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

		expect(res.locals['scopedCacheEpochs']).toEqual({
			'*': '1',
			articles: '2',
			directus_versions: '7',
		});
	});
});
