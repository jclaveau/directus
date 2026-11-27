import { readFileSync } from 'node:fs';
import type { EnvVarDeclaredType } from '../types/env-type.js';
import { getCastFlag } from '../utils/has-cast-prefix.js';

/**
 * The value the variable `fileEnvVarName` (a `NAME_FILE`) points to: the
 * content of the file at its path, behind the path's cast prefix if any.
 * Throws, naming the path and the variable, when the file cannot be read.
 */
export const readEnvVarFile = (
	fileEnvVarName: string,
	fileEnvVarValue: string,
	declaredType: EnvVarDeclaredType | null,
): string => {
	const castFlag = getCastFlag(fileEnvVarValue);

	const castPrefix = castFlag
		? `${castFlag}:`
		: '';

	const filePath = castFlag
		? fileEnvVarValue.replace(castPrefix, '')
		: fileEnvVarValue;

	let fileContent: string;

	try {
		fileContent = readFileSync(filePath, { encoding: 'utf8' });
	}
	catch {
		throw new Error(
			`Failed to read value from file ${JSON.stringify(fileEnvVarValue)},`
				+ ' defined in environment variable'
				+ ` ${JSON.stringify(fileEnvVarName)}.`,
		);
	}

	const fileContentType = castFlag ?? declaredType;

	// A secret is written with trailing newlines, which no boolean or number
	// parses with; a string, a password, keeps its spaces, as file_env's $(< file)
	if (fileContentType && fileContentType !== 'string') {
		return castPrefix + fileContent.trim();
	}

	return castPrefix + fileContent.replace(/\n+$/, '');
};
