import type {
	CoreEnvVarDeclaration,
	CoreEnvVarDeclarations,
} from '../types/env-var-declaration.js';
import type { EnvVarDeclaredType } from '../types/env-type.js';
import {
	ENV_VAR_DECLARATIONS,
	ENV_VAR_PATTERN_DECLARATIONS,
} from './env-var-declarations.js';

/** The pattern of the names `glob` matches, each `*` one or more characters. */
export const globPattern = (glob: string): RegExp => {
	const escapedParts = glob
		.split('*')
		.map((globPart) => globPart.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));

	return new RegExp(`^${escapedParts.join('.+')}$`);
};

/**
 * Each declaration with the pattern its name matches, literal names first. A
 * literal name is a glob matching only itself.
 */
export const ENV_VAR_NAME_PATTERNS: [RegExp, CoreEnvVarDeclaration][] =
	Object.entries({
		...ENV_VAR_DECLARATIONS,
		...ENV_VAR_PATTERN_DECLARATIONS,
	} as CoreEnvVarDeclarations) // const objects widened to the declared shape
		.map(([nameGlob, envVarDeclaration]) => {
			return [globPattern(nameGlob), envVarDeclaration];
		});

export const TYPE_MAP_REGEX: [RegExp, EnvVarDeclaredType][] =
	ENV_VAR_NAME_PATTERNS.flatMap(([namePattern, envVarDeclaration]) => {
		return 'type' in envVarDeclaration
			? [[namePattern, envVarDeclaration.type]]
			: [];
	});
