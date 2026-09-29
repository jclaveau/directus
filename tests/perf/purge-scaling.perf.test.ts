import { spawn, type ChildProcess } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
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
 * The primary-key phase also measures the purge that drops a whole collection: a
 * version save purges the collection it versions whatever its delta holds. The
 * versioned collection is small and stays the same size at every step, so what
 * grows with the cache is the purge finding that collection's index among
 * everyone else's.
 *
 * A boolean phase pins a boolean beside the primary key, true on every row: a
 * field whose one value every cached read shares, the way production's reads
 * pin `enabled` or `status` beside a narrower field.
 *
 * A last phase holds the live cache at the smallest size and grows what has
 * expired instead: entries filled under a short TTL, measured once Redis has
 * dropped them, while what named them may stay: index members on a layout
 * whose sets outlive them, index-key names on one whose sets expire with them.
 * Production's index is mostly those, between two reaps. A layout that forgets
 * them on the purge pays for it on the first write, so that write is reported
 * on its own beside the medians. A version save on the same collection reports
 * what walking them costs a collection-wide purge.
 *
 * Seeded through the api rather than written into Redis: a layout the bench
 * wrote itself would measure the bench's idea of the index, and the point is to
 * compare layouts. What a write purges and refills goes over HTTP; the rest of
 * the cache is filled in-process by `purge-extensions/perf-cache-fill`, which
 * runs the same read and the same filing without a request per entry. Before
 * any size is measured, a thousand entries are cached both ways on the branch
 * under test and the two keyspaces have to match, member shapes included.
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
const cacheSizes = (process.env['PERF_PURGE_SIZES'] ?? '1000,100000')
	.split(',')
	.map(Number);

const writeReps = Number(process.env['PERF_PURGE_WRITE_REPS'] ?? 9);
const warmConcurrency = Number(process.env['PERF_PURGE_WARM_CONCURRENCY'] ?? 32);

// How many cached reads each warmed row is part of: one per `limit`.
const SLICE_ENTRIES = 50;

// Entries per call to the filler, and how many calls are in flight.
const FILL_BATCH_ENTRIES = 1000;
const FILL_CONCURRENCY = 4;

// How many entries the filler is checked against a GET on, before any size.
const FIDELITY_ENTRIES = 1000;

// The TTL the expired-entries phase fills with: long enough that a batch's
// entries are still there when it answers, short enough to wait out.
const EXPIRING_TTL_MS = 2000;

const maxCommandScaling =
	Number(process.env['PERF_PURGE_MAX_COMMAND_SCALING'] ?? 1.5);

// Looser than the count: Redis's own clock is exact per command, but a larger
// keyspace moves each command's cost a little on its own.
const maxRedisTimeScaling =
	Number(process.env['PERF_PURGE_MAX_REDIS_TIME_SCALING'] ?? 2);

// A dead index-key name costs one EXISTS and one SREM when a collection purge
// first walks it; the slack covers the purge's own commands moving a little.
const maxCommandsPerDeadIndexKeyName = Number(
	process.env['PERF_PURGE_MAX_COMMANDS_PER_DEAD_INDEX_KEY_NAME'] ?? 2.5,
);

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
const largestSize = Math.max(...cacheSizes);

// Every write lands on a row the smallest size has warmed.
if (writeReps > smallestSize / SLICE_ENTRIES) {
	throw new Error(
		`PERF_PURGE_WRITE_REPS is at most ${smallestSize / SLICE_ENTRIES}`
		+ ` for a smallest size of ${smallestSize}, not ${writeReps}`,
	);
}

const STATUS_HEADER = 'x-cache-status';
const TENANTS = 8;

// The collection a version save purges whole, and how many reads of it are cached
// before each save: `VERSIONED_ENTRIES` per row, one per `limit`.
const VERSIONED = 'perf_versioned';
const VERSIONED_ROWS = 4;
const VERSIONED_ENTRIES = 5;

const rowCount = Math.ceil(largestSize / SLICE_ENTRIES);

type PurgePhase = {
	phaseName: string;
	collection: string;
	readsPin: string;
	scopeFields: string[];
	extraFields: Record<string, unknown>[];
	extraValues: Record<string, unknown>;
	extraFilter: string;
	fillFilter: Record<string, unknown>;
	timesCollectionPurge: boolean;
};

const PK_PHASE: PurgePhase = {
	phaseName: 'pk',
	collection: 'perf_slice',
	readsPin: 'Reads pin the primary key, not the index path.',
	scopeFields: ['tenant'],
	extraFields: [],
	extraValues: {},
	extraFilter: '',
	fillFilter: {},
	timesCollectionPurge: true,
};

// Declared, or a read could not pin it: only scope fields and the primary key
// are. Second, so `tenant` stays the index path. `enabled` sorts before `id`, so
// a read pinning both, one value each, ties on every count and falls to
// whichever pin key sorts first: a layout that breaks the tie by that key files
// every read under the one set all rows share, the worst case measured here.
const BOOLEAN_PHASE: PurgePhase = {
	phaseName: 'boolean',
	collection: 'perf_flag_slice',
	readsPin: 'Reads pin the primary key and `enabled`, true on every row, not the'
		+ ' index path.',
	scopeFields: ['tenant', 'enabled'],
	extraFields: [
		{
			field: 'enabled',
			type: 'boolean',
			meta: {},
			schema: { default_value: true },
		},
	],
	extraValues: { enabled: true },
	extraFilter: '&filter[enabled][_eq]=true',
	// As a GET's query string hands it over, before sanitizing.
	fillFilter: { enabled: { _eq: 'true' } },
	timesCollectionPurge: false,
};

const authHeaders = {
	'Authorization': `Bearer ${adminToken}`,
	'Content-Type': 'application/json',
};

let instance: ChildProcess | undefined;
let redis: Redis;
const phaseRowIds = new Map<string, number[]>();
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
			EXTENSIONS_PATH: join(root, 'tests', 'perf', 'purge-extensions'),
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

async function seedPhase(phase: PurgePhase): Promise<void> {
	const dropped = await fetch(`${base}/collections/${phase.collection}`, {
		method: 'DELETE',
		headers: authHeaders,
	});

	await dropped.text();

	await api('/collections', {
		method: 'POST',
		body: JSON.stringify({
			collection: phase.collection,
			// The index path first. No read below pins it, so every one of them is
			// filed where a read pinning anything else is.
			meta: { scoped_cache_fields: phase.scopeFields },
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
				...phase.extraFields,
			],
		}),
	});

	const rows = Array.from({ length: rowCount }, (_, index) => {
		return {
			tenant: `t${index % TENANTS}`,
			label: `row ${index}`,
			...phase.extraValues,
		};
	});

	let seededIds: number[] = [];

	for (let at = 0; at < rows.length; at += 500) {
		const created = await api(`/items/${phase.collection}?fields=id`, {
			method: 'POST',
			body: JSON.stringify(rows.slice(at, at + 500)),
		});

		seededIds = [...seededIds, ...created.data.map((row: any) => row.id)];
	}

	phaseRowIds.set(phase.phaseName, seededIds);
}

async function seedVersioned(): Promise<void> {
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
function slicePath(phase: PurgePhase, entryIndex: number): string {
	const rowIds = phaseRowIds.get(phase.phaseName)!;
	const rowId = rowIds[Math.floor(entryIndex / SLICE_ENTRIES)]!;
	const limit = 1 + (entryIndex % SLICE_ENTRIES);

	return `/items/${phase.collection}?filter[id][_eq]=${rowId}`
		+ `${phase.extraFilter}&limit=${limit}&fields=id,label`;
}

/** Read every entry in `[from, to)`, `warmConcurrency` at a time. */
async function warmEntries(
	phase: PurgePhase,
	from: number,
	to: number,
): Promise<Set<string>> {
	const statuses = new Set<string>();
	let next = from;

	async function drain(): Promise<void> {
		while (next < to) {
			const entryIndex = next++;
			const path = slicePath(phase, entryIndex);
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

// A fill under a short TTL, and the Redis names it sampled to watch expire.
type ExpiringFill = {
	ttlMs: number;
	sampledKeys: string[];
	aliveOnAnswer: number;
};

/**
 * Cache every entry in `[from, to)` in-process, `FILL_BATCH_ENTRIES` a call:
 * the reads `slicePath` names, under the keys and pins a GET of them files.
 * With `expiring`, under its TTL, sampling one entry per call.
 */
async function fillEntries(
	phase: PurgePhase,
	from: number,
	to: number,
	expiring?: ExpiringFill,
): Promise<number> {
	const rowIds = phaseRowIds.get(phase.phaseName)!;
	const batches: { id: number; limits: number[] }[][] = [];

	for (let at = from; at < to; at += FILL_BATCH_ENTRIES) {
		const rows = new Map<number, number[]>();
		const batchEnd = Math.min(at + FILL_BATCH_ENTRIES, to);

		for (let entryIndex = at; entryIndex < batchEnd; entryIndex++) {
			const rowId = rowIds[Math.floor(entryIndex / SLICE_ENTRIES)]!;
			const limits = rows.get(rowId) ?? [];

			limits.push(1 + (entryIndex % SLICE_ENTRIES));
			rows.set(rowId, limits);
		}

		batches.push([...rows].map(([id, limits]) => ({ id, limits })));
	}

	let filled = 0;
	let next = 0;

	async function drain(): Promise<void> {
		while (next < batches.length) {
			const rows = batches[next++]!;

			const answer = await api('/perf-cache-fill', {
				method: 'POST',
				body: JSON.stringify({
					collection: phase.collection,
					fields: 'id,label',
					filter: phase.fillFilter,
					rows,
					ttlMs: expiring?.ttlMs,
				}),
			});

			filled += answer.filled;

			if (expiring) {
				const sampled: string[] = answer.expiringKeys;

				expiring.sampledKeys.push(...sampled);
				expiring.aliveOnAnswer += await redis.exists(...sampled);
			}
		}
	}

	await Promise.all(Array.from({ length: FILL_CONCURRENCY }, () => drain()));

	return filled;
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

/**
 * The phase's largest index sets by member count, whatever the layout names
 * them: where its reads were actually filed.
 */
async function largestIndexSets(phase: PurgePhase): Promise<string> {
	const setSizes: [string, number][] = [];
	let cursor = '0';

	do {
		const [nextCursor, keys] = await redis.scan(
			cursor,
			'MATCH',
			`*fingerprint:${phase.collection}:*`,
			'COUNT',
			1000,
		);

		cursor = nextCursor;

		for (const key of keys) {
			const keyType = await redis.type(key);

			if (keyType === 'set') {
				setSizes.push([key, await redis.scard(key)]);
			}
			else if (keyType === 'zset') {
				setSizes.push([key, await redis.zcard(key)]);
			}
		}
	} while (cursor !== '0');

	const largestSets = setSizes
		.sort(([, a], [, b]) => b - a)
		.slice(0, 3)
		.map(([key, members]) => `\`${JSON.stringify(key)}\` ${members}`)
		.join(', ');

	return `${setSizes.length} index sets, largest: ${largestSets}`;
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

function timeWrite(
	phase: PurgePhase,
	rowIndex: number,
	idleRate: number,
): Promise<WriteSample> {
	const rowIds = phaseRowIds.get(phase.phaseName)!;

	return timeRedisCost(() => {
		return api(`/items/${phase.collection}/${rowIds[rowIndex]}`, {
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

/** `writeReps` scoped PATCHes, each on a row the smallest size has warmed. */
async function timeSliceWrites(
	phase: PurgePhase,
	idleRate: number,
): Promise<WriteSample[]> {
	const samples: WriteSample[] = [];

	for (let rep = 0; rep < writeReps; rep++) {
		samples.push(await timeWrite(phase, rep, idleRate));

		// Put the purged slice back, so the next write finds the same cache.
		const refill = await warmEntries(
			phase,
			rep * SLICE_ENTRIES,
			(rep + 1) * SLICE_ENTRIES,
		);

		expect([...refill], `the slice ${phase.phaseName} write ${rep} purged`)
			.toEqual(['MISS']);
	}

	return samples;
}

/** `writeReps` version saves, each over a freshly cached versioned collection. */
async function timeCollectionPurges(idleRate: number): Promise<WriteSample[]> {
	const collectionPurges: WriteSample[] = [];

	for (let rep = 0; rep < writeReps; rep++) {
		const versionedWarm = await warmVersionedEntries();

		expect([...versionedWarm], `the versioned reads before save ${rep}`)
			.toEqual(['MISS']);

		collectionPurges.push(await timeCollectionPurge(idleRate));
	}

	return collectionPurges;
}

function commandBreakdown(sample: WriteSample): string {
	return Object.entries(sample.byCommand)
		.sort(([, a], [, b]) => b - a)
		.map(([name, calls]) => `${name} ${calls}`)
		.join(', ');
}

function seriesOf(
	samplesBySize: Map<number, WriteSample[]>,
	size: number,
	pick: (sample: WriteSample) => number,
): Summary {
	return summarise(`${size}`, samplesBySize.get(size)!.map(pick));
}

function figureRowsOf(samplesBySize: Map<number, WriteSample[]>): string[] {
	return cacheSizes.map((size) => {
		const commands = seriesOf(samplesBySize, size, (sample) => sample.commands);
		const redisMs = seriesOf(samplesBySize, size, (sample) => sample.redisMs);
		const wallMs = seriesOf(samplesBySize, size, (sample) => sample.wallMs);

		return `| ${size} | ${commands.median.toFixed(1)}`
			+ ` | ${redisMs.median.toFixed(2)} ms | ${wallMs.median.toFixed(1)} ms`
			+ ` | ${wallMs.p95.toFixed(1)} ms |`;
	});
}

function scalingIn(
	samplesBySize: Map<number, WriteSample[]>,
	pick: (sample: WriteSample) => number,
): number {
	const largest = seriesOf(samplesBySize, largestSize, pick);
	const smallest = seriesOf(samplesBySize, smallestSize, pick);

	return largest.median / Math.max(smallest.median, Number.EPSILON);
}

const FIGURE_HEADER = [
	'| cache entries | Redis commands | Redis time | wall | wall p95 |',
	'| ---: | ---: | ---: | ---: | ---: |',
];

type PhaseResult = {
	phase: PurgePhase;
	idleRate: number;
	bySize: Map<number, WriteSample[]>;
	collectionPurgesBySize: Map<number, WriteSample[]>;
	markdown: string[];
	verdicts: string[];
	scaling: Record<string, number>;
	statusFigure: string;
};

const phaseResults: PhaseResult[] = [];

async function measurePhase(phase: PurgePhase): Promise<PhaseResult> {
	await clearResponseCache();
	await markIndexKeySetsComplete();

	const idleRate = await measureIdleCommands();
	const bySize = new Map<number, WriteSample[]>();
	const collectionPurgesBySize = new Map<number, WriteSample[]>();
	const report: string[] = [];
	let warmed = 0;

	// The slices the writes purge, read over HTTP like their refills are.
	const writtenEntries = writeReps * SLICE_ENTRIES;

	for (const size of [...cacheSizes].sort((a, b) => a - b)) {
		const warmStartedAt = performance.now();
		const readEnd = Math.min(Math.max(warmed, writtenEntries), size);

		if (warmed < readEnd) {
			const warmStatuses = await warmEntries(phase, warmed, readEnd);

			// A warm that never filled measured an empty cache at every size.
			expect([...warmStatuses], `${phase.phaseName} warming to ${size}`)
				.toEqual(['MISS']);
		}

		const filled = await fillEntries(phase, readEnd, size);

		expect(filled, `${phase.phaseName} entries filled to ${size}`)
			.toBe(size - readEnd);

		const warmSeconds = (performance.now() - warmStartedAt) / 1000;

		warmed = size;

		// A filled entry a GET does not find was filed under a key or a layout no
		// read of it uses.
		const filledRead = await fetch(`${base}${slicePath(phase, size - 1)}`, {
			headers: authHeaders,
		});

		await filledRead.text();

		expect(
			filledRead.headers.get(STATUS_HEADER),
			`the last ${phase.phaseName} entry of ${size}`,
		).toBe('HIT');

		const keyspace = await redis.dbsize();

		expect(keyspace, `Redis keys once ${phase.phaseName} warmed to ${size}`)
			.toBeGreaterThanOrEqual(size);

		const filedUnder = await largestIndexSets(phase);
		const samples = await timeSliceWrites(phase, idleRate);

		bySize.set(size, samples);

		let collectionReport = '';

		if (phase.timesCollectionPurge) {
			const collectionPurges = await timeCollectionPurges(idleRate);

			// Reaped, so the index-key sets vouch for the collection's sets: a SCAN
			// means the purge measured the keyspace fallback instead.
			for (const [rep, sample] of collectionPurges.entries()) {
				expect(sample.byCommand, `collection purge ${rep} at ${size}`)
					.not.toHaveProperty('scan');
			}

			collectionPurgesBySize.set(size, collectionPurges);

			collectionReport = '; last collection purge:'
				+ ` ${commandBreakdown(collectionPurges.at(-1)!)}`;
		}

		report.push(
			`- ${size} entries: ${keyspace} Redis keys, warmed in`
			+ ` ${warmSeconds.toFixed(0)} s; last write:`
			+ ` ${commandBreakdown(samples.at(-1)!)}${collectionReport};`
			+ ` ${filedUnder}`,
		);
	}

	const scaling: Record<string, number> = {
		commands: scalingIn(bySize, (sample) => sample.commands),
		redisTime: scalingIn(bySize, (sample) => sample.redisMs),
		wall: scalingIn(bySize, (sample) => sample.wallMs),
	};

	const gates: [string, number, number][] = [
		['Redis commands per write', scaling['commands']!, maxCommandScaling],
		['Redis time per write', scaling['redisTime']!, maxRedisTimeScaling],
	];

	const collectionMarkdown: string[] = [];

	if (phase.timesCollectionPurge) {
		scaling['collectionPurgeCommands'] = scalingIn(
			collectionPurgesBySize,
			(sample) => sample.commands,
		);

		scaling['collectionPurgeRedisTime'] = scalingIn(
			collectionPurgesBySize,
			(sample) => sample.redisMs,
		);

		gates.push(
			[
				'Redis commands per collection purge',
				scaling['collectionPurgeCommands'],
				maxCommandScaling,
			],
			[
				'Redis time per collection purge',
				scaling['collectionPurgeRedisTime'],
				maxRedisTimeScaling,
			],
		);

		collectionMarkdown.push(
			`One version save per rep, ${writeReps} reps per size, each purging the`
			+ ` whole ${VERSIONED} collection:`
			+ ` ${VERSIONED_ROWS * VERSIONED_ENTRIES} entries at every size. Medians.`,
			'',
			...FIGURE_HEADER,
			...figureRowsOf(collectionPurgesBySize),
			'',
		);
	}

	const verdicts = gates.map(([label, measured, ceiling]) => {
		const verdict = measured <= ceiling
			? 'ok'
			: 'OVER';

		return `| ${phase.phaseName}: ${label}, ${largestSize} entries against`
			+ ` ${smallestSize} | ${measured.toFixed(2)} | ${ceiling} | ${verdict} |`;
	});

	const wallScaling = scaling['wall']!;

	const wallVerdict = wallScaling <= targetWallScaling
		? 'ok'
		: 'over';

	const markdown = [
		`#### Phase: ${phase.phaseName}`,
		'',
		`One scoped PATCH per rep, ${writeReps} reps per size, each purging a slice`
		+ ` of ${SLICE_ENTRIES} entries. ${phase.readsPin} Medians.`,
		'',
		...FIGURE_HEADER,
		...figureRowsOf(bySize),
		'',
		...collectionMarkdown,
		...report,
		'',
		'| ratio | measured | ceiling | |',
		'| --- | ---: | ---: | --- |',
		...verdicts,
		`| ${phase.phaseName}: wall time per write (headroom, gates nothing)`
		+ ` | ${wallScaling.toFixed(2)} | ${targetWallScaling} | ${wallVerdict} |`,
		'',
	];

	const largestWall = seriesOf(bySize, largestSize, (sample) => sample.wallMs);
	const smallestWall = seriesOf(bySize, smallestSize, (sample) => sample.wallMs);

	const collectionFigure = phase.timesCollectionPurge
		? `, collection ${scaling['collectionPurgeCommands']!.toFixed(2)}x/`
		+ `${scaling['collectionPurgeRedisTime']!.toFixed(2)}x`
		: '';

	const statusFigure = `${phase.phaseName}`
		+ ` ${scaling['commands']!.toFixed(2)}x cmds`
		+ ` ${scaling['redisTime']!.toFixed(2)}x redis`
		+ ` ${largestWall.median.toFixed(1)}/${smallestWall.median.toFixed(1)} ms`
		+ `${collectionFigure}`;

	return {
		phase,
		idleRate,
		bySize,
		collectionPurgesBySize,
		markdown,
		verdicts,
		scaling,
		statusFigure,
	};
}

// Rewritten after every phase, and before its gates are judged: a breach still
// reports its figures, and a phase that never finished leaves the others'.
async function writeResults(): Promise<string[]> {
	const overVerdicts = phaseResults
		.flatMap((result) => result.verdicts)
		.filter((line) => line.endsWith('OVER |'));

	await mkdir(outputDir, { recursive: true });

	await writeFile(
		join(outputDir, 'purge-scaling.json'),
		`${JSON.stringify({
			commit: process.env['PERF_HEAD_SHA'] ?? 'local',
			measuredAt: new Date().toISOString(),
			sliceEntries: SLICE_ENTRIES,
			writeReps,
			phases: Object.fromEntries(phaseResults.map((result) => {
				return [
					result.phase.phaseName,
					{
						idleCommandsPerSecond: result.idleRate,
						samples: Object.fromEntries(result.bySize),
						collectionPurgeSamples:
							Object.fromEntries(result.collectionPurgesBySize),
						scaling: result.scaling,
					},
				];
			})),
		}, null, 2)}\n`,
	);

	const markdown = [
		...fidelityReport,
		'### Purge scaling',
		'',
		...phaseResults.flatMap((result) => result.markdown),
	];

	await writeFile(join(outputDir, 'purge-scaling.md'), `${markdown.join('\n')}\n`);

	const unfaithful = fidelityHeld === true
		? ''
		: 'filler fidelity FAILED — ';

	const breached = overVerdicts.length > 0
		? `${unfaithful}${overVerdicts.length} gate(s) OVER — `
		: unfaithful;

	const phaseFigures = phaseResults.map((result) => result.statusFigure);

	await writeFile(
		join(outputDir, 'purge-scaling.status.txt'),
		`${breached}purge at ${largestSize} vs ${smallestSize} entries:`
		+ ` ${phaseFigures.join('; ')}\n`,
	);

	return overVerdicts;
}

beforeAll(async () => {
	redis = new Redis(redisUrl);
	instance = await startInstance();

	await seedPhase(PK_PHASE);
	await seedPhase(BOOLEAN_PHASE);
	await seedVersioned();
});

afterAll(async () => {
	instance?.kill('SIGTERM');
	await redis?.quit().catch(() => undefined);
});

type KeyspaceShape = {
	// `<type> <ttl> <key>`, digests and numbers blanked, to how many keys have it
	// and how many members they hold between them.
	keys: Record<string, { keys: number; members: number }>;
	// `<key shape> <- <member shape>`: every member, not a sample, so the list is
	// the same whatever order a scan returns them in.
	members: string[];
};

// Taken and released by whatever the instance runs, not by the fill, so a
// snapshot catches one or not depending on timing alone.
function isUnrelatedKey(key: string): boolean {
	return /^[^:]*_lock:/.test(key);
}

function blankIdentities(text: string): string {
	return text
		.replace(/[0-9a-f]{16,}/g, '<h>')
		.replace(/\d+/g, '<n>');
}

async function scanMembers(
	key: string,
	type: string,
): Promise<string[]> {
	if (type === 'list') {
		return (await redis.lrange(key, 0, -1)).map(blankIdentities);
	}

	const members: string[] = [];
	let cursor = '0';

	do {
		let page: string[];

		if (type === 'set') {
			[cursor, page] = await redis.sscan(key, cursor, 'COUNT', 1000);
			members.push(...page.map(blankIdentities));
		}
		else if (type === 'zset') {
			[cursor, page] = await redis.zscan(key, cursor, 'COUNT', 1000);

			for (let at = 0; at < page.length; at += 2) {
				members.push(
					`${blankIdentities(page[at]!)} @ ${blankIdentities(page[at + 1]!)}`,
				);
			}
		}
		else if (type === 'hash') {
			[cursor, page] = await redis.hscan(key, cursor, 'COUNT', 1000);

			for (let at = 0; at < page.length; at += 2) {
				members.push(blankIdentities(page[at]!));
			}
		}
		else {
			return [];
		}
	} while (cursor !== '0');

	return members;
}

async function readKeyspaceShape(): Promise<{
	shape: KeyspaceShape;
	unrelated: string[];
}> {
	const keys: KeyspaceShape['keys'] = {};
	const members = new Set<string>();
	const unrelated: string[] = [];
	let cursor = '0';

	do {
		const [nextCursor, page] = await redis.scan(cursor, 'COUNT', 1000);
		cursor = nextCursor;

		const related = page.filter((key) => {
			if (isUnrelatedKey(key)) {
				unrelated.push(key);

				return false;
			}

			return true;
		});

		const pipeline = redis.pipeline();

		for (const key of related) {
			pipeline.type(key).pttl(key);
		}

		const answers = (await pipeline.exec()) ?? [];

		for (const [index, key] of related.entries()) {
			const type = String(answers[index * 2]![1]);
			const pttl = Number(answers[index * 2 + 1]![1]);
			const keyShape = blankIdentities(key);

			const lifetime = pttl === -1
				? 'persistent'
				: 'expiring';

			const keyMembers = await scanMembers(key, type);

			for (const member of keyMembers) {
				members.add(`${keyShape} <- ${member}`);
			}

			const name = `${type} ${lifetime} ${keyShape}`;
			const entry = keys[name] ?? { keys: 0, members: 0 };

			entry.keys += 1;

			entry.members += type === 'string'
				? 1
				: keyMembers.length;

			keys[name] = entry;
		}
	} while (cursor !== '0');

	return {
		// Sorted, so two shapes holding the same keys serialize the same.
		shape: {
			keys: Object.fromEntries(Object.entries(keys).sort()),
			members: [...members].sort(),
		},
		unrelated: unrelated.sort(),
	};
}

async function clearResponseCache(): Promise<void> {
	await fetch(`${base}/utils/cache/clear`, { method: 'POST', headers: authHeaders })
		.then((response) => response.text());
}

/**
 * Runs the reap the instance has turned off. A flush voids the mark saying the
 * index-key sets name every set, and until a reap writes it again every
 * collection purge scans the keyspace instead: the purges measured would be
 * that scan's.
 */
async function markIndexKeySetsComplete(): Promise<void> {
	const { markerKey, counterKey } = await api('/perf-cache-fill/reap', {
		method: 'POST',
	});

	expect(await redis.get(markerKey), 'the index-key sets marked complete')
		.toBe(await redis.get(counterKey) ?? '');
}

// What the filler fidelity check found, carried into the report the purge
// test writes.
let fidelityReport: string[] = [];
let fidelityHeld: boolean | undefined;

test('the filler files what a GET files', async () => {
	const pkRowCount = phaseRowIds.get(PK_PHASE.phaseName)!.length;
	const entries = Math.min(FIDELITY_ENTRIES, pkRowCount * SLICE_ENTRIES);

	await clearResponseCache();

	const warmStatuses = await warmEntries(PK_PHASE, 0, entries);

	expect([...warmStatuses], 'the HTTP warm').toEqual(['MISS']);

	const httpKeys = await redis.dbsize();
	const http = await readKeyspaceShape();

	await clearResponseCache();

	const filled = await fillEntries(PK_PHASE, 0, entries);

	expect(filled, 'entries filled').toBe(entries);

	const fillKeys = await redis.dbsize();
	const fill = await readKeyspaceShape();

	fidelityHeld = JSON.stringify(fill.shape) === JSON.stringify(http.shape);

	const names = [...new Set([
		...Object.keys(http.shape.keys),
		...Object.keys(fill.shape.keys),
	])].sort();

	const shapeRows = names.map((name) => {
		const byHttp = http.shape.keys[name];
		const byFill = fill.shape.keys[name];

		return `| \`${name}\` | ${byHttp?.keys ?? 0} | ${byHttp?.members ?? 0}`
			+ ` | ${byFill?.keys ?? 0} | ${byFill?.members ?? 0} |`;
	});

	const httpMembers = new Set(http.shape.members);
	const fillMembers = new Set(fill.shape.members);

	const memberRows = [
		...http.shape.members
			.filter((member) => !fillMembers.has(member))
			.map((member) => `- http only: \`${member}\``),
		...fill.shape.members
			.filter((member) => !httpMembers.has(member))
			.map((member) => `- filler only: \`${member}\``),
	];

	const unrelatedLine = `left out as unrelated: http ${http.unrelated.length},`
		+ ` filler ${fill.unrelated.length}`;

	fidelityReport = fidelityHeld
		? [
			`filler fidelity: ok (${entries} entries, ${httpKeys} Redis keys,`
			+ ` ${names.length} key shapes, ${http.shape.members.length}`
			+ ` member shapes; ${unrelatedLine})`,
			'',
		]
		: [
			'### Filler fidelity FAILED',
			'',
			`${entries} entries warmed over HTTP: ${httpKeys} Redis keys; filled`
			+ ` in-process: ${fillKeys}; ${unrelatedLine}.`,
			'',
			'| key shape | http keys | http members | filler keys | filler members |',
			'| --- | ---: | ---: | ---: | ---: |',
			...shapeRows,
			'',
			...(memberRows.length > 0
				? ['Member shapes on one side only:', '', ...memberRows, '']
				: ['Every member shape is on both sides.', '']),
		];

	await mkdir(outputDir, { recursive: true });

	// The whole comparison, held or not, for reading beside the summary.
	await writeFile(join(outputDir, 'purge-scaling-fidelity.md'), [
		`${entries} entries; Redis keys: http ${httpKeys}, filler ${fillKeys}`,
		'',
		'| key shape | http keys | http members | filler keys | filler members |',
		'| --- | ---: | ---: | ---: | ---: |',
		...shapeRows,
		'',
		...memberRows,
		'',
		`Unrelated, http: ${http.unrelated.join(', ') || 'none'}`,
		'',
		`Unrelated, filler: ${fill.unrelated.join(', ') || 'none'}`,
		'',
	].join('\n'));

	await writeFile(
		join(outputDir, 'purge-scaling.md'),
		`${fidelityReport.join('\n')}\n`,
	);

	expect(fill.shape).toEqual(http.shape);

	// Same shape, and the entries a GET names are the ones filled.
	const sampleStatuses = new Set<string>();

	for (let entryIndex = 0; entryIndex < entries; entryIndex += 97) {
		const sampled = await fetch(`${base}${slicePath(PK_PHASE, entryIndex)}`, {
			headers: authHeaders,
		});

		await sampled.text();
		sampleStatuses.add(sampled.headers.get(STATUS_HEADER) ?? 'none');
	}

	expect([...sampleStatuses], 're-reading filled entries').toEqual(['HIT']);
}, 10 * 60 * 1000);

test.each([PK_PHASE, BOOLEAN_PHASE])(
	'a scoped purge costs the same however much the cache holds: $phaseName',
	async (phase) => {
		const result = await measurePhase(phase);

		phaseResults.push(result);

		const overVerdicts = await writeResults();

		const phaseOver = result.verdicts.filter((line) => line.endsWith('OVER |'));

		expect(phaseOver, `gates exceeded:\n${overVerdicts.join('\n')}`)
			.toEqual([]);
	},
	60 * 60 * 1000,
);

// What the index of one collection still files, and what its index-key set names.
type IndexCount = {
	members: number;
	indexSets: number;
	indexKeyNames: number;
	deadIndexKeyNames: number;
};

/**
 * How many members the index sets of `collection` hold and how many sets hold
 * them, whatever the layout names them or stores them as, and how many sets
 * its index-key set names, of which how many Redis no longer holds. A layout
 * without an index-key set names none.
 */
async function countIndexMembers(collection: string): Promise<IndexCount> {
	let members = 0;
	let indexSets = 0;
	let cursor = '0';

	do {
		const [nextCursor, page] = await redis.scan(
			cursor,
			'MATCH',
			`*:scoped-cache-index:fingerprint*:${collection}:*`,
			'COUNT',
			1000,
		);

		cursor = nextCursor;

		for (const key of page) {
			const type = await redis.type(key);

			if (type === 'zset') {
				members += await redis.zcard(key);
				indexSets++;
			}
			else if (type === 'set') {
				members += await redis.scard(key);
				indexSets++;
			}
		}
	} while (cursor !== '0');

	const collectionIndexKeysKeyList = await redis.keys(
		`*:scoped-cache-index:collection-index-keys:${collection}`,
	);

	let indexKeyNames = 0;
	let deadIndexKeyNames = 0;

	for (const collectionIndexKeysKey of collectionIndexKeysKeyList) {
		let indexKeysCursor = '0';

		do {
			const [nextCursor, names] = await redis.sscan(
				collectionIndexKeysKey,
				indexKeysCursor,
				'COUNT',
				1000,
			);

			indexKeysCursor = nextCursor;
			indexKeyNames += names.length;

			const existing = await Promise.all(names.map((name) => {
				return redis.exists(name);
			}));

			deadIndexKeyNames += existing.filter((held) => held === 0).length;
		} while (indexKeysCursor !== '0');
	}

	return { members, indexSets, indexKeyNames, deadIndexKeyNames };
}

function describeIndexCount(count: IndexCount): string {
	return `${count.members} members in ${count.indexSets} sets,`
		+ ` ${count.indexKeyNames} index-key names`
		+ ` (${count.deadIndexKeyNames} dead)`;
}

/** Seconds until Redis holds none of `rawKeys`. */
async function waitUntilExpired(rawKeys: string[]): Promise<number> {
	const startedAt = performance.now();
	const deadline = Date.now() + 120_000;

	while (await redis.exists(...rawKeys) > 0) {
		if (Date.now() > deadline) {
			throw new Error('the expiring entries were still in Redis after 120 s');
		}

		await new Promise((wake) => setTimeout(wake, 250));
	}

	return (performance.now() - startedAt) / 1000;
}

test('a scoped purge costs the same however much has expired', async () => {
	const phase = PK_PHASE;
	const rowIds = phaseRowIds.get(phase.phaseName)!;

	// A version save purges its collection whole, so versioning the one the
	// expired entries were filed in walks whatever its index still names.
	await api(`/collections/${phase.collection}`, {
		method: 'PATCH',
		body: JSON.stringify({ meta: { versioning: true } }),
	});

	const sliceVersion = await api('/versions?fields=id', {
		method: 'POST',
		body: JSON.stringify({
			key: 'bench-expired',
			name: 'bench-expired',
			collection: phase.collection,
			item: String(rowIds[writeReps]),
		}),
	});

	await clearResponseCache();
	await markIndexKeySetsComplete();

	const idleRate = await measureIdleCommands();
	const writtenEntries = writeReps * SLICE_ENTRIES;
	const liveWarm = await warmEntries(phase, 0, writtenEntries);

	expect([...liveWarm], 'the live warm').toEqual(['MISS']);

	const liveFilled = await fillEntries(phase, writtenEntries, smallestSize);

	expect(liveFilled, 'live entries filled').toBe(smallestSize - writtenEntries);

	const bySize = new Map<number, WriteSample[]>();
	const collectionPurgesBySize = new Map<number, WriteSample[]>();
	const slicePurgesBySize = new Map<number, WriteSample[]>();
	const countsBySize = new Map<number, IndexCount>();
	const countsBeforeSlicePurgeBySize = new Map<number, IndexCount>();
	const report: string[] = [];
	let filed = smallestSize;

	for (const size of [...cacheSizes].sort((a, b) => a - b)) {
		let expiryNote = 'nothing expired';

		if (filed < size) {
			const expiring: ExpiringFill = {
				ttlMs: EXPIRING_TTL_MS,
				sampledKeys: [],
				aliveOnAnswer: 0,
			};

			const filled = await fillEntries(phase, filed, size, expiring);
			const filledAt = Date.now();

			expect(filled, `expiring entries filled to ${size}`).toBe(size - filed);

			// Names Redis never held would read as expired from the start.
			expect(expiring.aliveOnAnswer, 'sampled keys alive as their call answered')
				.toBeGreaterThan(0);

			const goneAfter = await waitUntilExpired(expiring.sampledKeys);

			// A filing may be kept twice its entry's TTL: past that, a layout that
			// forgets members by their expiry has had every chance to.
			const indexMarginMs = filledAt + 2 * EXPIRING_TTL_MS + 1000 - Date.now();

			await new Promise((wake) => setTimeout(wake, Math.max(indexMarginMs, 0)));

			const sidecars = expiring.sampledKeys
				.filter((key) => key.endsWith('__expires_at'))
				.length;

			expiryNote = `${size - filed} filled with a ${EXPIRING_TTL_MS} ms TTL;`
				+ ` sampled ${expiring.sampledKeys.length - sidecars} payload and`
				+ ` ${sidecars} \`__expires_at\` keys, ${expiring.aliveOnAnswer}`
				+ ` alive as their call answered, all gone ${goneAfter.toFixed(1)} s`
				+ ' after the fill';

			filed = size;
		}

		const liveRead = await fetch(`${base}${slicePath(phase, smallestSize - 1)}`, {
			headers: authHeaders,
		});

		await liveRead.text();

		expect(liveRead.headers.get(STATUS_HEADER), `the last live entry at ${size}`)
			.toBe('HIT');

		const keyspace = await redis.dbsize();
		const lingering = await countIndexMembers(phase.collection);

		// Every live entry is still filed. What a layout keeps of the expired
		// ones is what this phase reports, not what it requires.
		expect(lingering.members, `index members once ${size} entries are filed`)
			.toBeGreaterThanOrEqual(smallestSize);

		// An index-key set names every set still standing, dead names or not.
		expect(lingering.indexKeyNames, `index-key names once ${size} are filed`)
			.toBeGreaterThan(0);

		expect(
			lingering.indexKeyNames - lingering.deadIndexKeyNames,
			`live index-key names once ${size} entries are filed`,
		).toBeGreaterThanOrEqual(lingering.indexSets);

		countsBySize.set(size, lingering);

		const samples = await timeSliceWrites(phase, idleRate);

		bySize.set(size, samples);

		const afterRowWrites = await countIndexMembers(phase.collection);

		const collectionPurges = await timeCollectionPurges(idleRate);

		for (const [rep, sample] of collectionPurges.entries()) {
			expect(sample.byCommand, `expired: collection purge ${rep} at ${size}`)
				.not.toHaveProperty('scan');
		}

		collectionPurgesBySize.set(size, collectionPurges);

		countsBeforeSlicePurgeBySize.set(
			size,
			await countIndexMembers(phase.collection),
		);

		const slicePurges: WriteSample[] = [];
		let afterFirstSlicePurge = afterRowWrites;

		for (let rep = 0; rep < writeReps; rep++) {
			slicePurges.push(await timeRedisCost(() => {
				return api(`/versions/${sliceVersion.data.id}/save`, {
					method: 'POST',
					body: JSON.stringify({ label: `saved ${Date.now()}` }),
				});
			}, idleRate));

			const purgedRead = await fetch(`${base}${slicePath(phase, 0)}`, {
				headers: authHeaders,
			});

			await purgedRead.text();

			expect(
				purgedRead.headers.get(STATUS_HEADER),
				`the ${phase.collection} save ${rep} at ${size}`,
			).toBe('MISS');

			if (rep === 0) {
				afterFirstSlicePurge = await countIndexMembers(phase.collection);
			}

			// Put the live entries back, so the next save finds the same cache.
			const refilled = await fillEntries(phase, 0, smallestSize);

			expect(refilled, `live entries refilled after save ${rep}`)
				.toBe(smallestSize);
		}

		for (const [rep, sample] of slicePurges.entries()) {
			expect(sample.byCommand, `expired: ${phase.collection} save ${rep} at ${size}`)
				.not.toHaveProperty('scan');
		}

		slicePurgesBySize.set(size, slicePurges);

		const membersAfter = await countIndexMembers(phase.collection);

		report.push(
			`- ${size} filed: ${expiryNote}; ${keyspace} Redis keys; before the`
			+ ` writes ${describeIndexCount(lingering)}; after the row writes`
			+ ` ${describeIndexCount(afterRowWrites)}; after the first`
			+ ` ${phase.collection} save ${describeIndexCount(afterFirstSlicePurge)};`
			+ ` at the end ${describeIndexCount(membersAfter)}; rep 1:`
			+ ` ${commandBreakdown(samples[0]!)}; last write:`
			+ ` ${commandBreakdown(samples.at(-1)!)}; first ${phase.collection}`
			+ ` save: ${commandBreakdown(slicePurges[0]!)}; last:`
			+ ` ${commandBreakdown(slicePurges.at(-1)!)}`,
		);
	}

	const expiredFigureRowsOf = (samplesBySize: Map<number, WriteSample[]>) => {
		return cacheSizes.map((size) => {
			const commands = seriesOf(samplesBySize, size, (sample) => sample.commands);
			const redisMs = seriesOf(samplesBySize, size, (sample) => sample.redisMs);
			const wallMs = seriesOf(samplesBySize, size, (sample) => sample.wallMs);
			const firstRep = samplesBySize.get(size)![0]!;

			const counted = countsBySize.get(size)!;

			return `| ${size} | ${size - smallestSize} | ${counted.members}`
				+ ` | ${counted.indexKeyNames} | ${counted.deadIndexKeyNames}`
				+ ` | ${commands.median.toFixed(1)} | ${redisMs.median.toFixed(2)} ms`
				+ ` | ${wallMs.median.toFixed(1)} ms | ${wallMs.p95.toFixed(1)} ms`
				+ ` | ${firstRep.commands.toFixed(1)}`
				+ ` | ${firstRep.redisMs.toFixed(2)} ms`
				+ ` | ${firstRep.wallMs.toFixed(1)} ms |`;
		});
	};

	const expiredAtLargest = largestSize - smallestSize;

	const commandScaling = scalingIn(bySize, (sample) => sample.commands);
	const redisTimeScaling = scalingIn(bySize, (sample) => sample.redisMs);

	const firstRepScaling = bySize.get(largestSize)![0]!.commands
		/ Math.max(bySize.get(smallestSize)![0]!.commands, Number.EPSILON);

	const firstSlicePurgeScaling = slicePurgesBySize.get(largestSize)![0]!.commands
		/ Math.max(slicePurgesBySize.get(smallestSize)![0]!.commands, Number.EPSILON);

	const gates = [
		['Redis commands per write', commandScaling, maxCommandScaling],
		['Redis time per write', redisTimeScaling, maxRedisTimeScaling],
		[
			'Redis commands per collection purge',
			scalingIn(collectionPurgesBySize, (sample) => sample.commands),
			maxCommandScaling,
		],
		[
			'Redis time per collection purge',
			scalingIn(collectionPurgesBySize, (sample) => sample.redisMs),
			maxRedisTimeScaling,
		],
	] as const;

	const verdicts = gates.map(([label, measured, ceiling]) => {
		const verdict = measured <= ceiling
			? 'ok'
			: 'OVER';

		return `| expired: ${label}, ${expiredAtLargest} expired against 0`
			+ ` | ${measured.toFixed(2)} | ${ceiling} | ${verdict} |`;
	});

	// What the first collection purge pays above the steady one, shared out
	// over the dead index-key names it found. A layout with no index-key set
	// has none, and nothing to share out.
	const deadNamesAtLargest = countsBeforeSlicePurgeBySize.get(largestSize)!
		.deadIndexKeyNames;

	const largestSlicePurges = slicePurgesBySize.get(largestSize)!;

	const steadySlicePurgeCommands = seriesOf(
		slicePurgesBySize,
		largestSize,
		(sample) => sample.commands,
	).median;

	const perDeadName = deadNamesAtLargest > 0
		? (largestSlicePurges[0]!.commands - steadySlicePurgeCommands)
			/ deadNamesAtLargest
		: null;

	let perDeadNameVerdict = 'n/a';

	if (perDeadName !== null) {
		perDeadNameVerdict = perDeadName <= maxCommandsPerDeadIndexKeyName
			? 'ok'
			: 'OVER';
	}

	const perDeadNameMeasured = perDeadName === null
		? '—'
		: perDeadName.toFixed(2);

	verdicts.push(
		'| expired: Redis commands per dead index-key name, first collection purge'
		+ ` | ${perDeadNameMeasured} | ${maxCommandsPerDeadIndexKeyName}`
		+ ` | ${perDeadNameVerdict} |`,
	);

	const tableHeader = [
		'| entries filed | expired | index members | index-key set names'
		+ ' | dead index-key names | Redis commands | Redis time | wall | wall p95'
		+ ' | rep 1 commands | rep 1 Redis time | rep 1 wall |',
		'| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
		+ ' ---: | ---: |',
	];

	const markdown = [
		'### Purge scaling, expired entries',
		'',
		`${smallestSize} live entries at every size; the rest of each size filled`
		+ ` with a ${EXPIRING_TTL_MS} ms TTL and measured once Redis had dropped`
		+ ' them, whatever the layout still names of them counted beside each'
		+ ' size. One scoped PATCH per rep,'
		+ ` ${writeReps} reps per size, each purging a slice of ${SLICE_ENTRIES}`
		+ ' live entries. Medians, and rep 1 on its own: a purge that forgets'
		+ ' expired members pays for them on the first write after they expire,'
		+ ' and the medians hide it.',
		'',
		...tableHeader,
		...expiredFigureRowsOf(bySize),
		'',
		`One version save per rep, ${writeReps} reps per size, each purging the whole`
		+ ` ${VERSIONED} collection, beside the same expired entries. Index members`
		+ ` are ${phase.collection}'s.`,
		'',
		...tableHeader,
		...expiredFigureRowsOf(collectionPurgesBySize),
		'',
		`One version save per rep on ${phase.collection} itself, ${writeReps} reps`
		+ ` per size, each purging its ${smallestSize} live entries and walking`
		+ ' whatever its index still names of the expired ones, the live entries'
		+ ' refilled between reps. Only rep 1 above the median, per dead'
		+ ' index-key name counted before it, is gated.',
		'',
		...tableHeader,
		...expiredFigureRowsOf(slicePurgesBySize),
		'',
		...report,
		'',
		'#### Gates',
		'',
		'| ratio | measured | ceiling | |',
		'| --- | ---: | ---: | --- |',
		...verdicts,
		'',
	];

	await mkdir(outputDir, { recursive: true });
	await appendFile(join(outputDir, 'purge-scaling.md'), `${markdown.join('\n')}\n`);

	await writeFile(
		join(outputDir, 'purge-scaling-expired.json'),
		`${JSON.stringify({
			commit: process.env['PERF_HEAD_SHA'] ?? 'local',
			measuredAt: new Date().toISOString(),
			liveEntries: smallestSize,
			expiringTtlMs: EXPIRING_TTL_MS,
			indexCounts: Object.fromEntries(countsBySize),
			indexCountsBeforeSlicePurge: Object.fromEntries(
				countsBeforeSlicePurgeBySize,
			),
			commandsPerDeadIndexKeyName: perDeadName,
			samples: Object.fromEntries(bySize),
			collectionPurgeSamples: Object.fromEntries(collectionPurgesBySize),
			slicePurgeSamples: Object.fromEntries(slicePurgesBySize),
		}, null, 2)}\n`,
	);

	const over = verdicts.filter((line) => line.endsWith('OVER |'));
	const statusFile = join(outputDir, 'purge-scaling.status.txt');
	const earlierStatus = await readFile(statusFile, 'utf8').catch(() => '');

	const breached = over.length > 0
		? `expired: ${over.length} gate(s) OVER — `
		: '';

	await writeFile(
		statusFile,
		`${breached}${earlierStatus.trim()}; expired ${expiredAtLargest} vs 0:`
		+ ` ${commandScaling.toFixed(2)}x redis cmds,`
		+ ` ${redisTimeScaling.toFixed(2)}x redis time,`
		+ ` rep 1 ${firstRepScaling.toFixed(2)}x redis cmds,`
		+ ` ${phase.collection} save rep 1 ${firstSlicePurgeScaling.toFixed(2)}x,`
		+ ` ${perDeadNameMeasured} cmds per dead index-key name`
		+ ` (${deadNamesAtLargest} dead)\n`,
	);

	expect(over, `gates exceeded:\n${over.join('\n')}`).toEqual([]);
}, 60 * 60 * 1000);
