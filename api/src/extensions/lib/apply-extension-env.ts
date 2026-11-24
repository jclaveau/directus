import {
	castDeclaredValue,
	checkDeclaredValue,
	CORE_ENV_PREFIXES,
	type EnvDeclaration,
	isCoreEnvName,
} from '@directus/env';
import type { ExtensionEnv } from '@directus/extensions/scalabus';

/** Which extension declared each variable, and as what. */
export type ExtensionEnvDeclarers = Map<
	string,
	{ extensionName: string; envDeclaration: EnvDeclaration }
>;

/**
 * Check the variables `extensionName` declares and cast them into `env` as
 * declared, from the values they were set to or from their defaults. Throws,
 * naming the variable and the extension, on a value that does not fit, on a
 * name core declares, and on a name another extension declares as another
 * type; nothing is written then.
 */
export function applyExtensionEnv({
	extensionName,
	extensionEnvs,
	envDeclarers,
	rawValues,
	env,
}: {
	extensionName: string;
	extensionEnvs: ExtensionEnv[];
	envDeclarers: ExtensionEnvDeclarers;
	rawValues: Record<string, unknown>;
	env: Record<string, unknown>;
}): void {
	const quotedExtension = JSON.stringify(extensionName);
	const refusals: string[] = [];
	const declaredValues: Record<string, unknown> = {};

	for (const { prefix, vars } of extensionEnvs) {
		if (CORE_ENV_PREFIXES.some((corePrefix) => corePrefix === prefix)) {
			refusals.push(
				`Extension ${quotedExtension} declares the prefix`
					+ ` ${JSON.stringify(prefix)}, which is core's.`,
			);
		}

		for (const [name, envDeclaration] of Object.entries(vars)) {
			const quotedName = JSON.stringify(name);
			const otherDeclarer = envDeclarers.get(name);

			if (isCoreEnvName(name)) {
				refusals.push(
					`Extension ${quotedExtension} declares ${quotedName},`
						+ ' which core declares.',
				);
			}
			else if (
				otherDeclarer !== undefined
				&& otherDeclarer.extensionName !== extensionName
				&& otherDeclarer.envDeclaration.type !== envDeclaration.type
			) {
				refusals.push(
					`Extension ${quotedExtension} declares ${quotedName}`
						+ ` ${envDeclaration.type}, which extension`
						+ ` ${JSON.stringify(otherDeclarer.extensionName)} declares`
						+ ` ${otherDeclarer.envDeclaration.type}.`,
				);
			}

			const declaredValue = name in rawValues
				? rawValues[name]
				: envDeclaration.default;

			const refusal = declaredValue === undefined
				? null
				: checkDeclaredValue(name, declaredValue, envDeclaration);

			if (refusal !== null) {
				refusals.push(`Extension ${quotedExtension}: ${refusal}`);
			}
			else if (declaredValue !== undefined) {
				declaredValues[name] = castDeclaredValue(declaredValue, envDeclaration);
			}
		}
	}

	if (refusals.length > 0) {
		throw new Error(refusals.join('\n'));
	}

	for (const { vars } of extensionEnvs) {
		for (const [name, envDeclaration] of Object.entries(vars)) {
			envDeclarers.set(name, { extensionName, envDeclaration });
		}
	}

	Object.assign(env, declaredValues);
}

/**
 * The variables set under a core prefix or one an extension declares, that
 * neither core nor any extension declares: most likely typos.
 */
export function findUndeclaredEnv({
	rawNames,
	envDeclarers,
	extensionPrefixes,
}: {
	rawNames: string[];
	envDeclarers: ExtensionEnvDeclarers;
	extensionPrefixes: Set<string>;
}): string[] {
	const declaredPrefixes = [...CORE_ENV_PREFIXES, ...extensionPrefixes];

	return rawNames.filter((name) => {
		return declaredPrefixes.some((prefix) => name.startsWith(prefix))
			&& !isCoreEnvName(name)
			&& !envDeclarers.has(name);
	});
}
