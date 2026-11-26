import type { CoreEnvDeclarations } from '../types/env-declaration.js';
import { ENV_DECLARATIONS } from './env-declarations.js';

type DeclaredDefaults<Declarations extends CoreEnvDeclarations> = {
	[Name in keyof Declarations as Declarations[Name] extends { default: unknown }
		? Name
		: never]: Declarations[Name] extends { default: infer Default }
		? Default
		: never;
};

/** The default of every variable {@link ENV_DECLARATIONS} gives one. */
export const DEFAULTS = Object.fromEntries(
	// as: a const object widened to its declared shape
	Object.entries(ENV_DECLARATIONS as CoreEnvDeclarations)
		.filter(([, envDeclaration]) => 'default' in envDeclaration)
		.map(([name, envDeclaration]) => [name, envDeclaration.default]),
) as DeclaredDefaults<typeof ENV_DECLARATIONS>; // fromEntries loses keys
