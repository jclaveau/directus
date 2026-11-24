import { expect, test } from 'vitest';
import { checkDeclaredValue } from '../lib/check-declared-value.js';
import type { EnvDeclarations } from '../types/env-declaration.js';
import { ENV_DECLARATIONS } from './env-declarations.js';

test('every default fits its own declaration', () => {
	const refusals = Object.entries(ENV_DECLARATIONS as EnvDeclarations)
		.filter(([, envDeclaration]) => 'default' in envDeclaration)
		.map(([name, envDeclaration]) => {
			return checkDeclaredValue(name, envDeclaration.default, envDeclaration);
		})
		.filter((refusal) => refusal !== null);

	expect(refusals).toEqual([]);
});
