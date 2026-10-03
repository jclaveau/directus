//#region src/lib/cast.d.ts
declare const cast: (value: unknown, key?: string) => unknown;
//#endregion
//#region src/types/env.d.ts
type Env = Record<string, unknown>;
//#endregion
//#region src/types/env-sources.d.ts
/**
 * Which layer of the loader supplied a variable's final value. The wire contract
 * `@directus/types` publishes for the processes report declares the same union;
 * assigning one to the other is what keeps the two from drifting silently.
 */
type EnvValueSource = 'default' | 'process' | 'file' | 'secret-file';
type EnvSources = Record<string, EnvValueSource>;
//#endregion
//#region src/lib/use-env.d.ts
declare const useEnv: () => Env;
/**
 * Which layer each resolved variable's value came from. Reads off the same
 * memoized build as `useEnv`, so it always describes the env in force.
 */
declare const useEnvSources: () => EnvSources;
//#endregion
export { type EnvSources, type EnvValueSource, cast, useEnv, useEnvSources };