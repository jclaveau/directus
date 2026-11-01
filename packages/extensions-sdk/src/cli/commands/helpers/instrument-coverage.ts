import { APP_EXTENSION_TYPES } from '@directus/constants';
import { realpathSync } from 'node:fs';
import path from 'path';
import type {
	Plugin,
	RenderedChunk,
	TransformPluginContext,
	TransformResult,
} from 'rolldown';
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
		'decorators-legacy',
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

	refuseUnreadCoverage(coverageOptions);

	const globRoot = escapeGlob(sourceRoot);

	return {
		sourceRoot,
		coverageDir: path.resolve(
			sourceRoot,
			coverageOptions.dir ?? DEFAULT_COVERAGE_DIR,
		),
		pluginOptions: {
			// the package's own scripts: a workspace dependency is resolved to its
			// real path outside the package, and the plugin runs before rolldown
			// turns a json (or anything a user plugin loads) into a script
			include: coverageOptions.include === undefined
				? [path.posix.join(globRoot, '**/*.{js,mjs,cjs,ts,mts,cts}')]
				: anchorFilterPattern(coverageOptions.include, globRoot),
			exclude: coverageOptions.exclude === undefined
				? [path.posix.join(globRoot, 'node_modules/**'), '**/*.d.ts']
				: anchorFilterPattern(coverageOptions.exclude, globRoot),
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

/**
 * Refuses an option that builds fine but whose coverage the server never finds,
 * or that leaves its files somewhere no merge looks.
 */
function refuseUnreadCoverage(coverageOptions: CoverageConfig): void {
	const instrumenterConfig: unknown = coverageOptions.instrumenterConfig;

	// spread over the defaults, anything but an object would be dropped unseen
	if (
		instrumenterConfig !== undefined
		&& (typeof instrumenterConfig !== 'object'
			|| instrumenterConfig === null
			|| Array.isArray(instrumenterConfig))
	) {
		throw new Error(
			'coverage.instrumenterConfig must be an object of '
				+ 'istanbul-lib-instrument options, not '
				+ `${JSON.stringify(instrumenterConfig)}.`,
		);
	}

	const {
		coverageVariable,
		coverageGlobalScope,
		coverageGlobalScopeFunc,
	} = coverageOptions.instrumenterConfig ?? {};

	if (coverageVariable !== undefined && coverageVariable !== COVERAGE_VARIABLE) {
		throw new Error(
			'coverage.instrumenterConfig.coverageVariable must be '
				+ `"${COVERAGE_VARIABLE}", the global the server dumps, not `
				+ `"${coverageVariable}".`,
		);
	}

	if (coverageGlobalScope !== undefined && coverageGlobalScope !== 'this') {
		throw new Error(
			'coverage.instrumenterConfig.coverageGlobalScope must be "this", the '
				+ 'global object the server dumps from, not '
				+ `"${coverageGlobalScope}".`,
		);
	}

	if (coverageGlobalScopeFunc === false) {
		throw new Error(
			'coverage.instrumenterConfig.coverageGlobalScopeFunc must be true: an '
				+ 'ES module has no top-level this to hold the coverage.',
		);
	}

	if (coverageOptions.dir === '') {
		throw new Error('coverage.dir must name a directory, not "".');
	}

	const includePattern: unknown = coverageOptions.include;

	// createFilter reads an empty include as every module outside node_modules
	if (
		includePattern !== undefined
		&& (!isFilterPattern(includePattern)
			|| includePattern === null
			|| (Array.isArray(includePattern) && includePattern.length === 0))
	) {
		throw new Error(
			'coverage.include must be a glob, a regular expression or a non-empty '
				+ `array of them, not ${JSON.stringify(includePattern)}.`,
		);
	}

	const excludePattern: unknown = coverageOptions.exclude;

	if (excludePattern !== undefined && !isFilterPattern(excludePattern)) {
		throw new Error(
			'coverage.exclude must be a glob, a regular expression, an array of '
				+ `them or null, not ${JSON.stringify(excludePattern)}.`,
		);
	}

	for (const filterKey of ['include', 'exclude'] as const) {
		const filterEntries = [coverageOptions[filterKey] ?? []].flat();

		const negatedGlob = filterEntries.find((filterEntry) => {
			return typeof filterEntry === 'string' && filterEntry.startsWith('!');
		});

		// anchored to the package, the ! lands mid-path, where it negates nothing
		if (negatedGlob !== undefined) {
			throw new Error(
				`coverage.${filterKey} cannot hold the negated glob `
					+ `"${negatedGlob}": createFilter matches it as a literal path.`,
			);
		}
	}
}

function isFilterPattern(filterPattern: unknown): boolean {
	const isFilterEntry = (filterEntry: unknown) => {
		return typeof filterEntry === 'string' || filterEntry instanceof RegExp;
	};

	return filterPattern === null
		|| isFilterEntry(filterPattern)
		|| (Array.isArray(filterPattern) && filterPattern.every(isFilterEntry));
}

/**
 * A path a glob matches literally. A backslash would not do: createFilter turns
 * every one into a path separator, so each special character goes in a class.
 */
function escapeGlob(literalPath: string): string {
	return literalPath.replace(/[()[\]{}*?!+@|]/g, '[$&]');
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
	globRoot: string,
): FilterPattern {
	if (filterPattern === null) {
		return null;
	}

	const filterPatterns = typeof filterPattern === 'string'
		|| filterPattern instanceof RegExp
		? [filterPattern]
		: filterPattern;

	return filterPatterns.map((filterEntry) => {
		// as createFilter tells a relative glob apart
		if (
			typeof filterEntry === 'string'
			&& !path.isAbsolute(filterEntry)
			&& !filterEntry.startsWith('**')
		) {
			return path.posix.join(globRoot, filterEntry);
		}

		return filterEntry;
	});
}

/**
 * Prepended to every chunk of an instrumented API bundle. It refuses to run in
 * production, before any instrumented code does, and tells the server which
 * directory the files instrumented into this chunk have their coverage dumped
 * to: the server reads no extension.config.js. A file is routed by the build
 * that bundled it, not by where it lies, so a shared one imported from outside
 * the package goes with it.
 */
export function renderCoverageBanner(
	coverageTarget: CoverageTarget,
	sourceFiles: string[],
): string {
	const registeredDir = JSON.stringify({
		sourceRoot: coverageTarget.sourceRoot,
		coverageDir: coverageTarget.coverageDir,
		sourceFiles: [...sourceFiles].sort(),
	});

	// one entry per package: every chunk of a preserveModules build adds its
	// files to it, and a rebuild with another dir, reloaded in the same
	// process, replaces it
	return [
		`if (process.env.NODE_ENV === 'production') {`,
		`\tthrow new Error(${JSON.stringify(COVERAGE_IN_PRODUCTION_MESSAGE)});`,
		`}`,
		`{`,
		`\tconst registeredDir = ${registeredDir};`,
		`\tconst registeredDirs = globalThis.__extensionCoverageDirs ?? [];`,
		`\tconst samePackageDir = registeredDirs.find((otherDir) => {`,
		`\t\treturn otherDir.sourceRoot === registeredDir.sourceRoot`,
		`\t\t\t&& otherDir.coverageDir === registeredDir.coverageDir;`,
		`\t});`,
		`\tif (samePackageDir === undefined) {`,
		`\t\tglobalThis.__extensionCoverageDirs = [`,
		`\t\t\t...registeredDirs.filter((otherDir) => {`,
		`\t\t\t\treturn otherDir.sourceRoot !== registeredDir.sourceRoot;`,
		`\t\t\t}),`,
		`\t\t\tregisteredDir,`,
		`\t\t];`,
		`\t}`,
		`\telse {`,
		`\t\tsamePackageDir.sourceFiles = [...new Set([`,
		`\t\t\t...samePackageDir.sourceFiles,`,
		`\t\t\t...registeredDir.sourceFiles,`,
		`\t\t])];`,
		`\t}`,
		`}`,
		'',
	].join('\n');
}

export interface CoverageInstrumentation {
	plugin: Plugin;
	banner: (renderedChunk: RenderedChunk) => string;
}

/** rolldown-plugin-istanbul's plugin, which instruments in `transform` alone. */
interface IstanbulPlugin {
	name: string;
	transform: (
		this: TransformPluginContext,
		code: string,
		id: string,
	) => TransformResult | undefined;
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
	const { default: createIstanbulPlugin } = await import(
		'rolldown-plugin-istanbul'
	) as { default: (pluginOptions: IstanbulPluginOptions) => IstanbulPlugin };

	const istanbulPlugin = createIstanbulPlugin(coverageTarget.pluginOptions);
	const instrumentedFiles = new Set<string>();

	return {
		// istanbul keys a file by the module id it instrumented
		plugin: {
			name: istanbulPlugin.name,
			transform(code, id) {
				const instrumentedModule = istanbulPlugin.transform.call(this, code, id);

				if (instrumentedModule !== undefined) {
					instrumentedFiles.add(id);
				}

				return instrumentedModule;
			},
		},
		banner: (renderedChunk) => {
			return renderCoverageBanner(
				coverageTarget,
				renderedChunk.moduleIds.filter((moduleId) => {
					return instrumentedFiles.has(moduleId);
				}),
			);
		},
	};
}
