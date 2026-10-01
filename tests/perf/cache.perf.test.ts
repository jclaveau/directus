import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
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
 *
 * A local Redis also hides CPU: each command costs the server an encode, a promise
 * and a reply parse, which stays a few milliseconds here and becomes vCPU under 32
 * production workers. So each arm's server process is also charged the CPU time a
 * request costs it, and that is gated against `off` like the latencies.
 *
 * Two rules keep these gates able to stop a regression rather than record one:
 *
 * 1. The bench lands before the change it measures. When a PR changes what the
 *    cache costs, the arm that measures that cost goes in first, in a PR of its
 *    own merged to the trunk, so the change is compared against a trunk number.
 *    A gate written on the branch that pays the cost is set from that cost.
 * 2. A ceiling is raised only with the maintainer's explicit OK, and the commit
 *    that raises it states the figure before, the figure after, and why. A raise
 *    whose only reason is that the run was red is refused.
 *
 * `workflow_dispatch` on bench.yml with `ref` measures any commit with the bench
 * of the dispatched branch, which is how a new arm gets its trunk baseline.
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

// Unlike a command count, CPU time is noisy, so it is sampled several times with
// the arms alternating, and the fastest sample is gated: whatever else the runner
// does only adds CPU time to a sample, so the minimum is the steadiest reading.
// The median moved 1.64x to 2.24x on scoped fan fill across runs of one trunk.
const cpuReps = Number(process.env['PERF_CACHE_CPU_REPS'] ?? 9);

// At most 50: the fan sample walks `offset` for a fresh key per request, and past
// 50 a tenant's 250 notes no longer fill a 200-row page.
const cpuRequests = Number(process.env['PERF_CACHE_CPU_REQUESTS'] ?? 40);

const knobs = [
	['PERF_CACHE_REPS', reps],
	['PERF_CACHE_BATCH', batch],
	['PERF_CACHE_WRITE_REPS', writeReps],
	['PERF_CACHE_CENSUS_REQUESTS', censusRequests],
	['PERF_CACHE_CENSUS_WRITE_REPS', censusWriteReps],
	['PERF_CACHE_CPU_REPS', cpuReps],
	['PERF_CACHE_CPU_REQUESTS', cpuRequests],
] as const;

for (const [name, value] of knobs) {
	if (!Number.isFinite(value) || value < 1) {
		throw new Error(`${name} has to be a positive number, not ${String(value)}`);
	}
}

if (cpuRequests > 50) {
	throw new Error(`PERF_CACHE_CPU_REQUESTS is at most 50, not ${cpuRequests}`);
}

// Two kinds of gate.
//
// Ratchets: each ceiling is what the previous run measured plus a margin for the
// runner's own drift, so the suite fails when the cache gets worse. A ratchet only
// catches the next step up: a cost already there on its first run is its baseline.
//
// Absolute ceilings: the Redis commands a request adds over `off` are held to the
// target, whatever any run measured. Counts are exact, so a target is as stable a
// gate as a ratchet. The latency targets stay under Headroom, which gates nothing.
const maxWriteScaling = Number(process.env['PERF_CACHE_WRITE_SCALING_MAX'] ?? 1.5);
const maxCommandsPerHit = Number(process.env['PERF_CACHE_MAX_COMMANDS_HIT'] ?? 2);
const maxCommandsPerFill = Number(process.env['PERF_CACHE_MAX_COMMANDS_FILL'] ?? 15);

// The fan fill is where the tagging cost lives: a read pinned per row writes a tag
// set per row. Gated on both counts, because the two moved for different reasons —
// grouping a collection's slices into one index call halved the commands, and
// sending the tag script by hash cut the bytes without touching the count.
// Down from 500: 446 measured with the fan read's 200 authors pinned by key under
// the default pin cap of 250. A cap of 64 falls back to their 8 tenant slices and
// measured 31, both counted in all rather than over an uncached read (#392).
const maxCommandsPerFanFill =
	Number(process.env['PERF_CACHE_MAX_COMMANDS_FAN_FILL'] ?? 460);

const maxKilobytesPerFanFill =
	// Down from 78: 57.1 KB measured, 12.8 under a pin cap of 64 (#392).
	Number(process.env['PERF_CACHE_MAX_KB_FAN_FILL'] ?? 60);

const maxWriteCommandScaling =
	// Down from 3.2 now that a purge sends one UNLINK per 500 keys rather than one
	// per key: a write over 200 entries and one over 25 both cost 14 commands, so
	// what this gates is a return to a purge whose cost tracks the cache's size.
	Number(process.env['PERF_CACHE_WRITE_COMMAND_SCALING_MAX'] ?? 1.1);

// The target every shape is held to in Headroom, whatever its own ratchet allows.
const targetMissVsOff = 1.85;
const targetMissVsFull = 1.45;

// The absolute ceilings. What the counts would be with the response cache alone
// paying for itself: two reads on a hit, and on a fill the value and its sidecar
// around the read. A fan fill is held to the flat fill's: a read's cost to Redis
// should not grow with the number of rows it returns. `full` is held to them;
// `scoped` pays for its filing on top, and its fills are held to their own pair
// below until the index stops costing a set per pin (#587).
const maxCommandsAddedPerHit =
	Number(process.env['PERF_CACHE_MAX_COMMANDS_ADDED_HIT'] ?? 2);

const maxCommandsAddedPerFill =
	Number(process.env['PERF_CACHE_MAX_COMMANDS_ADDED_FILL'] ?? 7);

const maxCommandsAddedPerFanFill =
	Number(process.env['PERF_CACHE_MAX_COMMANDS_ADDED_FAN_FILL'] ?? 7);

// A scoped fill adds the epoch capture, its re-read, and the filing script: the
// script plus a TTL, SADD and EXPIRE per index set, and the same three on the
// set naming them. One set on a flat fill, 10.99 to 11.08 measured over three
// runs of one build, so the gate sits a command above. The fan read pins its
// 200 authors by key under the default pin cap, a set each, 446 measured: Redis
// has no SADD over many keys, so that is the floor of a key pin (#392).
const maxCommandsAddedPerScopedFill =
	Number(process.env['PERF_CACHE_MAX_COMMANDS_ADDED_SCOPED_FILL'] ?? 12);

const maxCommandsAddedPerScopedFanFill =
	Number(process.env['PERF_CACHE_MAX_COMMANDS_ADDED_SCOPED_FAN_FILL'] ?? 460);

// A purge that drops one slice should cost the same however much the cache holds.
const targetWriteCommandScaling = 1.5;

// CPU time a request costs the server, the fastest sample as a ratio to the
// fastest on `off`. Trunk's worst plus the ~0.3 one ratio moves between runs of
// unchanged code: over four runs trunk measured fill 1.58, fan fill 1.61 and
// hit 1.09 at worst, where the pin before #438 measured fan fill 2.20.
const cpuCeilings: Record<string, Record<CpuPhase, number>> = {
	full: { fill: 1.85, fanFill: 1.85, hit: 1.35 },
	scoped: { fill: 1.85, fanFill: 1.85, hit: 1.35 },
};

const STATUS_HEADER = 'x-cache-status';
const NOTE = 'perf_note';
const AUTHOR = 'perf_author';
const COMPANY = 'perf_company';

const COMPANIES = 6;
const AUTHORS = 250;
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
	// Every arm boots a build its namespace has not recorded, and a deploy's fill
	// pause would serve its warm series cold.
	CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX: '0',
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

// Each rep starts one arm further along, so no arm always goes first.
function armsInRepOrder(rep: number): Arm[] {
	const firstArm = rep % arms.length;

	return [...arms.slice(firstArm), ...arms.slice(0, firstArm)];
}

const readShapes = [
	{
		name: 'flat',
		// missVsOff up from 1.60: trunk alone measured 1.45 to 1.65 over five runs.
		ceilings: { hitVsOff: 1.05, missVsOff: 1.75, hitVsFull: 1.20, missVsFull: 1.35 },
		path: (tenant: string) =>
			`/items/${NOTE}?filter[tenant][_eq]=${tenant}&limit=25`,
	},
	{
		// Two m2o hops, so the pins come off nested rows rather than off the filter.
		name: 'deep',
		ceilings: { hitVsOff: 0.90, missVsOff: 1.60, hitVsFull: 1.25, missVsFull: 1.40 },
		path: (tenant: string) => {
			return `/items/${NOTE}?filter[tenant][_eq]=${tenant}&limit=25`
				+ `&fields=*,author.*,author.company.*`;
		},
	},
	{
		// 200 rows, so the payload itself counts. One pin: the filtered column.
		name: 'wide',
		ceilings: { hitVsOff: 1.00, missVsOff: 1.65, hitVsFull: 1.25, missVsFull: 1.40 },
		path: (tenant: string) =>
			`/items/${NOTE}?filter[tenant][_eq]=${tenant}&limit=200`,
	},
	{
		// `wide` again, with one m2o hop over 250 authors so each of the 200 rows
		// carries a DIFFERENT parent. What separates this from `wide` is the pin
		// fan-out alone, which is the crossover #392 is about.
		name: 'fan',
		// Its own, looser pair: a read that pins one key per row writes a set per
		// row too, and that is the cost the shape exists to expose rather than
		// one the ceiling should hide. The target every shape is held
		// to stays in Headroom.
		ceilings: { hitVsOff: 0.85, missVsOff: 2.25, hitVsFull: 1.20, missVsFull: 1.75 },
		path: (tenant: string) => {
			return `/items/${NOTE}?filter[tenant][_eq]=${tenant}&limit=200`
				+ `&fields=*,author.*`;
		},
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

/**
 * Wait for the reap a clear requests on a scoped arm to mark its index complete.
 * The pass runs a second after the clear, off the request path, and would land in
 * whatever is measured next. A clear keeps the marker, so once it is complete the
 * reap a clear requests is turned away and there is nothing left to wait for.
 */
async function awaitRequestedReap(arm: Arm): Promise<void> {
	if (arm.env['CACHE_AUTO_PURGE_MODE'] !== 'scoped') {
		return;
	}

	const namespace = `perf-cache-${arms.indexOf(arm)}`;
	const deadline = performance.now() + 30_000;

	while (performance.now() < deadline) {
		const [marker, generation] = await redis.mget(
			`${namespace}:scoped-cache-collection-index-keys-complete`,
			`${namespace}:scoped-cache-index-generation`,
		);

		if (marker !== null && marker === generation) {
			return;
		}

		await new Promise((wake) => setTimeout(wake, 100));
	}

	throw new Error(`no reap marked the ${arm.name} index complete in 30 s`);
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

	if (cold) {
		await awaitRequestedReap(arm);
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
	// What the client actually sent. A command count cannot see the difference
	// between a script called by its SHA and the same script with its whole body on
	// the wire — both are one command — and a read that pins per row sends the body
	// twice per pin.
	inputBytes: number;
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
	const inputBytes = Number(/total_net_input_bytes:(\d+)/.exec(stats)?.[1] ?? 0);

	return { commands, byCommand, socketReads, inputBytes };
}

type CensusResult = {
	perRequest: number;
	// What the api sent, where `perRequest` is what Redis executed: a command a
	// script runs counts in Redis's own stats but never crossed the wire, and only
	// what crossed it costs the api an encode, a promise and a reply parse.
	sentPerRequest: number;
	bytesPerRequest: number;
	// Every command, not a top-N slice: the first run of this bench reported six
	// commands per hit where the response cache accounts for two, and a truncated
	// list is what stopped the other four from being attributable to anything.
	breakdown: string;
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
	idleFloor: IdleFloor,
): Promise<CensusResult> {
	const watched = await countSentCommands(async () => {
		await redis.config('RESETSTAT');
		const startedAt = performance.now();

		await run();

		return {
			elapsed: (performance.now() - startedAt) / 1000,
			counted: await readRedisCounters(),
		};
	});

	const { elapsed, counted } = watched.result;

	// The two `info` calls this census makes land in the same counters.
	const overhead = idleFloor.executed * elapsed + 2;
	const net = Math.max(counted.commands - overhead, 0);

	const breakdown = Object.entries(counted.byCommand)
		.filter(([name]) => name.startsWith('config') === false)
		.sort(([, a], [, b]) => b - a)
		.map(([name, calls]) => `${name} ${(calls / requests).toFixed(1)}`)
		.join(', ');

	return {
		perRequest: net / requests,
		sentPerRequest:
			Math.max(watched.sent - idleFloor.sent * watched.seconds, 0) / requests,
		bytesPerRequest: counted.inputBytes / requests,
		breakdown,
		socketReadsPerRequest: counted.socketReads / requests,
	};
}

/**
 * The commands one request issues, named by the keys they touch.
 *
 * The census says how many; only this says which. Four commands the response
 * cache cannot account for look the same in a count and are obvious the moment
 * their keys are visible, so this runs after the timed phases — MONITOR sees
 * every client on the server and slows it down — with the other arms idle.
 */
async function traceRedisCommands(
	label: string,
	run: () => Promise<void>,
): Promise<string[]> {
	const watcher = new Redis(redisUrl);
	const monitor = await watcher.monitor();
	const lines: string[] = [];

	monitor.on('monitor', (_time: string, args: string[]) => {
		lines.push(args.join(' ').slice(0, 140));
	});

	try {
		// The subscription is registered asynchronously on the server, so a command
		// issued straight after it can be processed before it is.
		await new Promise((wake) => setTimeout(wake, 250));
		await run();
		await new Promise((wake) => setTimeout(wake, 250));
	}
	finally {
		monitor.disconnect();
		watcher.disconnect();
	}

	return [
		`${label} — ${lines.length} commands`,
		...lines.map((line) => `    ${line}`),
		'',
	];
}

type IdleFloor = {
	executed: number;
	// Apart from `executed`: a script the servers run while idle adds its own
	// commands to what Redis executed, and only the call to what was sent.
	sent: number;
};

/**
 * Counts the commands put on the wire, which `INFO commandstats` cannot tell
 * from the ones a script runs: MONITOR names each command's source, `lua` for a
 * script's own. It slows the server, which costs nothing where commands are
 * counted rather than timed. The bench's own connection is left out.
 */
async function countSentCommands<Result>(
	run: () => Promise<Result>,
): Promise<{ result: Result; sent: number; seconds: number }> {
	const benchAddress = /addr=(\S+)/.exec(String(await redis.client('INFO')))![1];
	const watcher = new Redis(redisUrl);
	const monitor = await watcher.monitor();
	let sent = 0;

	monitor.on('monitor', (_time: string, _args: string[], source: string) => {
		if (source !== 'lua' && source !== benchAddress) {
			sent++;
		}
	});

	try {
		// The subscription is registered asynchronously on the server.
		await new Promise((wake) => setTimeout(wake, 250));
		const startedAt = performance.now();

		const result = await run();

		// A command reaches the monitor after its reply reaches the api.
		await new Promise((wake) => setTimeout(wake, 250));

		return { result, sent, seconds: (performance.now() - startedAt) / 1000 };
	}
	finally {
		monitor.disconnect();
		watcher.disconnect();
	}
}

async function measureIdleRedisFloor(): Promise<IdleFloor> {
	const watched = await countSentCommands(async () => {
		await redis.config('RESETSTAT');
		await new Promise((wake) => setTimeout(wake, 3000));

		return readRedisCounters();
	});

	return {
		executed: watched.result.commands / 3,
		sent: watched.sent / watched.seconds,
	};
}

type CpuPhase = 'fill' | 'fanFill' | 'hit';

const cpuPhases: CpuPhase[] = ['fill', 'fanFill', 'hit'];

/**
 * The CPU time the arm's server has spent so far, in nanoseconds, summed over
 * every thread: the libuv pool and V8's GC threads work for the request too.
 *
 * `schedstat` rather than `stat`: `stat` counts clock ticks, 10 ms each, which is
 * a whole fill on this fixture.
 */
async function readServerCpu(arm: Arm): Promise<number> {
	const pid = arm.process!.pid!;
	let total = 0;

	for (const thread of await readdir(`/proc/${pid}/task`)) {
		try {
			const schedstat = await readFile(
				`/proc/${pid}/task/${thread}/schedstat`,
				'utf8',
			);

			total += Number(schedstat.split(' ')[0]);
		}
		catch {
			// The thread exited between the listing and the read.
		}
	}

	return total;
}

/**
 * What each arm's server burns per second with nothing driving it — timers, the
 * stats flush, the bus — so a sample can subtract it the way the Redis census
 * subtracts its idle floor. Every arm idles at once: each is its own process.
 */
async function measureIdleCpu(): Promise<Map<string, number>> {
	const before = await Promise.all(arms.map((arm) => readServerCpu(arm)));
	const startedAt = performance.now();

	await new Promise((wake) => setTimeout(wake, 3000));

	const after = await Promise.all(arms.map((arm) => readServerCpu(arm)));
	const elapsed = (performance.now() - startedAt) / 1000;

	return new Map(arms.map((arm, index) => {
		return [arm.name, (after[index]! - before[index]!) / elapsed];
	}));
}

function cpuPhasePath(phase: CpuPhase, tenant: string, index: number): string {
	if (phase === 'fill') {
		return `/items/${NOTE}?filter[tenant][_eq]=${tenant}&limit=25&offset=${index}`;
	}

	if (phase === 'fanFill') {
		return `/items/${NOTE}?filter[tenant][_eq]=${tenant}&limit=200`
			+ `&fields=*,author.*&offset=${index}`;
	}

	return `/items/${NOTE}?filter[tenant][_eq]=${tenant}&limit=25`;
}

/**
 * The server CPU one request of `phase` costs, in milliseconds.
 *
 * Measured over the whole window rather than around each response, because a fill
 * keeps working after it answers — the tag writes and the post-fill re-read run
 * off the response path — and that work is exactly the cost being looked for. The
 * window ends after a pause long enough for it to finish, and the pause is paid
 * for by subtracting the idle rate over the whole window.
 */
async function sampleCpu(
	arm: Arm,
	phase: CpuPhase,
	tenant: string,
	idleNsPerSecond: number,
): Promise<number> {
	await clearResponseCache(arm);
	await awaitRequestedReap(arm);

	if (phase === 'hit') {
		await api(arm.base, cpuPhasePath(phase, tenant, 0));
	}

	await new Promise((wake) => setTimeout(wake, 100));

	const before = await readServerCpu(arm);
	const startedAt = performance.now();

	for (let index = 0; index < cpuRequests; index++) {
		await api(arm.base, cpuPhasePath(phase, tenant, index));
	}

	await new Promise((wake) => setTimeout(wake, 250));

	const spent = await readServerCpu(arm) - before;
	const elapsed = (performance.now() - startedAt) / 1000;
	const net = Math.max(spent - idleNsPerSecond * elapsed, 0);

	return net / cpuRequests / 1e6;
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
	// The order rotates per rep too: `off` is every ratio's divisor, and going
	// first in every rep would hand it whatever going first costs.
	for (let rep = 0; rep < reps; rep++) {
		const tenant = tenants[rep % TENANTS]!;

		for (const shape of readShapes) {
			for (const cold of [true, false]) {
				for (const arm of armsInRepOrder(rep)) {
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
			for (const arm of armsInRepOrder(rep)) {
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
	const commandsPerFanFill = new Map<string, number>();
	const kilobytesPerFanFill = new Map<string, number>();
	const commandsPerWrite = new Map<string, Map<number, number>>();
	const sentPerHit = new Map<string, number>();
	const sentPerFill = new Map<string, number>();
	const sentPerFanFill = new Map<string, number>();

	function describe(counted: CensusResult): string {
		const bytes = (counted.bytesPerRequest / 1024).toFixed(1);

		return `**${counted.perRequest.toFixed(1)}** — ${counted.breakdown}`
			+ ` | **${counted.sentPerRequest.toFixed(1)}** (${bytes} KB)`;
	}

	// `off` is counted too, and that is what makes any of these attributable. A
	// request costs Redis something before the response cache is reached at all —
	// the permission lookups the cache key is built from go through a Redis-backed
	// tier — so only an arm's difference from this one is the cache's own doing.
	//
	// Serially, one arm at a time: the arms share a Redis, so two counted phases
	// running at once would each read the other's commands as their own.
	for (const arm of arms) {
		await clearResponseCache(arm);
		await awaitRequestedReap(arm);

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
		sentPerFill.set(arm.name, fill.sentPerRequest);
		recordCensus('read, fresh key', arm.name, describe(fill));

		// The same again over the fan shape, because the flat one writes two tag
		// sets and hides the cost this whole file exists to expose: a read that
		// pins per row writes a tag set per row, and each of those is a script
		// call carrying its own EXISTS, SADD and expiry.
		const fanFill = await census(
			async () => {
				for (let index = 0; index < censusRequests; index++) {
					await api(
						arm.base,
						`/items/${NOTE}?filter[tenant][_eq]=t2&limit=200`
						+ `&fields=*,author.*&offset=${index}`,
					);
				}
			},
			censusRequests,
			idleFloor,
		);

		commandsPerFanFill.set(arm.name, fanFill.perRequest);
		sentPerFanFill.set(arm.name, fanFill.sentPerRequest);
		kilobytesPerFanFill.set(arm.name, fanFill.bytesPerRequest / 1024);
		recordCensus('read, fresh key (fan)', arm.name, describe(fanFill));

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
		sentPerHit.set(arm.name, hit.sentPerRequest);
		recordCensus('read, repeated', arm.name, describe(hit));

		const perWarmSize = new Map<number, number>();

		// Both warm sizes, because a purge whose command count tracks how much the
		// cache holds is the one property a latency figure on a local Redis hides:
		// the commands pipeline into a single round trip here and into a single one
		// in production too, while costing Redis itself N times the work.
		for (const entries of warmSizes) {
			const counts: number[] = [];
			const sentCounts: number[] = [];
			let breakdown = '';

			for (let rep = 0; rep < censusWriteReps; rep++) {
				// Warmed BEFORE the counters are reset, so the warm's own commands
				// are not charged to the write it sets the stage for.
				await warmCache(arm, entries);

				const counted = await census(
					async () => {
						await timeWrite(arm, noteIds[rep]!);
					},
					1,
					idleFloor,
				);

				counts.push(counted.perRequest);
				sentCounts.push(counted.sentPerRequest);
				breakdown = counted.breakdown;
			}

			const label = `${arm.name} write@${entries}`;
			const perWrite = summarise(label, counts).median;
			const sentPerWrite = summarise(`${label} sent`, sentCounts).median;

			perWarmSize.set(entries, perWrite);

			recordCensus(
				`write@${entries}`,
				arm.name,
				`**${perWrite.toFixed(1)}** — ${breakdown}`
				+ ` | **${sentPerWrite.toFixed(1)}**`,
			);
		}

		commandsPerWrite.set(arm.name, perWarmSize);
	}

	const idleCpu = await measureIdleCpu();

	// Arms alternating and rotating inside each rep, as the timed reads do, and a
	// tenant per rep so no rep reads a key an earlier one left behind.
	for (let rep = 0; rep < cpuReps; rep++) {
		const tenant = tenants[rep % TENANTS]!;

		for (const phase of cpuPhases) {
			for (const arm of armsInRepOrder(rep)) {
				const idle = idleCpu.get(arm.name)!;

				record(`cpu:${phase}`, arm.name, await sampleCpu(arm, phase, tenant, idle));
			}
		}
	}

	const phases = [
		...readShapes.flatMap((shape) => [`${shape.name}:miss`, `${shape.name}:hit`]),
		...warmSizes.map((entries) => `write@${entries}`),
	];

	const head = (process.env['PERF_HEAD_SHA'] ?? 'local').slice(0, 10);
	const bench = (process.env['PERF_BENCH_SHA'] ?? head).slice(0, 10);

	const report: string[] = [
		'### Response cache — what it costs and what it buys',
		'',
		`Measured commit \`${head}\` with the bench of \`${bench}\`,`
		+ ` Node ${process.version}.`,
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
		'#### Server CPU per request',
		'',
		`${cpuReps} samples of ${cpuRequests} requests per arm, net of each`
		+ ' server\'s idle rate. `fill` and `fanFill` read a fresh key each time,'
		+ ' `hit` the same one. Gated on the min, as a ratio to `off`\'s min.',
		'',
		'| phase | arm | min | median | p95 | max | min vs `off` |',
		'| --- | --- | ---: | ---: | ---: | ---: | ---: |',
	);

	for (const phase of cpuPhases) {
		const floor = seriesOf(`cpu:${phase}`, 'off').min;

		for (const arm of arms) {
			const summary = seriesOf(`cpu:${phase}`, arm.name);
			const ratio = (summary.min / floor).toFixed(2);
			const row = summaryRow(summary).replace(`cpu:${phase} / `, '');

			report.push(`| ${phase} ${row} ${ratio}x |`);
		}
	}

	report.push(
		'',
		'#### Redis commands per request',
		'',
		`Net of a ${idleFloor.executed.toFixed(1)}/s executed and`
		+ ` ${idleFloor.sent.toFixed(1)}/s sent background floor measured idle.`
		+ ' Counts are exact, not sampled: they are what the latency above becomes'
		+ ' once Redis is a network hop rather than a container on the same host.'
		+ ' `off` is the'
		+ " control — a request costs Redis something before the response cache is"
		+ ' reached, so what the cache itself costs is the difference from that row.',
		'',
		'Executed is what Redis ran, a script\'s own commands included; sent is what'
		+ ' the api put on the wire, one per script call.',
		'',
		'| phase | arm | commands executed | commands sent |',
		'| --- | --- | --- | --- |',
	);

	for (const [phase, byArm] of censuses) {
		for (const arm of arms) {
			report.push(`| ${phase} | ${arm.name} | ${byArm.get(arm.name) ?? '— | —'} |`);
		}
	}

	// After every timed phase and every count, because MONITOR slows the server it
	// watches. One fill and one hit per arm, which is all it takes: the commands a
	// request issues are the same every time.
	const traces: string[] = [];

	for (const armName of ['full', 'scoped']) {
		const arm = arms.find((candidate) => candidate.name === armName)!;
		const tracePath = `/items/${NOTE}?filter[tenant][_eq]=t5&limit=25`;

		await clearResponseCache(arm);
		await awaitRequestedReap(arm);

		traces.push(...await traceRedisCommands(`${armName}, one fill`, async () => {
			await api(arm.base, tracePath);
		}));

		traces.push(...await traceRedisCommands(`${armName}, one hit`, async () => {
			await api(arm.base, tracePath);
		}));
	}

	const verdicts: string[] = [];
	const headroom: string[] = [];

	function row(label: string, value: number, ceiling: number): string {
		const mark = value <= ceiling
			? 'ok'
			: 'OVER';

		return `| ${label} | ${value.toFixed(2)} | ${ceiling} | ${mark} |`;
	}

	function verdict(label: string, value: number, ceiling: number): void {
		verdicts.push(row(label, value, ceiling));
	}

	// Measured against where the cache should be rather than where it was, and
	// gating nothing. See the ratchet note above the ceilings.
	function observe(label: string, value: number, target: number): void {
		headroom.push(row(label, value, target));
	}

	// What a shape's hit ratio has to reach before the cache is worth having at
	// all: a hit saves what the uncached read cost minus what serving it costs,
	// a miss pays the fill on top of that same uncached read, and below this
	// ratio the misses cost more than the hits save. A shape whose hit saves
	// nothing never repays its misses, however high the ratio goes.
	const breakEven: string[] = [
		'#### What hit ratio each shape has to reach to pay for itself',
		'',
		'| shape | a hit saves | a miss costs | break-even hit ratio |',
		'| --- | ---: | ---: | ---: |',
	];

	for (const shape of readShapes) {
		const uncached = seriesOf(`${shape.name}:miss`, 'off').median;
		const saved = uncached - seriesOf(`${shape.name}:hit`, 'scoped').median;
		const paid = seriesOf(`${shape.name}:miss`, 'scoped').median - uncached;

		const ratio = saved <= 0
			? 'never pays'
			: `${(100 * paid / (paid + saved)).toFixed(0)} %`;

		breakEven.push(
			`| ${shape.name} | ${saved.toFixed(1)} ms`
			+ ` | ${paid.toFixed(1)} ms | ${ratio} |`,
		);
	}

	for (const shape of readShapes) {
		const uncachedMiss = seriesOf(`${shape.name}:miss`, 'off').median;
		const scopedHit = seriesOf(`${shape.name}:hit`, 'scoped').median;
		const scopedMiss = seriesOf(`${shape.name}:miss`, 'scoped').median;
		const missVsOff = scopedMiss / uncachedMiss;
		const missVsFull = scopedMiss / seriesOf(`${shape.name}:miss`, 'full').median;

		verdict(
			`${shape.name}: a scoped HIT against no cache at all`,
			scopedHit / uncachedMiss,
			shape.ceilings.hitVsOff,
		);

		verdict(
			`${shape.name}: a scoped MISS against no cache at all`,
			missVsOff,
			shape.ceilings.missVsOff,
		);

		verdict(
			`${shape.name}: a scoped HIT against a full-mode HIT`,
			scopedHit / seriesOf(`${shape.name}:hit`, 'full').median,
			shape.ceilings.hitVsFull,
		);

		verdict(
			`${shape.name}: a scoped MISS against a full-mode MISS`,
			missVsFull,
			shape.ceilings.missVsFull,
		);

		// The same two against the figure every shape should reach, not the one
		// its own ceiling was ratcheted to.
		observe(
			`${shape.name}: a scoped MISS against no cache at all`,
			missVsOff,
			targetMissVsOff,
		);

		observe(
			`${shape.name}: a scoped MISS against a full-mode MISS`,
			missVsFull,
			targetMissVsFull,
		);
	}

	const writeCommandScaling =
		commandsPerWrite.get('scoped')!.get(warmSizes[1]!)!
		/ commandsPerWrite.get('scoped')!.get(warmSizes[0]!)!;

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

	// A purge that drops one slice should cost the same however much the cache
	// holds. Its LATENCY already does, because the deletes pipeline into one round
	// trip; whether its COMMAND count does is the question a local Redis hides.
	verdict(
		'Redis commands per scoped fan fill',
		commandsPerFanFill.get('scoped')!,
		maxCommandsPerFanFill,
	);

	verdict(
		'KB sent per scoped fan fill',
		kilobytesPerFanFill.get('scoped')!,
		maxKilobytesPerFanFill,
	);

	verdict(
		`Redis commands per scoped write, ${warmSizes[1]} entries against`
		+ ` ${warmSizes[0]}`,
		writeCommandScaling,
		maxWriteCommandScaling,
	);

	for (const armName of ['full', 'scoped']) {
		verdict(
			`Redis commands a ${armName} HIT adds over an uncached read`,
			commandsPerHit.get(armName)! - commandsPerHit.get('off')!,
			maxCommandsAddedPerHit,
		);

		verdict(
			`Redis commands a ${armName} fill adds over an uncached read`,
			commandsPerFill.get(armName)! - commandsPerFill.get('off')!,
			armName === 'scoped'
				? maxCommandsAddedPerScopedFill
				: maxCommandsAddedPerFill,
		);

		verdict(
			`Redis commands a ${armName} fan fill adds over an uncached read`,
			commandsPerFanFill.get(armName)! - commandsPerFanFill.get('off')!,
			armName === 'scoped'
				? maxCommandsAddedPerScopedFanFill
				: maxCommandsAddedPerFanFill,
		);

		for (const phase of cpuPhases) {
			verdict(
				`server CPU per ${armName} ${phase} against no cache at all`,
				seriesOf(`cpu:${phase}`, armName).min
				/ seriesOf(`cpu:${phase}`, 'off').min,
				cpuCeilings[armName]![phase],
			);
		}
	}

	observe(
		`Redis commands per scoped write, ${warmSizes[1]} entries against`
		+ ` ${warmSizes[0]}`,
		writeCommandScaling,
		targetWriteCommandScaling,
	);

	report.push(
		'',
		...breakEven,
		'',
		'#### One request, command by command',
		'',
		'What the counts above are made of. Taken with MONITOR after every timed',
		'phase, so it slows nothing that was measured.',
		'',
		'```',
		...traces,
		'```',
		'',
		'#### Gates',
		'',
		'Ratchets, where the ceiling is what the last run measured plus room for'
		+ ' drift, and absolute ceilings on the Redis commands a request adds.',
		'',
		'| ratio | measured | ceiling | |',
		'| --- | ---: | ---: | --- |',
		...verdicts,
		'',
		'#### Headroom',
		'',
		'Measured against where the cache should be. Gates nothing.',
		'',
		'| ratio | measured | target | |',
		'| --- | ---: | ---: | --- |',
		...headroom,
		'',
	);

	await mkdir(outputDir, { recursive: true });

	const seriesPhases = [
		...phases,
		...cpuPhases.map((phase) => `cpu:${phase}`),
	];

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
		idleRedisCommandsPerSecond: idleFloor.executed,
		idleRedisCommandsSentPerSecond: idleFloor.sent,
		series: Object.fromEntries(
			seriesPhases.map((phase) => {
				const byArm = arms.map((arm) => [arm.name, seriesOf(phase, arm.name)]);

				return [phase, Object.fromEntries(byArm)];
			}),
		),
		redisCommandsPerRequest: {
			hit: Object.fromEntries(commandsPerHit),
			fill: Object.fromEntries(commandsPerFill),
			fanFill: Object.fromEntries(commandsPerFanFill),
		},
		redisCommandsSentPerRequest: {
			hit: Object.fromEntries(sentPerHit),
			fill: Object.fromEntries(sentPerFill),
			fanFill: Object.fromEntries(sentPerFanFill),
		},
		idleServerCpuNsPerSecond: Object.fromEntries(idleCpu),
	};

	await writeFile(
		join(outputDir, 'cache.json'),
		`${JSON.stringify(result, null, 2)}\n`,
	);

	await writeFile(join(outputDir, 'cache.md'), `${report.join('\n')}\n`);

	// One line for whoever is reading a commit rather than a run: CI copies it into
	// the commit status verbatim, so it has to stand alone — a breached gate
	// included, since the status is written whether or not the run below passes.
	const over = verdicts.filter((line) => line.endsWith('OVER |'));
	const hitMs = seriesOf('flat:hit', 'scoped').median;
	const uncachedMs = seriesOf('flat:miss', 'off').median;

	const fanFillCpu = seriesOf('cpu:fanFill', 'scoped').min
		/ seriesOf('cpu:fanFill', 'off').min;

	const breached = over.length > 0
		? `${over.length} gate(s) OVER — `
		: '';

	await writeFile(
		join(outputDir, 'cache.status.txt'),
		`${breached}flat hit ${hitMs.toFixed(1)} ms vs ${uncachedMs.toFixed(1)} ms`
		+ ` uncached (${(hitMs / uncachedMs).toFixed(2)}x),`
		+ ` ${commandsPerHit.get('scoped')!.toFixed(1)} redis cmd/hit,`
		+ ` fan fill ${fanFillCpu.toFixed(2)}x cpu\n`,
	);

	expect(over, `gates exceeded:\n${over.join('\n')}`).toEqual([]);
}, 30 * 60 * 1000);
