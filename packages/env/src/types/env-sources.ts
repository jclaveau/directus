/**
 * Which layer of the loader supplied a variable's final value. The wire contract
 * `@directus/types` publishes for the processes report declares the same union;
 * assigning one to the other is what keeps the two from drifting silently.
 */
export type EnvValueSource = 'default' | 'process' | 'file' | 'secret-file';

export type EnvSources = Record<string, EnvValueSource>;
