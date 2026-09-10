import { afterEach, expect, test, vi } from 'vitest';
import { flushCaches } from '../../../cache.js';
import { useLogger } from '../../../logger/index.js';
import cacheFlush from './flush.js';

vi.mock('../../../cache.js');
vi.mock('../../../logger/index.js');

const error = vi.fn();
vi.mocked(useLogger).mockReturnValue({ error } as unknown as ReturnType<typeof useLogger>);

// The command's whole contract is its exit code, so the exit has to stop the function
// the way the real one does rather than let it run on into the next statement.
const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
	throw new Error(`exit:${code}`);
});

afterEach(() => {
	vi.clearAllMocks();
	vi.mocked(useLogger).mockReturnValue({ error } as unknown as ReturnType<typeof useLogger>);
});

test('forces the flush and exits 0', async () => {
	vi.mocked(flushCaches).mockResolvedValue(undefined);

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
