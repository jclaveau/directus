import { InvalidQueryError } from "@directus/errors";
import { NestedUpdateAnswers } from "@directus/types";
import { oneLine } from "@directus/utils";

//#region src/utils/nested-updates-from-query.ts
/**
* The `nestedUpdates` query param, left unset when absent; read off the raw
* query, since `sanitizeQuery` keeps only the read params.
*/
function nestedUpdatesFromQuery(query) {
	const nestedUpdates = query["nestedUpdates"];
	if (nestedUpdates !== void 0 && !NestedUpdateAnswers.includes(nestedUpdates)) throw new InvalidQueryError({ reason: oneLine`
				"nestedUpdates" must be one of ${NestedUpdateAnswers.join(", ")}
			` });
	return nestedUpdates;
}

//#endregion
export { nestedUpdatesFromQuery };