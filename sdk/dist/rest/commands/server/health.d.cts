import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/server/health.d.ts
type ServerHealthOutput = {
  status: 'ok' | 'warn' | 'error';
  releaseId?: string;
  serviceId?: string;
  checks?: {
    [name: string]: Record<string, any>[];
  };
};
/**
 * Get the current health status of the server.
 * @returns The current health status of the server.
 */
declare const serverHealth: <Schema>() => RestCommand<ServerHealthOutput, Schema>;
//#endregion
export { ServerHealthOutput, serverHealth };
//# sourceMappingURL=health.d.cts.map