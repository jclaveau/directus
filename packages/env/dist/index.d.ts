//#region src/types/env.d.ts
type Env = Record<string, unknown>;
//#endregion
//#region src/lib/use-env.d.ts
declare const useEnv: () => Env;
//#endregion
export { useEnv };