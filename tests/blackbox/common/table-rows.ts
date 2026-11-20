import config from '@common/config';
import { type ParsedFeature, parseGherkinTable } from '@common/cucumber';
import type { Vendor } from '@common/get-dbs-to-test';
import knex from 'knex';

const TABLE_ROWS_STEP = /^the rows of (\S+):$/;

/**
 * Writes a Given's rows straight into the test database. A Given states the
 * database a scenario starts from: sent through the API, a row would first
 * run that endpoint's statements, hooks and cache purges, and `/items`
 * refuses the `directus_*` tables outright. A cell reads as JSON, as
 * `parseGherkinTable` reads it, and an object or array is stored as its JSON
 * text, which is how a JSON column holds it.
 */
export async function insertTableRows(
	vendor: Vendor,
	tableName: string,
	tableRows: Record<string, string>[],
) {
	const database = knex(config.knexConfig[vendor]);

	try {
		await database(tableName).insert(parseGherkinTable(tableRows)
			.map((tableRow) => {
				return Object.fromEntries(Object.entries(tableRow)
					.map(([column, cellValue]) => {
						return [
							column,
							typeof cellValue === 'object' && cellValue !== null
								? JSON.stringify(cellValue)
								: cellValue,
						];
					}));
			}));
	}
	finally {
		await database.destroy();
	}
}

/**
 * Binds one `the rows of <table>:` step per such step the scenario holds: the
 * library matches each step to the definition at its own position, so a
 * scenario seeding three tables needs three definitions.
 */
export function bindTableRowsSteps(
	bindStep: (matcher: RegExp, stepCallback: StepRowsCallback) => void,
	feature: ParsedFeature,
	scenarioTitle: string,
	writeRows: StepRowsCallback,
) {
	const scenarioSteps = feature.scenarios.find((candidate) => {
		return candidate.title === scenarioTitle;
	})?.steps ?? [];

	for (const scenarioStep of scenarioSteps) {
		if (TABLE_ROWS_STEP.test(scenarioStep.stepText)) {
			bindStep(TABLE_ROWS_STEP, writeRows);
		}
	}
}

type StepRowsCallback = (
	tableName: string,
	tableRows: Record<string, string>[],
) => Promise<void>;
