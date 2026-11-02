import config, { getUrl, paths } from '@common/config';
import {
	parseGherkinTable,
	type ParsedFeature,
	type StepFunction,
} from '@common/cucumber';
import type { Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { stopSpawnedInstance } from '@utils/stop-spawned-instance';
import { type ChildProcess, spawn } from 'child_process';
import { freePortOfWorker } from '@utils/free-port-of-worker';
import { cloneDeep } from 'lodash-es';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, expect } from 'vitest';

type AuditedStatement = { stmt: string; count?: number };

type AuditEntry =
	| AuditedStatement
	| { transaction: string; statements: AuditedStatement[] };

const QUERY_AUDIT_HEADER = 'x-query-audit';

// Past its default 8kb the header drops its last entries, which would leave
// their statements uncounted: an audited instance keeps them all.
const QUERY_AUDIT_ENV = {
	QUERY_AUDIT_HEADER,
	QUERY_AUDIT_LEVEL: 'counts',
	QUERY_AUDIT_HEADER_MAX_SIZE: '0',
};

const STATEMENT_COUNTS_STEP = 'on postgres the requests ran these statements:';

const STATEMENT_COUNTS_COLUMNS = [
	'request',
	'table',
	'select',
	'insert',
	'update',
	'delete',
] as const;

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

/**
 * Starts an instance of the feature's own, sharing the vendor's database, that
 * answers with the statements each request ran: the shared instance must not.
 * Returns its url, known once the instance listens. Only postgres is held to
 * the counts, so any other vendor keeps the shared instance.
 */
export function startAuditedInstance(vendor: Vendor) {
	if (vendor !== 'postgres') {
		return () => getUrl(vendor);
	}

	const env = cloneDeep(config.envs);
	let auditedInstance: ChildProcess;

	beforeAll(async () => {
		const port = await freePortOfWorker();
		env[vendor].PORT = String(port);
		env[vendor]['PUBLIC_URL'] = getUrl(vendor, env);
		Object.assign(env[vendor], QUERY_AUDIT_ENV);

		auditedInstance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(port);
		await sendWarmUpRequest(getUrl(vendor, env));
	}, 60_000);

	afterAll(() => {
		return stopSpawnedInstance(auditedInstance);
	}, 60_000);

	return () => getUrl(vendor, env);
}

function countsStatements(feature: ParsedFeature) {
	return [
		...feature.scenarios,
		...feature.scenarioOutlines,
	].some(({ steps }) => {
		return steps.some(({ stepText }) => stepText === STATEMENT_COUNTS_STEP);
	});
}

/**
 * The url a feature's requests go to: an audited instance's when a scenario
 * counts its statements, else the shared instance's. Call it inside the
 * vendor's describe, as it registers the instance's hooks there.
 */
export function instanceUrlForFeature(feature: ParsedFeature, vendor: Vendor) {
	if (countsStatements(feature)) {
		return startAuditedInstance(vendor);
	}

	return () => getUrl(vendor);
}

/**
 * The env a feature already spawning an instance of its own adds, so that
 * instance answers with the statements each request ran.
 */
export function auditEnvForFeature(feature: ParsedFeature, vendor: Vendor) {
	if (vendor !== 'postgres' || !countsStatements(feature)) {
		return {};
	}

	return QUERY_AUDIT_ENV;
}

/**
 * Readies the instance a feature spawned for its counts, as
 * `startAuditedInstance` readies its own: whichever scenario runs first then
 * counts the same statements as when it runs after the others.
 */
export async function warmUpAuditedInstance(
	feature: ParsedFeature,
	vendor: Vendor,
	instanceUrl: string,
) {
	if (vendor !== 'postgres' || !countsStatements(feature)) {
		return;
	}

	await sendWarmUpRequest(instanceUrl);
}

// An instance's first request also reads the admin's access and the schema,
// both cached after it.
async function sendWarmUpRequest(instanceUrl: string) {
	const warmUp = await request(instanceUrl)
		.get('/users/me')
		.set('Authorization', AUTH);

	expect(warmUp.statusCode).toBe(200);
}

/**
 * Each table a response's statements touched, with how many of each keyword.
 * A counts-level `stmt` is `<keyword> <table>...`, `<keyword> <function>()...`
 * when it names no table, or `<keyword>...` when it calls no function either.
 */
function countStatements(
	response: Response | undefined,
	requestPosition: number,
) {
	if (response === undefined) {
		throw new Error(
			`Request ${requestPosition} got no HTTP response: only an HTTP call `
			+ 'has its statements counted',
		);
	}

	const countsByTable: Record<string, Record<string, number>> = {};
	const auditHeader = response.headers[QUERY_AUDIT_HEADER];

	if (auditHeader === undefined) {
		throw new Error(
			`Request ${requestPosition} answered without the ${QUERY_AUDIT_HEADER} `
			+ 'header: it was not sent to an instance started with the audit env',
		);
	}

	const { entriesDropped, statements } = JSON.parse(auditHeader) as {
		entriesDropped?: number;
		statements: AuditEntry[];
	};

	if (entriesDropped !== undefined) {
		throw new Error(
			`Request ${requestPosition}'s ${QUERY_AUDIT_HEADER} header dropped `
			+ `${entriesDropped} entries: their statements cannot be counted`,
		);
	}

	const auditedStatements = statements.flatMap((auditEntry) => {
		// A transaction's entry holds the statements it ran.
		if ('statements' in auditEntry) {
			return auditEntry.statements;
		}

		return [auditEntry];
	});

	for (const { stmt, count = 1 } of auditedStatements) {
		const cutMatch = /^([a-z]+)(?: (\S+))?\.\.\.$/.exec(stmt);

		if (cutMatch === null) {
			throw new Error(`"${stmt}" is no counts-level stmt`);
		}

		const [, statementKeyword, tableName = '(no table)'] = cutMatch as [
			string,
			string,
			string | undefined,
		];

		countsByTable[tableName] ??= { select: 0, insert: 0, update: 0, delete: 0 };
		const tableCounts = countsByTable[tableName];

		tableCounts[statementKeyword] = (tableCounts[statementKeyword] ?? 0)
			+ count;
	}

	return countsByTable;
}

// The rows as the feature file spells them, so a failure prints the table
// the scenario should hold: every keyword a column, 0 where it did not run.
function gherkinTableOf(countRows: Record<string, unknown>[]) {
	const tableColumns = [...new Set([
		...STATEMENT_COUNTS_COLUMNS,
		...countRows.flatMap(Object.keys),
	])];

	const cellRows = [
		tableColumns,
		...countRows.map((countRow) => {
			return tableColumns.map((column) => String(countRow[column] ?? 0));
		}),
	];

	const columnWidths = tableColumns.map((_column, position) => {
		return Math.max(...cellRows.map((cells) => cells[position]!.length));
	});

	return cellRows.map((cells) => {
		return `| ${cells.map((cell, position) => {
			return cell.padEnd(columnWidths[position]!);
		}).join(' | ')} |`;
	}).join('\n');
}

/**
 * The last step of a scenario: per request it names, by its position in the
 * request table, every table it touched and how many statements of each keyword.
 * A keyword outside select, insert, update and delete is a column of its own,
 * named after it, whose empty or 0 cells are left out; a statement naming no
 * table counts under its function, as `nextval()`, or under `(no table)`. A
 * request that ran no statement holds one `(none)` row of zeros.
 * Other vendors run other statements, so only postgres is held to it.
 */
export function defineStatementCountsStep(
	and: StepFunction,
	vendor: Vendor,
	receivedResponses: (Response | undefined)[],
) {
	and.optional(
		STATEMENT_COUNTS_STEP,
		(table: Record<string, string>[]) => {
			if (vendor !== 'postgres') {
				return;
			}

			if (table.length === 0) {
				throw new Error(
					'The statement counts name no request: a header-only table '
					+ 'holds every request to nothing',
				);
			}

			const ranCounts = [
				...new Set(table.map(({ request }) => request)),
			].flatMap((requestCell) => {
				const requestPosition = Number(requestCell);

				if (
					!Number.isInteger(requestPosition)
					|| requestPosition < 1
					|| requestPosition > receivedResponses.length
				) {
					throw new Error(
						`The statement counts name request "${requestCell}": only `
						+ `requests 1 to ${receivedResponses.length} were sent`,
					);
				}

				const countsByTable = countStatements(
					receivedResponses[requestPosition - 1],
					requestPosition,
				);

				const ranTableNames = Object.keys(countsByTable).sort();

				// Without a row of its own, a request is left unchecked.
				if (ranTableNames.length === 0) {
					return [{
						request: requestPosition,
						table: '(none)',
						select: 0,
						insert: 0,
						update: 0,
						delete: 0,
					}];
				}

				return ranTableNames
					.map((tableName) => {
						return {
							request: requestPosition,
							table: tableName,
							...countsByTable[tableName],
						};
					});
			});

			// A keyword column of its own lists only the requests that ran it.
			expect(
				ranCounts,
				`The requests ran these statements:\n${gherkinTableOf(ranCounts)}\n`,
			).toEqual(parseGherkinTable(table).map((expectedRow) => {
				return Object.fromEntries(Object.entries(expectedRow).filter(
					([column, value]) => {
						return (STATEMENT_COUNTS_COLUMNS as readonly string[])
							.includes(column)
							|| (value !== null && value !== 0);
					},
				));
			}));
		},
	);
}
