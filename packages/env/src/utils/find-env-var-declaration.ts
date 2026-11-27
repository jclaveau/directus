import { ENV_VAR_NAME_PATTERNS } from '../constants/type-map.js';
import type { CoreEnvVarDeclaration } from '../types/env-var-declaration.js';

/** What core declares `envVarName` as, or null when core declares nothing. */
export const findEnvVarDeclaration = (
	envVarName: string,
): CoreEnvVarDeclaration | null => {
	const declarationPattern = ENV_VAR_NAME_PATTERNS.find(([namePattern]) => {
		return namePattern.test(envVarName);
	});

	return declarationPattern?.[1] ?? null;
};
