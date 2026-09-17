import { capabilities_exports } from "./capabilities/index.js";
import { date_exports } from "./date/index.js";
import { fn_exports } from "./fn/index.js";
import { geometry_exports } from "./geometry/index.js";
import { number_exports } from "./number/index.js";
import { schema_exports } from "./schema/index.js";
import { sequence_exports } from "./sequence/index.js";
import { getDatabaseClient } from "../index.js";

//#region src/database/helpers/index.ts
function getHelpers(database) {
	const client = getDatabaseClient(database);
	return {
		date: new date_exports[client](database),
		st: new geometry_exports[client](database),
		schema: new schema_exports[client](database),
		sequence: new sequence_exports[client](database),
		number: new number_exports[client](database),
		capabilities: new capabilities_exports[client](database)
	};
}
function getFunctions(database, schema) {
	return new fn_exports[getDatabaseClient(database)](database, schema);
}

//#endregion
export { getFunctions, getHelpers };