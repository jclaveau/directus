import type {
	CoreEnvDeclaration,
	CoreEnvDeclarations,
} from '../types/env-declaration.js';
import type { EnvDeclarationType } from '../types/env-type.js';
import {
	ENV_DECLARATIONS,
	ENV_PATTERN_DECLARATIONS,
} from './env-declarations.js';

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
export const DECLARATION_PATTERNS: [RegExp, CoreEnvDeclaration][] = Object.entries({
	...ENV_DECLARATIONS,
	...ENV_PATTERN_DECLARATIONS,
} as CoreEnvDeclarations) // const objects widened to the declared shape
	.map(([nameGlob, envDeclaration]) => [globPattern(nameGlob), envDeclaration]);

export const TYPE_MAP_REGEX: [RegExp, EnvDeclarationType][] = DECLARATION_PATTERNS
	.flatMap(([namePattern, envDeclaration]) => {
		return 'type' in envDeclaration
			? [[namePattern, envDeclaration.type]]
			: [];
	});
