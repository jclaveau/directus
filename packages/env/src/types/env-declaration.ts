import type { EnvDeclarationType } from './env-type.js';

/** A list default is written `as const`, so a readonly list stands for one. */
type ReadonlyListOf<CastValue> = CastValue extends (infer Item)[]
	? readonly Item[]
	: CastValue;

/**
 * What a variable is declared as: the type its value is cast to, the default it
 * takes when unset, already of that type, and the only values it may take when
 * `values` lists them.
 */
export type EnvDeclaration = {
	[DeclaredType in EnvDeclarationType]: {
		type: DeclaredType;
		default?: ReadonlyListOf<EnvTypeValue[DeclaredType]>;
		values?: readonly string[];
	};
}[EnvDeclarationType];

export type EnvDeclarations = Record<string, EnvDeclaration>;

/**
 * A variable core reads whose value is guessed rather than cast to one type:
 * `false` or a value, a list or a word, or a passthrough a library reads.
 */
export type GuessedEnvDeclaration = { type?: never; default?: unknown };

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
