import { ContainsNullValuesError, InvalidForeignKeyError, NotNullViolationError, RecordNotUniqueError } from "@directus/errors";

//#region src/database/errors/dialects/sqlite.ts
function extractError(error, data, context) {
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
	if (error.message.includes("SQLITE_CONSTRAINT: FOREIGN KEY")) {
		const operation = context?.operation ?? null;
		let reason = null;
		if (operation === "delete") reason = "still_referenced";
		else if (operation === "create") reason = "invalid_reference";
		return new InvalidForeignKeyError({
			collection: context?.collection ?? null,
			field: null,
			value: null,
			constraint: null,
			relatedCollection: null,
			reason,
			operation
		});
	}
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