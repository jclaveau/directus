import { resolve } from 'node:path';
import { cwd } from 'node:process';
import type { EnvDeclarations } from '../types/env-declaration.js';
import { ENV_DECLARATIONS } from './env-declarations.js';

/**
 * Defaults of variables left out of {@link ENV_DECLARATIONS} on purpose,
 * because a declared type would change what their consumer sees rather than
 * just how it is parsed:
 *
 * - `AUTH_PROVIDERS` — `auth.ts` gates on `!env['AUTH_PROVIDERS']`, and `'array'`
 *   turns the empty default into `[]`, which is truthy.
 * - `CACHE_VALUE_MAX_SIZE`, `ROOT_REDIRECT`, `CORS_ORIGIN`, `IP_CUSTOM_HEADER`,
 *   `FLOWS_ENV_ALLOW_LIST`, `PRESSURE_LIMITER_MAX_MEMORY_RSS`,
 *   `PRESSURE_LIMITER_MAX_MEMORY_HEAP_USED`, `PRESSURE_LIMITER_RETRY_AFTER` —
 *   `false` disables them and any other value configures them, which no single
 *   EnvType covers.
 * - `IP_TRUST_PROXY` — express reads boolean, number, string or list.
 * - `CONFIG_PATH` — read straight off `process.env` before any casting runs.
 */
export const UNDECLARED_DEFAULTS = {
	CONFIG_PATH: resolve(cwd(), '.env'),
	ROOT_REDIRECT: './admin',
	CORS_ORIGIN: false,
	// Dual-typed: `false` (disabled) or a size string like `8kb` — respond.ts keys off
	// `!== false`. No single type-map entry fits, so it stays on per-value guessType.
	CACHE_VALUE_MAX_SIZE: false,
	AUTH_PROVIDERS: '',
	IP_TRUST_PROXY: true,
	IP_CUSTOM_HEADER: false,
	FLOWS_ENV_ALLOW_LIST: false,
	PRESSURE_LIMITER_MAX_MEMORY_RSS: false,
	PRESSURE_LIMITER_MAX_MEMORY_HEAP_USED: false,
	PRESSURE_LIMITER_RETRY_AFTER: false,
} as const;

type DeclaredDefaults<Declarations extends EnvDeclarations> = {
	[Name in keyof Declarations as Declarations[Name] extends { default: unknown }
		? Name
		: never]: Declarations[Name] extends { default: infer Default }
		? Default
		: never;
};

export const DEFAULTS = {
	...UNDECLARED_DEFAULTS,
	...Object.fromEntries(
		Object.entries(ENV_DECLARATIONS as EnvDeclarations)
			.filter(([, envDeclaration]) => 'default' in envDeclaration)
			.map(([name, envDeclaration]) => [name, envDeclaration.default]),
	) as DeclaredDefaults<typeof ENV_DECLARATIONS>,
};
