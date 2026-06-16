import { GraphQLError, locatedError } from "graphql";

//#region src/services/graphql/utils/add-path-to-validation-error.ts
function addPathToValidationError(validationError) {
	const token = validationError.nodes?.[0]?.loc?.startToken;
	if (!token) return validationError;
	let prev = token;
	const queryRegex = /query_[A-Za-z0-9]{8}/;
	while (prev) {
		if (prev.kind === "Name" && prev.value && queryRegex.test(prev.value)) return locatedError(validationError, validationError.nodes, [prev.value]);
		prev = prev.prev;
	}
	return locatedError(validationError, validationError.nodes);
}

//#endregion
export { addPathToValidationError };