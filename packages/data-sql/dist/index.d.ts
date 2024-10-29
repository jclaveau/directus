import { AbstractQueryNodeSortTargets, AbstractQuery } from '@directus/data';

interface SqlStatementColumn {
    type: 'primitive';
    table: string;
    column: string;
}
interface SqlStatementSelectColumn extends SqlStatementColumn {
    as?: string;
}
/**
 * Used for parameterized queries.
 */
type ParameterIndex = {
    /** Indicates where the actual value is stored in the parameter array */
    parameterIndex: number;
};
/**
 * This is an abstract SQL query which can be passen to all SQL drivers.
 *
 * @example
 * ```ts
 * const query: SqlStatement = {
 *  select: [id],
 *  from: 'articles',
 *  limit: 0,
 * 	parameters: [25],
 * };
 * ```
 */
interface AbstractSqlQuery {
    select: SqlStatementSelectColumn[];
    from: string;
    limit?: ParameterIndex;
    offset?: ParameterIndex;
    order?: AbstractSqlQueryOrderNode[];
    where?: AbstractSqlQueryWhereConditionNode | AbstractSqlQueryWhereLogicalNode;
    intersect?: AbstractSqlQuery;
    parameters: (string | boolean | number)[];
}
type AbstractSqlQueryOrderNode = {
    orderBy: AbstractQueryNodeSortTargets;
    direction: 'ASC' | 'DESC';
};
/**
 * An abstract WHERE clause.
 */
interface AbstractSqlQueryWhereConditionNode {
    type: 'condition';
    target: SqlStatementColumn;
    operation: 'eq' | 'lt' | 'lte' | 'gt' | 'gte' | 'in' | 'contains' | 'starts_with' | 'ends_with' | 'intersects';
    negate: boolean;
    compareTo: CompareValueNode;
}
interface AbstractSqlQueryWhereLogicalNode {
    type: 'logical';
    operator: 'and' | 'or';
    negate: boolean;
    childNodes: (AbstractSqlQueryWhereConditionNode | AbstractSqlQueryWhereLogicalNode)[];
}
interface CompareValueNode {
    type: 'value';
    parameterIndexes: number[];
}
/**
 * An actual vendor specific SQL statement with its parameters.
 * @example
 * ```
 * {
 * 		statement: 'SELECT * FROM "articles" WHERE "articles"."id" = $1;',
 * 		values: [99],
 * }
 * ```
 */
interface ParameterizedSQLStatement {
    statement: string;
    parameters: (string | number | boolean)[];
}

/**
 * @param abstractQuery the abstract query to convert
 * @returns a format very close to actual SQL but without making assumptions about the actual SQL dialect
 */
declare const convertAbstractQueryToAbstractSqlQuery: (abstractQuery: AbstractQuery) => AbstractSqlQuery;

export { AbstractSqlQuery, AbstractSqlQueryOrderNode, AbstractSqlQueryWhereConditionNode, AbstractSqlQueryWhereLogicalNode, CompareValueNode, ParameterizedSQLStatement, SqlStatementSelectColumn, convertAbstractQueryToAbstractSqlQuery };
