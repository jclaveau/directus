import { createError } from "@directus/errors";

//#region src/services/graphql/errors/validation.ts
const GraphQLValidationError = createError("GRAPHQL_VALIDATION", "GraphQL validation error.", 400);

//#endregion
export { GraphQLValidationError };