import { findEnvVarDeclaration } from './find-env-var-declaration.js';

/** Whether core declares the variable `envVarName`, literally or by a glob. */
export const isCoreEnvVarName = (envVarName: string): boolean => {
	return findEnvVarDeclaration(envVarName) !== null;
};
