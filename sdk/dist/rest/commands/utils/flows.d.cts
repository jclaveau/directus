import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/utils/flows.d.ts

/**
 * Trigger a flow
 * @param method
 * @param id
 * @param data
 * @returns Result of the flow, if any.
 */
declare const triggerFlow: <Schema>(method: "GET" | "POST", id: string, data?: Record<string, string>) => RestCommand<unknown, Schema>;
//#endregion
export { triggerFlow };
//# sourceMappingURL=flows.d.cts.map