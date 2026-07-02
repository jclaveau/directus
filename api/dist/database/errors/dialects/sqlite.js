import { ContainsNullValuesError, InvalidForeignKeyError, NotNullViolationError, RecordNotUniqueError } from "@directus/errors";

//#region src/database/errors/dialects/sqlite.ts
function extractError(error, data) {
	if (error.message.includes("SQLITE_CONSTRAINT: NOT NULL")) return notNullConstraint(error);
	if (error.message.includes("SQLITE_CONSTRAINT: UNIQUE")) {
		const errorParts = error.message.split(" ");
		const [table, field] = errorParts[errorParts.length - 1].split(".");
		if (!table || !field) return error;
		return new RecordNotUniqueError({
			collection: table,
			field,
			value: field ? data[field] : null
		});
	}
	if (error.message.includes("SQLITE_CONSTRAINT: FOREIGN KEY"))
 /**
	* NOTE:
	* SQLite doesn't return any useful information in it's foreign key constraint failed error, so
	* we can't extract the table/column/value accurately
	*/
	return new InvalidForeignKeyError({
		collection: null,
		field: null,
		value: null
	});
	return error;
}
function notNullConstraint(error) {
	const errorParts = error.message.split(" ");
	const [table, column] = errorParts[errorParts.length - 1].split(".");
	if (table && column) {
		if (table.startsWith("_knex_temp_alter")) return new ContainsNullValuesError({
			collection: table,
			field: column
		});
		return new NotNullViolationError({
			collection: table,
			field: column
		});
	}
	return error;
}

//#endregion
export { extractError };