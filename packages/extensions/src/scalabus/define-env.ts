import type { DeclaredEnvVars, Env, EnvVarDeclarations } from '@directus/env';
import type {
	EndpointConfig,
	EndpointExtensionContext,
	HookConfig,
	HookExtensionContext,
	OperationApiConfig,
	OperationContext,
	RegisterFunctions,
} from '@directus/types';
import type { Router } from 'express';
import {
	type BundleApiEntry,
	defineEndpoint,
	defineHook,
	defineMigration,
	defineOperationApi,
	type EndpointEntry,
	type HookEntry,
	type MigrationConfig,
	type MigrationEntry,
	type OperationApiEntry,
} from './define-entry.js';
import {
	refuseInvalidExtensionEnvVars,
} from './refuse-invalid-extension-env-vars.js';

/** The variables an extension declares, every one named under `prefix`. */
export interface ExtensionEnvVars<
	ExactDeclarations extends EnvVarDeclarations = EnvVarDeclarations,
> {
	prefix: string;
	vars: ExactDeclarations;
}

/** `Context` with `env` typed: core's variables and the extension's. */
export type WithDeclaredEnvVars<
	Context,
	ExactDeclarations extends EnvVarDeclarations,
> =
	Omit<Context, 'env'> & { env: Env & DeclaredEnvVars<ExactDeclarations> };

type EnvEndpointHandler<ExactDeclarations extends EnvVarDeclarations> = (
	router: Router,
	context: WithDeclaredEnvVars<EndpointExtensionContext, ExactDeclarations>,
) => void;

type EnvOperationApiConfig<Options, ExactDeclarations extends EnvVarDeclarations> = {
	id: string;
	handler: (
		options: Options,
		context: WithDeclaredEnvVars<OperationContext, ExactDeclarations>,
	) => unknown;
};

export interface ExtensionEnvVarsHelpers<
	ExactDeclarations extends EnvVarDeclarations,
>
	extends ExtensionEnvVars<ExactDeclarations> {
	defineHook: (
		name: string,
		config: (
			register: RegisterFunctions,
			context: WithDeclaredEnvVars<HookExtensionContext, ExactDeclarations>,
		) => void,
	) => HookEntry;
	defineEndpoint: (
		name: string,
		config:
			| EnvEndpointHandler<ExactDeclarations>
			| { id: string; handler: EnvEndpointHandler<ExactDeclarations> },
	) => EndpointEntry;
	defineOperationApi: <Options = Record<string, unknown>>(
		name: string,
		config: EnvOperationApiConfig<Options, ExactDeclarations>,
	) => OperationApiEntry;
	defineMigration: (name: string, config: MigrationConfig) => MigrationEntry;
}

/**
 * Declare the variables an extension reads, for the API to check at boot and
 * cast as declared, and get back the entry helpers whose `context.env` knows
 * their types.
 * For bundles only: a standalone extension casts what it reads off `env` itself.
 * The prefix may hold several words, so sit under a core one (`DB_VACUUM_`),
 * but never be one of core's (`DB_`).
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
export function defineEnv<const ExactDeclarations extends EnvVarDeclarations>(
	extensionEnv: ExtensionEnvVars<ExactDeclarations>,
): ExtensionEnvVarsHelpers<ExactDeclarations> {
	const { prefix, vars } = extensionEnv;

	refuseInvalidExtensionEnvVars(extensionEnv);

	const declaredEnvVars: ExtensionEnvVars = { prefix, vars };

	const stampEnvVars = <StampedEntry extends BundleApiEntry>(
		entry: StampedEntry,
	): StampedEntry => {
		return { ...entry, env: declaredEnvVars };
	};

	return {
		prefix,
		vars,
		// as: the typed env context is a narrower view of the one core passes
		defineHook: (name, config) => {
			return stampEnvVars(defineHook(name, config as HookConfig));
		},
		defineEndpoint: (name, config) => {
			return stampEnvVars(defineEndpoint(name, config as EndpointConfig));
		},
		defineOperationApi: <Options,>(
			name: string,
			config: EnvOperationApiConfig<Options, ExactDeclarations>,
		) => {
			return stampEnvVars(defineOperationApi<Options>(
				name,
				config as OperationApiConfig<Options>,
			));
		},
		defineMigration: (name, config) => {
			return stampEnvVars(defineMigration(name, config));
		},
	};
}
