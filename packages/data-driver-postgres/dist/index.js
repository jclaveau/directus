// src/index.ts
import { convertAbstractQueryToAbstractSqlQuery } from "@directus/data-sql";
import { Pool } from "pg";
import QueryStream from "pg-query-stream";

// src/utils/escape-identifier.ts
function escapeIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

// src/utils/wrap-column.ts
function wrapColumn(table, column, as) {
  let base = `${escapeIdentifier(table)}.${escapeIdentifier(column)}`;
  if (as) {
    base += ` AS ${escapeIdentifier(as)}`;
  }
  return base;
}

// src/query/select.ts
var select = ({ select: select2 }) => {
  const escapedColumns = select2.map(({ table, column, as }) => wrapColumn(table, column, as));
  return `SELECT ${escapedColumns.join(", ")}`;
};

// src/query/from.ts
function from({ from: from2 }) {
  return `FROM ${escapeIdentifier(from2)}`;
}

// src/query/limit.ts
function limit({ limit: limit2 }) {
  if (limit2 === void 0) {
    return null;
  }
  return `LIMIT $${limit2.parameterIndex + 1}`;
}

// src/query/offset.ts
function offset({ offset: offset2 }) {
  if (offset2 === void 0) {
    return null;
  }
  return `OFFSET $${offset2.parameterIndex + 1}`;
}

// src/query/where.ts
var where = ({ where: where2 }) => {
  if (where2 === void 0) {
    return null;
  }
  return `WHERE ${whereString(where2)}`;
};
var whereString = (where2) => {
  if (where2.type === "condition") {
    const target = wrapColumn(where2.target.table, where2.target.column);
    const comparison = getComparison(where2.operation, where2.compareTo, where2.negate);
    return `${target} ${comparison}`;
  } else {
    const logicalGroup = where2.childNodes.map(
      (childNode) => childNode.type === "condition" || childNode.negate ? whereString(childNode) : `(${whereString(childNode)})`
    ).join(where2.operator === "and" ? " AND " : " OR ");
    return where2.negate ? `NOT (${logicalGroup})` : logicalGroup;
  }
};
function getComparison(operation, compareTo, negate = false) {
  const parameterIndex = compareTo.parameterIndexes[0] + 1;
  switch (operation) {
    case "eq":
      return `${negate ? "!=" : "="} $${parameterIndex}`;
    case "gt":
      return `${negate ? "<=" : ">"} $${parameterIndex}`;
    case "gte":
      return `${negate ? "<" : ">="} $${parameterIndex}`;
    case "lt":
      return `${negate ? ">=" : "<"} $${parameterIndex}`;
    case "lte":
      return `${negate ? ">" : "<="} $${parameterIndex}`;
    case "contains":
      return `${negate ? "NOT LIKE" : "LIKE"} '%$${parameterIndex}%'`;
    case "starts_with":
      return `${negate ? "NOT LIKE" : "LIKE"} '$${parameterIndex}%'`;
    case "ends_with":
      return `${negate ? "NOT LIKE" : "LIKE"} '%$${parameterIndex}'`;
    case "in":
      return `${negate ? "NOT IN" : "IN"} (${compareTo.parameterIndexes.map((i) => `$${i + 1}`).join(", ")})`;
    default:
      throw new Error(`Unsupported operation: ${operation}`);
  }
}

// src/query/orderBy.ts
function orderBy({ order }) {
  if (order === void 0) {
    return null;
  }
  const sortExpressions = order.map((o) => {
    switch (o.orderBy.type) {
      case "primitive":
        return `${escapeIdentifier(o.orderBy.field)} ${o.direction}`;
      case "fn":
      case "m2o":
      case "a2o":
      default:
        throw new Error(`Type ${o.orderBy.type} hasn't been implemented yet`);
    }
  });
  return `ORDER BY ${sortExpressions.join(", ")}`;
}

// src/query/index.ts
function constructSqlQuery(query) {
  const statementParts = [select, from, where, orderBy, limit, offset];
  const statement = `${statementParts.map((part) => part(query)).filter((p) => p !== null).join(" ")};`;
  return {
    statement,
    parameters: query.parameters
  };
}

// src/index.ts
var DataDriverPostgres = class {
  #config;
  #pool;
  constructor(config) {
    this.#config = config;
    this.#pool = new Pool({
      connectionString: this.#config.connectionString
    });
  }
  async destroy() {
    await this.#pool.end();
  }
  async query(query) {
    try {
      const abstractSqlQuery = convertAbstractQueryToAbstractSqlQuery(query);
      const sql = constructSqlQuery(abstractSqlQuery);
      const queryStream = new QueryStream(sql.statement, sql.parameters);
      return this.#pool.query(queryStream);
    } catch (err) {
      throw new Error("Could not query the PostgreSQL datastore: " + err);
    }
  }
};
export {
  DataDriverPostgres as default
};
