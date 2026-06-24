import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/delete/deployment.d.ts

/**
* Delete a deployment provider.
*
* @param provider The provider type (e.g. 'vercel')
*
* @returns Nothing
* @throws Will throw if provider is empty
*/
declare const deleteDeployment: <Schema>(provider: string) => RestCommand<void, Schema>;
//#endregion
export { deleteDeployment };
//# sourceMappingURL=deployment.d.cts.map