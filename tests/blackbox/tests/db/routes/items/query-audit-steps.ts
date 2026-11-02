import config, { getUrl, paths } from '@common/config';
import {
	parseGherkinTable,
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

const COUNTED_COLUMNS = [
	'request',
	'table',
	'select',
	'insert',
	'update',
	'delete',
];

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

/**
 * Starts an instance of the feature's own, sharing the vendor's database, that
 * answers with the statements each request ran: the shared instance must not.
 * Returns its url, known once the instance listens.
 */
export function startAuditedInstance(vendor: Vendor) {
	const env = cloneDeep(config.envs);
	let auditedInstance: ChildProcess;

	beforeAll(async () => {
		const port = await freePortOfWorker();
		env[vendor].PORT = String(port);
		env[vendor]['PUBLIC_URL'] = getUrl(vendor, env);
		env[vendor]['QUERY_AUDIT_HEADER'] = QUERY_AUDIT_HEADER;
		env[vendor]['QUERY_AUDIT_LEVEL'] = 'counts';

		auditedInstance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(port);

		// The first request also reads the admin's access, cached after it.
		const warmUp = await request(getUrl(vendor, env))
			.get('/users/me')
			.set('Authorization', AUTH);

		expect(warmUp.statusCode).toBe(200);
	}, 60_000);

	afterAll(() => {
		return stopSpawnedInstance(auditedInstance);
	}, 60_000);

	return () => getUrl(vendor, env);
}

/**
 * Each table a response's statements touched, with how many of each keyword.
 * A counts-level `stmt` is `<keyword> <table>...`, `<keyword> <function>...`
 * when it names no table, or `<keyword>...` when it calls no function either.
 */
function countStatements(response: Response) {
	const countsByTable: Record<string, Record<string, number>> = {};

	const auditedStatements = (JSON.parse(
		response.headers[QUERY_AUDIT_HEADER]!,
	) as { statements: AuditEntry[] }).statements.flatMap((auditEntry) => {
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

// The rows as a Gherkin table to paste back, every keyword a column, 0 if unrun.
function gherkinTableOf(rows: Record<string, unknown>[]): string {
	const columns = [...new Set([...COUNTED_COLUMNS, ...rows.flatMap(Object.keys)])];

	const lines = [columns, ...rows.map((row) => {
		return columns.map((column) => String(row[column] ?? 0));
	})];

	const widths = columns.map((_column, columnIndex) => {
		return Math.max(...lines.map((line) => line[columnIndex]!.length));
	});

	return lines.map((line) => {
		return `| ${line.map((cell, columnIndex) => {
			return cell.padEnd(widths[columnIndex]!);
		}).join(' | ')} |`;
	}).join('\n');
}

/**
 * The last step of a scenario: per request it names, by its position in the
 * When table, every table it touched and how many statements of each keyword.
 * A keyword outside select, insert, update and delete is a column of its own,
 * named after it, whose empty or 0 cells are left out; a statement naming no
 * table counts under its function, or under `(no table)`.
 * Other vendors run other statements, so only postgres is held to it.
 */
export function defineStatementCountsStep(
	and: StepFunction,
	vendor: Vendor,
	receivedResponses: Response[],
) {
	and.optional(
		'on postgres the requests ran these statements:',
		(table: Record<string, string>[]) => {
			if (vendor !== 'postgres') {
				return;
			}

			const receivedRows = [...new Set(table.map(({ request: requestPosition }) => {
				return Number(requestPosition);
			}))].flatMap((requestPosition) => {
				const countsByTable = countStatements(
					receivedResponses[requestPosition - 1]!,
				);

				return Object.keys(countsByTable)
					.sort()
					.map((tableName) => {
						return {
							request: requestPosition,
							table: tableName,
							...countsByTable[tableName],
						};
					});
			});

			const expectedRows = parseGherkinTable(table).map((row) => {
				return Object.fromEntries(Object.entries(row).filter(([column, value]) => {
					return COUNTED_COLUMNS.includes(column)
						|| (value !== null && value !== 0);
				}));
			});

			expect(
				receivedRows,
				`the requests ran these statements:\n${gherkinTableOf(receivedRows)}`,
			).toEqual(expectedRows);
		},
	);
}
