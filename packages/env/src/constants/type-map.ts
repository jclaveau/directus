import type {
	EnvDeclaration,
	EnvDeclarations,
} from '../types/env-declaration.js';
import type { EnvDeclarationType } from '../types/env-type.js';
import {
	ENV_DECLARATIONS,
	ENV_PATTERN_DECLARATIONS,
} from './env-declarations.js';

/**
 * Each declaration with the pattern its name matches, literal names first. A
 * literal name is a pattern matching only itself.
 */
export const DECLARATION_PATTERNS: [RegExp, EnvDeclaration][] = Object.entries({
	...ENV_DECLARATIONS,
	...ENV_PATTERN_DECLARATIONS,
} as EnvDeclarations)
	.map(([name, envDeclaration]) => [new RegExp(`^${name}$`), envDeclaration]);

export const TYPE_MAP_REGEX: [RegExp, EnvDeclarationType][] = DECLARATION_PATTERNS
	.map(([namePattern, envDeclaration]) => [namePattern, envDeclaration.type]);
