import type {
	ENV_DECLARATIONS,
	ENV_PATTERN_DECLARATIONS,
} from '../constants/env-declarations.js';
import type { DeclaredEnv, PatternEnv } from './env-declaration.js';

/**
 * The variables core declares, each its declared type: a name core does not
 * declare is refused at typecheck.
 */
export type Env = DeclaredEnv<typeof ENV_DECLARATIONS>
	& PatternEnv<typeof ENV_PATTERN_DECLARATIONS>;

/** A name core declares, literally or by the glob it matches. */
export type EnvName = keyof Env & string;
