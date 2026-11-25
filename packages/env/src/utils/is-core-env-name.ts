import { findEnvDeclaration } from './find-env-declaration.js';

/** Whether core declares the variable `name`, literally or by a glob. */
export const isCoreEnvName = (name: string): boolean => {
	return findEnvDeclaration(name) !== null;
};
