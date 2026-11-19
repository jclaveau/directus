import { beforeEach, expect, test, vi } from 'vitest';
import { useCache } from '../cache.js';
import { withCache } from './with-cache.js';

vi.mock('../cache.js', () => {
	const cacheStore = {
		get: vi.fn(),
		set: vi.fn(),
	};

	return { useCache: () => cacheStore };
});

beforeEach(() => {
	vi.mocked(useCache().get).mockReset();
	vi.mocked(useCache().set).mockReset();
});

test('two concurrent calls on one key run the handler once', async () => {
	const cachedHandler = vi.fn(async () => ['row']);
	const cachedRead = withCache('rows', cachedHandler);

	const readResults = await Promise.all([
		cachedRead({ policies: ['a'] }),
		cachedRead({ policies: ['a'] }),
	]);

	expect(readResults).toEqual([['row'], ['row']]);
	expect(cachedHandler).toHaveBeenCalledTimes(1);
});

test('two concurrent calls on two keys run the handler twice', async () => {
	const cachedHandler = vi.fn(async () => ['row']);
	const cachedRead = withCache('rows', cachedHandler);

	await Promise.all([
		cachedRead({ policies: ['a'] }),
		cachedRead({ policies: ['b'] }),
	]);

	expect(cachedHandler).toHaveBeenCalledTimes(2);
});

test('a call made after a read ended reads the cache again', async () => {
	const cachedHandler = vi.fn(async () => ['row']);
	const cachedRead = withCache('rows', cachedHandler);

	await cachedRead({ policies: ['a'] });

	vi.mocked(useCache().get).mockResolvedValueOnce(['cached row']);

	await expect(cachedRead({ policies: ['a'] })).resolves.toEqual([
		'cached row',
	]);

	expect(cachedHandler).toHaveBeenCalledTimes(1);
});

test('a failed read rejects every waiting call and is not kept', async () => {
	const cachedHandler = vi.fn()
		.mockRejectedValueOnce(new Error('read failed'))
		.mockResolvedValueOnce(['row']);

	const cachedRead = withCache('rows', cachedHandler);

	const readResults = await Promise.allSettled([
		cachedRead({ policies: ['a'] }),
		cachedRead({ policies: ['a'] }),
	]);

	expect(readResults).toEqual([
		{ status: 'rejected', reason: new Error('read failed') },
		{ status: 'rejected', reason: new Error('read failed') },
	]);

	await expect(cachedRead({ policies: ['a'] })).resolves.toEqual(['row']);
	expect(cachedHandler).toHaveBeenCalledTimes(2);
});
