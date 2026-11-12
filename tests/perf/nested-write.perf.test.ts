import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, test } from 'vitest';
import { createExtensionPackage } from './extension-package.js';
import { summarise, summaryRow } from './measure.js';

/**
 * What a nested batch create costs as the batch grows
 * (https://github.com/jclaveau/directus/issues/414).
 *
 * One `POST` creates N parents, each with two children through a one-to-many
 * alias, the shape the planner sends. #414 batched those nested writes, so the
 * statements a create runs no longer grow with N: this reports them per size,
 * read off the instance's `QUERY_AUDIT_HEADER`, beside the request's time.
 *
 * Every child is scoped through its parent and the scoped cache is on, as the
 * planner's are, so the purge's scope reads are counted too.
 *
 * Fails when a larger batch runs more statements than the smallest one; the
 * time is shown, never judged.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const cli = process.env['PERF_CLI'] ?? join(root, 'dist', 'cli');
const adminToken = process.env['PERF_ADMIN_TOKEN'] ?? 'bench-admin-token';

const instancePort = Number(process.env['PERF_NESTED_WRITE_PORT'] ?? 8350);

const outputDir = process.env['PERF_OUTPUT_DIR']
	?? join(root, 'tests', 'perf', 'results');

const parentCounts = (process.env['PERF_NESTED_WRITE_SIZES'] ?? '2,20,100')
	.split(',')
	.map(Number);

const repetitionCount = Number(process.env['PERF_NESTED_WRITE_REPS'] ?? 7);

const CHILDREN_PER_PARENT = 2;
const AUDIT_HEADER = 'x-query-audit';
const DECK = 'bench_nw_deck';
const CARD = 'bench_nw_card';

const authHeaders = {
	'Authorization': `Bearer ${adminToken}`,
	'Content-Type': 'application/json',
};

type AuditedStatement = { stmt: string; count?: number };

type AuditEntry =
	| AuditedStatement
	| { transaction: string; statements: AuditedStatement[] };

type StatementCounts = Record<string, Record<string, number>>;

let instance: ChildProcess | undefined;
const base = `http://127.0.0.1:${instancePort}`;
const lines: string[] = [];

async function sendRequest(path: string, init: RequestInit = {}) {
	const response = await fetch(`${base}${path}`, {
		...init,
		headers: authHeaders,
	});

	const text = await response.text();

	if (!response.ok) {
		const excerpt = JSON.stringify(text.slice(0, 300));

		throw new Error(
			`${response.status} for ${JSON.stringify(path)}: ${excerpt}`,
		);
	}

	return response;
}

async function startInstance(): Promise<ChildProcess> {
	const spawned = spawn('node', [cli, 'start'], {
		env: {
			...process.env,
			NODE_ENV: 'production',
			SERVE_APP: 'false',
			LOG_LEVEL: 'warn',
			TELEMETRY: 'false',
			PACKAGE_FILE_LOCATION: await createExtensionPackage(),
			PORT: String(instancePort),
			PUBLIC_URL: base,
			// The bench times the write, not the front door.
			PRESSURE_LIMITER_ENABLED: 'false',
			CACHE_ENABLED: 'true',
			CACHE_STORE: 'redis',
			CACHE_AUTO_PURGE: 'true',
			CACHE_AUTO_PURGE_MODE: 'scoped',
			CACHE_NAMESPACE: 'perf-nested-write',
			QUERY_AUDIT_HEADER: AUDIT_HEADER,
			QUERY_AUDIT_LEVEL: 'counts',
			// Past its default 8kb the header drops entries, uncounted.
			QUERY_AUDIT_HEADER_MAX_SIZE: '0',
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

async function seedCollections(): Promise<void> {
	for (const collection of [CARD, DECK]) {
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

	await sendRequest('/collections', {
		method: 'POST',
		body: JSON.stringify([
			{
				collection: DECK,
				meta: { scoped_cache_fields: ['owner'] },
				schema: {},
				fields: [
					primaryKey,
					{ field: 'owner', type: 'string', meta: {}, schema: {} },
				],
			},
			{
				collection: CARD,
				meta: { scoped_cache_fields: ['deck.owner'] },
				schema: {},
				fields: [
					primaryKey,
					{ field: 'label', type: 'string', meta: {}, schema: {} },
				],
			},
		]),
	});

	await sendRequest(`/fields/${CARD}`, {
		method: 'POST',
		body: JSON.stringify({
			field: 'deck',
			type: 'integer',
			meta: { special: ['m2o'] },
			schema: {},
		}),
	});

	await sendRequest(`/fields/${DECK}`, {
		method: 'POST',
		body: JSON.stringify({
			field: 'cards',
			type: 'alias',
			meta: { special: ['o2m'] },
			schema: null,
		}),
	});

	await sendRequest('/relations', {
		method: 'POST',
		body: JSON.stringify({
			collection: CARD,
			field: 'deck',
			related_collection: DECK,
			meta: { one_field: 'cards' },
			schema: { on_delete: 'SET NULL' },
		}),
	});
}

function buildPayload(parentCount: number, repetition: number) {
	return Array.from({ length: parentCount }, (_, parentIndex) => {
		return {
			owner: `u${parentIndex % 2}`,
			cards: Array.from({ length: CHILDREN_PER_PARENT }, (_, childIndex) => {
				return { label: `r${repetition} p${parentIndex} c${childIndex}` };
			}),
		};
	});
}

/** Each table the request's statements touched, with each keyword's count. */
function countStatements(auditHeader: string | null): StatementCounts {
	if (auditHeader === null) {
		throw new Error(`The create answered without ${AUDIT_HEADER}`);
	}

	const { entriesDropped, statements } = JSON.parse(auditHeader) as {
		entriesDropped?: number;
		statements: AuditEntry[];
	};

	if (entriesDropped !== undefined) {
		throw new Error(
			`${AUDIT_HEADER} dropped ${JSON.stringify(entriesDropped)} entries`,
		);
	}

	const countsByTable: StatementCounts = {};

	const flatStatements = statements.flatMap((auditEntry) => {
		return 'statements' in auditEntry
			? auditEntry.statements
			: [auditEntry];
	});

	for (const { stmt, count = 1 } of flatStatements) {
		const cutMatch = /^([a-z]+)(?: (\S+))?\.\.\.$/.exec(stmt);

		if (cutMatch === null) {
			throw new Error(`${JSON.stringify(stmt)} is no counts-level stmt`);
		}

		const statementKeyword = cutMatch[1]!;
		const tableName = cutMatch[2] ?? '(no table)';

		countsByTable[tableName] ??= {};
		const tableCounts = countsByTable[tableName];

		tableCounts[statementKeyword] = (tableCounts[statementKeyword] ?? 0)
			+ count;
	}

	return countsByTable;
}

function totalOf(counts: StatementCounts): number {
	return Object.values(counts)
		.flatMap((tableCounts) => Object.values(tableCounts))
		.reduce((sum, count) => sum + count, 0);
}

function describeCounts(counts: StatementCounts): string {
	return Object.entries(counts)
		.sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
		.map(([tableName, tableCounts]) => {
			const keywords = Object.entries(tableCounts)
				.map(([keyword, count]) => `${keyword} ${count}`)
				.join(' ');

			return `${tableName}: ${keywords}`;
		})
		.join('; ');
}

beforeAll(async () => {
	instance = await startInstance();
	await seedCollections();
}, 10 * 60 * 1000);

afterAll(async () => {
	// An instance that died mid-measurement already closed: waiting for its
	// close again would hold the job until the 10 min hook timeout.
	if (instance !== undefined && instance.exitCode === null
		&& instance.signalCode === null) {
		instance.kill('SIGTERM');
		await new Promise((closed) => instance!.on('close', closed));
	}

	await writeFile(join(outputDir, 'nested-write.md'), lines.join('\n'))
		.catch(() => undefined);
});

test('what a nested batch create costs per parent count', async () => {
	await mkdir(outputDir, { recursive: true });

	// The plan, the schema and the admin's access warm before anything is
	// measured.
	await sendRequest(`/items/${DECK}`, {
		method: 'POST',
		body: JSON.stringify(buildPayload(2, -1)),
	});

	const timeRows: string[] = [];
	const countRows: string[] = [];
	const scalingBreaches: string[] = [];
	let smallestTotal: number | undefined;
	let smallestCount = 0;

	for (const parentCount of parentCounts) {
		const elapsedMs: number[] = [];
		const totals = new Set<number>();
		let lastCounts: StatementCounts = {};

		for (let repetition = 0; repetition < repetitionCount; repetition++) {
			// Serialized before the clock starts: the request is what is timed.
			const body = JSON.stringify(buildPayload(parentCount, repetition));
			const startedAt = performance.now();

			const response = await sendRequest(`/items/${DECK}`, {
				method: 'POST',
				body,
			});

			elapsedMs.push(performance.now() - startedAt);
			lastCounts = countStatements(response.headers.get(AUDIT_HEADER));
			totals.add(totalOf(lastCounts));
		}

		// Statements are the point; a size whose count moves between runs of
		// the same payload is a result of its own, never averaged away.
		const sortedTotals = [...totals].sort((left, right) => left - right);

		const totalCell = sortedTotals.length === 1
			? String(sortedTotals[0])
			: `${sortedTotals[0]}–${sortedTotals.at(-1)} (varies)`;

		const total = sortedTotals.at(-1)!;

		if (smallestTotal === undefined) {
			smallestTotal = total;
			smallestCount = parentCount;
		}

		const ratio = (total / smallestTotal).toFixed(2);

		if (total > smallestTotal) {
			scalingBreaches.push(
				`nested batch create ran ${JSON.stringify(total)} statements`
				+ ` at ${JSON.stringify(parentCount)} parents`
				+ ` vs ${JSON.stringify(smallestTotal)}`
				+ ` at ${JSON.stringify(smallestCount)} parents`
				+ ` (${JSON.stringify(Number(ratio))}×)`,
			);
		}

		countRows.push(
			`| ${parentCount} | ${parentCount * (1 + CHILDREN_PER_PARENT)}`
			+ ` | ${totalCell} vs ${smallestTotal} statements (${ratio}×)`
			+ ` | ${describeCounts(lastCounts)} |`,
		);

		timeRows.push(summaryRow(summarise(`${parentCount} parents`, elapsedMs)));
	}

	lines.push(
		'### Nested write — one batch create of N parents, 2 children each (#414)',
		'',
		`${repetitionCount} creates per size, scoped cache on.`,
		'',
		`#### Statements per create, against ${smallestCount} parents`,
		'',
		'| parents | rows written | statements | per table |',
		'| ---: | ---: | --- | --- |',
		...countRows,
		'',
		'#### Time per create',
		'',
		'| parents | min | median | p95 | max |',
		'| --- | ---: | ---: | ---: | ---: |',
		...timeRows,
		'',
	);

	if (scalingBreaches.length > 0) {
		throw new Error(scalingBreaches.join('\n'));
	}
}, 30 * 60 * 1000);
