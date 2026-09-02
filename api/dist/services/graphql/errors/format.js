import { set } from "lodash-es";
import { GraphQLError } from "graphql";

//#region src/services/graphql/errors/format.ts
/**
* Convert Directus-Exception into a GraphQL format, so it can be returned by GraphQL properly.
*/
function formatError(error) {
	if (Array.isArray(error)) {
		set(error[0], "extensions.code", error[0].code);
		return new GraphQLError(error[0].message, void 0, void 0, void 0, void 0, error[0]);
	}
	set(error, "extensions.code", error.code);
	return new GraphQLError(error.message, void 0, void 0, void 0, void 0, error);
}

//#endregion
export { formatError };