import type { ENV_DECLARATIONS } from '../constants/env-declarations.js';
import type { DeclaredEnv } from './env-declaration.js';

/** A declared variable is its declared type; any other is `unknown`. */
export type Env = DeclaredEnv<typeof ENV_DECLARATIONS> & Record<string, unknown>;
