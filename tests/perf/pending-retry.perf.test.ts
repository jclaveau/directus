import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Redis from 'ioredis';
import { afterAll, beforeAll, expect, test } from 'vitest';

/**
 * What retrying a recorded purge costs as the record grows
 * (https://github.com/jclaveau/directus/issues/392).
 *
 * A purge that fails after its write committed is recorded one fingerprint per
 * primary key, and the drain retries every recorded fingerprint of a collection in
 * one scan of that collection's index, testing each entry it reads against every
 * fingerprint: entries × fingerprints tests, synchronous. Past some count, dropping
 * the collection whole is cheaper than matching, and that count is what this
 * measures — the drain's wall time and the longest it held the event loop, per
 * cache size and fingerprint count, beside the collection-wide retry of the same
 * cache.
 *
 * Dispatch only, and gates nothing: it picks a threshold, it does not hold one.
 *
 * Filled in-process by `purge-extensions/perf-cache-fill`, recorded and drained
 * in-process by `purge-extensions/perf-pending-retry`, so the drain is timed where
 * it runs rather than through a timer.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const cli = process.env['PERF_CLI'] ?? join(root, 'dist', 'cli');
const adminToken = process.env['PERF_ADMIN_TOKEN'] ?? 'bench-admin-token';

const redisUrl = process.env['PERF_REDIS'] ?? process.env['REDIS']
	?? 'redis://127.0.0.1:6108';

const instancePort = Number(process.env['PERF_RETRY_PORT'] ?? 8330);

const outputDir = process.env['PERF_OUTPUT_DIR']
	?? join(root, 'tests', 'perf', 'results');

// Cumulative: each size fills on top of the one before.
const cacheSizes = (process.env['PERF_RETRY_SIZES'] ?? '10000,100000')
	.split(',')
	.map(Number);

const fingerprintCounts =
	(process.env['PERF_RETRY_FINGERPRINTS'] ?? '10,100,1000,3000,10000')
		.split(',')
		.map(Number);

// How many cached reads each row is part of: one per `limit`.
const ENTRIES_PER_ROW = 5;

const FILL_BATCH_ENTRIES = 1000;
const FILL_CONCURRENCY = 4;

const COLLECTION = 'perf_retry';
const STATUS_HEADER = 'x-cache-status';
const TENANTS = 8;

const largestSize = Math.max(...cacheSizes);
const rowCount = Math.ceil(largestSize / ENTRIES_PER_ROW);

const authHeaders = {
	'Authorization': `Bearer ${adminToken}`,
	'Content-Type': 'application/json',
};

const base = `http://127.0.0.1:${instancePort}`;

let instance: ChildProcess | undefined;
let redis: Redis;
let rowIds: number[] = [];

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
			CACHE_TTL: '6h',
			CACHE_SCOPED_INDEX_REAP_SCHEDULE: 'off',
			// Only the bench drains: a timer firing mid-record would retry half of it.
			CACHE_SCOPED_PURGE_RETRY_INTERVAL: '0',
			CACHE_NAMESPACE: 'perf-pending-retry',
			CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX: '0',
			// The fills saturate the event loop on purpose; the limiter's 503s would
			// abort the fill a measure depends on.
			PRESSURE_LIMITER_ENABLED: 'false',
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

async function seedCollection(): Promise<void> {
	const dropped = await fetch(`${base}/collections/${COLLECTION}`, {
		method: 'DELETE',
		headers: authHeaders,
	});

	await dropped.text();

	await api('/collections', {
		method: 'POST',
		body: JSON.stringify({
			collection: COLLECTION,
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

	for (let at = 0; at < rowCount; at += 500) {
		const rows = Array.from({ length: Math.min(500, rowCount - at) }, (_, index) => {
			return { tenant: `t${(at + index) % TENANTS}`, label: `row ${at + index}` };
		});

		const created = await api(`/items/${COLLECTION}?fields=id`, {
			method: 'POST',
			body: JSON.stringify(rows),
		});

		rowIds = [...rowIds, ...created.data.map((row: any) => row.id)];
	}
}

/** Cache every entry in `[from, to)` in-process, the reads `entryPath` names. */
async function fillEntries(from: number, to: number): Promise<void> {
	const batches: { id: number; limits: number[] }[][] = [];

	for (let at = from; at < to; at += FILL_BATCH_ENTRIES) {
		const rows = new Map<number, number[]>();
		const batchEnd = Math.min(at + FILL_BATCH_ENTRIES, to);

		for (let entryIndex = at; entryIndex < batchEnd; entryIndex++) {
			const rowId = rowIds[Math.floor(entryIndex / ENTRIES_PER_ROW)]!;
			const limits = rows.get(rowId) ?? [];

			limits.push(1 + (entryIndex % ENTRIES_PER_ROW));
			rows.set(rowId, limits);
		}

		batches.push([...rows].map(([id, limits]) => ({ id, limits })));
	}

	let next = 0;

	async function drain(): Promise<void> {
		while (next < batches.length) {
			const rows = batches[next++]!;

			await api('/perf-cache-fill', {
				method: 'POST',
				body: JSON.stringify({ collection: COLLECTION, fields: 'id,label', rows }),
			});
		}
	}

	await Promise.all(Array.from({ length: FILL_CONCURRENCY }, () => drain()));
}

async function readStatus(rowIndex: number): Promise<string> {
	const path = `/items/${COLLECTION}?filter[id][_eq]=${rowIds[rowIndex]}`
		+ '&limit=1&fields=id,label';

	const response = await fetch(`${base}${path}`, { headers: authHeaders });
	await response.text();

	return response.headers.get(STATUS_HEADER) ?? 'none';
}

async function readCommandStats(): Promise<{ commands: number; redisMs: number }> {
	const commandstats = await redis.info('commandstats');
	let commands = 0;
	let usec = 0;

	for (const line of commandstats.split('\n')) {
		const match = /^cmdstat_([^:]+):calls=(\d+),usec=(\d+)/.exec(line.trim());

		if (!match || match[1] === 'info') {
			continue;
		}

		commands += Number(match[2]);
		usec += Number(match[3]);
	}

	return { commands, redisMs: usec / 1000 };
}

type RetryMeasure = {
	entries: number;
	retry: string;
	fingerprints: number;
	drainMs: number;
	maxLoopBlockMs: number;
	commands: number;
	redisMs: number;
	cleared: number;
	left: number;
	purgedRead: string;
	untouchedRead: string;
};

async function measureDrain(
	entries: number,
	retry: string,
	fingerprints: number,
	record: Record<string, unknown>,
	untouchedRow: number,
): Promise<RetryMeasure> {
	await api('/perf-pending-retry/record', {
		method: 'POST',
		body: JSON.stringify({ collection: COLLECTION, ...record }),
	});

	const before = await readCommandStats();

	const drained = await api('/perf-pending-retry/drain', { method: 'POST' });

	const after = await readCommandStats();

	const measure = {
		entries,
		retry,
		fingerprints,
		drainMs: drained.drainMs,
		maxLoopBlockMs: drained.maxLoopBlockMs,
		commands: after.commands - before.commands,
		redisMs: after.redisMs - before.redisMs,
		cleared: drained.cleared,
		left: drained.left,
		// Row 0 is in every record, so its read has to be gone; the untouched row is
		// in none of the slices records, so its read has to survive them.
		purgedRead: await readStatus(0),
		untouchedRead: await readStatus(untouchedRow),
	};

	// Printed as it lands, so a run that dies later still reports what it measured.
	// eslint-disable-next-line no-console
	console.info(JSON.stringify(measure));

	return measure;
}

const measures: RetryMeasure[] = [];

beforeAll(async () => {
	redis = new Redis(redisUrl);
	instance = await startInstance();
	await seedCollection();
}, 600_000);

afterAll(async () => {
	instance?.kill('SIGTERM');
	await redis?.quit().catch(() => undefined);
});

test('a retry costs what its record names, or its collection', async () => {
	let filled = 0;

	for (const entries of [...cacheSizes].sort((left, right) => left - right)) {
		await fillEntries(filled, entries);
		filled = entries;

		const rowsCached = entries / ENTRIES_PER_ROW;
		const lastRow = rowsCached - 1;

		for (const fingerprints of fingerprintCounts) {
			if (fingerprints >= rowsCached) {
				continue;
			}

			measures.push(await measureDrain(
				entries,
				'slices',
				// The bare fingerprint rides with every write's record.
				fingerprints + 1,
				{ ids: rowIds.slice(0, fingerprints) },
				lastRow,
			));

			// What the retry dropped, and the two reads above, back in the cache.
			await fillEntries(0, fingerprints * ENTRIES_PER_ROW);
			await fillEntries(lastRow * ENTRIES_PER_ROW, entries);
		}

		measures.push(await measureDrain(
			entries,
			'collection',
			0,
			{ mode: 'collection' },
			lastRow,
		));

		await fillEntries(0, entries);
	}

	const lines = [
		'### Pending purge retry',
		'',
		`${ENTRIES_PER_ROW} cached reads per row, each pinning its primary key. A`
		+ ' slices record names the bare fingerprint and one per row; a collection'
		+ ' record names the collection.',
		'',
		'| cached entries | retry | recorded fingerprints | drain ms'
		+ ' | max loop block ms | redis commands | redis ms | row 0 | untouched row |',
		'| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |',
		...measures.map((measure) => {
			return `| ${measure.entries} | ${measure.retry} | ${measure.fingerprints}`
				+ ` | ${measure.drainMs.toFixed(0)} | ${measure.maxLoopBlockMs.toFixed(0)}`
				+ ` | ${measure.commands} | ${measure.redisMs.toFixed(1)}`
				+ ` | ${measure.purgedRead} | ${measure.untouchedRead} |`;
		}),
		'',
	];

	await mkdir(outputDir, { recursive: true });
	await writeFile(join(outputDir, 'pending-retry.md'), lines.join('\n'));
	await writeFile(join(outputDir, 'pending-retry.json'), JSON.stringify(measures));

	// eslint-disable-next-line no-console
	console.info(lines.join('\n'));

	for (const measure of measures) {
		expect(measure.left).toBe(0);
		expect(measure.purgedRead).toBe('MISS');

		expect(measure.untouchedRead).toBe(measure.retry === 'slices'
			? 'HIT'
			: 'MISS');
	}
}, 3_600_000);
