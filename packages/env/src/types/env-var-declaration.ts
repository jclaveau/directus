import type { EnvVarDeclaredType } from './env-type.js';

/** A list default is written `as const`, so a readonly list stands for one. */
type ReadonlyListOf<CastValue> = CastValue extends (infer Item)[]
	? readonly Item[]
	: CastValue;

/**
 * What a variable is declared as: the type its value is cast to, the default it
 * takes when unset, already of that type, and the only values it may take when
 * `values` lists them.
 */
export type EnvVarDeclaration = {
	[DeclaredType in EnvVarDeclaredType]: {
		type: DeclaredType;
		default?: ReadonlyListOf<EnvVarValueByType[DeclaredType]>;
		values?: readonly string[];
	};
}[EnvVarDeclaredType];

export type EnvVarDeclarations = Record<string, EnvVarDeclaration>;

/**
 * A variable core reads whose value is guessed rather than cast to one type:
 * `false` or a value, a list or a word, or a passthrough a library reads.
 */
export type GuessedEnvVarDeclaration = { type?: never; default?: unknown };

/** What core declares a variable as: a type, or a value it guesses. */
export type CoreEnvVarDeclaration = EnvVarDeclaration | GuessedEnvVarDeclaration;

export type CoreEnvVarDeclarations = Record<string, CoreEnvVarDeclaration>;

/** What a value of each type is once cast. */
export type EnvVarValueByType = {
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

export type DeclaredEnvVarValue<Declaration extends CoreEnvVarDeclaration> =
	Declaration extends { values: readonly (infer Choice)[] }
		? Choice
		: Declaration extends {
			type: infer DeclaredType extends EnvVarDeclaredType;
		}
			? EnvVarValueByType[DeclaredType]
			: unknown;

/**
 * The variables `ExactDeclarations` declares, typed: a variable with a default
 * is always set, one without may be `undefined`.
 */
export type DeclaredEnvVars<
	ExactDeclarations extends CoreEnvVarDeclarations,
> = {
	-readonly [VarName in keyof ExactDeclarations]:
		ExactDeclarations[VarName] extends { default: unknown }
			? DeclaredEnvVarValue<ExactDeclarations[VarName]>
			: DeclaredEnvVarValue<ExactDeclarations[VarName]> | undefined;
};

/** The names a glob matches, each `*` standing for one or more characters. */
export type EnvVarNamePattern<NamePattern extends string> =
	NamePattern extends `${infer Head}*${infer Tail}`
		? `${Head}${string}${EnvVarNamePattern<Tail>}`
		: NamePattern;

/**
 * The variables `ExactDeclarations` declares by the glob of their name, typed:
 * one index signature per glob, never set by default.
 */
export type PatternEnvVars<
	ExactDeclarations extends CoreEnvVarDeclarations,
> = {
	-readonly [
		NamePattern in keyof ExactDeclarations & string
			as EnvVarNamePattern<NamePattern>
	]: DeclaredEnvVarValue<ExactDeclarations[NamePattern]> | undefined;
};
