import { APP_EXTENSION_TYPES } from '@directus/constants';
import { realpathSync } from 'node:fs';
import path from 'path';
import type { Plugin } from 'rolldown';
import type {
	FilterPattern,
	InstrumenterOptions,
	IstanbulPluginOptions,
} from '../../istanbul-options.js';
import type { Config, CoverageConfig } from '../../types.js';

/** Where coverage is dumped when `dir` is left out, relative to the package. */
export const DEFAULT_COVERAGE_DIR = 'coverage/backend';

export const COVERAGE_IN_PRODUCTION_MESSAGE
	= 'Coverage instrumentation is forbidden when NODE_ENV is production.';

/** The global the server reads the coverage from. */
const COVERAGE_VARIABLE = '__coverage__';

/**
 * istanbul-lib-instrument runs @babel/parser, which reads TypeScript only with
 * its `typescript` plugin, and sees the sources before their types are gone.
 */
export const DEFAULT_INSTRUMENTER_CONFIG: InstrumenterOptions = {
	esModules: true,
	compact: true,
	produceSourceMap: true,
	autoWrap: true,
	preserveComments: true,
	parserPlugins: [
		'asyncGenerators',
		'bigInt',
		'classProperties',
		'classPrivateProperties',
		'classPrivateMethods',
		'dynamicImport',
		'importMeta',
		'numericSeparator',
		'objectRestSpread',
		'optionalCatchBinding',
		'topLevelAwait',
		'typescript',
	],
};

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
export function resolveCoverageTarget({
	coverageConfig,
	extensionType,
	sourceRoot,
	nodeEnv,
}: {
	coverageConfig: Config['coverage'];
	extensionType: string;
	sourceRoot: string;
	nodeEnv: string | undefined;
}): CoverageTarget | undefined {
	if (
		coverageConfig !== undefined
		&& typeof coverageConfig !== 'boolean'
		&& !isCoverageObject(coverageConfig)
	) {
		throw new Error(
			'coverage in extension.config.js must be true, false or an object of '
				+ 'rolldown-plugin-istanbul options with an optional enabled and dir, '
				+ `not ${JSON.stringify(coverageConfig)}.`,
		);
	}

	if (
		coverageConfig === undefined
		|| coverageConfig === false
		|| (typeof coverageConfig === 'object' && coverageConfig.enabled === false)
	) {
		return undefined;
	}

	const appTypes: readonly string[] = APP_EXTENSION_TYPES;

	// The API never loads an app extension's code, so its coverage is never read.
	if (appTypes.includes(extensionType)) {
		throw new Error(
			'coverage is only read for an api, hybrid or bundle extension, not for '
				+ `an extension of type "${extensionType}".`,
		);
	}

	if (nodeEnv === 'production') {
		throw new Error(COVERAGE_IN_PRODUCTION_MESSAGE);
	}

	const coverageOptions: CoverageConfig = coverageConfig === true
		? {}
		: coverageConfig;

	const coverageVariable = coverageOptions.instrumenterConfig?.coverageVariable;

	if (coverageVariable !== undefined && coverageVariable !== COVERAGE_VARIABLE) {
		throw new Error(
			'coverage.instrumenterConfig.coverageVariable must be '
				+ `"${COVERAGE_VARIABLE}", the global the server dumps, not `
				+ `"${coverageVariable}".`,
		);
	}

	return {
		sourceRoot,
		coverageDir: path.resolve(
			sourceRoot,
			coverageOptions.dir ?? DEFAULT_COVERAGE_DIR,
		),
		pluginOptions: {
			// the package's own sources: a workspace dependency is resolved to its
			// real path outside the package
			include: coverageOptions.include === undefined
				? [path.posix.join(sourceRoot, '**')]
				: anchorFilterPattern(coverageOptions.include, sourceRoot),
			exclude: coverageOptions.exclude === undefined
				? [path.posix.join(sourceRoot, 'node_modules/**'), '**/*.d.ts']
				: anchorFilterPattern(coverageOptions.exclude, sourceRoot),
			instrumenterConfig: {
				...DEFAULT_INSTRUMENTER_CONFIG,
				...coverageOptions.instrumenterConfig,
			},
			...(coverageOptions.instrumenter === undefined
				? {}
				: { instrumenter: coverageOptions.instrumenter }),
		},
	};
}

function isCoverageObject(coverageConfig: unknown): boolean {
	if (
		typeof coverageConfig !== 'object'
		|| coverageConfig === null
		|| Array.isArray(coverageConfig)
	) {
		return false;
	}

	const { enabled, dir } = coverageConfig as Record<string, unknown>;

	return (enabled === undefined || typeof enabled === 'boolean')
		&& (dir === undefined || typeof dir === 'string');
}

/**
 * A relative glob anchored to the package's real path. The plugin resolves one
 * against the working directory as given, while istanbul keys a file by its real
 * path: run from a symlinked directory, the two would never match.
 */
function anchorFilterPattern(
	filterPattern: FilterPattern,
	sourceRoot: string,
): FilterPattern {
	if (filterPattern === null) {
		return null;
	}

	const patterns = typeof filterPattern === 'string'
		|| filterPattern instanceof RegExp
		? [filterPattern]
		: filterPattern;

	return patterns.map((pattern) => {
		// as createFilter tells a relative glob apart
		if (
			typeof pattern === 'string'
			&& !path.isAbsolute(pattern)
			&& !pattern.startsWith('**')
		) {
			return path.posix.join(sourceRoot, pattern);
		}

		return pattern;
	});
}

/**
 * Prepended to every chunk of an instrumented API bundle. It refuses to run in
 * production, before any instrumented code does, and tells the server which
 * directory this package's coverage is dumped to: the server reads no
 * extension.config.js.
 */
export function renderCoverageBanner(coverageTarget: CoverageTarget): string {
	const registeredDir = JSON.stringify({
		sourceRoot: coverageTarget.sourceRoot,
		coverageDir: coverageTarget.coverageDir,
	});

	// pushed once: every chunk of a preserveModules build carries this banner
	return [
		`if (process.env.NODE_ENV === 'production') {`,
		`\tthrow new Error(${JSON.stringify(COVERAGE_IN_PRODUCTION_MESSAGE)});`,
		`}`,
		`{`,
		`\tconst registeredDir = ${registeredDir};`,
		`\tconst registeredDirs = (globalThis.__extensionCoverageDirs ??= []);`,
		`\tif (!registeredDirs.some((registered) => {`,
		`\t\treturn registered.sourceRoot === registeredDir.sourceRoot;`,
		`\t})) {`,
		`\t\tregisteredDirs.push(registeredDir);`,
		`\t}`,
		`}`,
		'',
	].join('\n');
}

export interface CoverageInstrumentation {
	plugin: Plugin;
	banner: string;
}

/**
 * The plugin and banner an api entrypoint is built with, or undefined when the
 * config asks for no coverage. The package root is the working directory, where
 * extension.config.js is read from, at its real path: istanbul keys its files by
 * where they really are.
 */
export async function loadCoverageInstrumentation(
	config: Config,
	extensionType: string,
): Promise<CoverageInstrumentation | undefined> {
	const coverageTarget = resolveCoverageTarget({
		coverageConfig: config.coverage,
		extensionType,
		sourceRoot: realpathSync(process.cwd()),
		nodeEnv: process.env['NODE_ENV'],
	});

	if (coverageTarget === undefined) {
		return undefined;
	}

	// Loaded on demand: a plain build never pays for babel and istanbul.
	const { default: istanbul } = await import('rolldown-plugin-istanbul') as {
		default: (pluginOptions: IstanbulPluginOptions) => Plugin;
	};

	return {
		plugin: istanbul(coverageTarget.pluginOptions),
		banner: renderCoverageBanner(coverageTarget),
	};
}
