import type { Request, Response } from 'express';
import { oneLine } from '@directus/utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	return { readScopedCacheEpochs: vi.fn() };
});

vi.mock('../scoped-cache/index.js', () => {
	return { readScopedCacheEpochs: mocks.readScopedCacheEpochs };
});

import useCollection from './use-collection.js';

function run(method: string) {
	const req = { method } as Request;
	const res = { locals: {} } as unknown as Response;
	const next = vi.fn();
	const done = new Promise<void>((resolve) => next.mockImplementation(resolve));
	useCollection('directus_users')(req, res, next);
	return done.then(() => ({ req, res, next }));
}

beforeEach(() => {
	mocks.readScopedCacheEpochs.mockReset();
	mocks.readScopedCacheEpochs.mockResolvedValue({ directus_users: '3', '*': '1' });
});

describe('useCollection', () => {
	test(oneLine`
		sets the collection and, on a GET, reads its purge counter first
	`, async () => {
		const { req, res, next } = await run('GET');

		expect(req.collection).toBe('directus_users');
		expect(mocks.readScopedCacheEpochs).toHaveBeenCalledWith(['directus_users']);

		expect(res.locals['scopedCacheEpochsBeforeQuery'])
			.toEqual({ directus_users: '3', '*': '1' });

		expect(next).toHaveBeenCalled();
	});

	test('reads nothing on a mutation, which fills no cache', async () => {
		const { res } = await run('PATCH');

		expect(mocks.readScopedCacheEpochs).not.toHaveBeenCalled();
		expect(res.locals['scopedCacheEpochsBeforeQuery']).toBeUndefined();
	});
});
