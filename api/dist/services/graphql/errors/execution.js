import { createError } from "@directus/errors";

//#region src/services/graphql/errors/execution.ts
const GraphQLExecutionError = createError("GRAPHQL_EXECUTION", "GraphQL execution error.", 400);

//#endregion
export { GraphQLExecutionError };