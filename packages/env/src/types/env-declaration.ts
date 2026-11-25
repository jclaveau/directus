import type { EnvDeclarationType } from './env-type.js';

/**
 * What a variable is declared as: the type its value is cast to, the default it
 * takes when unset, and the only values it may take when `values` lists them.
 */
export type EnvDeclaration = {
	type: EnvDeclarationType;
	default?: unknown;
	values?: readonly string[];
};

export type EnvDeclarations = Record<string, EnvDeclaration>;

/** What a value of each type is once cast. */
export type EnvTypeValue = {
	string: string;
	number: number;
	boolean: boolean;
	regex: RegExp;
	'string[]': string[];
	json: unknown;
};

export type DeclaredValue<Declaration extends EnvDeclaration> =
	Declaration extends { values: readonly (infer Choice)[] }
		? Choice
		: EnvTypeValue[Declaration['type']];

/**
 * The variables `Declarations` declares, typed: a variable with a default is
 * always set, one without may be `undefined`.
 */
export type DeclaredEnv<Declarations extends EnvDeclarations> = {
	-readonly [Name in keyof Declarations]:
		Declarations[Name] extends { default: unknown }
			? DeclaredValue<Declarations[Name]>
			: DeclaredValue<Declarations[Name]> | undefined;
};
