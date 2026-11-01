import type { EXTENSION_LANGUAGES } from '@directus/extensions';
import type { InputOptions, OutputOptions, Plugin } from 'rolldown';
import type { IstanbulPluginOptions } from './istanbul-options.js';

export type Language = (typeof EXTENSION_LANGUAGES)[number];
export type LanguageShort = 'js' | 'ts';

export type Config = {
	/**
	 * Dependencies the api entrypoint resolves at runtime instead of bundling. A
	 * string matches an import specifier exactly, so reach a package's subpaths
	 * with a regular expression. The app entrypoint ignores these: a browser
	 * resolves nothing but the shared deps the host guarantees.
	 */
	external?: (string | RegExp)[];
	plugins?: Plugin[];
	/**
	 * Instrument the api entrypoint with istanbul, for the server to dump its
	 * coverage to `dir`, relative to the package: `true` is `{}`, which
	 * instruments the package's own sources and dumps to `coverage/backend`.
	 * Refused for an app-only extension and when NODE_ENV is production.
	 */
	coverage?: boolean | CoverageConfig;
	watch?: {
		clearScreen?: boolean;
	};
};

/**
 * The object form of `coverage`: rolldown-plugin-istanbul's own options, plus
 * the switch and the directory the server dumps to. `include` and `exclude`
 * replace the defaults; `instrumenterConfig` is merged over them key by key, so
 * a `parserPlugins` of your own replaces the default list, `typescript` with it.
 */
export type CoverageConfig = IstanbulPluginOptions & {
	/** Off when false, keeping the rest for when it is switched back on. */
	enabled?: boolean;
	/** Relative to the package; `coverage/backend` when left out. */
	dir?: string;
};

export type RolldownConfig = { inputOptions: InputOptions; outputOptions: OutputOptions };

export type Format = 'esm' | 'cjs';

export type Report = {
	level: 'info' | 'warn' | 'error';
	message: string;
};
