import type {
	ENV_VAR_DECLARED_TYPES,
	ENV_TYPES,
} from '../constants/env-types.js';

export type EnvType = (typeof ENV_TYPES)[number];

export type EnvVarDeclaredType = (typeof ENV_VAR_DECLARED_TYPES)[number];
