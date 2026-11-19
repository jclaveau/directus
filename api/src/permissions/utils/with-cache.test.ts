import { beforeEach, expect, test, vi } from 'vitest';
import { useCache } from '../cache.js';
import { runningReads } from '../running-reads.js';
import { withCache } from './with-cache.js';

vi.mock('../cache.js', () => {
	const cacheStore = {
		get: vi.fn(),
		readGeneration: vi.fn(),
		setUnlessCleared: vi.fn(),
	};

	return { useCache: () => cacheStore };
});

beforeEach(() => {
	vi.mocked(useCache().get).mockReset();

	vi.mocked(useCache().readGeneration)
		.mockReset()
		.mockResolvedValue(0);

	vi.mocked(useCache().setUnlessCleared)
		.mockReset()
		.mockResolvedValue(true);
});

test('two concurrent calls on one key run the handler once', async () => {
	const cachedHandler = vi.fn(async (_options: object) => ['row']);
	const cachedRead = withCache('rows', cachedHandler);

	const readResults = await Promise.all([
		cachedRead({ policies: ['a'] }),
		cachedRead({ policies: ['a'] }),
	]);

	expect(readResults).toEqual([['row'], ['row']]);
	expect(cachedHandler).toHaveBeenCalledTimes(1);
});

test('two concurrent calls on two keys run the handler twice', async () => {
	const cachedHandler = vi.fn(async (_options: object) => ['row']);
	const cachedRead = withCache('rows', cachedHandler);

	await Promise.all([
		cachedRead({ policies: ['a'] }),
		cachedRead({ policies: ['b'] }),
	]);

	expect(cachedHandler).toHaveBeenCalledTimes(2);
});

test('a call made after a read ended reads the cache again', async () => {
	const cachedHandler = vi.fn(async (_options: object) => ['row']);
	const cachedRead = withCache('rows', cachedHandler);

	await cachedRead({ policies: ['a'] });

	vi.mocked(useCache().get).mockResolvedValueOnce(['cached row']);

	await expect(cachedRead({ policies: ['a'] })).resolves.toEqual([
		'cached row',
	]);

	expect(cachedHandler).toHaveBeenCalledTimes(1);
});

test('a call waiting on a failed read reads on its own', async () => {
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
		{ status: 'fulfilled', value: ['row'] },
	]);

	expect(cachedHandler).toHaveBeenCalledTimes(2);
});

test('a changed result does not reach the other caller', async () => {
	const cachedHandler = vi.fn(async (_options: object) => {
		return { admin: false, connections: [] as string[] };
	});

	const cachedRead = withCache('access', cachedHandler);

	const [firstAccess, secondAccess] = await Promise.all([
		cachedRead({ roles: ['a'] }),
		cachedRead({ roles: ['a'] }),
	]);

	firstAccess.admin = true;
	firstAccess.connections.push('main');

	expect(secondAccess).toEqual({ admin: false, connections: [] });
});

test('a call made after the running reads were cleared queries again', async () => {
	const finishReads: ((rows: string[]) => void)[] = [];

	const cachedHandler = vi.fn((_options: object) => {
		return new Promise<string[]>((resolve) => {
			finishReads.push(resolve);
		});
	});

	const cachedRead = withCache('rows', cachedHandler);

	const staleRead = cachedRead({ policies: ['a'] });
	runningReads.clear();
	const freshRead = cachedRead({ policies: ['a'] });

	await vi.waitUntil(() => cachedHandler.mock.calls.length === 2);
	finishReads[0]!(['stale row']);
	await expect(staleRead).resolves.toEqual(['stale row']);

	const joiningRead = cachedRead({ policies: ['a'] });
	finishReads[1]!(['fresh row']);

	await expect(Promise.all([freshRead, joiningRead])).resolves.toEqual([
		['fresh row'],
		['fresh row'],
	]);

	expect(cachedHandler).toHaveBeenCalledTimes(2);
});

test('a read stores its result under the generation read before it', async () => {
	vi.mocked(useCache().readGeneration).mockResolvedValue(3);

	const cachedHandler = vi.fn(async (_options: object) => ['row']);

	await withCache('rows', cachedHandler)({ policies: ['a'] });

	expect(useCache().setUnlessCleared).toHaveBeenCalledWith(
		expect.stringMatching(/^rows-/),
		['row'],
		3,
	);

	// A clear landing between the handler and the generation read would let
	// the stale result through: the generation has to come first.
	expect(
		vi.mocked(useCache().readGeneration).mock.invocationCallOrder[0],
	).toBeLessThan(cachedHandler.mock.invocationCallOrder[0]!);
});

test('a call waiting on a read a clear crossed reads on its own', async () => {
	vi.mocked(useCache().setUnlessCleared)
		.mockResolvedValueOnce(false)
		.mockResolvedValueOnce(true);

	const cachedHandler = vi.fn()
		.mockResolvedValueOnce(['stale row'])
		.mockResolvedValueOnce(['fresh row']);

	const cachedRead = withCache('rows', cachedHandler);

	await expect(Promise.all([
		cachedRead({ policies: ['a'] }),
		cachedRead({ policies: ['a'] }),
	])).resolves.toEqual([
		['stale row'],
		['fresh row'],
	]);

	expect(cachedHandler).toHaveBeenCalledTimes(2);
});

test('a read fails when the cache cannot store its result', async () => {
	vi.mocked(useCache().setUnlessCleared).mockRejectedValue(
		new Error('Connection is closed.'),
	);

	await expect(
		withCache('rows', async (_options: object) => ['row'])({ policies: ['a'] }),
	).rejects.toEqual(
		new Error('Connection is closed.'),
	);
});
