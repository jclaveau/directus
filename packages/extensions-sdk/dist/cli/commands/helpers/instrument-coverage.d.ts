import type { Plugin, RenderedChunk } from 'rolldown';
import type { InstrumenterOptions, IstanbulPluginOptions } from '../../istanbul-options.js';
import type { Config } from '../../types.js';
/** Where coverage is dumped when `dir` is left out, relative to the package. */
export declare const DEFAULT_COVERAGE_DIR = "coverage/backend";
export declare const COVERAGE_IN_PRODUCTION_MESSAGE = "Coverage instrumentation is forbidden when NODE_ENV is production.";
/**
 * istanbul-lib-instrument runs @babel/parser, which reads TypeScript only with
 * its `typescript` plugin, and sees the sources before their types are gone.
 */
export declare const DEFAULT_INSTRUMENTER_CONFIG: InstrumenterOptions;
export interface CoverageTarget {
    sourceRoot: string;
    coverageDir: string;
    pluginOptions: IstanbulPluginOptions;
}
/**
 * What `coverage` in extension.config.js asks of this build, or undefined for a
 * plain build. Throws on a request that must not be built: coverage of an
 * app-only extension, whose code never runs on the server, any coverage build
 * made with NODE_ENV=production, and a coverage variable the server never reads.
 */
export declare function resolveCoverageTarget({ coverageConfig, extensionType, sourceRoot, nodeEnv, }: {
    coverageConfig: Config['coverage'];
    extensionType: string;
    sourceRoot: string;
    nodeEnv: string | undefined;
}): CoverageTarget | undefined;
/**
 * Prepended to every chunk of an instrumented API bundle. It refuses to run in
 * production, before any instrumented code does, and tells the server which
 * directory the files instrumented into this chunk have their coverage dumped
 * to: the server reads no extension.config.js. A file is routed by the build
 * that bundled it, not by where it lies, so a shared one imported from outside
 * the package goes with it.
 */
export declare function renderCoverageBanner(coverageTarget: CoverageTarget, sourceFiles: string[]): string;
export interface CoverageInstrumentation {
    plugin: Plugin;
    banner: (renderedChunk: RenderedChunk) => string;
}
/**
 * The plugin and banner an api entrypoint is built with, or undefined when the
 * config asks for no coverage. The package root is the working directory, where
 * extension.config.js is read from, at its real path: istanbul keys its files by
 * where they really are.
 */
export declare function loadCoverageInstrumentation(config: Config, extensionType: string): Promise<CoverageInstrumentation | undefined>;
