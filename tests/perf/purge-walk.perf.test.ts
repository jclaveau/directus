import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import Redis from 'ioredis';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { summarise } from './measure.js';

/**
 * What a collection-wide purge costs per index set it walks.
 *
 * On 2026-10-01 production's collection-wide purges took about 5 ms per set:
 * 5.6 s at 1k-2k sets, 27 s past 4k, 90 s with about 21 of them running at once.
 * They came from the planner's sort endpoint on `student_course`, whose index
 * holds about 1.3k sets; #589 moves a sort onto the index path, and cascades,
 * upsert takeovers and keyless raw purges still walk. A hook's `purgeBy` on a
 * field the index is not split by walks the same sets, and took up to 48 s.
 *
 * Each arm seeds one collection with N sets of M entries — one set per row, the
 * row pinned as a home pin, about a kilobyte of pins beside it — and measures:
 *
 * - A: one collection-wide purge per N, with the Redis commands it sent;
 * - B: K purges of the same collection started at once, from one process, then
 *   spread over several;
 * - C: a declared purge on a field off the index path, per N;
 * - D: a one-row write while B's largest K runs, against the same write alone;
 * - a control: the collection-wide purge of an empty index.
 *
 * Every instance reaches Redis through a proxy adding `PERF_WALK_REDIS_DELAY_MS`
 * to each round trip, so a walk paying one round trip per set shows it the way
 * production's network does. The bench's own client goes direct.
 *
 * Before any purge is measured, the collection's index-key set has to be marked
 * complete: an unmarked index sends the purge to a keyspace SCAN, which is not
 * the walk measured here.
 *
 * Two arms when `PERF_BASELINE_CLI` is set, the head's and the baseline's, each
 * cell reported as `head vs baseline`. Reports, gates nothing.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const adminToken = process.env['PERF_ADMIN_TOKEN'] ?? 'bench-admin-token';

const redisUrl = process.env['PERF_REDIS'] ?? process.env['REDIS']
	?? 'redis://127.0.0.1:6108';

const outputDir = process.env['PERF_OUTPUT_DIR']
	?? join(root, 'tests', 'perf', 'results');

function numberList(name: string, fallback: string): number[] {
	return (process.env[name] ?? fallback).split(',').map(Number);
}

const setCounts = numberList('PERF_WALK_SETS', '500,1000,2000,4000,8000');
const membersPerSet = Number(process.env['PERF_WALK_MEMBERS'] ?? 5);
const concurrencies = numberList('PERF_WALK_CONCURRENCY', '1,3,8,20');
const concurrentSets = Number(process.env['PERF_WALK_CONCURRENT_SETS'] ?? 2000);
const processCount = Number(process.env['PERF_WALK_PROCESSES'] ?? 3);
const repetitions = Number(process.env['PERF_WALK_REPS'] ?? 2);
const redisDelayMs = Number(process.env['PERF_WALK_REDIS_DELAY_MS'] ?? 1);
const basePort = Number(process.env['PERF_WALK_PORT'] ?? 8340);

const ARMS = [
	{ armName: 'head', cli: process.env['PERF_CLI'] ?? join(root, 'dist', 'cli') },
	...process.env['PERF_BASELINE_CLI']
		? [{ armName: 'baseline', cli: process.env['PERF_BASELINE_CLI'] }]
		: [],
];

const NAMESPACE = 'perf-purge-walk';
const COLLECTION = 'perf_walk';
const ROW_WRITES = 5;

const authHeaders = {
	'Authorization': `Bearer ${adminToken}`,
	'Content-Type': 'application/json',
};

const benchStartedAt = performance.now();

// The job log shows how far a run got: one that times out writes no report.
function logProgress(step: string): void {
	const elapsedS = ((performance.now() - benchStartedAt) / 1000).toFixed(0);

	// eslint-disable-next-line no-console
	console.info(`[purge-walk ${elapsedS}s] ${step}`);
}

let redis: Redis;
let delayProxy: Server;
let proxyPort = 0;

/**
 * A TCP relay to Redis holding every chunk `delayMs / 2` each way, in order:
 * timers of one delay fire in the order they were set.
 */
async function startDelayProxy(delayMs: number): Promise<Server> {
	const target = new URL(redisUrl);
	const halfDelayMs = delayMs / 2;
	const sockets = new Set<Socket>();

	function relay(from: Socket, to: Socket): void {
		from.on('data', (chunk) => {
			if (halfDelayMs === 0) {
				to.write(chunk);

				return;
			}

			setTimeout(() => to.write(chunk), halfDelayMs);
		});

		from.on('close', () => to.destroy());
		from.on('error', () => to.destroy());
	}

	const server = createServer((client) => {
		const upstream = createConnection(
			Number(target.port || 6379),
			target.hostname,
		);

		sockets.add(client);
		sockets.add(upstream);
		client.on('close', () => sockets.delete(client));
		upstream.on('close', () => sockets.delete(upstream));
		relay(client, upstream);
		relay(upstream, client);
	});

	server.on('close', () => {
		for (const socket of sockets) {
			socket.destroy();
		}
	});

	await new Promise<void>((listening) => {
		server.listen(0, '127.0.0.1', () => listening());
	});

	return server;
}

function proxiedRedisUrl(): string {
	const target = new URL(redisUrl);

	target.hostname = '127.0.0.1';
	target.port = String(proxyPort);

	return target.toString();
}

function baseOf(port: number): string {
	return `http://127.0.0.1:${port}`;
}

async function api(
	port: number,
	path: string,
	init: { method?: string; body?: unknown } = {},
): Promise<any> {
	const response = await fetch(`${baseOf(port)}${path}`, {
		method: init.method ?? 'GET',
		headers: authHeaders,
		...(init.body === undefined
			? {}
			: { body: JSON.stringify(init.body) }),
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

async function startInstance(cli: string, port: number): Promise<ChildProcess> {
	const spawned = spawn('node', [cli, 'start'], {
		env: {
			...process.env,
			NODE_ENV: 'production',
			SERVE_APP: 'false',
			LOG_LEVEL: 'warn',
			TELEMETRY: 'false',
			EXTENSIONS_PATH: join(root, 'tests', 'perf', 'purge-extensions'),
			PORT: String(port),
			PUBLIC_URL: baseOf(port),
			REDIS: proxiedRedisUrl(),
			CACHE_ENABLED: 'true',
			CACHE_STORE: 'redis',
			CACHE_AUTO_PURGE: 'true',
			CACHE_AUTO_PURGE_MODE: 'scoped',
			CACHE_TTL: '6h',
			CACHE_SCOPED_INDEX_REAP_SCHEDULE: 'off',
			// Its own namespace, for the reason purge-scaling has one: the job's
			// `cli bootstrap` opened a fill pause in the default one.
			CACHE_NAMESPACE: NAMESPACE,
			CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX: '0',
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
			const response = await fetch(`${baseOf(port)}/server/ping`);

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

async function stopInstance(instance: ChildProcess): Promise<void> {
	if (instance.exitCode !== null) {
		return;
	}

	const exited = new Promise((done) => instance.once('exit', done));

	instance.kill('SIGTERM');
	await exited;
}

/**
 * Indexed on `course`, which no seeded entry pins: each is filed under its row's
 * home pin, one set per row, the way production's reads pinning
 * `student_course` by id are.
 */
async function seedCollection(port: number): Promise<number> {
	const dropped = await fetch(`${baseOf(port)}/collections/${COLLECTION}`, {
		method: 'DELETE',
		headers: authHeaders,
	});

	await dropped.text();

	await api(port, '/collections', {
		method: 'POST',
		body: {
			collection: COLLECTION,
			meta: { scoped_cache_fields: ['course'] },
			schema: {},
			fields: [
				{
					field: 'id',
					type: 'integer',
					meta: { hidden: true },
					schema: { is_primary_key: true, has_auto_increment: true },
				},
				{ field: 'course', type: 'string', meta: {}, schema: {} },
				{ field: 'student', type: 'integer', meta: {}, schema: {} },
				{ field: 'course_part', type: 'integer', meta: {}, schema: {} },
				{ field: 'status', type: 'string', meta: {}, schema: {} },
				{ field: 'label', type: 'string', meta: {}, schema: {} },
			],
		},
	});

	const created = await api(port, `/items/${COLLECTION}?fields=id`, {
		method: 'POST',
		body: { course: 'c1', student: 1, course_part: 1, status: 'active' },
	});

	return created.data.id;
}

type CommandStats = { commands: number; redisMs: number };

async function readCommandStats(): Promise<CommandStats> {
	const commandstats = await redis.info('commandstats');
	let commands = 0;
	let usec = 0;

	for (const line of commandstats.split('\n')) {
		const match = /^cmdstat_([^:]+):calls=(\d+),usec=(\d+)/.exec(line.trim());

		// The bench's own reads land in the same counters.
		if (!match || match[1] === 'info' || match[1]!.startsWith('config')) {
			continue;
		}

		commands += Number(match[2]);
		usec += Number(match[3]);
	}

	return { commands, redisMs: usec / 1000 };
}

/** Every set of the collection's index, the registry included. */
async function countIndexSets(): Promise<number> {
	let cursor = '0';
	let sets = 0;

	do {
		const [next, keys] = await redis.scan(
			cursor,
			'MATCH',
			`${NAMESPACE}:scoped-cache-index:*${COLLECTION}*`,
			'COUNT',
			1000,
		);

		cursor = next;
		sets += keys.length;
	}
	while (cursor !== '0');

	return sets;
}

/**
 * The reap marks the index-key sets complete; a purge reading an unmarked
 * index scans the keyspace instead, which is not what is measured.
 */
async function assertRegistryPath(port: number): Promise<void> {
	const { markerKey, generationKey } = await api(port, '/perf-cache-fill/reap', {
		method: 'POST',
	});

	expect(
		await redis.get(markerKey),
		'the index-key sets are marked complete, so the purge reads the registry',
	)
		.toBe(await redis.get(generationKey));
}

type PurgeAnswer = {
	durationsMs: number[];
	wallMs: number;
	cpuMs: number;
	maxLoopDelayMs: number;
};

function purge(
	port: number,
	kind: 'collection' | 'declared',
	concurrent: number,
): Promise<PurgeAnswer> {
	return api(port, '/perf-index-walk/purge', {
		method: 'POST',
		body: { collection: COLLECTION, kind, concurrent },
	});
}

async function seedIndex(port: number, sets: number): Promise<void> {
	// Whatever an earlier step left goes first, unmeasured.
	await purge(port, 'collection', 1);

	await api(port, '/perf-index-walk/seed', {
		method: 'POST',
		body: { collection: COLLECTION, sets, members: membersPerSet },
	});

	await assertRegistryPath(port);
	logProgress(`seeded ${sets} sets`);
}

async function timeRowWrite(
	port: number,
	rowId: number,
	at: number,
): Promise<number> {
	const startedAt = performance.now();

	await api(port, `/items/${COLLECTION}/${rowId}?fields=id`, {
		method: 'PATCH',
		body: { label: `write ${at}` },
	});

	return performance.now() - startedAt;
}

type WalkSample = {
	sets: number;
	durationMs: number;
	commands: number;
	redisMs: number;
	cpuMs: number;
	maxLoopDelayMs: number;
	setsLeft: number;
};

type ConcurrentSample = {
	concurrent: number;
	processes: number;
	p50Ms: number;
	maxMs: number;
};

type ArmResult = {
	armName: string;
	control: WalkSample;
	collectionBySets: Map<number, WalkSample[]>;
	declaredBySets: Map<number, WalkSample[]>;
	concurrent: ConcurrentSample[];
	rowWriteAloneMs: number;
	rowWriteDuringMs: number;
	rowWriteDuringConcurrent: number;
};

async function timeWalk(
	port: number,
	kind: 'collection' | 'declared',
	sets: number,
): Promise<WalkSample> {
	await redis.config('RESETSTAT');
	const answer = await purge(port, kind, 1);
	const stats = await readCommandStats();

	logProgress(
		`${kind} purge of ${sets} sets: ${answer.durationsMs[0]!.toFixed(0)} ms,`
		+ ` ${stats.commands} commands`,
	);

	return {
		sets,
		durationMs: answer.durationsMs[0]!,
		commands: stats.commands,
		redisMs: stats.redisMs,
		cpuMs: answer.cpuMs,
		maxLoopDelayMs: answer.maxLoopDelayMs,
		setsLeft: await countIndexSets(),
	};
}

async function measureArm(armName: string, cli: string): Promise<ArmResult> {
	const ports = Array.from({ length: processCount }, (_, at) => basePort + at);
	const instances: ChildProcess[] = [];

	try {
		instances.push(await startInstance(cli, ports[0]!));
		const rowId = await seedCollection(ports[0]!);

		// After the collection exists, so every one boots on the schema holding it.
		for (const port of ports.slice(1)) {
			instances.push(await startInstance(cli, port));
		}

		await seedIndex(ports[0]!, 0);
		const control = await timeWalk(ports[0]!, 'collection', 0);

		const collectionBySets = new Map<number, WalkSample[]>();
		const declaredBySets = new Map<number, WalkSample[]>();

		for (const sets of setCounts) {
			const collectionSamples: WalkSample[] = [];
			const declaredSamples: WalkSample[] = [];

			for (let rep = 0; rep < repetitions; rep++) {
				await seedIndex(ports[0]!, sets);
				collectionSamples.push(await timeWalk(ports[0]!, 'collection', sets));

				await seedIndex(ports[0]!, sets);
				declaredSamples.push(await timeWalk(ports[0]!, 'declared', sets));
			}

			collectionBySets.set(sets, collectionSamples);
			declaredBySets.set(sets, declaredSamples);
		}

		const concurrent: ConcurrentSample[] = [];

		for (const processes of [1, processCount]) {
			for (const concurrency of concurrencies) {
				await seedIndex(ports[0]!, concurrentSets);

				// Round-robin over the processes, each starting its share at once.
				const answers = await Promise.all(
					ports
						.slice(0, processes)
						.map((port, at) => {
							const remainder = at < concurrency % processes
								? 1
								: 0;

							return {
								port,
								share: Math.floor(concurrency / processes) + remainder,
							};
						})
						.filter(({ share }) => share > 0)
						.map(({ port, share }) => purge(port, 'collection', share)),
				);

				const durations = answers.flatMap((answer) => answer.durationsMs);

				logProgress(
					`${concurrency} purges over ${processes} process(es):`
					+ ` max ${Math.max(...durations).toFixed(0)} ms`,
				);

				concurrent.push({
					concurrent: concurrency,
					processes,
					p50Ms: summarise(`K=${concurrency}`, durations).median,
					maxMs: Math.max(...durations),
				});
			}
		}

		const aloneMs: number[] = [];

		for (let at = 0; at < ROW_WRITES; at++) {
			aloneMs.push(await timeRowWrite(ports[0]!, rowId, at));
		}

		// The write starts once the walks have, on the process running them.
		const rowWriteDuringConcurrent = Math.max(...concurrencies);
		const duringMs: number[] = [];

		for (let at = 0; at < ROW_WRITES; at++) {
			await seedIndex(ports[0]!, concurrentSets);

			const walks = purge(ports[0]!, 'collection', rowWriteDuringConcurrent);
			await new Promise((wake) => setTimeout(wake, 100));
			duringMs.push(await timeRowWrite(ports[0]!, rowId, ROW_WRITES + at));
			await walks;
		}

		return {
			armName,
			control,
			collectionBySets,
			declaredBySets,
			concurrent,
			rowWriteAloneMs: summarise('row write alone', aloneMs).median,
			rowWriteDuringMs: summarise('row write during', duringMs).median,
			rowWriteDuringConcurrent,
		};
	}
	finally {
		await Promise.all(instances.map(stopInstance));
	}
}

function medianOf(
	samples: WalkSample[],
	pick: (sample: WalkSample) => number,
): number {
	return summarise('walk', samples.map(pick)).median;
}

function cell(head: number, baseline: number | undefined, unit: string): string {
	const rounded = (value: number): string => {
		return value >= 100
			? value.toFixed(0)
			: value.toFixed(2);
	};

	if (baseline === undefined) {
		return `${rounded(head)} ${unit}`;
	}

	const ratio = baseline === 0
		? '–'
		: `${(head / baseline).toFixed(2)}x`;

	return `${rounded(head)} vs ${rounded(baseline)} ${unit} (${ratio})`;
}

function walkRows(
	label: string,
	head: Map<number, WalkSample[]>,
	baseline: Map<number, WalkSample[]> | undefined,
): string[] {
	return setCounts.map((sets) => {
		const headSamples = head.get(sets)!;
		const baselineSamples = baseline?.get(sets);

		const pick = (picker: (sample: WalkSample) => number) => {
			return [
				medianOf(headSamples, picker),
				baselineSamples === undefined
					? undefined
					: medianOf(baselineSamples, picker),
			] as const;
		};

		const [duration, baselineDuration] = pick((sample) => sample.durationMs);

		const [perSet, baselinePerSet] = pick((sample) => {
			return sample.durationMs / sample.sets;
		});

		const [commands, baselineCommands] = pick((sample) => sample.commands);
		const [redisMs, baselineRedisMs] = pick((sample) => sample.redisMs);
		const [cpuMs, baselineCpuMs] = pick((sample) => sample.cpuMs);
		const [loopMs, baselineLoopMs] = pick((sample) => sample.maxLoopDelayMs);

		const setsLeft = Math.max(
			...headSamples.map((sample) => sample.setsLeft),
			...(baselineSamples ?? []).map((sample) => sample.setsLeft),
		);

		return `| ${label} | ${sets} | ${cell(duration, baselineDuration, 'ms')}`
			+ ` | ${cell(perSet, baselinePerSet, 'ms')}`
			+ ` | ${cell(commands, baselineCommands, 'cmds')}`
			+ ` | ${cell(redisMs, baselineRedisMs, 'ms')}`
			+ ` | ${cell(cpuMs, baselineCpuMs, 'ms')}`
			+ ` | ${cell(loopMs, baselineLoopMs, 'ms')} | ${setsLeft} |`;
	});
}

function writeReport(results: ArmResult[]): string[] {
	const [head, baseline] = results as [ArmResult, ArmResult | undefined];

	const arms = baseline === undefined
		? `\`${head.armName}\` only.`
		: `Each cell \`${head.armName} vs ${baseline.armName}\`.`;

	const lines = [
		'### Collection purge walk',
		'',
		`${membersPerSet} entries per set, about 1 KB of pins each; every instance`
		+ ` reaches Redis through ${redisDelayMs} ms of added round trip.`
		+ ` ${arms} Medians of ${repetitions}.`,
		'',
		`Control, an empty index: ${cell(
			head.control.durationMs,
			baseline?.control.durationMs,
			'ms',
		)}, ${cell(head.control.commands, baseline?.control.commands, 'cmds')}.`,
		'',
		'| purge | sets | duration | per set | Redis commands | Redis time'
		+ ' | api CPU | longest loop block | index keys left |',
		'| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
		...walkRows('collection', head.collectionBySets, baseline?.collectionBySets),
		...walkRows('declared', head.declaredBySets, baseline?.declaredBySets),
		'',
		`K purges of one collection of ${concurrentSets} sets started at once.`,
		'',
		'| K | processes | p50 | max |',
		'| --- | --- | --- | --- |',
		...head.concurrent.map((sample, at) => {
			const baselineSample = baseline?.concurrent[at];

			return `| ${sample.concurrent} | ${sample.processes}`
				+ ` | ${cell(sample.p50Ms, baselineSample?.p50Ms, 'ms')}`
				+ ` | ${cell(sample.maxMs, baselineSample?.maxMs, 'ms')} |`;
		}),
		'',
		`A one-row write, median of ${ROW_WRITES}, alone: ${cell(
			head.rowWriteAloneMs,
			baseline?.rowWriteAloneMs,
			'ms',
		)}; while ${head.rowWriteDuringConcurrent} purges walk on the same`
		+ ` process: ${cell(
			head.rowWriteDuringMs,
			baseline?.rowWriteDuringMs,
			'ms',
		)}.`,
	];

	return lines;
}

beforeAll(async () => {
	redis = new Redis(redisUrl, { lazyConnect: false });
	delayProxy = await startDelayProxy(redisDelayMs);
	proxyPort = (delayProxy.address() as { port: number }).port;
});

afterAll(async () => {
	redis?.disconnect();
	await new Promise((closed) => delayProxy?.close(closed));
});

test('a collection purge walks its index', async () => {
	const results: ArmResult[] = [];

	for (const { armName, cli } of ARMS) {
		logProgress(`arm ${armName}`);
		results.push(await measureArm(armName, cli));
	}

	const report = writeReport(results);

	await mkdir(outputDir, { recursive: true });
	await writeFile(join(outputDir, 'purge-walk.md'), `${report.join('\n')}\n`);
	// eslint-disable-next-line no-console
	console.info(report.join('\n'));

	for (const { collectionBySets } of results) {
		for (const samples of collectionBySets.values()) {
			for (const sample of samples) {
				expect(sample.setsLeft, 'a collection purge leaves no index set').toBe(0);
			}
		}
	}
}, 190 * 60 * 1000);
