import { EndpointEntry, HookEntry, MigrationConfig, MigrationEntry, OperationApiEntry } from "./define-entry.js";
import { EndpointExtensionContext, HookExtensionContext, OperationContext, RegisterFunctions } from "@directus/types";
import { DeclaredEnvVars, Env, EnvVarDeclarations } from "@directus/env";
import { Router } from "express";

//#region src/scalabus/define-env.d.ts
/** The variables an extension declares, every one named under `prefix`. */
interface ExtensionEnvVars<ExactDeclarations extends EnvVarDeclarations = EnvVarDeclarations> {
  prefix: string;
  vars: ExactDeclarations;
}
/** `Context` with `env` typed: core's variables and the extension's. */
type WithDeclaredEnvVars<Context, ExactDeclarations extends EnvVarDeclarations> = Omit<Context, 'env'> & {
  env: Env & DeclaredEnvVars<ExactDeclarations>;
};
type EnvEndpointHandler<ExactDeclarations extends EnvVarDeclarations> = (router: Router, context: WithDeclaredEnvVars<EndpointExtensionContext, ExactDeclarations>) => void;
type EnvOperationApiConfig<Options, ExactDeclarations extends EnvVarDeclarations> = {
  id: string;
  handler: (options: Options, context: WithDeclaredEnvVars<OperationContext, ExactDeclarations>) => unknown;
};
interface ExtensionEnvVarsHelpers<ExactDeclarations extends EnvVarDeclarations> extends ExtensionEnvVars<ExactDeclarations> {
  defineHook: (name: string, config: (register: RegisterFunctions, context: WithDeclaredEnvVars<HookExtensionContext, ExactDeclarations>) => void) => HookEntry;
  defineEndpoint: (name: string, config: EnvEndpointHandler<ExactDeclarations> | {
    id: string;
    handler: EnvEndpointHandler<ExactDeclarations>;
  }) => EndpointEntry;
  defineOperationApi: <Options = Record<string, unknown>>(name: string, config: EnvOperationApiConfig<Options, ExactDeclarations>) => OperationApiEntry;
  defineMigration: (name: string, config: MigrationConfig) => MigrationEntry;
}
/**
 * Declare the variables an extension reads, for the API to check at boot and
 * cast as declared, and get back the entry helpers whose `context.env` knows
 * their types.
 * For bundles only: a standalone extension casts what it reads off `env` itself.
 *
 * ```ts
 * const subscriptionsEnv = defineEnv({
 * 	prefix: 'SUBSCRIPTIONS_',
 * 	vars: { SUBSCRIPTIONS_TRIAL_DAYS: { type: 'number', default: 14 } },
 * });
 *
 * subscriptionsEnv.defineHook('trials', (register, { env }) => {
 * 	env.SUBSCRIPTIONS_TRIAL_DAYS; // number
 * });
 * ```
 */
declare function defineEnv<const ExactDeclarations extends EnvVarDeclarations>(extensionEnv: ExtensionEnvVars<ExactDeclarations>): ExtensionEnvVarsHelpers<ExactDeclarations>;
//#endregion
export { ExtensionEnvVars, ExtensionEnvVarsHelpers, WithDeclaredEnvVars, defineEnv };