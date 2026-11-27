import {
	castEnvVarValue,
	checkDeclaredEnvVarValue,
	CORE_ENV_VAR_PREFIXES,
	type EnvVarDeclaration,
	getDefaultType,
	isCoreEnvVarName,
	readEnvVarFile,
} from '@directus/env';
import type { ExtensionEnvVars } from '@directus/extensions/scalabus';

/** Which extension declared each variable, and as what. */
export type ExtensionEnvVarDeclarers = Map<
	string,
	{ extensionName: string; envVarDeclaration: EnvVarDeclaration }
>;

/**
 * Check the variables `extensionName` declares and cast them into `liveEnv` as
 * declared, from the values they were set to or from their defaults. Throws,
 * naming the variable and the extension, on a value that does not fit, on a
 * name core declares, and on a name another extension declares as another
 * type or with another default; nothing is written then.
 */
export function applyExtensionEnvVars({
	extensionName,
	extensionEnvVars,
	envVarDeclarers,
	rawEnvVarValues,
	liveEnv,
}: {
	extensionName: string;
	extensionEnvVars: ExtensionEnvVars[];
	envVarDeclarers: ExtensionEnvVarDeclarers;
	rawEnvVarValues: Record<string, unknown>;
	liveEnv: Record<string, unknown>;
}): void {
	const quotedExtension = JSON.stringify(extensionName);
	const declarationRefusals: string[] = [];
	const declaredValues: Record<string, unknown> = {};

	for (const { prefix, vars } of extensionEnvVars) {
		if (CORE_ENV_VAR_PREFIXES.some((corePrefix) => corePrefix === prefix)) {
			declarationRefusals.push(
				`Extension ${quotedExtension} declares the prefix`
					+ ` ${JSON.stringify(prefix)}, which is core's.`,
			);
		}

		for (const [envVarName, envVarDeclaration] of Object.entries(vars)) {
			const quotedName = JSON.stringify(envVarName);
			const otherDeclarer = envVarDeclarers.get(envVarName);

			if (isCoreEnvVarName(envVarName)) {
				declarationRefusals.push(
					`Extension ${quotedExtension} declares ${quotedName},`
						+ ' which core declares.',
				);
			}
			else if (
				otherDeclarer !== undefined
				&& otherDeclarer.extensionName !== extensionName
				&& otherDeclarer.envVarDeclaration.type !== envVarDeclaration.type
			) {
				declarationRefusals.push(
					`Extension ${quotedExtension} declares ${quotedName}`
						+ ` ${envVarDeclaration.type}, which extension`
						+ ` ${JSON.stringify(otherDeclarer.extensionName)} declares`
						+ ` ${otherDeclarer.envVarDeclaration.type}.`,
				);
			}
			else if (
				otherDeclarer !== undefined
				&& otherDeclarer.extensionName !== extensionName
				&& 'default' in envVarDeclaration
				&& 'default' in otherDeclarer.envVarDeclaration
				&& JSON.stringify(envVarDeclaration.default)
				!== JSON.stringify(otherDeclarer.envVarDeclaration.default)
			) {
				declarationRefusals.push(
					`Extension ${quotedExtension} declares ${quotedName}`
						+ ` default ${JSON.stringify(envVarDeclaration.default)},`
						+ ' which extension'
						+ ` ${JSON.stringify(otherDeclarer.extensionName)} declares`
						+ ` ${JSON.stringify(otherDeclarer.envVarDeclaration.default)}.`,
				);
			}

			const fileEnvVarName = `${envVarName}_FILE`;
			const fileEnvVarValue = rawEnvVarValues[fileEnvVarName];
			let declaredValue: unknown;

			try {
				if (typeof fileEnvVarValue === 'string') {
					declaredValue = readEnvVarFile(
						fileEnvVarName,
						fileEnvVarValue,
						envVarDeclaration.type,
					);
				}
				else {
					declaredValue = envVarName in rawEnvVarValues
						? rawEnvVarValues[envVarName]
						: envVarDeclaration.default;
				}
			}
			catch (fileReadError) {
				declarationRefusals.push(
					`Extension ${quotedExtension}: ${(fileReadError as Error).message}`,
				);

				continue;
			}

			const valueRefusal = declaredValue === undefined
				? null
				: checkDeclaredEnvVarValue(envVarName, declaredValue, envVarDeclaration);

			if (valueRefusal !== null) {
				declarationRefusals.push(`Extension ${quotedExtension}: ${valueRefusal}`);
			}
			else if (declaredValue !== undefined) {
				declaredValues[envVarName] = castEnvVarValue(
					declaredValue,
					envVarDeclaration.type,
				);
			}
		}
	}

	if (declarationRefusals.length > 0) {
		throw new Error(declarationRefusals.join('\n'));
	}

	for (const { vars } of extensionEnvVars) {
		for (const [envVarName, envVarDeclaration] of Object.entries(vars)) {
			envVarDeclarers.set(envVarName, { extensionName, envVarDeclaration });
		}
	}

	Object.assign(liveEnv, declaredValues);
}

/**
 * Give each variable the extensions declared back the value core cast it to,
 * so `liveEnv` reads as a boot without them: core's guess at the value it was set
 * to, or nothing when it was not set. A name core declares is never one, since
 * `applyExtensionEnvVars` refuses it.
 */
export function restoreCoreEnvVars({
	envVarDeclarers,
	rawEnvVarValues,
	liveEnv,
}: {
	envVarDeclarers: ExtensionEnvVarDeclarers;
	rawEnvVarValues: Record<string, unknown>;
	liveEnv: Record<string, unknown>;
}): void {
	for (const declaredName of envVarDeclarers.keys()) {
		if (declaredName in rawEnvVarValues) {
			liveEnv[declaredName] = castEnvVarValue(
				rawEnvVarValues[declaredName],
				getDefaultType(declaredName),
			);
		}
		else {
			Reflect.deleteProperty(liveEnv, declaredName);
		}
	}
}

/**
 * The variables set under a core prefix or one an extension declares, that
 * neither core nor any extension declares: most likely typos.
 */
export function findUndeclaredEnvVars({
	rawEnvVarNames,
	envVarDeclarers,
	extensionPrefixes,
}: {
	rawEnvVarNames: string[];
	envVarDeclarers: ExtensionEnvVarDeclarers;
	extensionPrefixes: Set<string>;
}): string[] {
	const declaredPrefixes = [...CORE_ENV_VAR_PREFIXES, ...extensionPrefixes];

	return rawEnvVarNames.filter((envVarName) => {
		return declaredPrefixes.some((prefix) => envVarName.startsWith(prefix))
			&& !isCoreEnvVarName(envVarName)
			&& !envVarDeclarers.has(envVarName)
			&& !(envVarName.endsWith('_FILE')
				&& envVarDeclarers.has(envVarName.slice(0, -'_FILE'.length)));
	});
}
