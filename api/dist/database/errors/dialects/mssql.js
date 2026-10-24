import database_default from "../../index.js";
import { ContainsNullValuesError, InvalidForeignKeyError, NotNullViolationError, RecordNotUniqueError, ValueOutOfRangeError, ValueTooLongError } from "@directus/errors";

//#region src/database/errors/dialects/mssql.ts
var MSSQLErrorCodes = /* @__PURE__ */ function(MSSQLErrorCodes$1) {
	MSSQLErrorCodes$1[MSSQLErrorCodes$1["FOREIGN_KEY_VIOLATION"] = 547] = "FOREIGN_KEY_VIOLATION";
	MSSQLErrorCodes$1[MSSQLErrorCodes$1["NOT_NULL_VIOLATION"] = 515] = "NOT_NULL_VIOLATION";
	MSSQLErrorCodes$1[MSSQLErrorCodes$1["NUMERIC_VALUE_OUT_OF_RANGE"] = 220] = "NUMERIC_VALUE_OUT_OF_RANGE";
	MSSQLErrorCodes$1[MSSQLErrorCodes$1["UNIQUE_VIOLATION"] = 2601] = "UNIQUE_VIOLATION";
	MSSQLErrorCodes$1[MSSQLErrorCodes$1["VALUE_LIMIT_VIOLATION"] = 2628] = "VALUE_LIMIT_VIOLATION";
	return MSSQLErrorCodes$1;
}(MSSQLErrorCodes || {});
async function extractError(error, data) {
	switch (error.number) {
		case MSSQLErrorCodes.UNIQUE_VIOLATION:
		case 2627: return await uniqueViolation();
		case MSSQLErrorCodes.NUMERIC_VALUE_OUT_OF_RANGE: return numericValueOutOfRange();
		case MSSQLErrorCodes.VALUE_LIMIT_VIOLATION: return valueLimitViolation();
		case MSSQLErrorCodes.NOT_NULL_VIOLATION: return notNullViolation();
		case MSSQLErrorCodes.FOREIGN_KEY_VIOLATION: return foreignKeyViolation();
	}
	return error;
	async function uniqueViolation() {
		/**
		* NOTE:
		* SQL Server doesn't return the name of the offending column when a unique constraint is thrown:
		*
		* insert into [articles] ([unique]) values (@p0)
		* - Violation of UNIQUE KEY constraint 'UQ__articles__5A062640242004EB'.
		* Cannot insert duplicate key in object 'dbo.articles'. The duplicate key value is (rijk).
		*
		* While it's not ideal, the best next thing we can do is extract the column name from
		* information_schema when this happens
		*/
		const betweenQuotes = /'([^']+)'/g;
		const betweenParens = /\(([^)]+)\)/g;
		const quoteMatches = error.message.match(betweenQuotes);
		const parenMatches = error.message.match(betweenParens);
		if (!quoteMatches || !parenMatches) return error;
		const keyName = quoteMatches[1].slice(1, -1);
		let collection = quoteMatches[0].slice(1, -1);
		let field = null;
		if (keyName) {
			const database = database_default();
			const constraintUsage = await database.select("sys.columns.name as field", database.raw("OBJECT_NAME(??) as collection", ["sys.columns.object_id"])).from("sys.indexes").innerJoin("sys.index_columns", (join) => {
				join.on("sys.indexes.object_id", "=", "sys.index_columns.object_id").andOn("sys.indexes.index_id", "=", "sys.index_columns.index_id");
			}).innerJoin("sys.columns", (join) => {
				join.on("sys.index_columns.object_id", "=", "sys.columns.object_id").andOn("sys.index_columns.column_id", "=", "sys.columns.column_id");
			}).where("sys.indexes.name", "=", keyName).first();
			collection = constraintUsage?.collection;
			field = constraintUsage?.field;
		}
		return new RecordNotUniqueError({
			collection,
			field,
			value: field ? data[field] : null
		});
	}
	function numericValueOutOfRange() {
		const bracketMatches = error.message.match(/\[([^\]]+)\]/g);
		if (!bracketMatches) return error;
		return new ValueOutOfRangeError({
			collection: bracketMatches[0].slice(1, -1),
			field: null,
			value: null
		});
	}
	function valueLimitViolation() {
		const betweenBrackets = /\[([^\]]+)\]/g;
		const betweenQuotes = /'([^']+)'/g;
		const bracketMatches = error.message.match(betweenBrackets);
		const quoteMatches = error.message.match(betweenQuotes);
		if (!bracketMatches || !quoteMatches) return error;
		const collection = bracketMatches[0].slice(1, -1);
		const field = quoteMatches[1].slice(1, -1);
		return new ValueTooLongError({
			collection,
			field,
			value: field ? data[field] : null
		});
	}
	function notNullViolation() {
		const betweenBrackets = /\[([^\]]+)\]/g;
		const betweenQuotes = /'([^']+)'/g;
		const bracketMatches = error.message.match(betweenBrackets);
		const quoteMatches = error.message.match(betweenQuotes);
		if (!bracketMatches || !quoteMatches) return error;
		const collection = bracketMatches[0].slice(1, -1);
		const field = quoteMatches[0].slice(1, -1);
		if (error.message.includes("Cannot insert the value NULL into column")) return new ContainsNullValuesError({
			collection,
			field
		});
		return new NotNullViolationError({
			collection,
			field
		});
	}
	function foreignKeyViolation() {
		const betweenUnderscores = /__(.+)__/g;
		const betweenParens = /\(([^)]+)\)/g;
		const underscoreMatches = error.message.match(betweenUnderscores);
		const parenMatches = error.message.match(betweenParens);
		if (!underscoreMatches || !parenMatches) return error;
		const underscoreParts = underscoreMatches[0].split("__");
		const collection = underscoreParts[1];
		const field = underscoreParts[2];
		return new InvalidForeignKeyError({
			collection,
			field,
			value: field ? data[field] : null
		});
	}
}

//#endregion
export { extractError };