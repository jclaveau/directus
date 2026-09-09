import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Redis from 'ioredis';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { summarise, summaryRow, type Summary } from './measure.js';

/**
 * What the response cache costs and what it buys, on the request path.
 *
 * The startup bench beside this one compares two BUNDLES. This one compares four
 * CONFIGURATIONS of one bundle, measured against each other minutes apart on one
 * machine — because the question it answers is not "did this commit get slower" but
 * "does having the cache on make the app slower than not having it", and only an
 * uncached arm running on the same machine at the same time can answer that.
 *
 * That choice is also what makes the assertions at the bottom worth having. An
 * absolute millisecond figure belongs to the runner (the startup bench has measured
 * the same bundle at 4.5 s and 6.5 s depending on what else was running), so
 * nothing here asserts one. Every gate is a ratio between two arms sampled in the
 * same rep, which drift moves together and a real regression moves apart.
 *
 * The arms:
 *
 * - `off`          the floor. No cache at all: what a read costs when nothing helps
 *                  it and what a write costs when nothing has to be invalidated.
 * - `full`         upstream's behaviour — cache on, and every mutation flushes the
 *                  whole namespace.
 * - `scoped`       this fork's — cache on, and a mutation drops only the slices its
 *                  rows belong to.
 * - `scoped+stats` the same, with the cache-stats dashboard collecting. Its own arm
 *                  because it is off by default, so folding it into `scoped` would
 *                  charge every deployment for a feature most do not run.
 *
 * Latency is only half of it. Milliseconds on a shared runner are noisy, while the
 * number of Redis commands a request issues is exact and machine-independent — and
 * it is what latency becomes once Redis is a network hop away rather than a
 * container on the same host. So every phase is also counted, not just timed, and
 * the counts carry the tighter gates.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The bundle `pnpm --filter directus deploy` produces, as the startup bench uses:
// measuring a shape nobody deploys measures nothing.
const cli = process.env['PERF_CLI'] ?? join(root, 'dist', 'cli');

// Handed to `cli bootstrap` as ADMIN_TOKEN, so no login round trip stands between
// the harness and the first measurement.
const adminToken = process.env['PERF_ADMIN_TOKEN'] ?? 'bench-admin-token';

const redisUrl = process.env['PERF_REDIS'] ?? process.env['REDIS']
	?? 'redis://127.0.0.1:6108';

const basePort = Number(process.env['PERF_CACHE_BASE_PORT'] ?? 8300);

const outputDir = process.env['PERF_OUTPUT_DIR']
	?? join(root, 'tests', 'perf', 'results');

// A rep is one sample per arm per phase, and a read sample averages a batch of
// requests: a single request at this scale is a few milliseconds, where the timer's
// own resolution and one GC pause are a large fraction of the figure.
const reps = Number(process.env['PERF_CACHE_REPS'] ?? 9);
const batch = Number(process.env['PERF_CACHE_BATCH'] ?? 20);

// Writes get their own count because each sample re-warms the cache first, which
// costs `warmEntries` reads and dwarfs the write it is preparing for.
const writeReps = Number(process.env['PERF_CACHE_WRITE_REPS'] ?? 7);

// How many entries the cache holds when a write lands. Two sizes, because the
// interesting property is not either number but the slope between them: a
// whole-namespace flush pays for everything the cache holds, a slice purge does not.
const warmSizes = [25, 200];

const censusRequests = Number(process.env['PERF_CACHE_CENSUS_REQUESTS'] ?? 50);
const censusWriteReps = Number(process.env['PERF_CACHE_CENSUS_WRITE_REPS'] ?? 3);

const knobs = [
	['PERF_CACHE_REPS', reps],
	['PERF_CACHE_BATCH', batch],
	['PERF_CACHE_WRITE_REPS', writeReps],
	['PERF_CACHE_CENSUS_REQUESTS', censusRequests],
	['PERF_CACHE_CENSUS_WRITE_REPS', censusWriteReps],
] as const;

for (const [name, value] of knobs) {
	if (!Number.isFinite(value) || value < 1) {
		throw new Error(`${name} has to be a positive number, not ${String(value)}`);
	}
}

// The gates. Defaults are the loosest values that still fail on a real regression;
// the report prints every measured ratio beside its ceiling so they can be tightened
// against numbers rather than guesses.
const maxHitRatio = Number(process.env['PERF_CACHE_HIT_MAX_RATIO'] ?? 0.9);
const maxMissRatio = Number(process.env['PERF_CACHE_MISS_MAX_RATIO'] ?? 2);
const maxScopedVsFull = Number(process.env['PERF_CACHE_SCOPED_VS_FULL_MAX'] ?? 1.25);
const maxWriteScaling = Number(process.env['PERF_CACHE_WRITE_SCALING_MAX'] ?? 1.5);
const maxCommandsPerHit = Number(process.env['PERF_CACHE_MAX_COMMANDS_HIT'] ?? 4);
const maxCommandsPerFill = Number(process.env['PERF_CACHE_MAX_COMMANDS_FILL'] ?? 12);

const STATUS_HEADER = 'x-cache-status';
const NOTE = 'perf_note';
const AUTHOR = 'perf_author';
const COMPANY = 'perf_company';

const COMPANIES = 6;
const AUTHORS = 24;
const TENANTS = 8;
const NOTES_PER_TENANT = 250;

// Long enough that a wide read moves a payload worth compressing and serializing —
// a body of three short columns would measure the round trips and nothing else.
const BODY_FILLER = 'x'.repeat(200);

const tenants = Array.from({ length: TENANTS }, (_, index) => `t${index}`);

const authHeaders = {
	'Authorization': `Bearer ${adminToken}`,
	'Content-Type': 'application/json',
};

type Arm = {
	name: string;
	base: string;
	// `off` is measured on every phase — it is the comparison — but it has no cache
	// to clear, warm, or count commands for.
	cached: boolean;
	env: Record<string, string>;
	process?: ChildProcess;
};

const cachedArmEnv = {
	CACHE_ENABLED: 'true',
	CACHE_STORE: 'redis',
	CACHE_AUTO_PURGE: 'true',
	// Set so a series can prove it measured the path it is named after: a warm
	// series that never saw HIT measured a cold one four times over. It costs one
	// `setHeader` per response, where the tag headers would add a Redis write per
	// fill and a read per hit — so those stay off.
	CACHE_STATUS_HEADER: STATUS_HEADER,
};

const arms: Arm[] = [
	{ name: 'off', cached: false, base: '', env: { CACHE_ENABLED: 'false' } },
	{
		name: 'full',
		cached: true,
		base: '',
		env: { ...cachedArmEnv, CACHE_AUTO_PURGE_MODE: 'full' },
	},
	{
		name: 'scoped',
		cached: true,
		base: '',
		env: { ...cachedArmEnv, CACHE_AUTO_PURGE_MODE: 'scoped' },
	},
	{
		name: 'scoped+stats',
		cached: true,
		base: '',
		env: {
			...cachedArmEnv,
			CACHE_AUTO_PURGE_MODE: 'scoped',
			CACHE_STATS_ENABLED: 'true',
		},
	},
];

const readShapes = [
	{
		name: 'flat',
		path: (tenant: string) =>
			`/items/${NOTE}?filter[tenant][_eq]=${tenant}&limit=25`,
	},
	{
		// Two m2o hops, so the pins come off nested rows rather than off the filter.
		name: 'deep',
		path: (tenant: string) => {
			return `/items/${NOTE}?filter[tenant][_eq]=${tenant}&limit=25`
				+ `&fields=*,author.*,author.company.*`;
		},
	},
	{
		// 200 rows, so per-row pinning and the payload itself both count.
		name: 'wide',
		path: (tenant: string) =>
			`/items/${NOTE}?filter[tenant][_eq]=${tenant}&limit=200`,
	},
];

let noteIds: number[] = [];
let redis: Redis;

const timings = new Map<string, Map<string, number[]>>();

function record(phase: string, arm: string, value: number): void {
	const byArm = timings.get(phase) ?? new Map<string, number[]>();

	byArm.set(arm, [...(byArm.get(arm) ?? []), value]);
	timings.set(phase, byArm);
}

function seriesOf(phase: string, arm: string): Summary {
	const samples = timings.get(phase)?.get(arm);

	if (!samples) {
		throw new Error(`No samples for ${phase} on ${arm}.`);
	}

	return summarise(`${phase} / ${arm}`, samples);
}

async function api(
	base: string,
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

async function startInstance(
	name: string,
	port: number,
	env: Record<string, string>,
): Promise<ChildProcess> {
	const instance = spawn('node', [cli, 'start'], {
		env: {
			...process.env,
			NODE_ENV: 'production',
			SERVE_APP: 'false',
			LOG_LEVEL: 'warn',
			TELEMETRY: 'false',
			EXTENSIONS_PATH: join(root, 'tests', 'perf', 'cache-extensions'),
			PORT: String(port),
			PUBLIC_URL: `http://127.0.0.1:${port}`,
			...env,
		},
	});

	// A server that dies during boot answers nothing, so the poll below would spin
	// until the hook times out with no idea why. Keep its output for the failure.
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

		if (Date.now() > deadline) {
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

/**
 * Build the fixture from scratch every run.
 *
 * Dropped and recreated rather than reused: the row count and the spread across
 * tenants decide what every figure below means, so a leftover table from a run with
 * other knobs would silently rebase the whole report.
 */
async function seedFixture(base: string): Promise<void> {
	for (const collection of [NOTE, AUTHOR, COMPANY]) {
		const dropped = await fetch(`${base}/collections/${collection}`, {
			method: 'DELETE',
			headers: authHeaders,
		});

		await dropped.text();
	}

	const primaryKey = {
		field: 'id',
		type: 'integer',
		meta: { hidden: true },
		schema: { is_primary_key: true, has_auto_increment: true },
	};

	await api(base, '/collections', {
		method: 'POST',
		body: JSON.stringify([
			{
				collection: COMPANY,
				meta: { scoped_cache_fields: ['region'] },
				schema: {},
				fields: [
					primaryKey,
					{ field: 'region', type: 'string', meta: {}, schema: {} },
					{ field: 'name', type: 'string', meta: {}, schema: {} },
				],
			},
			{
				collection: AUTHOR,
				meta: { scoped_cache_fields: ['tenant'] },
				schema: {},
				fields: [
					primaryKey,
					{ field: 'tenant', type: 'string', meta: {}, schema: {} },
					{ field: 'name', type: 'string', meta: {}, schema: {} },
				],
			},
			{
				collection: NOTE,
				meta: { scoped_cache_fields: ['tenant'] },
				schema: {},
				fields: [
					primaryKey,
					{ field: 'tenant', type: 'string', meta: {}, schema: {} },
					{ field: 'label', type: 'string', meta: {}, schema: {} },
					{ field: 'body', type: 'text', meta: {}, schema: {} },
				],
			},
		]),
	});

	const m2oFields = [
		{ collection: AUTHOR, field: 'company', related: COMPANY },
		{ collection: NOTE, field: 'author', related: AUTHOR },
	];

	for (const { collection, field, related } of m2oFields) {
		await api(base, `/fields/${collection}`, {
			method: 'POST',
			body: JSON.stringify({
				field,
				type: 'integer',
				meta: { special: ['m2o'] },
				schema: {},
			}),
		});

		await api(base, '/relations', {
			method: 'POST',
			body: JSON.stringify({
				collection,
				field,
				related_collection: related,
				meta: {},
				schema: { on_delete: 'SET NULL' },
			}),
		});
	}

	const companies = await api(base, `/items/${COMPANY}?fields=id`, {
		method: 'POST',
		body: JSON.stringify(
			Array.from({ length: COMPANIES }, (_, index) => {
				return { region: `r${index % 3}`, name: `company ${index}` };
			}),
		),
	});

	const companyIds = companies.data.map((row: any) => row.id);

	const authors = await api(base, `/items/${AUTHOR}?fields=id`, {
		method: 'POST',
		body: JSON.stringify(
			Array.from({ length: AUTHORS }, (_, index) => {
				return {
					tenant: tenants[index % TENANTS],
					name: `author ${index}`,
					company: companyIds[index % COMPANIES],
				};
			}),
		),
	});

	const authorIds = authors.data.map((row: any) => row.id);

	const notes = tenants.flatMap((tenant, tenantIndex) => {
		return Array.from({ length: NOTES_PER_TENANT }, (_, index) => {
			return {
				tenant,
				label: `note ${tenantIndex}-${index}`,
				body: BODY_FILLER,
				author: authorIds[(tenantIndex * NOTES_PER_TENANT + index) % AUTHORS],
			};
		});
	});

	// Chunked: one insert of every row is a single statement wide enough to reach
	// postgres' 65535 bind parameters on a table this shape.
	for (let at = 0; at < notes.length; at += 500) {
		const created = await api(base, `/items/${NOTE}?fields=id`, {
			method: 'POST',
			body: JSON.stringify(notes.slice(at, at + 500)),
		});

		noteIds = [...noteIds, ...created.data.map((row: any) => row.id)];
	}
}

function clearResponseCache(arm: Arm): Promise<unknown> {
	if (!arm.cached) {
		return Promise.resolve();
	}

	return fetch(`${arm.base}/utils/cache/clear`, {
		method: 'POST',
		headers: authHeaders,
	}).then((response) => response.text());
}

type ReadSeries = { msPerRequest: number; statuses: Set<string> };

/**
 * Time a batch of identical reads and report the per-request mean, along with every
 * cache status the batch saw — which is what says the batch measured the path it is
 * named after rather than the other one.
 *
 * `cold` clears the arm's response cache before each request, outside the timer, so
 * every request in the batch is a fill. Warm batches instead take one untimed read
 * first: whatever ran before may have purged, and a batch whose first request is a
 * miss reports a median of two different things.
 */
async function timeReads(
	arm: Arm,
	path: string,
	cold: boolean,
): Promise<ReadSeries> {
	const statuses = new Set<string>();
	let total = 0;

	if (!cold) {
		await api(arm.base, path);
	}

	for (let index = 0; index < batch; index++) {
		if (cold) {
			await clearResponseCache(arm);
		}

		const startedAt = performance.now();
		const response = await fetch(`${arm.base}${path}`, { headers: authHeaders });
		const body = await response.text();
		total += performance.now() - startedAt;

		if (!response.ok) {
			throw new Error(
				`${arm.name} answered ${response.status} for ${path}:`
				+ ` ${body.slice(0, 200)}`,
			);
		}

		statuses.add(response.headers.get(STATUS_HEADER) ?? 'none');
	}

	return { msPerRequest: total / batch, statuses };
}

/**
 * Fill the arm's cache with `entries` entries, spread evenly over the tenants — so
 * the slice a write lands in holds a fraction of them while the namespace holds all
 * of them. That spread is the whole measurement: it is what a slice purge and a
 * namespace flush disagree about.
 *
 * Run against the uncached arm too, where it caches nothing. Not waste: it leaves
 * every arm's database equally warm before its write is timed, which a skipped warm
 * would not.
 */
async function warmCache(arm: Arm, entries: number): Promise<void> {
	for (let index = 0; index < entries; index++) {
		const tenant = tenants[index % TENANTS]!;
		const offset = Math.floor(index / TENANTS);

		await api(
			arm.base,
			`/items/${NOTE}?filter[tenant][_eq]=${tenant}&limit=25&offset=${offset}`,
		);
	}
}

async function timeWrite(arm: Arm, noteId: number): Promise<number> {
	const startedAt = performance.now();

	await api(arm.base, `/items/${NOTE}/${noteId}`, {
		method: 'PATCH',
		body: JSON.stringify({ label: `touched ${Date.now()}` }),
	});

	return performance.now() - startedAt;
}

type RedisCounters = {
	commands: number;
	byCommand: Record<string, number>;
	socketReads: number;
};

async function readRedisCounters(): Promise<RedisCounters> {
	const commandstats = await redis.info('commandstats');
	const stats = await redis.info('stats');

	const byCommand: Record<string, number> = {};
	let commands = 0;

	for (const line of commandstats.split('\n')) {
		const match = /^cmdstat_([^:]+):calls=(\d+)/.exec(line.trim());

		if (!match) {
			continue;
		}

		const calls = Number(match[2]);

		byCommand[match[1]!] = calls;
		commands += calls;
	}

	const socketReads = Number(/total_reads_processed:(\d+)/.exec(stats)?.[1] ?? 0);

	return { commands, byCommand, socketReads };
}

type CensusResult = {
	perRequest: number;
	top: string;
	socketReadsPerRequest: number;
};

/**
 * Count what one phase costs Redis, per request.
 *
 * Command counts are exact rather than sampled — the same request issues the same
 * commands every time — so a short window is enough, and the only pollution is what
 * the other instances do in the background while it runs. `idleFloor` is that,
 * measured on its own with nothing driving them, and subtracted here.
 */
async function census(
	run: () => Promise<void>,
	requests: number,
	idleFloor: number,
): Promise<CensusResult> {
	await redis.config('RESETSTAT');
	const startedAt = performance.now();

	await run();

	const elapsed = (performance.now() - startedAt) / 1000;
	const counted = await readRedisCounters();

	// The two `info` calls this census makes land in the same counters.
	const overhead = idleFloor * elapsed + 2;
	const net = Math.max(counted.commands - overhead, 0);

	const top = Object.entries(counted.byCommand)
		.sort(([, a], [, b]) => b - a)
		.slice(0, 6)
		.map(([name, calls]) => `${name} ${(calls / requests).toFixed(1)}`)
		.join(', ');

	return {
		perRequest: net / requests,
		top,
		socketReadsPerRequest: counted.socketReads / requests,
	};
}

async function measureIdleRedisFloor(): Promise<number> {
	await redis.config('RESETSTAT');
	await new Promise((wake) => setTimeout(wake, 3000));

	const counted = await readRedisCounters();

	return counted.commands / 3;
}

beforeAll(async () => {
	await mkdir(join(root, 'tests', 'perf', 'cache-extensions'), { recursive: true });

	// Seeded from an instance of its own, killed before any arm starts: the arms
	// cache the schema, and a collection created after they booted would reach some
	// of them through the bus and others only on their next reload.
	const seedPort = basePort + arms.length;

	const seedInstance = await startInstance('seed', seedPort, {
		CACHE_ENABLED: 'false',
	});

	await seedFixture(`http://127.0.0.1:${seedPort}`);

	seedInstance.kill('SIGTERM');
	await new Promise((closed) => seedInstance.on('close', closed));

	redis = new Redis(redisUrl);

	await Promise.all(arms.map(async (arm, index) => {
		const port = basePort + index;

		arm.base = `http://127.0.0.1:${port}`;

		arm.process = await startInstance(arm.name, port, {
			...arm.env,
			CACHE_NAMESPACE: `perf-cache-${index}`,
		});
	}));
}, 10 * 60 * 1000);

afterAll(async () => {
	for (const arm of arms) {
		arm.process?.kill('SIGTERM');
	}

	await redis?.quit().catch(() => undefined);
});

test('the cache costs less than what it replaces', async () => {
	const cachedArms = arms.filter((arm) => arm.cached);

	// Discarded: the first read of a shape pays for a plan the database has not
	// cached and a namespace Redis has never seen, and it would drag a short series.
	for (const arm of arms) {
		for (const shape of readShapes) {
			await timeReads(arm, shape.path(tenants[0]!), true);
		}
	}

	// Alternating arm by arm inside each rep, not one arm's whole series then the
	// next: whatever else the machine is doing drifts over minutes, and alternating
	// spreads that drift over every arm instead of handing it to whoever went last.
	for (let rep = 0; rep < reps; rep++) {
		const tenant = tenants[rep % TENANTS]!;

		for (const shape of readShapes) {
			for (const cold of [true, false]) {
				for (const arm of arms) {
					const phase = `${shape.name}:${cold
						? 'miss'
						: 'hit'}`;

					const series = await timeReads(arm, shape.path(tenant), cold);

					record(phase, arm.name, series.msPerRequest);

					// The vacuity guard. Without it a misconfigured arm measures the
					// same path four times and reports a flawless ratio: a warm series
					// that never saw a HIT is a cold series with another name.
					let expected = 'none';

					if (arm.cached) {
						expected = cold
							? 'MISS'
							: 'HIT';
					}

					expect(
						[...series.statuses],
						`${arm.name} ${phase} saw the wrong cache statuses`,
					).toEqual([expected]);
				}
			}
		}
	}

	for (let rep = 0; rep < writeReps; rep++) {
		for (const entries of warmSizes) {
			for (const arm of arms) {
				await warmCache(arm, entries);

				const noteId = noteIds[(rep * warmSizes.length) % noteIds.length]!;

				record(`write@${entries}`, arm.name, await timeWrite(arm, noteId));
			}
		}
	}

	const idleFloor = await measureIdleRedisFloor();
	const censuses = new Map<string, Map<string, string>>();

	function recordCensus(phase: string, arm: string, figure: string): void {
		const byArm = censuses.get(phase) ?? new Map<string, string>();

		byArm.set(arm, figure);
		censuses.set(phase, byArm);
	}

	const commandsPerHit = new Map<string, number>();
	const commandsPerFill = new Map<string, number>();

	// Serially, one arm at a time: the arms share a Redis, so two counted phases
	// running at once would each be reading the other's commands as their own.
	for (const arm of cachedArms) {
		await clearResponseCache(arm);

		// A distinct key per request rather than a clear between them: clearing is
		// itself a scan and a delete over the namespace, and it would be counted.
		const fill = await census(
			async () => {
				for (let index = 0; index < censusRequests; index++) {
					await api(
						arm.base,
						`/items/${NOTE}?filter[tenant][_eq]=t0&limit=25&offset=${index}`,
					);
				}
			},
			censusRequests,
			idleFloor,
		);

		commandsPerFill.set(arm.name, fill.perRequest);
		recordCensus('fill', arm.name, `${fill.perRequest.toFixed(1)} (${fill.top})`);

		const hitPath = `/items/${NOTE}?filter[tenant][_eq]=t1&limit=25`;
		await api(arm.base, hitPath);

		const hit = await census(
			async () => {
				for (let index = 0; index < censusRequests; index++) {
					await api(arm.base, hitPath);
				}
			},
			censusRequests,
			idleFloor,
		);

		commandsPerHit.set(arm.name, hit.perRequest);
		recordCensus('hit', arm.name, `${hit.perRequest.toFixed(1)} (${hit.top})`);

		const writeCounts: number[] = [];
		let writeTop = '';

		for (let rep = 0; rep < censusWriteReps; rep++) {
			// Warmed BEFORE the counters are reset, so the warm's own commands are
			// not charged to the write it sets the stage for.
			await warmCache(arm, warmSizes[1]!);

			const counted = await census(
				async () => {
					await timeWrite(arm, noteIds[rep]!);
				},
				1,
				idleFloor,
			);

			writeCounts.push(counted.perRequest);
			writeTop = counted.top;
		}

		const perWrite = summarise(`${arm.name} write`, writeCounts).median;

		recordCensus(
			`write@${warmSizes[1]}`,
			arm.name,
			`${perWrite.toFixed(1)} (${writeTop})`,
		);
	}

	const phases = [
		...readShapes.flatMap((shape) => [`${shape.name}:miss`, `${shape.name}:hit`]),
		...warmSizes.map((entries) => `write@${entries}`),
	];

	const head = (process.env['PERF_HEAD_SHA'] ?? 'local').slice(0, 10);

	const report: string[] = [
		'### Response cache — what it costs and what it buys',
		'',
		`Measured commit \`${head}\`, Node ${process.version}.`,
		'',
		`${reps} reps of ${batch} reads per arm per shape, ${writeReps} timed writes`
		+ ` per warm size, arms alternating. Fixture:`
		+ ` ${TENANTS * NOTES_PER_TENANT} rows over ${TENANTS} tenants.`,
		'',
	];

	for (const phase of phases) {
		const floor = seriesOf(phase, 'off').median;

		report.push(
			`#### ${phase}`,
			'',
			'| arm | min | median | p95 | max | vs `off` |',
			'| --- | ---: | ---: | ---: | ---: | ---: |',
		);

		for (const arm of arms) {
			const summary = seriesOf(phase, arm.name);
			const ratio = (summary.median / floor).toFixed(2);
			const row = summaryRow(summary).replace(`${phase} / `, '');

			report.push(`${row} ${ratio}x |`);
		}

		report.push('');
	}

	report.push(
		'#### Redis commands per request',
		'',
		`Net of a ${idleFloor.toFixed(1)}/s background floor measured idle. Counts are`
		+ ' exact, not sampled: they are what the latency above becomes once Redis is'
		+ ' a network hop rather than a container on the same host.',
		'',
		`| phase | ${cachedArms.map((arm) => arm.name).join(' | ')} |`,
		`| --- | ${cachedArms.map(() => '---').join(' | ')} |`,
	);

	for (const [phase, byArm] of censuses) {
		const cells = cachedArms.map((arm) => byArm.get(arm.name) ?? '—');

		report.push(`| ${phase} | ${cells.join(' | ')} |`);
	}

	const verdicts: string[] = [];

	function verdict(label: string, value: number, ceiling: number): void {
		const mark = value <= ceiling
			? 'ok'
			: 'OVER';

		verdicts.push(`| ${label} | ${value.toFixed(2)} | ${ceiling} | ${mark} |`);
	}

	for (const shape of readShapes) {
		const floor = seriesOf(`${shape.name}:miss`, 'off').median;

		verdict(
			`${shape.name}: a scoped HIT against no cache at all`,
			seriesOf(`${shape.name}:hit`, 'scoped').median / floor,
			maxHitRatio,
		);

		verdict(
			`${shape.name}: a scoped MISS against no cache at all`,
			seriesOf(`${shape.name}:miss`, 'scoped').median / floor,
			maxMissRatio,
		);

		verdict(
			`${shape.name}: a scoped HIT against a full-mode HIT`,
			seriesOf(`${shape.name}:hit`, 'scoped').median
			/ seriesOf(`${shape.name}:hit`, 'full').median,
			maxScopedVsFull,
		);
	}

	verdict(
		`a scoped write over ${warmSizes[1]} entries against one over ${warmSizes[0]}`,
		seriesOf(`write@${warmSizes[1]}`, 'scoped').median
		/ seriesOf(`write@${warmSizes[0]}`, 'scoped').median,
		maxWriteScaling,
	);

	verdict(
		'Redis commands per scoped HIT',
		commandsPerHit.get('scoped')!,
		maxCommandsPerHit,
	);

	verdict(
		'Redis commands per scoped fill',
		commandsPerFill.get('scoped')!,
		maxCommandsPerFill,
	);

	report.push(
		'',
		'#### Gates',
		'',
		'| ratio | measured | ceiling | |',
		'| --- | ---: | ---: | --- |',
		...verdicts,
		'',
	);

	await mkdir(outputDir, { recursive: true });

	const result = {
		commit: process.env['PERF_HEAD_SHA'] ?? 'local',
		node: process.version,
		measuredAt: new Date().toISOString(),
		reps,
		batch,
		writeReps,
		fixture: {
			tenants: TENANTS,
			notes: TENANTS * NOTES_PER_TENANT,
			warmSizes,
		},
		idleRedisCommandsPerSecond: idleFloor,
		series: Object.fromEntries(
			phases.map((phase) => {
				const byArm = arms.map((arm) => [arm.name, seriesOf(phase, arm.name)]);

				return [phase, Object.fromEntries(byArm)];
			}),
		),
		redisCommandsPerRequest: {
			hit: Object.fromEntries(commandsPerHit),
			fill: Object.fromEntries(commandsPerFill),
		},
	};

	await writeFile(
		join(outputDir, 'cache.json'),
		`${JSON.stringify(result, null, 2)}\n`,
	);

	await writeFile(join(outputDir, 'cache.md'), `${report.join('\n')}\n`);

	// One line for whoever is reading a commit rather than a run: CI copies it into
	// the commit status verbatim, so it has to stand alone.
	const hitMs = seriesOf('flat:hit', 'scoped').median;
	const uncachedMs = seriesOf('flat:miss', 'off').median;

	await writeFile(
		join(outputDir, 'cache.status.txt'),
		`flat hit ${hitMs.toFixed(1)} ms vs ${uncachedMs.toFixed(1)} ms uncached`
		+ ` (${(hitMs / uncachedMs).toFixed(2)}x),`
		+ ` ${commandsPerHit.get('scoped')!.toFixed(1)} redis cmd/hit\n`,
	);

	const over = verdicts.filter((line) => line.endsWith('OVER |'));

	expect(over, `gates exceeded:\n${over.join('\n')}`).toEqual([]);
}, 30 * 60 * 1000);
