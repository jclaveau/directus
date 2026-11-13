import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	type CacheAuditRunReport,
	runCacheAudit,
} from '../../../cache-audit-runs.js';
import { type CacheAuditFinding, loopbackReplayer } from '../../../cache-audit.js';
import { useLogger } from '../../../logger/index.js';
import { createServer } from '../../../server.js';
import { cacheAuditEnabled } from '../../../utils/cache-audit-enabled.js';
import { drainStdout } from '../../utils/drain-stdout.js';
import cacheAudit, { exitCodeFor, renderReport } from './audit.js';

// The verdict list stays real: an automock would hand the renderer an empty one.
vi.mock('../../../cache-audit.js', async (importOriginal) => {
	return {
		...await importOriginal<typeof import('../../../cache-audit.js')>(),
		loopbackReplayer: vi.fn(),
	};
});

vi.mock('../../../cache-audit-runs.js', () => ({ runCacheAudit: vi.fn() }));

vi.mock('../../../logger/index.js');
// A factory, not an automock: shaping one would load the whole app behind it.
vi.mock('../../../server.js', () => ({ createServer: vi.fn() }));
vi.mock('../../../utils/cache-audit-enabled.js');
vi.mock('../../utils/drain-stdout.js');

const error = vi.fn();
const written: string[] = [];

// A listening server as the command sees it: `listen` answers on the next
// tick with an ephemeral port, the way `net.Server` does.
function listeningServer(port = 43210) {
	const server = new EventEmitter() as EventEmitter & {
		listen: ReturnType<typeof vi.fn>;
		address: () => { port: number };
	};

	server.listen = vi.fn((_options: unknown, onListening: () => void) => {
		queueMicrotask(onListening);

		return server;
	});

	server.address = () => ({ port });

	return server;
}

function report(overrides: Partial<CacheAuditRunReport> = {}): CacheAuditRunReport {
	return {
		id: 1,
		scanned: 0,
		counts: {
			fresh: 0,
			stale: 0,
			pin_drift: 0,
			raced: 0,
			time_varying: 0,
			expired: 0,
			unreplayable: 0,
		},
		findings: [],
		evicted: 0,
		durationMs: 12,
		timedOut: false,
		...overrides,
	};
}

function finding(overrides: Partial<CacheAuditFinding> = {}): CacheAuditFinding {
	return {
		verdict: 'stale',
		reason: null,
		redisKey: 'rk',
		cacheKey: 'ck',
		method: 'GET',
		url: '/items/articles?fields[]=id',
		query: 'fields[]=id',
		user: 'user-1',
		collection: 'articles',
		filledAt: 1_000,
		ageMs: 90_000,
		pins: ['articles:owner=acme'],
		replayPins: ['articles:owner=acme'],
		diff: ['/data/0/title'],
		purgesSinceFilled: [],
		...overrides,
	};
}

const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
	throw new Error(`exit:${code}`);
});

beforeEach(() => {
	written.length = 0;

	vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
		written.push(String(chunk));

		return true;
	}) as never);

	vi.mocked(useLogger).mockReturnValue(
		{ error } as unknown as ReturnType<typeof useLogger>,
	);

	vi.mocked(createServer).mockResolvedValue(listeningServer() as never);
	vi.mocked(loopbackReplayer).mockReturnValue('replayer' as never);
	vi.mocked(drainStdout).mockResolvedValue();
	vi.mocked(cacheAuditEnabled).mockReturnValue(true);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('the command', () => {
	test('boots the app on a loopback port and replays through it', async () => {
		vi.mocked(runCacheAudit).mockResolvedValue(report());
		const server = listeningServer(48000);
		vi.mocked(createServer).mockResolvedValue(server as never);

		await expect(cacheAudit({})).rejects.toThrowError('exit:0');

		expect(server.listen).toHaveBeenCalledWith(
			{ host: '127.0.0.1', port: 0 },
			expect.any(Function),
		);

		expect(loopbackReplayer).toHaveBeenCalledWith({
			host: '127.0.0.1',
			port: 48000,
		});

		expect(runCacheAudit).toHaveBeenCalledWith('cli', {
			limit: undefined,
			user: undefined,
			collection: undefined,
			purge: undefined,
			replay: 'replayer',
		});
	});

	test('hands the narrowing options over, the limit as a number', async () => {
		vi.mocked(runCacheAudit).mockResolvedValue(report());

		await expect(cacheAudit({
			limit: '25',
			user: 'user-1',
			collection: 'articles',
			purge: true,
		})).rejects.toThrowError('exit:0');

		expect(runCacheAudit).toHaveBeenCalledWith('cli', expect.objectContaining({
			limit: 25,
			user: 'user-1',
			collection: 'articles',
			purge: true,
		}));
	});

	test('prints the report as JSON under --json', async () => {
		const given = report({ scanned: 3 });
		vi.mocked(runCacheAudit).mockResolvedValue(given);

		await expect(cacheAudit({ json: true })).rejects.toThrowError('exit:0');

		expect(JSON.parse(written.join(''))).toEqual(given);
	});

	test('prints the rendered report otherwise', async () => {
		vi.mocked(runCacheAudit).mockResolvedValue(report({ scanned: 3 }));

		await expect(cacheAudit({})).rejects.toThrowError('exit:0');

		expect(written.join('')).toMatch(/^3 entries audited in 12ms\n/);
	});

	test('says when the run stopped on its time budget', async () => {
		vi.mocked(runCacheAudit).mockResolvedValue(report({ timedOut: true }));

		await expect(cacheAudit({})).rejects.toThrowError('exit:0');

		expect(written.join('')).toContain(
			'\nstopped on CACHE_AUDIT_MAX_DURATION; the next run resumes behind it\n',
		);
	});

	test('exits 1 on a stale entry', async () => {
		vi.mocked(runCacheAudit).mockResolvedValue(report({
			scanned: 1,
			counts: { ...report().counts, stale: 1 },
			findings: [finding()],
		}));

		await expect(cacheAudit({})).rejects.toThrowError('exit:1');
	});

	test('logs a failed audit and exits 1', async () => {
		const failure = new Error('redis is away');
		vi.mocked(runCacheAudit).mockRejectedValue(failure);

		await expect(cacheAudit({})).rejects.toThrowError('exit:1');

		expect(error).toHaveBeenCalledWith(failure);
		expect(written).toEqual([]);
	});

	test('refuses before the boot when CACHE_AUDIT_ENABLED is off', async () => {
		vi.mocked(cacheAuditEnabled).mockReturnValue(false);

		await expect(cacheAudit({})).rejects.toThrowError('exit:1');

		expect(error).toHaveBeenCalledWith(
			'CACHE_AUDIT_ENABLED is false on this node: nothing to run',
		);

		expect(createServer).not.toHaveBeenCalled();
		expect(runCacheAudit).not.toHaveBeenCalled();
	});

	test.each(['abc', '0', '-3', '2.5'])(
		'refuses --limit %s before the boot',
		async (limit) => {
			await expect(cacheAudit({ limit })).rejects.toThrowError('exit:1');

			expect(error).toHaveBeenCalledWith(
				`--limit has to be a whole number of 1 or more, not "${limit}"`,
			);

			expect(createServer).not.toHaveBeenCalled();
			expect(runCacheAudit).not.toHaveBeenCalled();
		},
	);

	test('logs a boot that could not listen and exits 1', async () => {
		const server = listeningServer();

		server.listen = vi.fn(() => {
			queueMicrotask(() => server.emit('error', new Error('EADDRINUSE')));

			return server;
		});

		vi.mocked(createServer).mockResolvedValue(server as never);

		await expect(cacheAudit({})).rejects.toThrowError('exit:1');

		expect(error).toHaveBeenCalledWith(new Error('EADDRINUSE'));
		expect(runCacheAudit).not.toHaveBeenCalled();
	});

	// `process.exit` discards whatever stdout still holds; the report is the
	// first thing an immediate exit drops.
	test('lets the report leave the process before it exits', async () => {
		const order: string[] = [];
		vi.mocked(runCacheAudit).mockResolvedValue(report());

		vi.mocked(drainStdout).mockImplementation(async () => {
			order.push('drained');
		});

		exit.mockImplementationOnce(((code: number) => {
			order.push(`exit:${code}`);
			throw new Error(`exit:${code}`);
		}) as never);

		await expect(cacheAudit({})).rejects.toThrowError('exit:0');

		expect(order).toEqual(['drained', 'exit:0']);
	});
});

describe('the exit code', () => {
	test.each([
		[{}, false, 0],
		[{ stale: 1 }, false, 1],
		[{ pin_drift: 1 }, false, 1],
		[{ unreplayable: 1 }, false, 0],
		[{ unreplayable: 1 }, true, 2],
		[{ stale: 1, unreplayable: 1 }, true, 1],
		[{ raced: 1, time_varying: 1, expired: 1 }, true, 0],
	])('%o strict=%s → %i', (counts, strict, expected) => {
		const given = report({ counts: { ...report().counts, ...counts } });

		expect(exitCodeFor(given, strict)).toBe(expected);
	});
});

describe('the rendered report', () => {
	test('leads with the totals, one verdict per line', () => {
		const given = report({
			scanned: 4,
			counts: { ...report().counts, fresh: 3, stale: 1 },
			evicted: 1,
		});

		expect(renderReport(given)).toBe([
			'4 entries audited in 12ms, 1 evicted',
			'  fresh         3',
			'  stale         1',
			'  pin_drift     0',
			'  raced         0',
			'  time_varying  0',
			'  expired       0',
			'  unreplayable  0',
			'',
		].join('\n'));
	});

	test('describes a stale entry down to its diff and the purges it survived', () => {
		const given = report({
			findings: [finding({
				purgesSinceFilled: [{
					time: Date.UTC(2026, 8, 16, 10, 0, 0),
					mode: 'slices',
					collection: 'articles',
					scopedCachePin: 'articles:owner=acme',
					evicted: 0,
				}],
			})],
		});

		expect(renderReport(given)).toContain([
			'stale  GET /items/articles?fields[]=id',
			'  key rk',
			'  user user-1  collection articles  age 90s',
			'  pins articles:owner=acme',
			'  replay pins articles:owner=acme',
			'  diff /data/0/title',
			'  purged since the fill and still held:',
			'    2026-09-16T10:00:00.000Z slices articles:owner=acme',
		].join('\n'));
	});

	test('names the public user on a described fill nobody signed', () => {
		const given = report({ findings: [finding({ user: null })] });

		expect(renderReport(given)).toContain(
			'  user public  collection articles  age 90s',
		);
	});

	test('says when no purge ever named a stale entry', () => {
		const given = report({ findings: [finding({ purgesSinceFilled: [] })] });

		expect(renderReport(given)).toContain(
			'  no purge covered it since the fill: its pins never named the write',
		);
	});

	test('names a collection purge by its collection, a namespace one by *', () => {
		const given = report({
			findings: [finding({
				purgesSinceFilled: [
					{
						time: 0,
						mode: 'collection',
						collection: 'articles',
						scopedCachePin: null,
						evicted: 0,
					},
					{
						time: 0,
						mode: 'namespace',
						collection: null,
						scopedCachePin: null,
						evicted: 0,
					},
				],
			})],
		});

		const rendered = renderReport(given);

		expect(rendered).toContain('collection articles');
		expect(rendered).toContain('namespace *');
	});

	test('prints a GraphQL entry with its stored document', () => {
		const given = report({
			findings: [finding({
				url: '/graphql',
				query: '{"query":"{ articles { id } }"}',
				replayPins: null,
				diff: ['/'],
			})],
		});

		expect(renderReport(given)).toContain(
			'  document {"query":"{ articles { id } }"}\n  diff /',
		);
	});
});
