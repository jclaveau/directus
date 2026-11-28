//#region src/utils/strip-quotes.ts
/**
* Strip leading/trailing quotes from a string and handle null values.
*/
function stripQuotes(value) {
	if (value === null || value === void 0) return null;
	const trimmed = value.trim();
	if (trimmed.startsWith(`'`) && trimmed.endsWith(`'`) || trimmed.startsWith("\"") && trimmed.endsWith("\"")) return trimmed.slice(1, -1);
	return value;
}

//#endregion
//#region src/dialects/mysql.ts
function rawColumnToColumn(rawColumn) {
	let dataType = rawColumn.COLUMN_TYPE.replace(/\(.*?\)/, "");
	if (rawColumn.COLUMN_TYPE.startsWith("tinyint(1)")) dataType = "boolean";
	return {
		name: rawColumn.COLUMN_NAME,
		table: rawColumn.TABLE_NAME,
		data_type: dataType,
		default_value: parseDefaultValue$3(rawColumn.COLUMN_DEFAULT),
		generation_expression: rawColumn.GENERATION_EXPRESSION || null,
		max_length: rawColumn.CHARACTER_MAXIMUM_LENGTH,
		numeric_precision: rawColumn.NUMERIC_PRECISION,
		numeric_scale: rawColumn.NUMERIC_SCALE,
		is_generated: !!rawColumn.EXTRA?.endsWith("GENERATED"),
		is_nullable: rawColumn.IS_NULLABLE === "YES",
		is_unique: rawColumn.COLUMN_KEY === "UNI",
		is_indexed: !!rawColumn.INDEX_NAME && rawColumn.INDEX_NAME.length > 0,
		is_primary_key: rawColumn.CONSTRAINT_NAME === "PRIMARY" || rawColumn.COLUMN_KEY === "PRI",
		has_auto_increment: rawColumn.EXTRA === "auto_increment",
		foreign_key_column: rawColumn.REFERENCED_COLUMN_NAME,
		foreign_key_table: rawColumn.REFERENCED_TABLE_NAME,
		comment: rawColumn.COLUMN_COMMENT
	};
}
function parseDefaultValue$3(value) {
	if (value === null || value.trim().toLowerCase() === "null") return null;
	return stripQuotes(value);
}
var MySQL = class {
	knex;
	constructor(knex) {
		this.knex = knex;
	}
	async overview() {
		const columns = await this.knex.raw(`
			SELECT
				C.TABLE_NAME as table_name,
				C.COLUMN_NAME as column_name,
				C.COLUMN_DEFAULT as default_value,
				C.IS_NULLABLE as is_nullable,
				C.COLUMN_TYPE as data_type,
				C.COLUMN_KEY as column_key,
				C.CHARACTER_MAXIMUM_LENGTH as max_length,
				C.EXTRA as extra
			FROM
				INFORMATION_SCHEMA.COLUMNS AS C
			LEFT JOIN
				INFORMATION_SCHEMA.TABLES AS T ON C.TABLE_NAME = T.TABLE_NAME
				AND C.TABLE_SCHEMA = T.TABLE_SCHEMA
			WHERE
				T.TABLE_TYPE = 'BASE TABLE' AND
				C.TABLE_SCHEMA = ?;
			`, [this.knex.client.database()]);
		const overview = {};
		for (const column of columns[0]) {
			if (column.table_name in overview === false) {
				const primaryKeys = columns[0].filter((nested) => {
					return nested.table_name === column.table_name && nested.column_key === "PRI";
				});
				overview[column.table_name] = {
					primary: primaryKeys.length !== 1 ? void 0 : primaryKeys[0].column_name,
					columns: {}
				};
			}
			let dataType = column.data_type.replace(/\(.*?\)/, "");
			if (column.data_type.startsWith("tinyint(1)")) dataType = "boolean";
			overview[column.table_name].columns[column.column_name] = {
				...column,
				default_value: column.extra === "auto_increment" ? "AUTO_INCREMENT" : parseDefaultValue$3(column.default_value),
				is_nullable: column.is_nullable === "YES",
				is_generated: column.extra?.endsWith("GENERATED") ?? false,
				data_type: dataType
			};
		}
		return overview;
	}
	/**
	* List all existing tables in the current schema/database
	*/
	async tables() {
		return (await this.knex.select("TABLE_NAME").from("INFORMATION_SCHEMA.TABLES").where({
			TABLE_TYPE: "BASE TABLE",
			TABLE_SCHEMA: this.knex.client.database()
		})).map(({ TABLE_NAME }) => TABLE_NAME);
	}
	async tableInfo(table) {
		const query = this.knex.select("TABLE_NAME", "ENGINE", "TABLE_SCHEMA", "TABLE_COLLATION", "TABLE_COMMENT").from("information_schema.tables").where({
			table_schema: this.knex.client.database(),
			table_type: "BASE TABLE"
		});
		if (table) {
			const rawTable = await query.andWhere({ table_name: table }).first();
			return {
				name: rawTable.TABLE_NAME,
				schema: rawTable.TABLE_SCHEMA,
				comment: rawTable.TABLE_COMMENT,
				collation: rawTable.TABLE_COLLATION,
				engine: rawTable.ENGINE
			};
		}
		return (await query).map((rawTable) => {
			return {
				name: rawTable.TABLE_NAME,
				schema: rawTable.TABLE_SCHEMA,
				comment: rawTable.TABLE_COMMENT,
				collation: rawTable.TABLE_COLLATION,
				engine: rawTable.ENGINE
			};
		});
	}
	/**
	* Check if a table exists in the current schema/database
	*/
	async hasTable(table) {
		const result = await this.knex.count({ count: "*" }).from("information_schema.tables").where({
			table_schema: this.knex.client.database(),
			table_name: table
		}).first();
		return result && result.count === 1 || false;
	}
	/**
	* Get all the available columns in the current schema/database. Can be filtered to a specific table
	*/
	async columns(table) {
		const query = this.knex.select("TABLE_NAME", "COLUMN_NAME").from("INFORMATION_SCHEMA.COLUMNS").where({ TABLE_SCHEMA: this.knex.client.database() });
		if (table) query.andWhere({ TABLE_NAME: table });
		return (await query).map(({ TABLE_NAME, COLUMN_NAME }) => ({
			table: TABLE_NAME,
			column: COLUMN_NAME
		}));
	}
	async columnInfo(table, column) {
		const query = this.knex.select("c.TABLE_NAME", "c.COLUMN_NAME", "c.COLUMN_DEFAULT", "c.COLUMN_TYPE", "c.CHARACTER_MAXIMUM_LENGTH", "c.IS_NULLABLE", "c.COLUMN_KEY", "c.EXTRA", "c.COLLATION_NAME", "c.COLUMN_COMMENT", "c.NUMERIC_PRECISION", "c.NUMERIC_SCALE", "c.GENERATION_EXPRESSION", "fk.REFERENCED_TABLE_NAME", "fk.REFERENCED_COLUMN_NAME", "fk.CONSTRAINT_NAME", "rc.UPDATE_RULE", "rc.DELETE_RULE", "rc.MATCH_OPTION", "stats.INDEX_NAME").from("INFORMATION_SCHEMA.COLUMNS as c").leftJoin("INFORMATION_SCHEMA.KEY_COLUMN_USAGE as fk", function() {
			this.on("c.TABLE_NAME", "=", "fk.TABLE_NAME").andOn("fk.COLUMN_NAME", "=", "c.COLUMN_NAME").andOn("fk.CONSTRAINT_SCHEMA", "=", "c.TABLE_SCHEMA");
		}).leftJoin("INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS as rc", function() {
			this.on("rc.TABLE_NAME", "=", "fk.TABLE_NAME").andOn("rc.CONSTRAINT_NAME", "=", "fk.CONSTRAINT_NAME").andOn("rc.CONSTRAINT_SCHEMA", "=", "fk.CONSTRAINT_SCHEMA");
		}).leftJoin("INFORMATION_SCHEMA.STATISTICS as stats", function() {
			this.on("stats.TABLE_SCHEMA", "=", "c.TABLE_SCHEMA").andOn("stats.TABLE_NAME", "=", "c.TABLE_NAME").andOn("stats.COLUMN_NAME", "=", "c.COLUMN_NAME").andOnVal("stats.NON_UNIQUE", 1).andOnVal("stats.SEQ_IN_INDEX", 1);
		}).where({ "c.TABLE_SCHEMA": this.knex.client.database() });
		if (table) query.andWhere({ "c.TABLE_NAME": table });
		if (column) return rawColumnToColumn(await query.andWhere({ "c.column_name": column }).first());
		return (await query).map(rawColumnToColumn).sort((column$1) => +!column$1.foreign_key_column).filter((column$1, index, records) => {
			return records.findIndex((_column) => {
				return column$1.name === _column.name && column$1.table === _column.table;
			}) === index;
		});
	}
	/**
	* Check if a table exists in the current schema/database
	*/
	async hasColumn(table, column) {
		const result = await this.knex.count("*", { as: "count" }).from("information_schema.columns").where({
			table_schema: this.knex.client.database(),
			table_name: table,
			column_name: column
		}).first();
		return !!(result && result.count);
	}
	/**
	* Get the primary key column for the given table
	*/
	async primary(table) {
		const results = await this.knex.raw(`SHOW KEYS FROM ?? WHERE Key_name = 'PRIMARY'`, table);
		if (results && results.length && results[0].length) return results[0][0]["Column_name"];
		return null;
	}
	async foreignKeys(table) {
		const result = await this.knex.raw(`
		 SELECT DISTINCT
			rc.TABLE_NAME AS 'table',
			kcu.COLUMN_NAME AS 'column',
			rc.REFERENCED_TABLE_NAME AS 'foreign_key_table',
			kcu.REFERENCED_COLUMN_NAME AS 'foreign_key_column',
			rc.CONSTRAINT_NAME AS 'constraint_name',
			rc.UPDATE_RULE AS on_update,
			rc.DELETE_RULE AS on_delete
		 FROM
			information_schema.referential_constraints AS rc
		 JOIN information_schema.key_column_usage AS kcu ON
			rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
			AND kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
		 WHERE
			rc.CONSTRAINT_SCHEMA = ?;
	  `, [this.knex.client.database()]);
		if (table) return result?.[0]?.filter((row) => row.table === table).map((row) => ({ ...row })) ?? [];
		return result?.[0]?.map((row) => ({ ...row })) ?? [];
	}
};

//#endregion
//#region src/dialects/postgres.ts
/**
* Converts Postgres default value to JS
* Eg `'example'::character varying` => `example`
*/
function parseDefaultValue$2(value) {
	if (value === null) return null;
	if (value.startsWith("nextval(")) return value;
	value = value.split("::")[0] ?? null;
	if (value?.trim().toLowerCase() === "null") return null;
	return stripQuotes(value);
}
var Postgres = class {
	knex;
	schema;
	explodedSchema;
	constructor(knex) {
		this.knex = knex;
		const config = knex.client.config;
		if (!config.searchPath) {
			this.schema = "public";
			this.explodedSchema = [this.schema];
		} else if (typeof config.searchPath === "string") {
			this.schema = config.searchPath;
			this.explodedSchema = [config.searchPath];
		} else {
			this.schema = config.searchPath[0];
			this.explodedSchema = config.searchPath;
		}
	}
	/**
	* Set the schema to be used in other methods
	*/
	withSchema(schema) {
		this.schema = schema;
		this.explodedSchema = [this.schema];
		return this;
	}
	async overview() {
		const bindings = this.explodedSchema.map(() => "?").join(",");
		const [columnsResult, primaryKeysResult, uniqueIndexResult] = await Promise.all([
			this.knex.raw(`
        SELECT c.table_name
          , c.column_name
          , c.column_default as default_value
          , c.data_type
			 		, c.character_maximum_length as max_length
          , c.is_generated = 'ALWAYS' is_generated
          , CASE WHEN c.is_identity = 'YES' THEN true ELSE false END is_identity
          , CASE WHEN c.is_nullable = 'YES' THEN true ELSE false END is_nullable
        FROM
          information_schema.columns c
        LEFT JOIN information_schema.tables t
          ON c.table_name = t.table_name
        WHERE
          t.table_type = 'BASE TABLE'
          AND c.table_schema IN (${bindings});
      `, this.explodedSchema),
			this.knex.raw(`
        SELECT relname as table_name
          , pg_attribute.attname as column_name
        FROM pg_index
          , pg_class
          , pg_attribute
          , pg_namespace
        WHERE
          indrelid = pg_class.oid
          AND nspname IN (${bindings})
          AND pg_class.relnamespace = pg_namespace.oid
          AND pg_attribute.attrelid = pg_class.oid
          AND pg_attribute.attnum = ANY (pg_index.indkey)
          AND indisprimary
          AND indnatts = 1
			 AND relkind != 'S'
      `, this.explodedSchema),
			this.knex.raw(`
        SELECT DISTINCT c.relname AS table_name
          , a.attname AS column_name
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a
          ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
        WHERE i.indisunique
          AND NOT i.indisprimary
          AND i.indpred IS NULL
          AND i.indexprs IS NULL
          AND c.relkind IN ('r', 'p')
          AND n.nspname IN (${bindings})
      `, this.explodedSchema)
		]);
		const columns = columnsResult.rows;
		const primaryKeys = primaryKeysResult.rows;
		let geometryColumns = [];
		if ((await this.knex.raw(`SELECT oid FROM pg_proc WHERE proname = 'postgis_version'`)).rows.length > 0) geometryColumns = (await this.knex.raw(`WITH geometries as (
					select * from geometry_columns
					union
					select * from geography_columns
				)
				SELECT f_table_name as table_name
					, f_geometry_column as column_name
					, type as data_type
				FROM geometries g
				JOIN information_schema.tables t
					ON g.f_table_name = t.table_name
					AND t.table_type = 'BASE TABLE'
				WHERE f_table_schema in (${bindings})
				`, this.explodedSchema)).rows;
		const overview = {};
		for (const column of columns) {
			if (column.is_identity || column.default_value?.startsWith("nextval(")) column.default_value = "AUTO_INCREMENT";
			else column.default_value = parseDefaultValue$2(column.default_value);
			if (column.table_name in overview === false) overview[column.table_name] = {
				columns: {},
				primary: void 0
			};
			if (["point", "polygon"].includes(column.data_type)) column.data_type = "unknown";
			overview[column.table_name].columns[column.column_name] = column;
		}
		for (const { table_name, column_name } of primaryKeys) if (overview[table_name]) overview[table_name].primary = column_name;
		else console.error(`Could not set primary key "${column_name}" for unknown table "${table_name}"`);
		for (const { table_name, column_name } of uniqueIndexResult.rows) {
			const uniqueTable = overview[table_name];
			const uniqueColumn = uniqueTable?.columns[column_name];
			if (uniqueColumn) uniqueColumn.in_unique_index = true;
			else if (uniqueTable) console.error(`Could not flag unique column ${JSON.stringify(column_name)} of table ${JSON.stringify(table_name)}: information_schema.columns lists only the columns the user holds a privilege on`);
			else console.error(`Could not flag unique column "${column_name}" of unknown table "${table_name}"`);
		}
		for (const { table_name, column_name, data_type } of geometryColumns) if (overview[table_name]) if (overview[table_name].columns[column_name]) overview[table_name].columns[column_name].data_type = data_type;
		else console.error(`Could not set data type "${data_type}" for unknown column "${column_name}" in table "${table_name}"`);
		else console.error(`Could not set geometry column "${column_name}" for unknown table "${table_name}"`);
		return overview;
	}
	/**
	* List all existing tables in the current schema/database
	*/
	async tables() {
		const schemaIn = this.explodedSchema.map((schemaName) => `${this.knex.raw("?", [schemaName])}::regnamespace`);
		return (await this.knex.raw(`
		 SELECT
			rel.relname AS name
		 FROM
			pg_class rel
		 WHERE
			rel.relnamespace IN (${schemaIn})
			AND rel.relkind = 'r'
		 ORDER BY rel.relname
	  `)).rows.map((row) => row.name);
	}
	async tableInfo(table) {
		const schemaIn = this.explodedSchema.map((schemaName) => `${this.knex.raw("?", [schemaName])}::regnamespace`);
		const bindings = [];
		if (table) bindings.push(table);
		const result = await this.knex.raw(`
		 SELECT
			rel.relnamespace::regnamespace::text AS schema,
			rel.relname AS name,
			des.description AS comment
		 FROM
			pg_class rel
		 LEFT JOIN pg_description des ON rel.oid = des.objoid AND des.objsubid = 0
		 WHERE
			rel.relnamespace IN (${schemaIn})
			${table ? "AND rel.relname = ?" : ""}
			AND rel.relkind = 'r'
		 ORDER BY rel.relname
	  `, bindings);
		if (table) return result.rows[0];
		return result.rows;
	}
	/**
	* Check if a table exists in the current schema/database
	*/
	async hasTable(table) {
		const schemaIn = this.explodedSchema.map((schemaName) => `${this.knex.raw("?", [schemaName])}::regnamespace`);
		return (await this.knex.raw(`
		 SELECT
			rel.relname AS name
		 FROM
			pg_class rel
		 WHERE
			rel.relnamespace IN (${schemaIn})
			AND rel.relkind = 'r'
			AND rel.relname = ?
		 ORDER BY rel.relname
	  `, [table])).rows.length > 0;
	}
	/**
	* Get all the available columns in the current schema/database. Can be filtered to a specific table
	*/
	async columns(table) {
		const bindings = [];
		if (table) bindings.push(table);
		const schemaIn = this.explodedSchema.map((schemaName) => `${this.knex.raw("?", [schemaName])}::regnamespace`);
		return (await this.knex.raw(`
		 SELECT
			att.attname AS column,
			rel.relname AS table
		 FROM
			pg_attribute att
			LEFT JOIN pg_class rel ON att.attrelid = rel.oid
		 WHERE
			rel.relnamespace IN (${schemaIn})
			${table ? "AND rel.relname = ?" : ""}
			AND rel.relkind = 'r'
			AND att.attnum > 0
			AND NOT att.attisdropped;
	  `, bindings)).rows;
	}
	async columnInfo(table, column) {
		const { knex } = this;
		const bindings = [];
		if (table) bindings.push(table);
		if (column) bindings.push(column);
		const schemaIn = this.explodedSchema.map((schemaName) => `${this.knex.raw("?", [schemaName])}::regnamespace`);
		const majorVersion = (await this.knex.raw(`SHOW server_version`)).rows?.[0]?.server_version?.split(".")?.[0] ?? 10;
		let generationSelect = `
		 NULL AS generation_expression,
		 pg_get_expr(ad.adbin, ad.adrelid) AS default_value,
		 FALSE AS is_generated,
	  `;
		if (Number(majorVersion) >= 12) generationSelect = `
			CASE WHEN att.attgenerated = 's' THEN pg_get_expr(ad.adbin, ad.adrelid) ELSE null END AS generation_expression,
			CASE WHEN att.attgenerated = '' THEN pg_get_expr(ad.adbin, ad.adrelid) ELSE null END AS default_value,
			att.attgenerated = 's' AS is_generated,
		 `;
		const [columns, constraints] = await Promise.all([knex.raw(`
			SELECT
			  att.attname AS name,
			  rel.relname AS table,
			  rel.relnamespace::regnamespace::text as schema,
			  att.atttypid::regtype::text AS data_type,
			  ix_rel.relname as index_name,
			  NOT att.attnotnull AS is_nullable,
			  ${generationSelect}
			  CASE
				 WHEN att.atttypid IN (1042, 1043) THEN (att.atttypmod - 4)::int4
				 WHEN att.atttypid IN (1560, 1562) THEN (att.atttypmod)::int4
				 ELSE NULL
			  END AS max_length,
			  des.description AS comment,
			  CASE att.atttypid
				 WHEN 21 THEN 16
				 WHEN 23 THEN 32
				 WHEN 20 THEN 64
				 WHEN 1700 THEN
					CASE WHEN atttypmod = -1 THEN NULL
					  ELSE (((atttypmod - 4) >> 16) & 65535)::int4
					END
				 WHEN 700 THEN 24
				 WHEN 701 THEN 53
				 ELSE NULL
			  END AS numeric_precision,
			  CASE
				 WHEN atttypid IN (21, 23, 20) THEN 0
				 WHEN atttypid = 1700 THEN
					CASE
					  WHEN atttypmod = -1 THEN NULL
					  ELSE ((atttypmod - 4) & 65535)::int4
					END
				 ELSE null
			  END AS numeric_scale
			FROM
			  pg_attribute att
			  LEFT JOIN pg_class rel ON att.attrelid = rel.oid
			  LEFT JOIN pg_attrdef ad ON (att.attrelid, att.attnum) = (ad.adrelid, ad.adnum)
			  LEFT JOIN pg_description des ON (att.attrelid, att.attnum) = (des.objoid, des.objsubid)
			  LEFT JOIN LATERAL (
			    SELECT
				 indexrelid
			    FROM
				 pg_index ix
			    WHERE
				 att.attrelid = ix.indrelid
				 AND att.attnum = ALL(ix.indkey)
				 AND ix.indisunique = false
			    LIMIT 1
			  ) ix ON true
			  LEFT JOIN pg_class ix_rel ON ix_rel.oid=ix.indexrelid
			WHERE
			  rel.relnamespace IN (${schemaIn})
			  ${table ? "AND rel.relname = ?" : ""}
			  ${column ? "AND att.attname = ?" : ""}
			  AND rel.relkind = 'r'
			  AND att.attnum > 0
			  AND NOT att.attisdropped
			ORDER BY rel.relname, att.attnum;
		 `, bindings), knex.raw(`
			SELECT
			  con.contype AS type,
			  rel.relname AS table,
			  att.attname AS column,
			  frel.relnamespace::regnamespace::text AS foreign_key_schema,
			  frel.relname AS foreign_key_table,
			  fatt.attname AS foreign_key_column,
			  CASE
				 WHEN con.contype = 'p' THEN EXISTS (
				   SELECT 1
				   FROM pg_depend dep
				   JOIN pg_class seq ON seq.oid = dep.objid AND seq.relkind = 'S'
				   WHERE dep.classid = 'pg_class'::regclass
				     AND dep.refclassid = 'pg_class'::regclass
				     AND dep.refobjid = att.attrelid
				     AND dep.refobjsubid = att.attnum
				     AND dep.deptype IN ('a', 'i')
				 )
				 ELSE NULL
			  END AS has_auto_increment
			FROM
			  pg_constraint con
			LEFT JOIN pg_class rel ON con.conrelid = rel.oid
			LEFT JOIN pg_class frel ON con.confrelid = frel.oid
			LEFT JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
			LEFT JOIN pg_attribute fatt ON fatt.attrelid = con.confrelid AND fatt.attnum = con.confkey[1]
			WHERE con.connamespace IN (${schemaIn})
			  AND array_length(con.conkey, 1) <= 1
			  AND (con.confkey IS NULL OR array_length(con.confkey, 1) = 1)
			  ${table ? "AND rel.relname = ?" : ""}
			  ${column ? "AND att.attname = ?" : ""}
			`, bindings)]);
		const parsedColumns = columns.rows.map((col) => {
			const constraintsForColumn = constraints.rows.filter((constraint) => constraint.table === col.table && constraint.column === col.name);
			const foreignKeyConstraint = constraintsForColumn.find((constraint) => constraint.type === "f");
			return {
				name: col.name,
				table: col.table,
				data_type: col.data_type,
				default_value: parseDefaultValue$2(col.default_value),
				generation_expression: col.generation_expression,
				max_length: col.max_length,
				numeric_precision: col.numeric_precision,
				numeric_scale: col.numeric_scale,
				is_generated: col.is_generated,
				is_nullable: col.is_nullable,
				is_unique: constraintsForColumn.some((constraint) => ["u", "p"].includes(constraint.type)),
				is_indexed: !!col.index_name && col.index_name.length > 0,
				is_primary_key: constraintsForColumn.some((constraint) => constraint.type === "p"),
				has_auto_increment: constraintsForColumn.some((constraint) => constraint.has_auto_increment),
				foreign_key_schema: foreignKeyConstraint?.foreign_key_schema ?? null,
				foreign_key_table: foreignKeyConstraint?.foreign_key_table ?? null,
				foreign_key_column: foreignKeyConstraint?.foreign_key_column ?? null,
				comment: col.comment
			};
		});
		if (table && column) return parsedColumns[0];
		if (!((await this.knex.raw(`SELECT oid FROM pg_proc WHERE proname = 'postgis_version'`)).rows.length > 0)) return parsedColumns;
		for (const column$1 of parsedColumns) if (["point", "polygon"].includes(column$1.data_type)) column$1.data_type = "unknown";
		const query = this.knex.with("geometries", this.knex.raw(`
				select * from geometry_columns
				union
				select * from geography_columns
		`)).select({
			table: "f_table_name",
			name: "f_geometry_column",
			data_type: "type"
		}).from("geometries").whereIn("f_table_schema", this.explodedSchema);
		if (table) query.andWhere("f_table_name", table);
		if (column) {
			const parsedColumn = parsedColumns[0];
			const geometry = await query.andWhere("f_geometry_column", column).first();
			if (geometry) parsedColumn.data_type = geometry.data_type;
		}
		const geometries = await query;
		for (const column$1 of parsedColumns) {
			const geometry = geometries.find((geometry$1) => {
				return column$1.name == geometry$1.name && column$1.table == geometry$1.table;
			});
			if (geometry) column$1.data_type = geometry.data_type;
		}
		if (table && column) return parsedColumns[0];
		return parsedColumns;
	}
	/**
	* Check if the given table contains the given column
	*/
	async hasColumn(table, column) {
		const schemaIn = this.explodedSchema.map((schemaName) => `${this.knex.raw("?", [schemaName])}::regnamespace`);
		return (await this.knex.raw(`
		 SELECT
			att.attname AS column,
			rel.relname AS table
		 FROM
			pg_attribute att
			LEFT JOIN pg_class rel ON att.attrelid = rel.oid
		 WHERE
			rel.relnamespace IN (${schemaIn})
			AND rel.relname = ?
			AND att.attname = ?
			AND rel.relkind = 'r'
			AND att.attnum > 0
			AND NOT att.attisdropped;
	  `, [table, column])).rows;
	}
	/**
	* Get the primary key column for the given table
	*/
	async primary(table) {
		const schemaIn = this.explodedSchema.map((schemaName) => `${this.knex.raw("?", [schemaName])}::regnamespace`);
		return (await this.knex.raw(`
		 SELECT
			  att.attname AS column
			FROM
			  pg_constraint con
			LEFT JOIN pg_class rel ON con.conrelid = rel.oid
			LEFT JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
			WHERE con.connamespace IN (${schemaIn})
			  AND con.contype = 'p'
			  AND array_length(con.conkey, 1) <= 1
			  AND rel.relname = ?
	  `, [table])).rows?.[0]?.column ?? null;
	}
	async foreignKeys(table) {
		const schemaIn = this.explodedSchema.map((schemaName) => `${this.knex.raw("?", [schemaName])}::regnamespace`);
		const bindings = [];
		if (table) bindings.push(table);
		return (await this.knex.raw(`
		  SELECT
			  con.conname AS constraint_name,
			  rel.relname AS table,
			  att.attname AS column,
			  frel.relnamespace::regnamespace::text AS foreign_key_schema,
			  frel.relname AS foreign_key_table,
			  fatt.attname AS foreign_key_column,
			  CASE con.confupdtype
				 WHEN 'r' THEN
					'RESTRICT'
				 WHEN 'c' THEN
					'CASCADE'
				 WHEN 'n' THEN
					'SET NULL'
				 WHEN 'd' THEN
					'SET DEFAULT'
				 WHEN 'a' THEN
					'NO ACTION'
				 ELSE
					NULL
			  END AS on_update,
			  CASE con.confdeltype
				 WHEN 'r' THEN
					'RESTRICT'
				 WHEN 'c' THEN
					'CASCADE'
				 WHEN 'n' THEN
					'SET NULL'
				 WHEN 'd' THEN
					'SET DEFAULT'
				 WHEN 'a' THEN
					'NO ACTION'
				 ELSE
					NULL
			  END AS on_delete
			FROM
			  pg_constraint con
			LEFT JOIN pg_class rel ON con.conrelid = rel.oid
			LEFT JOIN pg_class frel ON con.confrelid = frel.oid
			LEFT JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
			LEFT JOIN pg_attribute fatt ON fatt.attrelid = con.confrelid AND fatt.attnum = con.confkey[1]
			WHERE con.connamespace IN (${schemaIn})
			  AND array_length(con.conkey, 1) <= 1
			  AND (con.confkey IS NULL OR array_length(con.confkey, 1) = 1)
			  AND con.contype = 'f'
			  ${table ? "AND rel.relname = ?" : ""}
	  `, bindings)).rows;
	}
};

//#endregion
//#region src/dialects/cockroachdb.ts
/**
* Converts CockroachDB default value to JS
* Eg `'example'::character varying` => `example`
*/
function parseDefaultValue$1(value) {
	if (value === null) return null;
	if (value.startsWith("nextval(")) return value;
	value = value.split("::")[0] ?? null;
	if (value?.trim().toLowerCase() === "null") return null;
	return stripQuotes(value);
}
var CockroachDB = class {
	knex;
	schema;
	explodedSchema;
	constructor(knex) {
		this.knex = knex;
		const config = knex.client.config;
		if (!config.searchPath) {
			this.schema = "public";
			this.explodedSchema = [this.schema];
		} else if (typeof config.searchPath === "string") {
			this.schema = config.searchPath;
			this.explodedSchema = [config.searchPath];
		} else {
			this.schema = config.searchPath[0];
			this.explodedSchema = config.searchPath;
		}
	}
	/**
	* Set the schema to be used in other methods
	*/
	withSchema(schema) {
		this.schema = schema;
		this.explodedSchema = [this.schema];
		return this;
	}
	async overview() {
		const [columnsResult, primaryKeysResult] = await Promise.all([this.knex.raw(`
        SELECT c.table_name
          , c.column_name
          , c.column_default as default_value
          , c.data_type
			 		, c.character_maximum_length as max_length
          , c.is_generated = 'ALWAYS' is_generated
          , CASE WHEN c.is_identity = 'YES' THEN true ELSE false END is_identity
          , CASE WHEN c.is_nullable = 'YES' THEN true ELSE false END is_nullable
        FROM
          information_schema.columns c
        LEFT JOIN information_schema.tables t
          ON c.table_name = t.table_name
        WHERE
          t.table_type = 'BASE TABLE'
          AND c.table_schema IN (?);
      `, [this.explodedSchema.join(",")]), this.knex.raw(`
        SELECT relname as table_name
          , pg_attribute.attname as column_name
        FROM pg_index
          , pg_class
          , pg_attribute
          , pg_namespace
        WHERE
          indrelid = pg_class.oid
          AND nspname IN (?)
          AND pg_class.relnamespace = pg_namespace.oid
          AND pg_attribute.attrelid = pg_class.oid
          AND pg_attribute.attnum = ANY (pg_index.indkey)
          AND indisprimary
          AND indnatts = 1
			 AND relkind != 'S'
      `, [this.explodedSchema.join(",")])]);
		const columns = columnsResult.rows;
		const primaryKeys = primaryKeysResult.rows;
		let geometryColumns = [];
		if ((await this.knex.raw(`SELECT oid FROM pg_proc WHERE proname = 'postgis_version'`)).rows.length > 0) geometryColumns = (await this.knex.raw(`WITH geometries as (
					select * from geometry_columns
					union
					select * from geography_columns
				)
				SELECT f_table_name as table_name
					, f_geometry_column as column_name
					, type as data_type
				FROM geometries g
				JOIN information_schema.tables t
					ON g.f_table_name = t.table_name
					AND t.table_type = 'BASE TABLE'
				WHERE f_table_schema in (?)
				`, [this.explodedSchema.join(",")])).rows;
		const overview = {};
		for (const column of columns) {
			if (column.is_identity || column.default_value?.startsWith("nextval(")) column.default_value = "AUTO_INCREMENT";
			else column.default_value = parseDefaultValue$1(column.default_value);
			if (column.table_name in overview === false) overview[column.table_name] = {
				columns: {},
				primary: void 0
			};
			if (["point", "polygon"].includes(column.data_type)) column.data_type = "unknown";
			overview[column.table_name].columns[column.column_name] = column;
		}
		for (const { table_name, column_name } of primaryKeys) if (overview[table_name]) overview[table_name].primary = column_name;
		else console.error(`Could not set primary key "${column_name}" for unknown table "${table_name}"`);
		for (const { table_name, column_name, data_type } of geometryColumns) if (overview[table_name]) if (overview[table_name].columns[column_name]) overview[table_name].columns[column_name].data_type = data_type;
		else console.error(`Could not set data type "${data_type}" for unknown column "${column_name}" in table "${table_name}"`);
		else console.error(`Could not set geometry column "${column_name}" for unknown table "${table_name}"`);
		return overview;
	}
	/**
	* List all existing tables in the current schema/database
	*/
	async tables() {
		return (await this.knex.select("tablename").from("pg_catalog.pg_tables").whereIn("schemaname", this.explodedSchema)).map(({ tablename }) => tablename);
	}
	async tableInfo(table) {
		const query = this.knex.select("table_name", "table_schema", this.knex.select(this.knex.raw("obj_description(oid)")).from("pg_class").where({ relkind: "r" }).andWhere({ relname: "table_name" }).as("table_comment")).from("information_schema.tables").whereIn("table_schema", this.explodedSchema).andWhereRaw(`"table_catalog" = current_database()`).andWhere({ table_type: "BASE TABLE" }).orderBy("table_name", "asc");
		if (table) {
			const rawTable = await query.andWhere({ table_name: table }).limit(1).first();
			return {
				name: rawTable.table_name,
				schema: rawTable.table_schema,
				comment: rawTable.table_comment
			};
		}
		return (await query).map((rawTable) => {
			return {
				name: rawTable.table_name,
				schema: rawTable.table_schema,
				comment: rawTable.table_comment
			};
		});
	}
	/**
	* Check if a table exists in the current schema/database
	*/
	async hasTable(table) {
		const subquery = this.knex.select().from("information_schema.tables").whereIn("table_schema", this.explodedSchema).andWhere({ table_name: table });
		return (await this.knex.select(this.knex.raw("exists (?)", [subquery])).first())?.exists || false;
	}
	/**
	* Get all the available columns in the current schema/database. Can be filtered to a specific table
	*/
	async columns(table) {
		const query = this.knex.select("table_name", "column_name").from("information_schema.columns").whereIn("table_schema", this.explodedSchema);
		if (table) query.andWhere({ table_name: table });
		return (await query).map(({ table_name, column_name }) => ({
			table: table_name,
			column: column_name
		}));
	}
	async columnInfo(table, column) {
		const { knex } = this;
		const bindings = [];
		if (table) bindings.push(table);
		if (column) bindings.push(column);
		const schemaIn = this.explodedSchema.map((schemaName) => `${this.knex.raw("?", [schemaName])}::regnamespace`);
		const [columns, constraints] = await Promise.all([knex.raw(`
         SELECT *, CASE WHEN res.is_generated THEN (
          SELECT
            generation_expression
          FROM
            information_schema.columns
          WHERE
            table_schema = res.schema
            AND table_name = res.table
            AND column_name = res.name
          ) ELSE NULL END AS generation_expression
         FROM (
         SELECT
           att.attname AS name,
           rel.relname AS table,
           rel.relnamespace::regnamespace::text AS schema,
           format_type(att.atttypid, null) AS data_type,
           ix_rel.relname as index_name,
           NOT att.attnotnull AS is_nullable,
           CASE WHEN att.attgenerated = '' THEN pg_get_expr(ad.adbin, ad.adrelid) ELSE null END AS default_value,
           att.attgenerated = 's' AS is_generated,
           CASE
             WHEN att.atttypid IN (1042, 1043) THEN (att.atttypmod - 4)::int4
             WHEN att.atttypid IN (1560, 1562) THEN (att.atttypmod)::int4
             ELSE NULL
           END AS max_length,
           des.description AS comment,
           CASE att.atttypid
             WHEN 21 THEN 16
             WHEN 23 THEN 32
             WHEN 20 THEN 64
             WHEN 1700 THEN
               CASE WHEN atttypmod = -1 THEN NULL
                 ELSE (((atttypmod - 4) >> 16) & 65535)::int4
               END
             WHEN 700 THEN 24
             WHEN 701 THEN 53
             ELSE NULL
           END AS numeric_precision,
           CASE
             WHEN atttypid IN (21, 23, 20) THEN 0
             WHEN atttypid = 1700 THEN
               CASE
                 WHEN atttypmod = -1 THEN NULL
                 ELSE ((atttypmod - 4) & 65535)::int4
               END
             ELSE null
           END AS numeric_scale
         FROM
           pg_attribute att
           LEFT JOIN pg_class rel ON att.attrelid = rel.oid
           LEFT JOIN pg_attrdef ad ON (att.attrelid, att.attnum) = (ad.adrelid, ad.adnum)
           LEFT JOIN pg_description des ON (att.attrelid, att.attnum) = (des.objoid, des.objsubid)
           LEFT JOIN LATERAL (
              SELECT
                indexrelid
              FROM
                pg_index ix
              WHERE
                att.attrelid = ix.indrelid
                AND att.attnum = ALL(ix.indkey)
                AND ix.indisunique = false
              LIMIT 1
           ) ix ON true
           LEFT JOIN pg_class ix_rel ON ix_rel.oid=ix.indexrelid
         WHERE
           rel.relnamespace IN (${schemaIn})
           ${table ? "AND rel.relname = ?" : ""}
           ${column ? "AND att.attname = ?" : ""}
           AND rel.relkind = 'r'
           AND att.attnum > 0
           AND NOT att.attisdropped
         ORDER BY rel.relname, att.attnum) res;
       `, bindings), knex.raw(`
         SELECT
           con.contype AS type,
           rel.relname AS table,
           att.attname AS column,
           frel.relnamespace::regnamespace::text AS foreign_key_schema,
           frel.relname AS foreign_key_table,
           fatt.attname AS foreign_key_column
         FROM
           pg_constraint con
         LEFT JOIN pg_class rel ON con.conrelid = rel.oid
         LEFT JOIN pg_class frel ON con.confrelid = frel.oid
         LEFT JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
         LEFT JOIN pg_attribute fatt ON fatt.attrelid = con.confrelid AND fatt.attnum = con.confkey[1]
         WHERE con.connamespace IN (${schemaIn})
           AND array_length(con.conkey, 1) <= 1
           AND (con.confkey IS NULL OR array_length(con.confkey, 1) = 1)
           ${table ? "AND rel.relname = ?" : ""}
           ${column ? "AND att.attname = ?" : ""}
         `, bindings)]);
		const parsedColumns = columns.rows.map((col) => {
			const constraintsForColumn = constraints.rows.filter((constraint) => constraint.table === col.table && constraint.column === col.name);
			const foreignKeyConstraint = constraintsForColumn.find((constraint) => constraint.type === "f");
			return {
				name: col.name,
				table: col.table,
				data_type: col.data_type,
				default_value: parseDefaultValue$1(col.default_value),
				generation_expression: col.generation_expression,
				max_length: col.max_length,
				numeric_precision: col.numeric_precision,
				numeric_scale: col.numeric_scale,
				is_generated: col.is_generated,
				is_nullable: col.is_nullable,
				is_unique: constraintsForColumn.some((constraint) => ["u", "p"].includes(constraint.type)),
				is_indexed: !!col.index_name?.length && col.index_name.length > 0,
				is_primary_key: constraintsForColumn.some((constraint) => constraint.type === "p"),
				has_auto_increment: ["integer", "bigint"].includes(col.data_type) && (col.default_value?.startsWith("nextval(") ?? false),
				foreign_key_schema: foreignKeyConstraint?.foreign_key_schema ?? null,
				foreign_key_table: foreignKeyConstraint?.foreign_key_table ?? null,
				foreign_key_column: foreignKeyConstraint?.foreign_key_column ?? null,
				comment: col.comment
			};
		});
		for (const column$1 of parsedColumns) if (["point", "polygon"].includes(column$1.data_type)) column$1.data_type = "unknown";
		if (!((await this.knex.raw(`SELECT oid FROM pg_proc WHERE proname = 'postgis_version'`)).rows.length > 0)) {
			if (table && column) return parsedColumns[0];
			return parsedColumns;
		}
		const query = this.knex.with("geometries", this.knex.raw(`
				select * from geometry_columns
				union
				select * from geography_columns
		`)).select({
			table: "f_table_name",
			name: "f_geometry_column",
			data_type: "type"
		}).from("geometries").whereIn("f_table_schema", this.explodedSchema);
		if (table) query.andWhere("f_table_name", table);
		if (column) {
			const parsedColumn = parsedColumns[0];
			const geometry = await query.andWhere("f_geometry_column", column).first();
			if (geometry) parsedColumn.data_type = geometry.data_type;
			return parsedColumn;
		}
		const geometries = await query;
		for (const column$1 of parsedColumns) {
			const geometry = geometries.find((geometry$1) => {
				return column$1.name == geometry$1.name && column$1.table == geometry$1.table;
			});
			if (geometry) column$1.data_type = geometry.data_type;
		}
		return parsedColumns;
	}
	/**
	* Check if the given table contains the given column
	*/
	async hasColumn(table, column) {
		const subquery = this.knex.select().from("information_schema.columns").whereIn("table_schema", this.explodedSchema).andWhere({
			table_name: table,
			column_name: column
		});
		return (await this.knex.select(this.knex.raw("exists (?)", [subquery])).first())?.exists || false;
	}
	/**
	* Get the primary key column for the given table
	*/
	async primary(table) {
		const result = await this.knex.select("information_schema.key_column_usage.column_name").from("information_schema.key_column_usage").leftJoin("information_schema.table_constraints", "information_schema.table_constraints.constraint_name", "information_schema.key_column_usage.constraint_name").whereIn("information_schema.table_constraints.table_schema", this.explodedSchema).andWhere({
			"information_schema.table_constraints.constraint_type": "PRIMARY KEY",
			"information_schema.table_constraints.table_name": table
		}).first();
		return result ? result.column_name : null;
	}
	async foreignKeys(table) {
		const rowsWithoutQuotes = (await this.knex.raw(`
      SELECT
        c.conrelid::regclass::text AS "table",
        (
          SELECT
            STRING_AGG(a.attname, ','
            ORDER BY
              t.seq)
          FROM (
            SELECT
              ROW_NUMBER() OVER (ROWS UNBOUNDED PRECEDING) AS seq,
              attnum
            FROM
              UNNEST(c.conkey) AS t (attnum)) AS t
          INNER JOIN pg_attribute AS a ON a.attrelid = c.conrelid
            AND a.attnum = t.attnum) AS "column",
        tt.name AS foreign_key_table,
        (
          SELECT
            STRING_AGG(QUOTE_IDENT(a.attname), ','
            ORDER BY
              t.seq)
          FROM (
            SELECT
              ROW_NUMBER() OVER (ROWS UNBOUNDED PRECEDING) AS seq,
              attnum
            FROM
              UNNEST(c.confkey) AS t (attnum)) AS t
        INNER JOIN pg_attribute AS a ON a.attrelid = c.confrelid
          AND a.attnum = t.attnum) AS foreign_key_column,
        tt.schema AS foreign_key_schema,
        c.conname AS constraint_name,
        CASE confupdtype
        WHEN 'r' THEN
          'RESTRICT'
        WHEN 'c' THEN
          'CASCADE'
        WHEN 'n' THEN
          'SET NULL'
        WHEN 'd' THEN
          'SET DEFAULT'
        WHEN 'a' THEN
          'NO ACTION'
        ELSE
          NULL
        END AS on_update,
        CASE confdeltype
        WHEN 'r' THEN
          'RESTRICT'
        WHEN 'c' THEN
          'CASCADE'
        WHEN 'n' THEN
          'SET NULL'
        WHEN 'd' THEN
          'SET DEFAULT'
        WHEN 'a' THEN
          'NO ACTION'
        ELSE
          NULL
        END AS
        on_delete
      FROM
        pg_catalog.pg_constraint AS c
        INNER JOIN (
          SELECT
            pg_class.oid,
            QUOTE_IDENT(pg_namespace.nspname) AS SCHEMA,
            QUOTE_IDENT(pg_class.relname) AS name
          FROM
            pg_class
            INNER JOIN pg_namespace ON pg_class.relnamespace = pg_namespace.oid) AS tf ON tf.oid = c.conrelid
        INNER JOIN (
          SELECT
            pg_class.oid,
            QUOTE_IDENT(pg_namespace.nspname) AS SCHEMA,
            QUOTE_IDENT(pg_class.relname) AS name
          FROM
            pg_class
            INNER JOIN pg_namespace ON pg_class.relnamespace = pg_namespace.oid) AS tt ON tt.oid = c.confrelid
      WHERE
        c.contype = 'f';
    `)).rows.map(stripRowQuotes);
		if (table) return rowsWithoutQuotes.filter((row) => row.table === table);
		return rowsWithoutQuotes;
		function stripRowQuotes(row) {
			return Object.fromEntries(Object.entries(row).map(([key, value]) => {
				return [key, stripQuotes(value)];
			}));
		}
	}
};

//#endregion
//#region src/utils/extract-max-length.ts
/**
* Extracts the length value out of a given datatype
* For example: `varchar(32)` => 32
*/
function extractMaxLength(type) {
	const matches = /\(([^)]+)\)/.exec(type);
	if (matches && matches.length > 0 && matches[1]) return Number(matches[1]);
	return null;
}

//#endregion
//#region src/utils/extract-type.ts
/**
* Extracts the type out of a given datatype
* For example: `varchar(32)` => varchar
*/
function extractType(type) {
	return type.replace(/[^a-zA-Z]/g, "").toLowerCase();
}

//#endregion
//#region src/dialects/sqlite.ts
function parseDefaultValue(value) {
	if (value === null || value.trim().toLowerCase() === "null") return null;
	return stripQuotes(value);
}
var SQLite = class {
	knex;
	constructor(knex) {
		this.knex = knex;
	}
	async overview() {
		const tablesWithAutoIncrementPrimaryKeys = (await this.knex.select("name").from("sqlite_master").whereRaw(`sql LIKE "%AUTOINCREMENT%"`)).map(({ name }) => name);
		const tables = await this.tables();
		const overview = {};
		for (const table of tables) {
			const columns = await this.knex.raw(`PRAGMA table_xinfo(??)`, table);
			if (table in overview === false) {
				const primaryKeys = columns.filter((column) => column.pk !== 0);
				overview[table] = {
					primary: primaryKeys.length !== 1 ? void 0 : primaryKeys[0].name,
					columns: {}
				};
			}
			for (const column of columns) overview[table].columns[column.name] = {
				table_name: table,
				column_name: column.name,
				default_value: column.pk === 1 && tablesWithAutoIncrementPrimaryKeys.includes(table) ? "AUTO_INCREMENT" : parseDefaultValue(column.dflt_value),
				is_nullable: column.notnull == 0,
				is_generated: column.hidden !== 0,
				data_type: extractType(column.type),
				max_length: extractMaxLength(column.type),
				numeric_precision: null,
				numeric_scale: null
			};
		}
		return overview;
	}
	/**
	* List all existing tables in the current schema/database
	*/
	async tables() {
		return (await this.knex.select("name").from("sqlite_master").whereRaw(`type = 'table' AND name NOT LIKE 'sqlite_%'`)).map(({ name }) => name);
	}
	async tableInfo(table) {
		const query = this.knex.select("name", "sql").from("sqlite_master").where({ type: "table" }).andWhereRaw(`name NOT LIKE 'sqlite_%'`);
		if (table) query.andWhere({ name: table });
		let records = await query;
		records = records.map((table$1) => ({
			name: table$1.name,
			sql: table$1.sql
		}));
		if (table) return records[0];
		return records;
	}
	/**
	* Check if a table exists in the current schema/database
	*/
	async hasTable(table) {
		return (await this.knex.select(1).from("sqlite_master").where({
			type: "table",
			name: table
		})).length > 0;
	}
	/**
	* Get all the available columns in the current schema/database. Can be filtered to a specific table
	*/
	async columns(table) {
		if (table) return (await this.knex.raw(`PRAGMA table_xinfo(??)`, table)).map((column) => ({
			table,
			column: column.name
		}));
		const tables = await this.tables();
		return (await Promise.all(tables.map(async (table$1) => await this.columns(table$1)))).flat();
	}
	async columnInfo(table, column) {
		const getColumnsForTable = async (table$1) => {
			const tablesWithAutoIncrementPrimaryKeys = (await this.knex.select("name").from("sqlite_master").whereRaw(`sql LIKE "%AUTOINCREMENT%"`)).map(({ name }) => name);
			const columns = await this.knex.raw(`PRAGMA table_xinfo(??)`, table$1);
			const foreignKeys = await this.knex.raw(`PRAGMA foreign_key_list(??)`, table$1);
			const indexList = await this.knex.raw(`PRAGMA index_list(??)`, table$1);
			const indexInfoList = await Promise.all(indexList.map((index) => this.knex.raw(`PRAGMA index_info(??)`, index.name)));
			return columns.map((raw) => {
				const foreignKey = foreignKeys.find((fk) => fk.from === raw.name);
				let isUniqueColumn = false;
				let isIndexedColumn = false;
				for (let i = 0; i < indexInfoList.length; i++) {
					if (!indexInfoList[i]?.find((fk) => fk.name === raw.name)) continue;
					if (indexInfoList[i]?.length !== 1 || !indexList[i]) continue;
					if (indexList[i].unique === 1) isUniqueColumn = true;
					else if (indexList[i].name.length > 0) isIndexedColumn = true;
					if (isUniqueColumn && isIndexedColumn) break;
				}
				return {
					name: raw.name,
					table: table$1,
					data_type: extractType(raw.type),
					default_value: parseDefaultValue(raw.dflt_value),
					max_length: extractMaxLength(raw.type),
					numeric_precision: null,
					numeric_scale: null,
					is_generated: raw.hidden !== 0,
					generation_expression: null,
					is_nullable: raw.notnull === 0,
					is_unique: isUniqueColumn,
					is_indexed: isIndexedColumn,
					is_primary_key: raw.pk === 1,
					has_auto_increment: raw.pk === 1 && tablesWithAutoIncrementPrimaryKeys.includes(table$1),
					foreign_key_column: foreignKey?.to || null,
					foreign_key_table: foreignKey?.table || null
				};
			});
		};
		if (!table) {
			const tables = await this.tables();
			return (await Promise.all(tables.map(async (table$1) => await getColumnsForTable(table$1)))).flat();
		}
		if (table && !column) return await getColumnsForTable(table);
		return (await getColumnsForTable(table)).find((columnInfo) => columnInfo.name === column);
	}
	/**
	* Check if a table exists in the current schema/database
	*/
	async hasColumn(table, column) {
		let isColumn = false;
		if ((await this.knex.raw(`SELECT COUNT(*) AS ct FROM pragma_table_xinfo('${table}') WHERE name='${column}'`))[0]["ct"] !== 0) isColumn = true;
		return isColumn;
	}
	/**
	* Get the primary key column for the given table
	*/
	async primary(table) {
		return (await this.knex.raw(`PRAGMA table_xinfo(??)`, table)).find((col) => col.pk !== 0)?.name || null;
	}
	async foreignKeys(table) {
		if (table) return (await this.knex.raw(`PRAGMA foreign_key_list(??)`, table)).map((key) => ({
			table,
			column: key.from,
			foreign_key_table: key.table,
			foreign_key_column: key.to,
			on_update: key.on_update,
			on_delete: key.on_delete,
			constraint_name: null
		}));
		const tables = await this.tables();
		return (await Promise.all(tables.map(async (table$1) => await this.foreignKeys(table$1)))).flat();
	}
};

//#endregion
//#region src/index.ts
const createInspector = (knex) => {
	let constructor;
	switch (knex.client.constructor.name) {
		case "Client_MySQL":
		case "Client_MySQL2":
			constructor = MySQL;
			break;
		case "Client_PG":
			constructor = Postgres;
			break;
		case "Client_CockroachDB":
			constructor = CockroachDB;
			break;
		case "Client_SQLite3":
			constructor = SQLite;
			break;
		default: throw Error("Unsupported driver used: " + knex.client.constructor.name);
	}
	return new constructor(knex);
};

//#endregion
export { createInspector };