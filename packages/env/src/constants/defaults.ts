import type { CoreEnvVarDeclarations } from '../types/env-var-declaration.js';
import { ENV_VAR_DECLARATIONS } from './env-var-declarations.js';

type DeclaredDefaults<ExactDeclarations extends CoreEnvVarDeclarations> = {
	[VarName in keyof ExactDeclarations as ExactDeclarations[VarName] extends {
		default: unknown;
	}
		? VarName
		: never]: ExactDeclarations[VarName] extends { default: infer DefaultValue }
		? DefaultValue
		: never;
};

/** The default of every variable {@link ENV_VAR_DECLARATIONS} gives one. */
export const DEFAULTS = Object.fromEntries(
	// as: a const object widened to its declared shape
	Object.entries(ENV_VAR_DECLARATIONS as CoreEnvVarDeclarations)
		.filter(([, envVarDeclaration]) => 'default' in envVarDeclaration)
		.map(([name, envVarDeclaration]) => [name, envVarDeclaration.default]),
) as DeclaredDefaults<typeof ENV_VAR_DECLARATIONS>; // fromEntries loses keys
