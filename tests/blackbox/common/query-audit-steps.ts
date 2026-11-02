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
 * The url a feature's requests go to: an audited instance's when a scenario
 * counts its statements, else the shared instance's. Call it inside the
 * vendor's describe, as it registers the instance's hooks there.
 */
export function instanceUrlForFeature(feature: ParsedFeature, vendor: Vendor) {
	const countsStatements = [
		...feature.scenarios,
		...feature.scenarioOutlines,
	].some(({ steps }) => {
		return steps.some(({ stepText }) => stepText === STATEMENT_COUNTS_STEP);
	});

	if (countsStatements) {
		return startAuditedInstance(vendor);
	}

	return () => getUrl(vendor);
}

// Each table a response's statements touched, with how many of each kind.
function countStatements(response: Response, requestPosition: number) {
	const countsByTable: Record<string, Record<string, number>> = {};
	const auditHeader = response.headers[QUERY_AUDIT_HEADER];

	if (auditHeader === undefined) {
		throw new Error(
			`Request ${requestPosition} answered without the ${QUERY_AUDIT_HEADER} `
			+ 'header: it was not sent to the instance startAuditedInstance '
			+ 'started',
		);
	}

	const auditedStatements = (JSON.parse(auditHeader) as {
		statements: AuditEntry[];
	}).statements.flatMap((auditEntry) => {
		// A transaction's entry holds the statements it ran.
		if ('statements' in auditEntry) {
			return auditEntry.statements;
		}

		return [auditEntry];
	});

	for (const { stmt, count = 1 } of auditedStatements) {
		const [statementKind, tableName] = stmt
			.replace(/\.\.\.$/, '')
			.split(' ') as [string, string];

		countsByTable[tableName] ??= { select: 0, insert: 0, update: 0, delete: 0 };
		const tableCounts = countsByTable[tableName];
		tableCounts[statementKind] = (tableCounts[statementKind] ?? 0) + count;
	}

	return countsByTable;
}

// The rows as the feature file spells them, so a failure prints the table
// the scenario should hold.
function gherkinTableOf(countRows: Record<string, unknown>[]) {
	const cellRows = [
		[...STATEMENT_COUNTS_COLUMNS],
		...countRows.map((countRow) => {
			return STATEMENT_COUNTS_COLUMNS.map((column) => {
				return String(countRow[column]);
			});
		}),
	];

	const columnWidths = STATEMENT_COUNTS_COLUMNS.map((_column, position) => {
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
 * request table, every table it touched and how many statements of each kind.
 * Other vendors run other statements, so only postgres is held to it.
 */
export function defineStatementCountsStep(
	and: StepFunction,
	vendor: Vendor,
	receivedResponses: Response[],
) {
	and.optional(
		STATEMENT_COUNTS_STEP,
		(table: Record<string, string>[]) => {
			if (vendor !== 'postgres') {
				return;
			}

			const ranCounts = [
				...new Set(table.map(({ request }) => Number(request))),
			].flatMap((requestPosition) => {
				const countsByTable = countStatements(
					receivedResponses[requestPosition - 1]!,
					requestPosition,
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

			expect(
				ranCounts,
				`The requests ran these statements:\n${gherkinTableOf(ranCounts)}\n`,
			).toEqual(parseGherkinTable(table));
		},
	);
}
