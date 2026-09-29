import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Redis from 'ioredis';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { summarise, type Summary } from './measure.js';

/**
 * What a scoped purge costs as the cache grows.
 *
 * A write purges the slices its rows belong to, and that slice is the same size
 * whether the cache holds a thousand entries or a hundred thousand. What the purge
 * costs should follow the slice, not the cache: on 2026-09-29 it followed the
 * cache, and production stopped answering
 * (https://github.com/jclaveau/directus/issues/570).
 *
 * `cache.perf.test.ts` gates the same property between 25 and 200 entries, which
 * both fit in one `SSCAN … COUNT 1000` step, and its reads pin the collection's
 * index path, so what they are filed under stays small. Here every read pins the
 * primary key instead — a field that is not the index path, the way production's
 * reads pin `course` — and the cache is grown to sizes a scan has to page through.
 *
 * The slice a write purges is held constant across sizes: every warmed row is read
 * `SLICE_ENTRIES` ways, so a larger cache means more rows cached, never more
 * entries per row. Whatever grows with the size is the purge walking what it did
 * not need to.
 *
 * Gated on what Redis did, not on what the api saw: the command count is exact,
 * and the time Redis spent executing them is what every other client queued
 * behind. The wall time is reported beside them and gates nothing.
 *
 * A second phase measures the purge that drops a whole collection: a version save
 * purges the collection it versions whatever its delta holds. The versioned
 * collection is small and stays the same size at every step, so what grows with
 * the cache is the purge finding that collection's index among everyone else's.
 *
 * Seeded through the api rather than written into Redis: a layout the bench
 * wrote itself would measure the bench's idea of the index, and the point is to
 * compare layouts.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const cli = process.env['PERF_CLI'] ?? join(root, 'dist', 'cli');
const adminToken = process.env['PERF_ADMIN_TOKEN'] ?? 'bench-admin-token';

const redisUrl = process.env['PERF_REDIS'] ?? process.env['REDIS']
	?? 'redis://127.0.0.1:6108';

const instancePort = Number(process.env['PERF_PURGE_PORT'] ?? 8320);

const outputDir = process.env['PERF_OUTPUT_DIR']
	?? join(root, 'tests', 'perf', 'results');

// Cumulative: each size warms on top of the one before.
const cacheSizes = (process.env['PERF_PURGE_SIZES'] ?? '1000,10000,100000')
	.split(',')
	.map(Number);

const writeReps = Number(process.env['PERF_PURGE_WRITE_REPS'] ?? 9);
const warmConcurrency = Number(process.env['PERF_PURGE_WARM_CONCURRENCY'] ?? 32);

// How many cached reads each warmed row is part of: one per `limit`.
const SLICE_ENTRIES = 50;

const maxCommandScaling =
	Number(process.env['PERF_PURGE_MAX_COMMAND_SCALING'] ?? 1.5);

// Looser than the count: Redis's own clock is exact per command, but a larger
// keyspace moves each command's cost a little on its own.
const maxRedisTimeScaling =
	Number(process.env['PERF_PURGE_MAX_REDIS_TIME_SCALING'] ?? 2);

const targetWallScaling = 1.5;

for (const [name, value] of [
	['PERF_PURGE_WRITE_REPS', writeReps],
	['PERF_PURGE_WARM_CONCURRENCY', warmConcurrency],
	...cacheSizes.map((size) => ['PERF_PURGE_SIZES', size] as const),
] as const) {
	if (!Number.isFinite(value) || value < 1) {
		throw new Error(`${name} has to be a positive number, not ${String(value)}`);
	}
}

if (cacheSizes.length < 2) {
	throw new Error('PERF_PURGE_SIZES needs at least two sizes to compare');
}

const smallestSize = Math.min(...cacheSizes);

// Every write lands on a row the smallest size has warmed.
if (writeReps > smallestSize / SLICE_ENTRIES) {
	throw new Error(
		`PERF_PURGE_WRITE_REPS is at most ${smallestSize / SLICE_ENTRIES}`
		+ ` for a smallest size of ${smallestSize}, not ${writeReps}`,
	);
}

const STATUS_HEADER = 'x-cache-status';
const SLICE = 'perf_slice';
const TENANTS = 8;

// The collection a version save purges whole, and how many reads of it are cached
// before each save: `VERSIONED_ENTRIES` per row, one per `limit`.
const VERSIONED = 'perf_versioned';
const VERSIONED_ROWS = 4;
const VERSIONED_ENTRIES = 5;

const rowCount = Math.ceil(Math.max(...cacheSizes) / SLICE_ENTRIES);

const authHeaders = {
	'Authorization': `Bearer ${adminToken}`,
	'Content-Type': 'application/json',
};

let instance: ChildProcess | undefined;
let redis: Redis;
let rowIds: number[] = [];
let versionedIds: number[] = [];
let versionId = '';

const base = `http://127.0.0.1:${instancePort}`;

async function api(
	path: string,
	init: { method?: string; body?: string } = {},
): Promise<any> {
	const response = await fetch(`${base}${path}`, {
		method: init.method ?? 'GET',
		headers: authHeaders,
		...(init.body === undefined
			? {}
			: { body: init.body }),
	});

	const text = await response.text();

	if (!response.ok) {
		throw new Error(
			`${init.method ?? 'GET'} ${path} answered ${response.status}:`
			+ ` ${text.slice(0, 400)}`,
		);
	}

	return text === ''
		? null
		: JSON.parse(text);
}

async function startInstance(): Promise<ChildProcess> {
	const spawned = spawn('node', [cli, 'start'], {
		env: {
			...process.env,
			NODE_ENV: 'production',
			SERVE_APP: 'false',
			LOG_LEVEL: 'warn',
			TELEMETRY: 'false',
			EXTENSIONS_PATH: join(root, 'tests', 'perf', 'cache-extensions'),
			PORT: String(instancePort),
			PUBLIC_URL: base,
			CACHE_ENABLED: 'true',
			CACHE_STORE: 'redis',
			CACHE_AUTO_PURGE: 'true',
			CACHE_AUTO_PURGE_MODE: 'scoped',
			CACHE_STATUS_HEADER: STATUS_HEADER,
			// Long enough that nothing warmed expires before the largest size is
			// measured, and no reap runs in the middle of a write.
			CACHE_TTL: '6h',
			CACHE_SCOPED_INDEX_REAP_SCHEDULE: 'off',
		},
	});

	let output = '';
	spawned.stdout?.on('data', (chunk) => (output += chunk));
	spawned.stderr?.on('data', (chunk) => (output += chunk));

	let exited = false;
	spawned.on('exit', () => (exited = true));

	const deadline = Date.now() + 120_000;

	for (;;) {
		if (exited) {
			throw new Error(`The instance exited during boot:\n${output}`);
		}

		if (Date.now() > deadline) {
			throw new Error(`The instance never listened:\n${output}`);
		}

		try {
			const response = await fetch(`${base}/server/ping`);

			if (response.ok) {
				await response.text();

				return spawned;
			}
		}
		catch {
			// Not listening yet.
		}

		await new Promise((wake) => setTimeout(wake, 50));
	}
}

async function seedFixture(): Promise<void> {
	const dropped = await fetch(`${base}/collections/${SLICE}`, {
		method: 'DELETE',
		headers: authHeaders,
	});

	await dropped.text();

	await api('/collections', {
		method: 'POST',
		body: JSON.stringify({
			collection: SLICE,
			// The index path. No read below pins it, so every one of them is filed
			// where a read pinning anything else is.
			meta: { scoped_cache_fields: ['tenant'] },
			schema: {},
			fields: [
				{
					field: 'id',
					type: 'integer',
					meta: { hidden: true },
					schema: { is_primary_key: true, has_auto_increment: true },
				},
				{ field: 'tenant', type: 'string', meta: {}, schema: {} },
				{ field: 'label', type: 'string', meta: {}, schema: {} },
			],
		}),
	});

	const rows = Array.from({ length: rowCount }, (_, index) => {
		return { tenant: `t${index % TENANTS}`, label: `row ${index}` };
	});

	for (let at = 0; at < rows.length; at += 500) {
		const created = await api(`/items/${SLICE}?fields=id`, {
			method: 'POST',
			body: JSON.stringify(rows.slice(at, at + 500)),
		});

		rowIds = [...rowIds, ...created.data.map((row: any) => row.id)];
	}

	const droppedVersioned = await fetch(`${base}/collections/${VERSIONED}`, {
		method: 'DELETE',
		headers: authHeaders,
	});

	await droppedVersioned.text();

	await api('/collections', {
		method: 'POST',
		body: JSON.stringify({
			collection: VERSIONED,
			meta: { versioning: true },
			schema: {},
			fields: [
				{
					field: 'id',
					type: 'integer',
					meta: { hidden: true },
					schema: { is_primary_key: true, has_auto_increment: true },
				},
				{ field: 'label', type: 'string', meta: {}, schema: {} },
			],
		}),
	});

	const versionedRows = Array.from({ length: VERSIONED_ROWS }, (_, index) => {
		return { label: `versioned ${index}` };
	});

	const createdVersioned = await api(`/items/${VERSIONED}?fields=id`, {
		method: 'POST',
		body: JSON.stringify(versionedRows),
	});

	versionedIds = createdVersioned.data.map((row: any) => row.id);

	const version = await api('/versions?fields=id', {
		method: 'POST',
		body: JSON.stringify({
			key: 'bench',
			name: 'bench',
			collection: VERSIONED,
			item: String(versionedIds[0]),
		}),
	});

	versionId = version.data.id;
}

// Pinned on the primary key, and selecting the column a write changes, so the
// write reaches every entry of its row's slice.
function slicePath(entryIndex: number): string {
	const rowId = rowIds[Math.floor(entryIndex / SLICE_ENTRIES)]!;
	const limit = 1 + (entryIndex % SLICE_ENTRIES);

	return `/items/${SLICE}?filter[id][_eq]=${rowId}&limit=${limit}`
		+ '&fields=id,label';
}

/** Read every entry in `[from, to)`, `warmConcurrency` at a time. */
async function warmEntries(from: number, to: number): Promise<Set<string>> {
	const statuses = new Set<string>();
	let next = from;

	async function drain(): Promise<void> {
		while (next < to) {
			const entryIndex = next++;
			const path = slicePath(entryIndex);
			const response = await fetch(`${base}${path}`, { headers: authHeaders });
			const body = await response.text();

			if (!response.ok) {
				throw new Error(
					`GET ${path} answered ${response.status}: ${body.slice(0, 200)}`,
				);
			}

			statuses.add(response.headers.get(STATUS_HEADER) ?? 'none');
		}
	}

	await Promise.all(Array.from({ length: warmConcurrency }, () => drain()));

	return statuses;
}

/** Cache every read of the versioned collection a version save purges. */
async function warmVersionedEntries(): Promise<Set<string>> {
	const statuses = new Set<string>();

	for (const rowId of versionedIds) {
		for (let limit = 1; limit <= VERSIONED_ENTRIES; limit++) {
			const path = `/items/${VERSIONED}?filter[id][_eq]=${rowId}`
				+ `&limit=${limit}&fields=id,label`;

			const response = await fetch(`${base}${path}`, { headers: authHeaders });
			const body = await response.text();

			if (!response.ok) {
				throw new Error(
					`GET ${path} answered ${response.status}: ${body.slice(0, 200)}`,
				);
			}

			statuses.add(response.headers.get(STATUS_HEADER) ?? 'none');
		}
	}

	return statuses;
}

type CommandStats = {
	commands: number;
	redisMs: number;
	byCommand: Record<string, number>;
};

// The bench's own `config` and `info` land in the same counters.
function isBenchCommand(name: string): boolean {
	return name.startsWith('config') || name === 'info';
}

async function readCommandStats(): Promise<CommandStats> {
	const commandstats = await redis.info('commandstats');
	const byCommand: Record<string, number> = {};
	let commands = 0;
	let usec = 0;

	for (const line of commandstats.split('\n')) {
		const match = /^cmdstat_([^:]+):calls=(\d+),usec=(\d+)/.exec(line.trim());

		if (!match || isBenchCommand(match[1]!)) {
			continue;
		}

		byCommand[match[1]!] = Number(match[2]);
		commands += Number(match[2]);
		usec += Number(match[3]);
	}

	return { commands, redisMs: usec / 1000, byCommand };
}

// What the instance issues with nothing driving it, per second.
async function measureIdleCommands(): Promise<number> {
	await redis.config('RESETSTAT');
	await new Promise((wake) => setTimeout(wake, 3000));

	return (await readCommandStats()).commands / 3;
}

type WriteSample = {
	commands: number;
	redisMs: number;
	wallMs: number;
	byCommand: Record<string, number>;
};

async function timeRedisCost(
	sendRequest: () => Promise<unknown>,
	idleRate: number,
): Promise<WriteSample> {
	await redis.config('RESETSTAT');
	const startedAt = performance.now();

	await sendRequest();

	const wallMs = performance.now() - startedAt;
	const counted = await readCommandStats();
	const idleCommands = idleRate * (performance.now() - startedAt) / 1000;

	return {
		commands: Math.max(counted.commands - idleCommands, 0),
		redisMs: counted.redisMs,
		wallMs,
		byCommand: counted.byCommand,
	};
}

function timeWrite(rowIndex: number, idleRate: number): Promise<WriteSample> {
	return timeRedisCost(() => {
		return api(`/items/${SLICE}/${rowIds[rowIndex]}`, {
			method: 'PATCH',
			body: JSON.stringify({ label: `touched ${Date.now()}` }),
		});
	}, idleRate);
}

// A version save purges its collection whole: `purgeScopedCache(…, null)`.
function timeCollectionPurge(idleRate: number): Promise<WriteSample> {
	return timeRedisCost(() => {
		return api(`/versions/${versionId}/save`, {
			method: 'POST',
			body: JSON.stringify({ label: `saved ${Date.now()}` }),
		});
	}, idleRate);
}

beforeAll(async () => {
	await mkdir(join(root, 'tests', 'perf', 'cache-extensions'), { recursive: true });

	redis = new Redis(redisUrl);
	instance = await startInstance();

	await seedFixture();
});

afterAll(async () => {
	instance?.kill('SIGTERM');
	await redis?.quit().catch(() => undefined);
});

test('a scoped purge costs the same however much the cache holds', async () => {
	await fetch(`${base}/utils/cache/clear`, { method: 'POST', headers: authHeaders })
		.then((response) => response.text());

	const idleRate = await measureIdleCommands();
	const bySize = new Map<number, WriteSample[]>();
	const collectionPurgesBySize = new Map<number, WriteSample[]>();
	const report: string[] = [];
	let warmed = 0;

	for (const size of [...cacheSizes].sort((a, b) => a - b)) {
		const warmStartedAt = performance.now();
		const warmStatuses = await warmEntries(warmed, size);
		const warmSeconds = (performance.now() - warmStartedAt) / 1000;

		warmed = size;

		// A warm that never filled measured an empty cache at every size.
		expect([...warmStatuses], `warming to ${size}`).toContain('MISS');

		const keyspace = await redis.dbsize();

		expect(keyspace, `Redis keys once warmed to ${size}`)
			.toBeGreaterThanOrEqual(size);

		const samples: WriteSample[] = [];

		for (let rep = 0; rep < writeReps; rep++) {
			samples.push(await timeWrite(rep, idleRate));

			// Put the purged slice back, so the next write finds the same cache.
			const refill = await warmEntries(
				rep * SLICE_ENTRIES,
				(rep + 1) * SLICE_ENTRIES,
			);

			expect([...refill], `the slice write ${rep} purged`).toContain('MISS');
		}

		bySize.set(size, samples);

		const collectionPurges: WriteSample[] = [];

		for (let rep = 0; rep < writeReps; rep++) {
			const versionedWarm = await warmVersionedEntries();

			expect([...versionedWarm], `the versioned reads before save ${rep}`)
				.toContain('MISS');

			collectionPurges.push(await timeCollectionPurge(idleRate));
		}

		collectionPurgesBySize.set(size, collectionPurges);

		const collectionBreakdown = Object.entries(collectionPurges.at(-1)!.byCommand)
			.sort(([, a], [, b]) => b - a)
			.map(([name, calls]) => `${name} ${calls}`)
			.join(', ');

		const lastBreakdown = Object.entries(samples.at(-1)!.byCommand)
			.sort(([, a], [, b]) => b - a)
			.map(([name, calls]) => `${name} ${calls}`)
			.join(', ');

		report.push(
			`- ${size} entries: ${keyspace} Redis keys, warmed in`
			+ ` ${warmSeconds.toFixed(0)} s; last write: ${lastBreakdown};`
			+ ` last collection purge: ${collectionBreakdown}`,
		);
	}

	const seriesOf = (
		samplesBySize: Map<number, WriteSample[]>,
		size: number,
		pick: (sample: WriteSample) => number,
	) => {
		return summarise(`${size}`, samplesBySize.get(size)!.map(pick));
	};

	const seriesAt = (size: number, pick: (sample: WriteSample) => number) => {
		return seriesOf(bySize, size, pick);
	};

	const figureRowsOf = (samplesBySize: Map<number, WriteSample[]>) => {
		return cacheSizes.map((size) => {
			const commands = seriesOf(samplesBySize, size, (sample) => sample.commands);
			const redisMs = seriesOf(samplesBySize, size, (sample) => sample.redisMs);
			const wallMs = seriesOf(samplesBySize, size, (sample) => sample.wallMs);

			return `| ${size} | ${commands.median.toFixed(1)}`
				+ ` | ${redisMs.median.toFixed(2)} ms | ${wallMs.median.toFixed(1)} ms`
				+ ` | ${wallMs.p95.toFixed(1)} ms |`;
		});
	};

	const figureRows = figureRowsOf(bySize);
	const collectionFigureRows = figureRowsOf(collectionPurgesBySize);

	const largestSize = Math.max(...cacheSizes);

	const scalingIn = (
		samplesBySize: Map<number, WriteSample[]>,
		pick: (sample: WriteSample) => number,
	) => {
		const largest: Summary = seriesOf(samplesBySize, largestSize, pick);
		const smallest: Summary = seriesOf(samplesBySize, smallestSize, pick);

		return largest.median / Math.max(smallest.median, Number.EPSILON);
	};

	const scalingOf = (pick: (sample: WriteSample) => number) => {
		return scalingIn(bySize, pick);
	};

	const commandScaling = scalingOf((sample) => sample.commands);
	const redisTimeScaling = scalingOf((sample) => sample.redisMs);
	const wallScaling = scalingOf((sample) => sample.wallMs);

	const collectionCommandScaling = scalingIn(
		collectionPurgesBySize,
		(sample) => sample.commands,
	);

	const collectionRedisTimeScaling = scalingIn(
		collectionPurgesBySize,
		(sample) => sample.redisMs,
	);

	const gates = [
		['Redis commands per write', commandScaling, maxCommandScaling],
		['Redis time per write', redisTimeScaling, maxRedisTimeScaling],
		[
			'Redis commands per collection purge',
			collectionCommandScaling,
			maxCommandScaling,
		],
		[
			'Redis time per collection purge',
			collectionRedisTimeScaling,
			maxRedisTimeScaling,
		],
	] as const;

	const verdicts = gates.map(([label, measured, ceiling]) => {
		const verdict = measured <= ceiling
			? 'ok'
			: 'OVER';

		return `| ${label}, ${largestSize} entries against ${smallestSize}`
			+ ` | ${measured.toFixed(2)} | ${ceiling} | ${verdict} |`;
	});

	const wallVerdict = wallScaling <= targetWallScaling
		? 'ok'
		: 'over';

	const markdown = [
		'### Purge scaling',
		'',
		`One scoped PATCH per rep, ${writeReps} reps per size, each purging a slice`
		+ ` of ${SLICE_ENTRIES} entries. Reads pin the primary key, not the index`
		+ ' path. Medians.',
		'',
		'| cache entries | Redis commands | Redis time | wall | wall p95 |',
		'| ---: | ---: | ---: | ---: | ---: |',
		...figureRows,
		'',
		`One version save per rep, ${writeReps} reps per size, each purging the whole`
		+ ` ${VERSIONED} collection: ${VERSIONED_ROWS * VERSIONED_ENTRIES} entries`
		+ ' at every size. Medians.',
		'',
		'| cache entries | Redis commands | Redis time | wall | wall p95 |',
		'| ---: | ---: | ---: | ---: | ---: |',
		...collectionFigureRows,
		'',
		...report,
		'',
		'#### Gates',
		'',
		'| ratio | measured | ceiling | |',
		'| --- | ---: | ---: | --- |',
		...verdicts,
		'',
		'#### Headroom',
		'',
		'| ratio | measured | target | |',
		'| --- | ---: | ---: | --- |',
		`| wall time per write, ${largestSize} entries against ${smallestSize}`
		+ ` | ${wallScaling.toFixed(2)} | ${targetWallScaling} | ${wallVerdict} |`,
		'',
	];

	await mkdir(outputDir, { recursive: true });

	await writeFile(
		join(outputDir, 'purge-scaling.json'),
		`${JSON.stringify({
			commit: process.env['PERF_HEAD_SHA'] ?? 'local',
			measuredAt: new Date().toISOString(),
			sliceEntries: SLICE_ENTRIES,
			writeReps,
			idleCommandsPerSecond: idleRate,
			samples: Object.fromEntries(bySize),
			collectionPurgeSamples: Object.fromEntries(collectionPurgesBySize),
			scaling: {
				commands: commandScaling,
				redisTime: redisTimeScaling,
				wall: wallScaling,
				collectionPurgeCommands: collectionCommandScaling,
				collectionPurgeRedisTime: collectionRedisTimeScaling,
			},
		}, null, 2)}\n`,
	);

	await writeFile(join(outputDir, 'purge-scaling.md'), `${markdown.join('\n')}\n`);

	const over = verdicts.filter((line) => line.endsWith('OVER |'));

	const breached = over.length > 0
		? `${over.length} gate(s) OVER — `
		: '';

	const largestWall = seriesAt(largestSize, (sample) => sample.wallMs).median;
	const smallestWall = seriesAt(smallestSize, (sample) => sample.wallMs).median;

	await writeFile(
		join(outputDir, 'purge-scaling.status.txt'),
		`${breached}purge at ${largestSize} vs ${smallestSize} entries:`
		+ ` ${commandScaling.toFixed(2)}x redis cmds,`
		+ ` ${redisTimeScaling.toFixed(2)}x redis time,`
		+ ` ${largestWall.toFixed(1)} vs ${smallestWall.toFixed(1)} ms;`
		+ ` collection purge ${collectionCommandScaling.toFixed(2)}x redis cmds,`
		+ ` ${collectionRedisTimeScaling.toFixed(2)}x redis time\n`,
	);

	expect(over, `gates exceeded:\n${over.join('\n')}`).toEqual([]);
}, 60 * 60 * 1000);
