/**
 * rolldown-plugin-istanbul's options, which neither it nor istanbul-lib-instrument
 * types: these follow their sources, plugin 5.0.1 and istanbul-lib-instrument 6.
 */

/** As @rollup/pluginutils' createFilter takes it. */
export type FilterPattern =
	| ReadonlyArray<string | RegExp>
	| string
	| RegExp
	| null;

/** istanbul-lib-instrument's createInstrumenter options. */
export interface InstrumenterOptions {
	coverageVariable?: string;
	reportLogic?: boolean;
	preserveComments?: boolean;
	compact?: boolean;
	esModules?: boolean;
	autoWrap?: boolean;
	produceSourceMap?: boolean;
	ignoreClassMethods?: string[];
	sourceMapUrlCallback?: (filename: string, url: string) => void;
	debug?: boolean;
	parserPlugins?: string[];
	coverageGlobalScope?: string;
	coverageGlobalScopeFunc?: boolean;
	generatorOpts?: Record<string, unknown>;
}

/** A stand-in for istanbul-lib-instrument, called as the plugin calls it. */
export interface Instrumenter {
	createInstrumenter(options: InstrumenterOptions): unknown;
}

export interface IstanbulPluginOptions {
	include?: FilterPattern;
	exclude?: FilterPattern;
	instrumenterConfig?: InstrumenterOptions;
	instrumenter?: Instrumenter;
}
