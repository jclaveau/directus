import { afterEach, expect, test, vi } from 'vitest';
import { flushCaches, type CacheFlushReport } from '../../../cache.js';
import { useLogger } from '../../../logger/index.js';
import cacheFlush from './flush.js';

vi.mock('../../../cache.js');
vi.mock('../../../logger/index.js');

const error = vi.fn();

function mockLogger() {
	vi.mocked(useLogger).mockReturnValue(
		{ error } as unknown as ReturnType<typeof useLogger>,
	);
}

function report(overrides: Partial<CacheFlushReport> = {}): CacheFlushReport {
	return { durationMs: 1, droppedIndexKeys: 0, failures: [], ...overrides };
}

mockLogger();

// The command's whole contract is its exit code, so the exit has to stop the
// function the way the real one does rather than run on into the next statement.
const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
	throw new Error(`exit:${code}`);
});

afterEach(() => {
	vi.clearAllMocks();
	mockLogger();
});

test('forces the flush and exits 0', async () => {
	vi.mocked(flushCaches).mockResolvedValue(report());

	await expect(cacheFlush()).rejects.toThrowError('exit:0');

	expect(flushCaches).toHaveBeenCalledWith(true);
	expect(error).not.toHaveBeenCalled();
});

test('reports the failure and exits 1', async () => {
	const failure = new Error('redis is away');
	vi.mocked(flushCaches).mockRejectedValue(failure);

	await expect(cacheFlush()).rejects.toThrowError('exit:1');

	expect(error).toHaveBeenCalledWith(failure);
	expect(exit).toHaveBeenCalledWith(1);
});

// `flushCaches` warns and carries on rather than throwing, so a command reading
// its exit code off the absence of an exception would tell a deploy the caches
// are clear when Redis refused every one of them.
test('exits 1 on a flush that resolved with tiers it could not clear', async () => {
	vi.mocked(flushCaches).mockResolvedValue(
		report({ failures: ['system cache', 'scoped-cache index'] }),
	);

	await expect(cacheFlush()).rejects.toThrowError('exit:1');

	expect(error).toHaveBeenCalledWith(
		'[cache] flush incomplete: system cache, scoped-cache index',
	);
});

// `process.exit` does not stop the caller while an `exit` listener runs, so the
// command reads on into a report it never got and raises a TypeError out of the
// handler for exit 1.
test('stops at the first exit rather than reading a missing report', async () => {
	exit.mockImplementationOnce((() => undefined) as never);

	vi.mocked(flushCaches).mockRejectedValue(new Error('redis is away'));

	await expect(cacheFlush()).resolves.toBeUndefined();

	expect(exit).toHaveBeenCalledTimes(1);
	expect(exit).toHaveBeenCalledWith(1);
});
