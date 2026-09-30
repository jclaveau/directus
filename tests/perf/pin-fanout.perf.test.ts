import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Redis from 'ioredis';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { summarise } from './measure.js';

/**
 * What `CACHE_SCOPED_MAX_PINS_PER_COLLECTION` trades, measured on both sides
 * (#392). Exploratory: it reports, and gates nothing.
 *
 * A read nesting L parents of one collection pins L primary keys while L is
 * under the cap, each filed in its own set. Past the cap it pins the parents'
 * scope slices, and with no scope field the bare collection set. The fill pays
 * per pin; the writes to the parent collection pay per entry the coarser pin
 * shares a set with, and evict more of them.
 *
 * One arm per cap, plus `off`. Two parent collections, so both fallbacks show:
 * `fan_author` declares `tenant` (a capped read falls to one tenant slice),
 * `fan_writer` declares nothing (a capped read falls to the bare set). Every
 * tenant owns its own 500 parents, and a read at `offset` o of a tenant nests
 * parents o .. o+L-1 of that tenant, so two reads share parents only where
 * their windows overlap — closer to a production fan than the cache bench's
 * 250 parents shared by every read.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = process.env['PERF_CLI'] ?? join(root, 'dist', 'cli');
const adminToken = process.env['PERF_ADMIN_TOKEN'] ?? 'bench-admin-token';

const redisUrl = process.env['PERF_REDIS'] ?? process.env['REDIS']
	?? 'redis://127.0.0.1:6108';

const basePort = Number(process.env['PERF_FANOUT_BASE_PORT'] ?? 8400);

const outputDir = process.env['PERF_OUTPUT_DIR']
	?? join(root, 'tests', 'perf', 'results');

const caps = (process.env['PERF_FANOUT_CAPS'] ?? '250,64,16,4')
	.split(',')
	.map(Number);

const fillRequests = Number(process.env['PERF_FANOUT_FILL_REQUESTS'] ?? 20);
const fillWidths = [25, 200];

const warmSizes = (process.env['PERF_FANOUT_WARM_SIZES'] ?? '200,1600')
	.split(',')
	.map(Number);

const writesPerSize = Number(process.env['PERF_FANOUT_WRITES'] ?? 5);
const warmWidth = 200;

const STATUS_HEADER = 'x-cache-status';
const NOTE = 'fan_note';
const AUTHOR = 'fan_author';
const WRITER = 'fan_writer';
const TENANTS = 8;
const PARENTS_PER_TENANT = 500;
const NOTES_PER_TENANT = 1000;

const tenants = Array.from({ length: TENANTS }, (_, index) => `t${index}`);

const authHeaders = {
	'Authorization': `Bearer ${adminToken}`,
	'Content-Type': 'application/json',
};

type Arm = {
	name: string;
	cap: number | null;
	namespace: string;
	base: string;
	process?: ChildProcess;
};

const arms: Arm[] = [
	{ name: 'off', cap: null, namespace: 'perf-fan-off', base: '' },
	...caps.map((cap) => {
		return { name: `cap ${cap}`, cap, namespace: `perf-fan-${cap}`, base: '' };
	}),
];

const cachedArms = arms.filter((arm) => arm.cap !== null);

const relations = [
	{ field: 'author', collection: AUTHOR, fallback: 'tenant slice' },
	{ field: 'writer', collection: WRITER, fallback: 'bare set' },
] as const;

let redis: Redis;
const parentIds: Record<string, number[]> = {};

function fanPath(
	field: string,
	tenant: string,
	width: number,
	offset: number,
): string {
	return `/items/${NOTE}?filter[tenant][_eq]=${tenant}&sort=id&limit=${width}`
		+ `&offset=${offset}&fields=*,${field}.*`;
}

function flatPath(tenant: string, offset: number): string {
	return `/items/${NOTE}?filter[tenant][_eq]=${tenant}&sort=id&limit=25`
		+ `&offset=${offset}`;
}

async function api(base: string, path: string, init: RequestInit = {}) {
	const response = await fetch(`${base}${path}`, {
		...init,
		headers: authHeaders,
	});

	const text = await response.text();

	if (!response.ok) {
		throw new Error(`${response.status} for ${path}: ${text.slice(0, 300)}`);
	}

	return {
		body: text === ''
			? null
			: JSON.parse(text),
		status: response.headers.get(STATUS_HEADER) ?? 'none',
	};
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

async function seedFixture(base: string): Promise<void> {
	for (const collection of [NOTE, AUTHOR, WRITER]) {
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

	const parentFields = [
		primaryKey,
		{ field: 'tenant', type: 'string', meta: {}, schema: {} },
		{ field: 'name', type: 'string', meta: {}, schema: {} },
	];

	await api(base, '/collections', {
		method: 'POST',
		body: JSON.stringify([
			{
				collection: AUTHOR,
				meta: { scoped_cache_fields: ['tenant'] },
				schema: {},
				fields: parentFields,
			},
			{ collection: WRITER, meta: {}, schema: {}, fields: parentFields },
			{
				collection: NOTE,
				meta: { scoped_cache_fields: ['tenant'] },
				schema: {},
				fields: [
					primaryKey,
					{ field: 'tenant', type: 'string', meta: {}, schema: {} },
					{ field: 'label', type: 'string', meta: {}, schema: {} },
				],
			},
		]),
	});

	for (const { field, collection } of relations) {
		await api(base, `/fields/${NOTE}`, {
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
				collection: NOTE,
				field,
				related_collection: collection,
				meta: {},
				schema: { on_delete: 'SET NULL' },
			}),
		});
	}

	for (const { collection } of relations) {
		const parents = tenants.flatMap((tenant) => {
			return Array.from({ length: PARENTS_PER_TENANT }, (_, index) => {
				return { tenant, name: `${tenant} parent ${index}` };
			});
		});

		const ids: number[] = [];

		for (let at = 0; at < parents.length; at += 1000) {
			const created = await api(base, `/items/${collection}?fields=id`, {
				method: 'POST',
				body: JSON.stringify(parents.slice(at, at + 1000)),
			});

			ids.push(...created.body.data.map((row: any) => row.id));
		}

		parentIds[collection] = ids;
	}

	const notes = tenants.flatMap((tenant, tenantIndex) => {
		return Array.from({ length: NOTES_PER_TENANT }, (_, index) => {
			const parent = tenantIndex * PARENTS_PER_TENANT
				+ (index % PARENTS_PER_TENANT);

			return {
				tenant,
				label: `note ${tenant}-${index}`,
				author: parentIds[AUTHOR]![parent],
				writer: parentIds[WRITER]![parent],
			};
		});
	});

	for (let at = 0; at < notes.length; at += 1000) {
		await api(base, `/items/${NOTE}`, {
			method: 'POST',
			body: JSON.stringify(notes.slice(at, at + 1000)),
		});
	}
}

async function clearResponseCache(arm: Arm): Promise<void> {
	await api(arm.base, '/utils/cache/clear', { method: 'POST' });

	const deadline = performance.now() + 30_000;

	while (performance.now() < deadline) {
		const [marker, generation] = await redis.mget(
			`${arm.namespace}:scoped-cache-collection-index-keys-complete`,
			`${arm.namespace}:scoped-cache-index-generation`,
		);

		if (marker !== null && marker === generation) {
			return;
		}

		await new Promise((wake) => setTimeout(wake, 100));
	}

	throw new Error(`no reap marked the ${arm.name} index complete in 30 s`);
}

type Counted = { executed: number; kilobytes: number; byCommand: string };

async function readCounters(): Promise<{
	executed: number;
	inputBytes: number;
	byCommand: Record<string, number>;
}> {
	const commandstats = await redis.info('commandstats');
	const stats = await redis.info('stats');
	const byCommand: Record<string, number> = {};
	let executed = 0;

	for (const line of commandstats.split('\n')) {
		const match = /^cmdstat_([^:]+):calls=(\d+)/.exec(line.trim());

		if (!match || /^(config|info|slowlog)/.test(match[1]!)) {
			continue;
		}

		byCommand[match[1]!] = Number(match[2]);
		executed += Number(match[2]);
	}

	const inputBytes = Number(/total_net_input_bytes:(\d+)/.exec(stats)?.[1] ?? 0);

	return { executed, inputBytes, byCommand };
}

// What the idle instances issue per second, subtracted from every count.
let idleExecutedPerSecond = 0;

async function counted(
	run: () => Promise<void>,
	requests: number,
): Promise<Counted> {
	await redis.config('RESETSTAT');
	const startedAt = performance.now();

	await run();

	const elapsed = (performance.now() - startedAt) / 1000;
	const { executed, inputBytes, byCommand } = await readCounters();
	const net = Math.max(executed - idleExecutedPerSecond * elapsed, 0);

	return {
		executed: net / requests,
		kilobytes: inputBytes / 1024 / requests,
		byCommand: Object.entries(byCommand)
			.sort(([, a], [, b]) => b - a)
			.slice(0, 6)
			.map(([name, calls]) => `${name} ${(calls / requests).toFixed(1)}`)
			.join(', '),
	};
}

type Slowest = { name: string; ms: number };

async function readSlowest(): Promise<Slowest> {
	const entries = await redis.call('SLOWLOG', 'GET', '-1') as [
		number,
		number,
		number,
		string[],
	][];

	let slowest: Slowest = { name: 'none', ms: 0 };

	for (const [, , micros, args] of entries) {
		const name = String(args[0]).toLowerCase();

		if (/^(config|info|slowlog)/.test(name)) {
			continue;
		}

		if (micros / 1000 > slowest.ms) {
			slowest = { name, ms: micros / 1000 };
		}
	}

	return slowest;
}

function median(samples: number[]): number {
	return summarise('median', samples).median;
}

const lines: string[] = [];

beforeAll(async () => {
	await mkdir(join(root, 'tests', 'perf', 'cache-extensions'), { recursive: true });

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

		arm.process = await startInstance(arm.name, port, arm.cap === null
			? { CACHE_ENABLED: 'false' }
			: {
				CACHE_ENABLED: 'true',
				CACHE_STORE: 'redis',
				CACHE_AUTO_PURGE: 'true',
				CACHE_AUTO_PURGE_MODE: 'scoped',
				CACHE_STATUS_HEADER: STATUS_HEADER,
				CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX: '0',
				CACHE_SCOPED_MAX_PINS_PER_COLLECTION: String(arm.cap),
				CACHE_NAMESPACE: arm.namespace,
			});
	}));

	await redis.config('SET', 'slowlog-log-slower-than', '0');
	await redis.config('SET', 'slowlog-max-len', '100000');
}, 15 * 60 * 1000);

afterAll(async () => {
	for (const arm of arms) {
		arm.process?.kill('SIGTERM');
	}

	await writeFile(join(outputDir, 'pin-fanout.md'), lines.join('\n'))
		.catch(() => undefined);

	await redis?.quit().catch(() => undefined);
});

test('what the pin cap trades between a fill and a write', async () => {
	await mkdir(outputDir, { recursive: true });

	// Every arm's plan and schema warm before anything is counted.
	for (const arm of arms) {
		for (const { field } of relations) {
			await api(arm.base, fanPath(field, 't7', 200, 700));
		}
	}

	await redis.config('RESETSTAT');
	await new Promise((wake) => setTimeout(wake, 3000));
	idleExecutedPerSecond = (await readCounters()).executed / 3;

	lines.push(
		'### Pin fan-out — `CACHE_SCOPED_MAX_PINS_PER_COLLECTION` sweep (#392)',
		'',
		`Idle floor: ${idleExecutedPerSecond.toFixed(1)} commands/s, subtracted.`,
		'',
		'#### Fill: one fresh-key read, per request',
		'',
		'| shape | arm | Redis commands executed | added vs off | KB sent'
		+ ' | fill ms (median) | top commands |',
		'| --- | --- | ---: | ---: | ---: | ---: | --- |',
	);

	const shapes = [
		{ name: 'flat, limit 25', path: (index: number) => flatPath('t0', index) },
		...relations.flatMap(({ field, fallback }) => {
			return fillWidths.map((width) => {
				return {
					name: `${field} (${fallback}), limit ${width}`,
					path: (index: number) => fanPath(field, 't1', width, index),
				};
			});
		}),
	];

	for (const shape of shapes) {
		let offCommands = 0;

		for (const arm of arms) {
			if (arm.cap !== null) {
				await clearResponseCache(arm);
			}

			const fillMs: number[] = [];
			const statuses = new Set<string>();

			const result = await counted(async () => {
				for (let index = 0; index < fillRequests; index++) {
					const startedAt = performance.now();
					const { status } = await api(arm.base, shape.path(index));

					fillMs.push(performance.now() - startedAt);
					statuses.add(status);
				}
			}, fillRequests);

			if (arm.cap === null) {
				offCommands = result.executed;
			}
			else {
				expect(statuses, `${arm.name} ${shape.name}`).toEqual(new Set(['MISS']));
			}

			lines.push(
				`| ${shape.name} | ${arm.name} | ${result.executed.toFixed(1)}`
				+ ` | ${(result.executed - offCommands).toFixed(1)}`
				+ ` | ${result.kilobytes.toFixed(1)}`
				+ ` | ${median(fillMs).toFixed(1)} | ${result.byCommand} |`,
			);
		}
	}

	lines.push(
		'',
		'#### Write to the nested collection, with K fan entries (limit 200) cached',
		'',
		'One `PATCH` of a parent\'s `name`, then every warm entry re-read: a MISS'
		+ ' is an entry that write evicted. Medians over the writes.',
		'',
		'| parent | K | arm | write ms | Redis commands executed'
		+ ' | slowest command | evicted of K | top commands |',
		'| --- | ---: | --- | ---: | ---: | --- | ---: | --- |',
	);

	for (const { field, collection, fallback } of relations) {
		for (const size of warmSizes) {
			const warmPaths = Array.from({ length: size }, (_, index) => {
				const tenant = tenants[index % TENANTS]!;
				const offset = Math.floor(index / TENANTS);

				return fanPath(field, tenant, warmWidth, offset);
			});

			for (const arm of cachedArms) {
				await clearResponseCache(arm);

				for (const path of warmPaths) {
					await api(arm.base, path);
				}

				const writeMs: number[] = [];
				const executed: number[] = [];
				const evicted: number[] = [];
				let slowest: Slowest = { name: 'none', ms: 0 };
				let byCommand = '';

				for (let write = 0; write < writesPerSize; write++) {
					// A parent every warm read of its tenant at a low offset nests.
					const tenantIndex = write % TENANTS;

					const parent = parentIds[collection]![
						tenantIndex * PARENTS_PER_TENANT + 150 + write
					]!;

					// A fill finishes its tag writes after it answers; let the re-reads'
					// land before the write is counted.
					await new Promise((wake) => setTimeout(wake, 500));
					await redis.call('SLOWLOG', 'RESET');
					let startedAt = 0;

					const result = await counted(async () => {
						startedAt = performance.now();

						await api(arm.base, `/items/${collection}/${parent}`, {
							method: 'PATCH',
							body: JSON.stringify({ name: `touched ${write}` }),
						});

						writeMs.push(performance.now() - startedAt);
					}, 1);

					executed.push(result.executed);
					byCommand = result.byCommand;

					const writeSlowest = await readSlowest();

					if (writeSlowest.ms > slowest.ms) {
						slowest = writeSlowest;
					}

					let misses = 0;

					for (const path of warmPaths) {
						const { status } = await api(arm.base, path);

						if (status !== 'HIT') {
							misses++;
						}
					}

					evicted.push(misses);
				}

				lines.push(
					`| ${field} (${fallback}) | ${size} | ${arm.name}`
					+ ` | ${median(writeMs).toFixed(1)}`
					+ ` | ${median(executed).toFixed(0)}`
					+ ` | \`${slowest.name}\` ${slowest.ms.toFixed(2)} ms`
					+ ` | ${median(evicted)} of ${size} | ${byCommand} |`,
				);
			}
		}
	}

	lines.push('');
}, 30 * 60 * 1000);
