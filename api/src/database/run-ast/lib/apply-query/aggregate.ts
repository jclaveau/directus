import type {
	Aggregate,
	Filter,
	Permission,
	SchemaOverview,
} from '@directus/types';
import type { Knex } from 'knex';
import {
	getCases,
} from '../../../../permissions/modules/process-ast/lib/get-cases.js';
import { isEqual } from '../../../../utils/lodash-es-used.js';
import { applyCaseWhen } from '../../utils/apply-case-when.js';
import type { AliasGenerator } from './create-alias-generator.js';

export type AggregateCaseOptions = {
	knex: Knex;
	cases: Filter[];
	permissions: Permission[];
	generateAlias: AliasGenerator;
};

const aggregateSqlByOperation = new Map([
	['count', 'count(?)'],
	['countDistinct', 'count(distinct ?)'],
	['avg', 'avg(?)'],
	['avgDistinct', 'avg(distinct ?)'],
	['sum', 'sum(?)'],
	['sumDistinct', 'sum(distinct ?)'],
	['min', 'min(?)'],
	['max', 'max(?)'],
]);

export function applyAggregate(
	schema: SchemaOverview,
	dbQuery: Knex.QueryBuilder,
	aggregate: Aggregate,
	collection: string,
	hasJoins: boolean,
	caseOptions?: AggregateCaseOptions,
): void {
	for (const [operation, fields] of Object.entries(aggregate)) {
		if (!fields) continue;

		for (const field of fields) {
			if (operation === 'countAll') {
				dbQuery.count('*', { as: 'countAll' });
				continue;
			}

			if (operation === 'count' && field === '*') {
				dbQuery.count('*', { as: 'count' });
				continue;
			}

			// A primary key is never null: this counts the rows read, as count(*) does.
			// `*` names no column a case could return.
			const countsRowsRead = ['count', 'countDistinct'].includes(operation)
				&& (field === '*' || schema.collections[collection]?.primary === field);

			const fieldCases = caseOptions && !countsRowsRead
				? getAggregateFieldCases(collection, field, caseOptions)
				: [];

			const aggregateSql = aggregateSqlByOperation.get(operation);

			if (caseOptions && aggregateSql && fieldCases.length > 0) {
				const { knex, cases, permissions, generateAlias } = caseOptions;

				// By key: the rule may read an o2m, or a join the rows do not go through
				const casedColumn = applyCaseWhen(
					{
						column: knex.raw('??.??', [collection, field]),
						columnCases: fieldCases,
						table: collection,
						cases,
						aliasMap: Object.create(null),
						permissions,
						generateAlias,
						readsCasesByKey: true,
					},
					{ knex, schema },
				);

				// knex drops the alias of an aggregate over a raw column
				dbQuery.select(knex.raw(`${aggregateSql} as ??`, [
					casedColumn,
					`${operation}->${field}`,
				]));

				continue;
			}

			if (operation === 'countDistinct' && !hasJoins && schema.collections[collection]?.primary === field) {
				// Optimize to count as primary keys are unique
				dbQuery.count(`${collection}.${field}`, { as: `countDistinct->${field}` });
				continue;
			}

			if (['count', 'countDistinct', 'avg', 'avgDistinct', 'sum', 'sumDistinct', 'min', 'max'].includes(operation)) {
				(dbQuery as any)[operation](`${collection}.${field}`, { as: `${operation}->${field}` });
			}
		}
	}
}

function getAggregateFieldCases(
	collection: string,
	field: string,
	{ cases, permissions }: AggregateCaseOptions,
) {
	const {
		cases: ruleCases,
		caseMap,
		allowedFields,
	} = getCases(collection, permissions, []);

	if (allowedFields.has('*') || allowedFields.has(field)) {
		return [];
	}

	const fieldCases = [
		...(caseMap['*'] ?? []),
		...(caseMap[field] ?? []),
	].map((caseIndex) => ruleCases[caseIndex]!);

	// Every row read already goes through a rule granting the field
	const everyRowGrantsField = cases.length > 0 && cases.every((rowCase) => {
		return fieldCases.some((fieldCase) => isEqual(fieldCase, rowCase));
	});

	if (everyRowGrantsField) {
		return [];
	}

	return fieldCases;
}
