import { UNDECLARED_DEFAULTS } from '../constants/defaults.js';
import { findEnvDeclaration } from './find-env-declaration.js';
import { isDirectusVariable } from './is-directus-variable.js';

/** Whether core declares or reads the variable `name`. */
export const isCoreEnvName = (name: string): boolean => {
	return findEnvDeclaration(name) !== null
		|| name in UNDECLARED_DEFAULTS
		|| isDirectusVariable(name);
};
