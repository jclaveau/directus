export {
	ENV_VAR_DECLARATIONS,
	ENV_VAR_PATTERN_DECLARATIONS,
} from './constants/env-var-declarations.js';
export { castEnvVarValue } from './lib/cast.js';
export { readEnvVarFile } from './lib/read-env-var-file.js';
export { checkDeclaredEnvVarValue } from './lib/check-declared-env-var-value.js';
export { useEnv, useEnvVarRawValues, useEnvSources } from './lib/use-env.js';
export type {
	CoreEnvVarDeclaration,
	DeclaredEnvVars,
	DeclaredEnvVarValue,
	EnvVarDeclaration,
	EnvVarDeclarations,
	EnvVarValueByType,
	EnvVarNamePattern,
	GuessedEnvVarDeclaration,
} from './types/env-var-declaration.js';
export type { EnvSources, EnvValueSource } from './types/env-sources.js';
export type { EnvVarDeclaredType, EnvType } from './types/env-type.js';
export type { Env, EnvVarName } from './types/env.js';
export { getDefaultType } from './utils/get-default-type.js';
export { findEnvVarDeclaration } from './utils/find-env-var-declaration.js';
export { CORE_ENV_VAR_PREFIXES } from './constants/core-env-var-prefixes.js';
export { isCoreEnvVarName } from './utils/is-core-env-var-name.js';
