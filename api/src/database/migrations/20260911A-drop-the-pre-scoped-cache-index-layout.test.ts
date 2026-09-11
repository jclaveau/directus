import { oneLine } from '@directus/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { redisConfigAvailable, useRedis } from '../../redis/index.js';
import { up } from './20260911A-drop-the-pre-scoped-cache-index-layout.js';

const env: Record<string, unknown> = { CACHE_NAMESPACE: 'ns' };

vi.mock('@directus/env', () => ({ useEnv: () => env }));
vi.mock('../../redis/index.js');

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));

vi.mock('../../logger/index.js', () => ({ useLogger: () => logger }));

function mockRedis(...pages: [string, string[]][]) {
	const scan = vi.fn();

	for (const page of pages) {
		scan.mockResolvedValueOnce(page);
	}

	const unlink = vi.fn();

	// One per `pipeline()`, the way ioredis hands them out: a shared stand-in would
	// let a later `exec` answer for commands an earlier one already reported.
	function pipeline() {
		const queued: string[][] = [];

		const built = {
			unlink: (keys: string[]) => {
				queued.push(keys);
				unlink(keys);
				return built;
			},
			exec: async () => queued.map((keys) => [null, keys.length]),
		};

		return built;
	}

	vi.mocked(redisConfigAvailable).mockReturnValue(true);
	vi.mocked(useRedis).mockReturnValue({ scan, pipeline } as any);

	return { scan, unlink };
}

afterEach(() => vi.clearAllMocks());

describe('the migration dropping the pre-scoped-cache-index layout', () => {
	it('unlinks both families the old layout wrote', async () => {
		const { scan, unlink } = mockRedis(
			['0', ['ns:tag:articles', 'ns:tag:authors']],
			['0', ['ns:slices:articles']],
		);

		await up({} as any);

		expect(scan).toHaveBeenCalledWith('0', 'MATCH', 'ns:tag:*', 'COUNT', 1000);

		expect(scan)
		.toHaveBeenCalledWith('0', 'MATCH', 'ns:slices:*', 'COUNT', 1000);

		expect(unlink).toHaveBeenCalledWith(['ns:tag:articles', 'ns:tag:authors']);
		expect(unlink).toHaveBeenCalledWith(['ns:slices:articles']);

		expect(logger.info)
		.toHaveBeenCalledWith('[cache] dropped 3 keys of the old index layout');
	});

	it('follows the cursor rather than stopping at the first page', async () => {
		const { unlink } = mockRedis(
			['7', ['ns:tag:articles']],
			['0', ['ns:tag:authors']],
			['0', []],
		);

		await up({} as any);

		expect(unlink).toHaveBeenCalledWith(['ns:tag:articles']);
		expect(unlink).toHaveBeenCalledWith(['ns:tag:authors']);
	});

	it(oneLine`
		spares the rest of the keyspace — the cache-stats stream beside these is the
		only copy of its telemetry until the drain moves it into postgres
	`, async () => {
		const { scan } = mockRedis(['0', []], ['0', []]);

		await up({} as any);

		expect(scan).toHaveBeenCalledTimes(2);

		expect(scan)
		.not.toHaveBeenCalledWith('0', 'MATCH', 'ns:*', 'COUNT', expect.anything());
	});

	// The runner calls this uncaught, right after recording the version it applied,
	// so a throw here fails a deploy over pointers into a cache the request path
	// already reads as a MISS while Redis is the thing that is away.
	it('does not fail the deploy when Redis refuses the scan', async () => {
		const { scan } = mockRedis();

		scan.mockRejectedValue(new Error('Connection is closed.'));

		await expect(up({} as any)).resolves.toBeUndefined();

		expect(logger.warn).toHaveBeenCalled();
	});

	it('does nothing at all with no Redis configured', async () => {
		const { scan } = mockRedis();

		vi.mocked(redisConfigAvailable).mockReturnValue(false);

		await up({} as any);

		expect(scan).not.toHaveBeenCalled();
	});
});
