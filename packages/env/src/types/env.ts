import type {
	ENV_VAR_DECLARATIONS,
	ENV_VAR_PATTERN_DECLARATIONS,
} from '../constants/env-var-declarations.js';
import type { DeclaredEnvVars, PatternEnvVars } from './env-var-declaration.js';

/**
 * The variables core declares, each its declared type: a name core does not
 * declare is refused at typecheck.
 */
export type Env = DeclaredEnvVars<typeof ENV_VAR_DECLARATIONS>
	& PatternEnvVars<typeof ENV_VAR_PATTERN_DECLARATIONS>;

/** A name core declares, literally or by the glob it matches. */
export type EnvVarName = keyof Env & string;
