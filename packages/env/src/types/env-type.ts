import type {
	ENV_DECLARATION_TYPES,
	ENV_TYPES,
} from '../constants/env-types.js';

export type EnvType = (typeof ENV_TYPES)[number];

export type EnvDeclarationType = (typeof ENV_DECLARATION_TYPES)[number];
