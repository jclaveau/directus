import { DECLARATION_PATTERNS } from '../constants/type-map.js';
import type { CoreEnvDeclaration } from '../types/env-declaration.js';

/** What core declares `name` as, or null when core declares nothing. */
export const findEnvDeclaration = (
	name: string,
): CoreEnvDeclaration | null => {
	const declarationPattern = DECLARATION_PATTERNS.find(([namePattern]) => {
		return namePattern.test(name);
	});

	return declarationPattern?.[1] ?? null;
};
