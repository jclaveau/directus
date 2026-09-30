import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/server/openapi.d.ts
type OpenApiSpecOutput = Record<string, any>;
/**
 * Retrieve the OpenAPI spec for the current project.
 * @returns Object conforming to the OpenAPI Specification
 */
declare const readOpenApiSpec: <Schema>() => RestCommand<OpenApiSpecOutput, Schema>;
//#endregion
export { OpenApiSpecOutput, readOpenApiSpec };
//# sourceMappingURL=openapi.d.cts.map