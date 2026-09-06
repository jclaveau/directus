import type { EXTENSION_LANGUAGES } from '@directus/extensions';
import type { InputOptions, OutputOptions, Plugin } from 'rolldown';

export type Language = (typeof EXTENSION_LANGUAGES)[number];
export type LanguageShort = 'js' | 'ts';

export type Config = {
	/**
	 * Dependencies to leave out of the bundle and resolve at runtime instead. A
	 * string matches an import specifier exactly, so reach a package's subpaths
	 * with a regular expression.
	 */
	external?: (string | RegExp)[];
	plugins?: Plugin[];
	watch?: {
		clearScreen?: boolean;
	};
};

export type RolldownConfig = { inputOptions: InputOptions; outputOptions: OutputOptions };

export type Format = 'esm' | 'cjs';

export type Report = {
	level: 'info' | 'warn' | 'error';
	message: string;
};
