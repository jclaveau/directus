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

/**
 * A variable core reads whose value is guessed rather than cast to one type:
 * `false` or a value, a list or a word, or a passthrough a library reads.
 */
export type GuessedEnvDeclaration = { default?: unknown };

/** What core declares a variable as: a type, or a value it guesses. */
export type CoreEnvDeclaration = EnvDeclaration | GuessedEnvDeclaration;

export type CoreEnvDeclarations = Record<string, CoreEnvDeclaration>;

/** What a value of each type is once cast. */
export type EnvTypeValue = {
	string: string;
	number: number;
	boolean: boolean;
	regex: RegExp;
	'string[]': string[];
	json: unknown;
	'false | number': false | number;
	'false | string': false | string;
	'false | string[]': false | string[];
	'boolean | number | string | string[]': boolean | number | string | string[];
};

export type DeclaredValue<Declaration extends CoreEnvDeclaration> =
	Declaration extends { values: readonly (infer Choice)[] }
		? Choice
		: Declaration extends { type: infer DeclaredType extends EnvDeclarationType }
			? EnvTypeValue[DeclaredType]
			: unknown;

/**
 * The variables `Declarations` declares, typed: a variable with a default is
 * always set, one without may be `undefined`.
 */
export type DeclaredEnv<Declarations extends CoreEnvDeclarations> = {
	-readonly [Name in keyof Declarations]:
		Declarations[Name] extends { default: unknown }
			? DeclaredValue<Declarations[Name]>
			: DeclaredValue<Declarations[Name]> | undefined;
};

/** The names a glob matches, each `*` standing for one or more characters. */
export type GlobName<Glob extends string> =
	Glob extends `${infer Head}*${infer Tail}`
		? `${Head}${string}${GlobName<Tail>}`
		: Glob;

/**
 * The variables `Declarations` declares by the glob of their name, typed: one
 * index signature per glob, never set by default.
 */
export type PatternEnv<Declarations extends CoreEnvDeclarations> = {
	-readonly [Glob in keyof Declarations & string as GlobName<Glob>]:
		DeclaredValue<Declarations[Glob]> | undefined;
};
