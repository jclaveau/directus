import { RestCommand } from "../../types.js";

//#region src/rest/commands/auth/providers.d.ts
interface ReadProviderOutput {
  name: string;
  driver: string;
  icon?: string | null;
}
/**
 * List all the configured auth providers.
 *
 * @returns Array of configured auth providers.
 */
declare const readProviders: <Schema>(sessionOnly?: boolean) => RestCommand<ReadProviderOutput[], Schema>;
//#endregion
export { ReadProviderOutput, readProviders };
//# sourceMappingURL=providers.d.ts.map