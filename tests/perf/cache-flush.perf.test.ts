import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Redis from 'ioredis';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { summarise, summaryRow, type Summary } from './measure.js';

/**
 * What a cache flush costs as the cache grows.
 *
 * `directus cache flush` clears the response cache and drops the scoped-cache
 * index. In the database every other key shares, both walk the whole keyspace: on
 * the 2026-09-22 prod deploy four of them took 95 to 201 s each (#559). A cache in
 * a database of its own (`CACHE_REDIS_DB`) empties with one FLUSHDB instead, and
 * the index SCAN that follows walks a database the FLUSHDB just emptied.
 *
 * The figure is not a flush's duration but its slope as the cache grows, between
 * two sizes. The arms:
 *
 * - `shared`  `CACHE_REDIS_DB` unset: the cache lives in database 0. The
 *             reference, and the proof the grown cache reached a SCAN.
 * - `own-db`  `CACHE_REDIS_DB` set: the cache lives in a database of its own.
 *
 * A few entries are filled over HTTP; the rest are written straight into Redis
 * in the shapes the real ones took, a string per response entry and a set per
 * index key, under the arm's namespace, in whichever database the real ones
 * landed in.
 *
 * The gate is the SCAN count: a namespaced clear walks COUNT 1000 keys a call,
 * so it is exact, machine-independent and visible at 20k keys. The duration only
 * rises above noise near prod's size (270k keys, 2026-08-26), so it is reported,
 * not gated. Nothing but the flush runs while it is counted: the instance that
 * filled the cache is stopped first, so no scheduled job lands a SCAN in the
 * window.
 *
 * The system and permission caches stay in database 0, so the full flush still
 * SCANs it for them. Its size is reported beside each flush, not gated.
 *
 * The rules in cache.perf.test.ts's header hold here too: this bench lands before
 * the change it measures, and a ceiling is raised only with the maintainer's OK.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = process.env['PERF_CLI'] ?? join(root, 'dist', 'cli');
const adminToken = process.env['PERF_ADMIN_TOKEN'] ?? 'bench-admin-token';

// Pathless on purpose: the shared database is the one REDIS selects, database 0.
const redisUrl = process.env['PERF_REDIS'] ?? 'redis://127.0.0.1:6108';

const basePort = Number(process.env['PERF_FLUSH_BASE_PORT'] ?? 8400);

const outputDir = process.env['PERF_OUTPUT_DIR']
	?? join(root, 'tests', 'perf', 'results');

const cacheDatabase = Number(process.env['PERF_FLUSH_CACHE_DB'] ?? 9);
const flushReps = Number(process.env['PERF_FLUSH_REPS'] ?? 5);
const filledEntries = Number(process.env['PERF_FLUSH_FILLED_ENTRIES'] ?? 20);

// Two sizes, because the property is the slope between them.
const cacheSizes = [2_000, 20_000];
const grownRange = cacheSizes[1]! - cacheSizes[0]!;

// Response entries per index set in the grown cache, roughly prod's mix.
const entriesPerIndexSet = 3;

const knobs = [
	['PERF_FLUSH_REPS', flushReps],
	['PERF_FLUSH_FILLED_ENTRIES', filledEntries],
] as const;

for (const [name, value] of knobs) {
	if (!Number.isFinite(value) || value < 1) {
		throw new Error(`${name} has to be a positive number, not ${String(value)}`);
	}
}

if (!Number.isInteger(cacheDatabase) || cacheDatabase < 1) {
	throw new Error(`PERF_FLUSH_CACHE_DB has to be 1 or more, not ${cacheDatabase}`);
}

// The SCANs a flush in its own database adds when the cache grows by
// `grownRange` keys: none, give or take a pass landing on a batch boundary.
const maxScansAddedByGrowth = Number(
	process.env['PERF_FLUSH_MAX_SCANS_ADDED'] ?? 2,
);

// A NaN ceiling would pass every flush: nothing compares greater than NaN.
if (!Number.isFinite(maxScansAddedByGrowth) || maxScansAddedByGrowth < 0) {
	throw new Error(
		'PERF_FLUSH_MAX_SCANS_ADDED has to be 0 or more,'
		+ ` not ${String(maxScansAddedByGrowth)}`,
	);
}

// Below this the shared arm's SCANs never met the grown cache, and the `own-db`
// figures would pass for a reason that has nothing to do with its database: a
// MATCH SCAN walks COUNT 1000 keys per call, so 18k keys are ~18 calls a pass.
const minSharedScansAddedByGrowth = grownRange / 1000 / 2;

const NOTE = 'perf_flush_note';

const authHeaders = {
	'Authorization': `Bearer ${adminToken}`,
	'Content-Type': 'application/json',
};

type Arm = { name: string; env: Record<string, string> };

const cachedArmEnv = {
	CACHE_ENABLED: 'true',
	CACHE_STORE: 'redis',
	CACHE_AUTO_PURGE: 'true',
	CACHE_AUTO_PURGE_MODE: 'scoped',
	CACHE_STATUS_HEADER: 'x-cache-status',
	REDIS: redisUrl,
};

const arms: Arm[] = [
	{
		name: 'shared',
		env: { ...cachedArmEnv, CACHE_NAMESPACE: 'perf-flush-shared' },
	},
	{
		name: 'own-db',
		env: {
			...cachedArmEnv,
			CACHE_NAMESPACE: 'perf-flush-own-db',
			CACHE_REDIS_DB: String(cacheDatabase),
		},
	},
];

type FlushSample = {
	ms: number;
	scans: number;
	commands: number;
	sharedKeys: number;
};

const samples = new Map<string, FlushSample[]>();

function sampleKey(arm: Arm, cacheSize: number): string {
	return `${arm.name}@${cacheSize}`;
}

let redis: Redis;
let cacheRedis: Redis;

function instanceEnv(port: number, env: Record<string, string>) {
	return {
		...process.env,
		NODE_ENV: 'production',
		SERVE_APP: 'false',
		LOG_LEVEL: 'warn',
		TELEMETRY: 'false',
		EXTENSIONS_PATH: join(root, 'tests', 'perf', 'cache-extensions'),
		PORT: String(port),
		PUBLIC_URL: `http://127.0.0.1:${port}`,
		...env,
	};
}

async function startInstance(
	name: string,
	port: number,
	env: Record<string, string>,
): Promise<ChildProcess> {
	const instance = spawn('node', [cli, 'start'], { env: instanceEnv(port, env) });

	let output = '';
	instance.stdout?.on('data', (chunk) => (output += chunk));
	instance.stderr?.on('data', (chunk) => (output += chunk));

	let exited = false;
	instance.on('exit', () => (exited = true));

	const deadline = Date.now() + 120_000;

	for (;;) {
		if (exited) {
			throw new Error(`The ${name} instance exited during boot:\n${output}`);
		}

		// Left running, it would hold its port and keep writing to Redis.
		if (Date.now() > deadline) {
			instance.kill('SIGKILL');
			throw new Error(`The ${name} instance never listened:\n${output}`);
		}

		try {
			const response = await fetch(`http://127.0.0.1:${port}/server/ping`);

			if (response.ok) {
				await response.text();

				return instance;
			}
		}
		catch {
			// Not listening yet.
		}

		await new Promise((wake) => setTimeout(wake, 50));
	}
}

async function stopInstance(instance: ChildProcess): Promise<void> {
	if (instance.exitCode !== null) {
		return;
	}

	const closed = new Promise((resolveClose) => instance.once('close', resolveClose));
	instance.kill('SIGTERM');
	await closed;
}

async function api(
	base: string,
	path: string,
	init: { method?: string; body?: string } = {},
): Promise<Response> {
	const response = await fetch(`${base}${path}`, {
		method: init.method ?? 'GET',
		headers: authHeaders,
		...(init.body === undefined
			? {}
			: { body: init.body }),
	});

	if (!response.ok) {
		throw new Error(
			`${init.method ?? 'GET'} ${path} answered ${response.status}:`
			+ ` ${(await response.text()).slice(0, 400)}`,
		);
	}

	return response;
}

async function seedFixture(base: string): Promise<void> {
	const dropped = await fetch(`${base}/collections/${NOTE}`, {
		method: 'DELETE',
		headers: authHeaders,
	});

	await dropped.text();

	await (await api(base, '/collections', {
		method: 'POST',
		body: JSON.stringify({
			collection: NOTE,
			meta: { scoped_cache_fields: ['slot'] },
			schema: {},
			fields: [
				{
					field: 'id',
					type: 'integer',
					meta: { hidden: true },
					schema: { is_primary_key: true, has_auto_increment: true },
				},
				{ field: 'slot', type: 'string', meta: {}, schema: {} },
			],
		}),
	})).text();

	const rows = Array.from({ length: filledEntries }, (_, index) => {
		return { slot: `s${index}` };
	});

	for (let offset = 0; offset < rows.length; offset += 100) {
		await (await api(base, `/items/${NOTE}`, {
			method: 'POST',
			body: JSON.stringify(rows.slice(offset, offset + 100)),
		})).text();
	}
}

type KeyShapes = { client: Redis; responseKey: string; indexKey: string };

async function scanFirst(client: Redis, pattern: string): Promise<string | null> {
	let cursor = '0';

	do {
		const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);

		if (keys.length > 0) {
			return keys[0]!;
		}

		cursor = next;
	} while (cursor !== '0');

	return null;
}

/**
 * Where the arm's real entries landed and what their keys look like, read back
 * rather than assumed: the Keyv key nests its namespace twice, and the database
 * is the very thing the arms differ on.
 */
async function readKeyShapes(arm: Arm): Promise<KeyShapes> {
	const namespace = arm.env['CACHE_NAMESPACE']!;

	const found: KeyShapes[] = [];

	for (const client of [redis, cacheRedis]) {
		const responseKey = await scanFirst(client, `${namespace}_response*`);
		const indexKey = await scanFirst(client, `${namespace}:scoped-cache-index:*`);

		if (responseKey && indexKey) {
			found.push({ client, responseKey, indexKey });
		}
	}

	// Both would mean a run left the namespace behind, and the growth could land
	// in the database this build does not use.
	if (found.length !== 1) {
		throw new Error(
			`The ${arm.name} arm's cache is in ${found.length} databases, not 1.`,
		);
	}

	return found[0]!;
}

/**
 * Grow the arm's cache to `size` keys in the shapes its real entries took, in
 * MSET and pipelined SADD chunks rather than one round trip a key.
 */
async function growCache(shapes: KeyShapes, size: number): Promise<void> {
	const indexSets = Math.floor(size / (entriesPerIndexSet + 1));
	const entries = size - indexSets;

	for (let start = 0; start < entries; start += 5000) {
		const pairs: string[] = [];

		for (let index = start; index < Math.min(entries, start + 5000); index++) {
			pairs.push(`${shapes.responseKey}-grown-${index}`, 'x');
		}

		await shapes.client.mset(...pairs);
	}

	for (let start = 0; start < indexSets; start += 5000) {
		const pipeline = shapes.client.pipeline();

		for (let index = start; index < Math.min(indexSets, start + 5000); index++) {
			pipeline.sadd(`${shapes.indexKey}-grown-${index}`, `member-${index}`);
		}

		await pipeline.exec();
	}
}

/**
 * Fill the arm's cache for real, one scoped entry per slot, each read pinned to
 * its own slice, then stop the instance so nothing it schedules runs during the
 * flush.
 */
async function fillCache(arm: Arm, port: number): Promise<void> {
	const instance = await startInstance(arm.name, port, arm.env);
	const base = `http://127.0.0.1:${port}`;

	try {
		for (let index = 0; index < filledEntries; index += 10) {
			const batchSize = Math.min(10, filledEntries - index);

			await Promise.all(Array.from({ length: batchSize }, async (_, step) => {
				const slot = `s${index + step}`;

				await (await api(
					base,
					`/items/${NOTE}?filter[slot][_eq]=${slot}&fields=id,slot`,
				)).text();
			}));
		}

		const warm = await api(
			base,
			`/items/${NOTE}?filter[slot][_eq]=s0&fields=id,slot`,
		);

		await warm.text();

		if (warm.headers.get('x-cache-status') !== 'HIT') {
			throw new Error(`The ${arm.name} arm never cached what it filled.`);
		}
	}
	finally {
		await stopInstance(instance);
	}
}

async function readScansAndCommands(): Promise<{ scans: number; commands: number }> {
	const commandstats = await redis.info('commandstats');
	let scans = 0;
	let commands = 0;

	for (const line of commandstats.split('\n')) {
		const match = /^cmdstat_([^:]+):calls=(\d+)/.exec(line.trim());

		if (!match) {
			continue;
		}

		commands += Number(match[2]);

		if (match[1] === 'scan') {
			scans = Number(match[2]);
		}
	}

	return { scans, commands };
}

/**
 * Run `directus cache flush` the way a deploy step does, and read what it
 * reports: the flush times itself, so the figure excludes the CLI's own boot.
 */
async function runCacheFlush(arm: Arm, port: number): Promise<number> {
	const flush = spawn('node', [cli, 'cache', 'flush'], {
		env: instanceEnv(port, { ...arm.env, LOG_LEVEL: 'info' }),
	});

	let output = '';
	flush.stdout?.on('data', (chunk) => (output += chunk));
	flush.stderr?.on('data', (chunk) => (output += chunk));

	const code = await new Promise((resolveExit) => flush.once('close', resolveExit));

	if (code !== 0) {
		throw new Error(`The ${arm.name} flush exited ${String(code)}:\n${output}`);
	}

	const reported = /\[cache\] flushed in (\d+)ms/.exec(output);

	if (!reported) {
		throw new Error(`The ${arm.name} flush never said what it cost:\n${output}`);
	}

	return Number(reported[1]);
}

async function sampleFlush(arm: Arm, cacheSize: number, port: number) {
	await fillCache(arm, port);

	const shapes = await readKeyShapes(arm);
	await growCache(shapes, cacheSize);

	const sharedKeys = await redis.dbsize();
	const before = await readScansAndCommands();
	const ms = await runCacheFlush(arm, port);
	const after = await readScansAndCommands();

	const sample: FlushSample = {
		ms,
		scans: after.scans - before.scans,
		commands: after.commands - before.commands,
		sharedKeys,
	};

	// A flush that left the grown keys measured a cache it never emptied.
	expect(await scanFirst(shapes.client, `${shapes.responseKey}-grown-*`)).toBeNull();
	expect(await scanFirst(shapes.client, `${shapes.indexKey}-grown-*`)).toBeNull();

	const key = sampleKey(arm, cacheSize);
	samples.set(key, [...(samples.get(key) ?? []), sample]);
}

function seriesOf(
	arm: Arm,
	cacheSize: number,
	field: keyof FlushSample,
): Summary {
	return summarise(
		`${arm.name}, ${cacheSize} cache keys`,
		samples.get(sampleKey(arm, cacheSize))!.map((sample) => sample[field]),
	);
}

beforeAll(async () => {
	await mkdir(join(root, 'tests', 'perf', 'cache-extensions'), { recursive: true });

	const seedPort = basePort + arms.length;

	const seedInstance = await startInstance('seed', seedPort, {
		CACHE_ENABLED: 'false',
	});

	await seedFixture(`http://127.0.0.1:${seedPort}`);
	await stopInstance(seedInstance);

	redis = new Redis(redisUrl);
	cacheRedis = redis.duplicate({ db: cacheDatabase });
}, 10 * 60 * 1000);

afterAll(async () => {
	if (!redis) {
		return;
	}

	await cacheRedis.flushdb();
	await cacheRedis.quit();

	await redis.quit().catch(() => undefined);
});

test('a flush in its own database does not pay for the cache size', async () => {
	for (const cacheSize of cacheSizes) {
		for (let rep = 0; rep < flushReps; rep++) {
			// Each rep starts one arm further along, so no arm always goes first.
			const ordered = [
				...arms.slice(rep % arms.length),
				...arms.slice(0, rep % arms.length),
			];

			for (const arm of ordered) {
				await sampleFlush(arm, cacheSize, basePort + arms.indexOf(arm));
			}
		}
	}

	const [smaller, larger] = cacheSizes as [number, number];
	const [shared, ownDatabase] = arms as [Arm, Arm];

	const addedScans = (arm: Arm) => {
		return seriesOf(arm, larger, 'scans').median
			- seriesOf(arm, smaller, 'scans').median;
	};

	const addedMs = (arm: Arm) => {
		return seriesOf(arm, larger, 'ms').min - seriesOf(arm, smaller, 'ms').min;
	};

	const gates = [
		{
			name: 'SCANs a flush in its own database adds as the cache grows',
			value: addedScans(ownDatabase),
			ceiling: maxScansAddedByGrowth,
		},
	];

	const lines = [
		'### Cache flush',
		'',
		`\`directus cache flush\` of a cache grown to ${cacheSizes.join(' then ')}`
		+ ` keys (${filledEntries} filled over HTTP), ${flushReps} reps.`
		+ ` \`own-db\` keeps its cache in database ${cacheDatabase}.`,
		'',
		'| flush | min | median | p95 | max |',
		'| --- | ---: | ---: | ---: | ---: |',
		...arms.flatMap((arm) => {
			return cacheSizes.map((cacheSize) => {
				return summaryRow(seriesOf(arm, cacheSize, 'ms'));
			});
		}),
		'',
		'| SCANs per flush | min | median | p95 | max |',
		'| --- | ---: | ---: | ---: | ---: |',
		...arms.flatMap((arm) => {
			return cacheSizes.map((cacheSize) => {
				return summaryRow(seriesOf(arm, cacheSize, 'scans'), '');
			});
		}),
		'',
		'| Redis commands per flush | min | median | p95 | max |',
		'| --- | ---: | ---: | ---: | ---: |',
		...arms.flatMap((arm) => {
			return cacheSizes.map((cacheSize) => {
				return summaryRow(seriesOf(arm, cacheSize, 'commands'), '');
			});
		}),
		'',
		'| database 0 keys at the flush | min | median | p95 | max |',
		'| --- | ---: | ---: | ---: | ---: |',
		...arms.flatMap((arm) => {
			return cacheSizes.map((cacheSize) => {
				return summaryRow(seriesOf(arm, cacheSize, 'sharedKeys'), '');
			});
		}),
		'',
		`Growing the cache by ${grownRange} keys adds ${addedScans(shared)} SCANs and`
		+ ` ${addedMs(shared).toFixed(1)} ms to \`shared\`, ${addedScans(ownDatabase)}`
		+ ` SCANs and ${addedMs(ownDatabase).toFixed(1)} ms to \`own-db\`.`,
		'',
		'| gate | value | ceiling | |',
		'| --- | ---: | ---: | --- |',
		...gates.map((gate) => {
			const verdict = gate.value <= gate.ceiling
				? 'ok'
				: 'OVER';

			return `| ${gate.name} | ${gate.value.toFixed(2)} | ${gate.ceiling}`
				+ ` | ${verdict} |`;
		}),
	];

	const over = gates.filter((gate) => gate.value > gate.ceiling);

	const status = over.length === 0
		? `flush in own db: +${addedScans(ownDatabase)} SCANs over ${grownRange} keys`
		: `over: ${over.map((gate) => gate.name).join('; ')}`;

	await mkdir(outputDir, { recursive: true });
	await writeFile(join(outputDir, 'cache-flush.md'), `${lines.join('\n')}\n`);

	// An invalid probe, not a breach: without it the gates below pass for any
	// flush, including one that never met the grown cache. It writes no status,
	// so the report fails it wherever it ran.
	expect(
		addedScans(shared),
		'the shared flush never walked the grown cache',
	).toBeGreaterThanOrEqual(minSharedScansAddedByGrowth);

	await writeFile(join(outputDir, 'cache-flush.status.txt'), status);

	expect(
		over.map((gate) => `${gate.name}: ${gate.value.toFixed(2)} > ${gate.ceiling}`),
		`gates exceeded:\n${over.map((gate) => gate.name).join('\n')}`,
	).toEqual([]);
});
