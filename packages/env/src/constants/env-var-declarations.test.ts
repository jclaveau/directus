import { expect, test } from 'vitest';
import { checkDeclaredEnvVarValue } from '../lib/check-declared-env-var-value.js';
import type {
	CoreEnvVarDeclarations,
	EnvVarDeclaration,
} from '../types/env-var-declaration.js';
import { ENV_VAR_DECLARATIONS } from './env-var-declarations.js';

test('every default fits its own declaration', () => {
	const declarationRefusals = Object.entries(
		ENV_VAR_DECLARATIONS as CoreEnvVarDeclarations,
	)
		.filter((namedDeclaration): namedDeclaration is [string, EnvVarDeclaration] => {
			return 'type' in namedDeclaration[1];
		})
		.filter(([, envVarDeclaration]) => 'default' in envVarDeclaration)
		.map(([envVarName, envVarDeclaration]) => {
			return checkDeclaredEnvVarValue(
				envVarName,
				envVarDeclaration.default,
				envVarDeclaration,
			);
		})
		.filter((valueRefusal) => valueRefusal !== null);

	expect(declarationRefusals).toEqual([]);
});
