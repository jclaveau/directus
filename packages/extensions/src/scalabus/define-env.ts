import type { DeclaredEnv, Env, EnvDeclarations } from '@directus/env';
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

/** The variables an extension declares, every one named under `prefix`. */
export interface ExtensionEnv<
	Declarations extends EnvDeclarations = EnvDeclarations,
> {
	prefix: string;
	vars: Declarations;
}

/** `Context` with `env` typed: core's variables and the extension's. */
export type WithDeclaredEnv<Context, Declarations extends EnvDeclarations> =
	Omit<Context, 'env'> & { env: Env & DeclaredEnv<Declarations> };

type EnvEndpointHandler<Declarations extends EnvDeclarations> = (
	router: Router,
	context: WithDeclaredEnv<EndpointExtensionContext, Declarations>,
) => void;

type EnvOperationApiConfig<Options, Declarations extends EnvDeclarations> = {
	id: string;
	handler: (
		options: Options,
		context: WithDeclaredEnv<OperationContext, Declarations>,
	) => unknown;
};

export interface ExtensionEnvHelpers<Declarations extends EnvDeclarations>
	extends ExtensionEnv<Declarations> {
	defineHook: (
		name: string,
		config: (
			register: RegisterFunctions,
			context: WithDeclaredEnv<HookExtensionContext, Declarations>,
		) => void,
	) => HookEntry;
	defineEndpoint: (
		name: string,
		config:
			| EnvEndpointHandler<Declarations>
			| { id: string; handler: EnvEndpointHandler<Declarations> },
	) => EndpointEntry;
	defineOperationApi: <Options = Record<string, unknown>>(
		name: string,
		config: EnvOperationApiConfig<Options, Declarations>,
	) => OperationApiEntry;
	defineMigration: (name: string, config: MigrationConfig) => MigrationEntry;
}

const ENV_PREFIX_PATTERN = /^[A-Z][A-Z0-9]*_$/;

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
export function defineEnv<const Declarations extends EnvDeclarations>(
	extensionEnv: ExtensionEnv<Declarations>,
): ExtensionEnvHelpers<Declarations> {
	const { prefix, vars } = extensionEnv;

	if (!ENV_PREFIX_PATTERN.test(prefix)) {
		throw new Error(
			`Env prefix ${JSON.stringify(prefix)} must be upper case and end`
				+ ' with "_", like "SUBSCRIPTIONS_"',
		);
	}

	for (const name of Object.keys(vars)) {
		if (!name.startsWith(prefix)) {
			throw new Error(
				`Env variable ${JSON.stringify(name)} is not named under its`
					+ ` prefix ${JSON.stringify(prefix)}`,
			);
		}
	}

	const declaredEnv: ExtensionEnv = { prefix, vars };

	const stampEnv = <Entry extends BundleApiEntry>(entry: Entry): Entry => {
		return { ...entry, env: declaredEnv };
	};

	return {
		prefix,
		vars,
		defineHook: (name, config) => {
			return stampEnv(defineHook(name, config as HookConfig));
		},
		defineEndpoint: (name, config) => {
			return stampEnv(defineEndpoint(name, config as EndpointConfig));
		},
		defineOperationApi: <Options,>(
			name: string,
			config: EnvOperationApiConfig<Options, Declarations>,
		) => {
			return stampEnv(defineOperationApi<Options>(
				name,
				config as OperationApiConfig<Options>,
			));
		},
		defineMigration: (name, config) => {
			return stampEnv(defineMigration(name, config));
		},
	};
}
