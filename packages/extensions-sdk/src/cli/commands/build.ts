import type { ExtensionOptionsBundleEntry, ExtensionManifest as TExtensionManifest } from '@directus/extensions';
import {
	API_SHARED_DEPS,
	APP_SHARED_DEPS,
	EXTENSION_PKG_KEY,
	ExtensionManifest,
	ExtensionOptionsBundleEntries,
} from '@directus/extensions';
import type { AppExtensionType, ApiExtensionType } from '@directus/types';
import { APP_EXTENSION_TYPES, EXTENSION_TYPES, HYBRID_EXTENSION_TYPES } from '@directus/constants';
import { isIn, isTypeIn } from '@directus/utils';
import terserDefault from '@rollup/plugin-terser';
import virtualDefault from '@rollup/plugin-virtual';
import vue from '@vitejs/plugin-vue';
import chalk from 'chalk';
import fse from 'fs-extra';
import ora from 'ora';
import path from 'path';
import {
	defineConfig,
	rolldown,
	watch as rolldownWatch,
	type InputOptions,
	type OutputOptions,
	type RollupError,
} from 'rolldown';
import styles from 'rollup-plugin-styler';
import type { Config, Format, RolldownConfig } from '../types.js';
import { getFileExt } from '../utils/file.js';
import { clear, log } from '../utils/logger.js';
import tryParseJson from '../utils/try-parse-json.js';
import generateBundleEntrypoint from './helpers/generate-bundle-entrypoint.js';
import loadConfig from './helpers/load-config.js';
import { validateSplitEntrypointOption } from './helpers/validate-cli-options.js';

/**
 * Packages that only mean something in a browser. An api entrypoint reaching one
 * drags the whole front-end into a bundle every worker parses at boot — one
 * extension in the wild grew a 13.6 MB api entry out of two such imports, and
 * nothing said so at build time.
 */
const APP_ONLY_PACKAGES = [
	// the sdk is the one shared dep an api entrypoint is meant to reach
	...APP_SHARED_DEPS.filter((dep) => dep !== '@directus/extensions-sdk'),
	'@directus/themes',
	'@directus/composables',
];

// Workaround for https://github.com/rollup/plugins/issues/1329
const virtual = virtualDefault as unknown as typeof virtualDefault.default;
const terser = terserDefault as unknown as typeof terserDefault.default;

type BuildOptions = {
	type?: string;
	input?: string;
	output?: string;
	external?: string;
	watch?: boolean;
	minify?: boolean;
	sourcemap?: boolean;
};

export default async function build(options: BuildOptions): Promise<void> {
	const watch = options.watch ?? false;
	const sourcemap = options.sourcemap ?? false;
	const minify = options.minify ?? false;

	const external = (options.external ?? '')
		.split(',')
		.map((dep) => dep.trim())
		.filter((dep) => dep.length > 0);

	if (!options.type && !options.input && !options.output) {
		const packagePath = path.resolve('package.json');

		if (!(await fse.pathExists(packagePath))) {
			log(`Current directory is not a valid Directus extension:`, 'error');
			log(`Missing "package.json" file.`, 'error');
			process.exit(1);
		}

		let extensionManifestFile: string;

		try {
			extensionManifestFile = (await fse.readFile(packagePath, 'utf8')) as string;
		} catch {
			log(`Failed to read "package.json" file from current directory.`, 'error');
			process.exit(1);
		}

		let extensionManifest: TExtensionManifest;

		try {
			extensionManifest = JSON.parse(extensionManifestFile);
			ExtensionManifest.parse(extensionManifest);
		} catch {
			log(`Current directory is not a valid Directus extension:`, 'error');
			log(`Invalid "package.json" file.`, 'error');

			process.exit(1);
		}

		const extensionOptions = extensionManifest[EXTENSION_PKG_KEY];

		const format = extensionManifest.type === 'module' ? 'esm' : 'cjs';

		if (extensionOptions.type === 'bundle') {
			await buildBundleExtension({
				entries: extensionOptions.entries,
				outputApp: extensionOptions.path.app,
				outputApi: extensionOptions.path.api,
				format,
				external,
				watch,
				sourcemap,
				minify,
			});
		} else if (isTypeIn(extensionOptions, HYBRID_EXTENSION_TYPES)) {
			await buildHybridExtension({
				inputApp: extensionOptions.source.app,
				inputApi: extensionOptions.source.api,
				outputApp: extensionOptions.path.app,
				outputApi: extensionOptions.path.api,
				format,
				external,
				watch,
				sourcemap,
				minify,
			});
		} else {
			await buildAppOrApiExtension({
				type: extensionOptions.type,
				input: extensionOptions.source,
				output: extensionOptions.path,
				format,
				external,
				watch,
				sourcemap,
				minify,
			});
		}
	} else {
		const type = options.type;
		const input = options.input;
		const output = options.output;

		if (!type) {
			log(`Extension type has to be specified using the ${chalk.blue('[-t, --type <type>]')} option.`, 'error');
			process.exit(1);
		}

		if (!isIn(type, EXTENSION_TYPES)) {
			log(
				`Extension type ${chalk.bold(type)} is not supported. Available extension types: ${EXTENSION_TYPES.map((t) =>
					chalk.bold.magenta(t),
				).join(', ')}.`,
				'error',
			);

			process.exit(1);
		}

		if (!input) {
			log(`Extension entrypoint has to be specified using the ${chalk.blue('[-i, --input <file>]')} option.`, 'error');
			process.exit(1);
		}

		if (!output) {
			log(
				`Extension output file has to be specified using the ${chalk.blue('[-o, --output <file>]')} option.`,
				'error',
			);

			process.exit(1);
		}

		if (type === 'bundle') {
			const entries = ExtensionOptionsBundleEntries.safeParse(tryParseJson(input));
			const splitOutput = tryParseJson(output);

			if (entries.success === false) {
				log(
					`Input option needs to be of the format ${chalk.blue(
						`[-i '[{"type":"<extension-type>","name":"<extension-name>","source":<entrypoint>}]']`,
					)}.`,
					'error',
				);

				process.exit(1);
			}

			if (!validateSplitEntrypointOption(splitOutput)) {
				log(
					`Output option needs to be of the format ${chalk.blue(
						`[-o '{"app":"<app-entrypoint>","api":"<api-entrypoint>"}']`,
					)}.`,
					'error',
				);

				process.exit(1);
			}

			await buildBundleExtension({
				entries: entries.data,
				outputApp: splitOutput.app,
				outputApi: splitOutput.api,
				format: 'esm',
				external,
				watch,
				sourcemap,
				minify,
			});
		} else if (isIn(type, HYBRID_EXTENSION_TYPES)) {
			const splitInput = tryParseJson(input);
			const splitOutput = tryParseJson(output);

			if (!validateSplitEntrypointOption(splitInput)) {
				log(
					`Input option needs to be of the format ${chalk.blue(
						`[-i '{"app":"<app-entrypoint>","api":"<api-entrypoint>"}']`,
					)}.`,
					'error',
				);

				process.exit(1);
			}

			if (!validateSplitEntrypointOption(splitOutput)) {
				log(
					`Output option needs to be of the format ${chalk.blue(
						`[-o '{"app":"<app-entrypoint>","api":"<api-entrypoint>"}']`,
					)}.`,
					'error',
				);

				process.exit(1);
			}

			await buildHybridExtension({
				inputApp: splitInput.app,
				inputApi: splitInput.api,
				outputApp: splitOutput.app,
				outputApi: splitOutput.api,
				format: 'esm',
				external,
				watch,
				sourcemap,
				minify,
			});
		} else {
			await buildAppOrApiExtension({
				type,
				input,
				output,
				format: 'esm',
				external,
				watch,
				sourcemap,
				minify,
			});
		}
	}
}

async function buildAppOrApiExtension({
	type,
	input,
	output,
	format,
	external,
	watch,
	sourcemap,
	minify,
}: {
	type: AppExtensionType | ApiExtensionType;
	input: string;
	output: string;
	format: Format;
	external: string[];
	watch: boolean;
	sourcemap: boolean;
	minify: boolean;
}) {
	if (!(await fse.pathExists(input)) || !(await fse.stat(input)).isFile()) {
		log(`Entrypoint ${chalk.bold(input)} does not exist.`, 'error');
		process.exit(1);
	}

	if (output.length === 0) {
		log(`Output file can not be empty.`, 'error');
		process.exit(1);
	}

	const config = await loadConfig();

	const mode = isIn(type, APP_EXTENSION_TYPES) ? 'browser' : 'node';

	const inputOptions = getRollupOptions({ mode, input, minify, external, config });
	const outputOptions = getRollupOutputOptions({ mode, output, format, sourcemap });

	if (watch) {
		await watchExtension({ inputOptions, outputOptions });
	} else {
		await buildExtension({ inputOptions, outputOptions });
	}
}

async function buildHybridExtension({
	inputApp,
	inputApi,
	outputApp,
	outputApi,
	format,
	external,
	watch,
	sourcemap,
	minify,
}: {
	inputApp: string;
	inputApi: string;
	outputApp: string;
	outputApi: string;
	format: Format;
	external: string[];
	watch: boolean;
	sourcemap: boolean;
	minify: boolean;
}) {
	if (!(await fse.pathExists(inputApp)) || !(await fse.stat(inputApp)).isFile()) {
		log(`App entrypoint ${chalk.bold(inputApp)} does not exist.`, 'error');
		process.exit(1);
	}

	if (!(await fse.pathExists(inputApi)) || !(await fse.stat(inputApi)).isFile()) {
		log(`API entrypoint ${chalk.bold(inputApi)} does not exist.`, 'error');
		process.exit(1);
	}

	if (outputApp.length === 0) {
		log(`App output file can not be empty.`, 'error');
		process.exit(1);
	}

	if (outputApi.length === 0) {
		log(`API output file can not be empty.`, 'error');
		process.exit(1);
	}

	const config = await loadConfig();

	const rollupOptionsApp = getRollupOptions({
		mode: 'browser',
		input: inputApp,
		minify,
		external,
		config,
	});

	const rollupOptionsApi = getRollupOptions({
		mode: 'node',
		input: inputApi,
		minify,
		external,
		config,
	});

	const outputOptionsApp = getRollupOutputOptions({ mode: 'browser', output: outputApp, format, sourcemap });
	const outputOptionsApi = getRollupOutputOptions({ mode: 'node', output: outputApi, format, sourcemap });

	const rollupOptionsAll = [
		{ inputOptions: rollupOptionsApp, outputOptions: outputOptionsApp },
		{ inputOptions: rollupOptionsApi, outputOptions: outputOptionsApi },
	];

	if (watch) {
		await watchExtension(rollupOptionsAll);
	} else {
		await buildExtension(rollupOptionsAll);
	}
}

async function buildBundleExtension({
	entries,
	outputApp,
	outputApi,
	format,
	external,
	watch,
	sourcemap,
	minify,
}: {
	entries: ExtensionOptionsBundleEntry[];
	outputApp: string;
	outputApi: string;
	format: Format;
	external: string[];
	watch: boolean;
	sourcemap: boolean;
	minify: boolean;
}) {
	if (outputApp.length === 0) {
		log(`App output file can not be empty.`, 'error');
		process.exit(1);
	}

	if (outputApi.length === 0) {
		log(`API output file can not be empty.`, 'error');
		process.exit(1);
	}

	const bundleEntryNames = new Set();

	for (const { name } of entries) {
		if (bundleEntryNames.has(name)) {
			log(`Duplicate extension found in bundle for ${chalk.bold(name)}.`, 'error');
			process.exit(1);
		}

		bundleEntryNames.add(name);
	}

	const config = await loadConfig();

	const entrypointApp = generateBundleEntrypoint('app', entries);
	const entrypointApi = generateBundleEntrypoint('api', entries);

	const rollupOptionsApp = getRollupOptions({
		mode: 'browser',
		input: { entry: entrypointApp },
		minify,
		external,
		config,
	});

	const rollupOptionsApi = getRollupOptions({
		mode: 'node',
		input: { entry: entrypointApi },
		minify,
		external,
		config,
	});

	const outputOptionsApp = getRollupOutputOptions({ mode: 'browser', output: outputApp, format, sourcemap });
	const outputOptionsApi = getRollupOutputOptions({ mode: 'node', output: outputApi, format, sourcemap });

	const rollupOptionsAll = [
		{ inputOptions: rollupOptionsApp, outputOptions: outputOptionsApp },
		{ inputOptions: rollupOptionsApi, outputOptions: outputOptionsApi },
	];

	if (watch) {
		await watchExtension(rollupOptionsAll);
	} else {
		await buildExtension(rollupOptionsAll);
	}
}

async function buildExtension(config: RolldownConfig | RolldownConfig[]) {
	const configs = Array.isArray(config) ? config : [config];

	const spinner = ora(chalk.bold('Building Directus extension...')).start();
	const reports: { level: 'info' | 'warn'; message: string }[] = [];

	const result = await Promise.all(
		configs.map(async (c) => {
			try {
				const bundle = await rolldown(c.inputOptions);

				const { output } = await bundle.write(c.outputOptions);
				await bundle.close();

				// what a worker will parse at every boot, and whether any of it is the app's
				if (c.inputOptions.platform === 'node') {
					const chunks = output.flatMap((chunk) => {
						return chunk.type === 'chunk'
							? [chunk]
							: [];
					});

					const moduleIds = chunks.flatMap((chunk) => {
						const ids = Object.keys(chunk.modules);

						return ids.map((id) => id.replaceAll('\\', '/'));
					});

					const appOnly = APP_ONLY_PACKAGES.filter((pkg) => {
						return moduleIds.some((id) => id.includes(`node_modules/${pkg}/`));
					});

					const bytes = chunks.reduce((total, chunk) => {
						return total + Buffer.byteLength(chunk.code);
					}, 0);

					const weight = chalk.bold(
						bytes < 1e6
							? `${(bytes / 1e3).toFixed(1)} KB`
							: `${(bytes / 1e6).toFixed(2)} MB`,
					);

					const plural = moduleIds.length === 1
						? ''
						: 's';

					reports.push({
						level: 'info',
						message: `API bundle: ${weight}, ${moduleIds.length} module${plural}`,
					});

					if (appOnly.length > 0) {
						reports.push({
							level: 'warn',
							message: [
								`The API entrypoint pulls in ${chalk.bold(appOnly.join(', '))}.`,
								`Every worker parses that at boot without ever serving the app —`,
								`move those imports to the app entrypoint, make them`,
								`${chalk.blue('import type')}, or exclude them with`,
								`${chalk.blue('--external')}.`,
							].join(' '),
						});
					}
				}
			} catch (error) {
				return formatRollupError(error as RollupError);
			}

			return null;
		}),
	);

	const resultErrors = result.filter((r) => r !== null);

	if (resultErrors.length > 0) {
		spinner.fail(chalk.bold('Failed'));

		log(resultErrors.join('\n\n'));

		process.exit(1);
	} else {
		spinner.succeed(chalk.bold('Done'));

		for (const report of reports) {
			log(report.message, report.level);
		}
	}
}

async function watchExtension(config: RolldownConfig | RolldownConfig[]) {
	const configs = Array.isArray(config) ? config : [config];
	const userConfig = await loadConfig();

	const spinner = ora(chalk.bold('Building Directus extension...'));

	let buildCount = 0;

	for (const c of configs) {
		const watcher = rolldownWatch({
			...c.inputOptions,
			output: c.outputOptions,
		});

		watcher.on('event', async (event) => {
			switch (event.code) {
				case 'BUNDLE_START':
					if (buildCount === 0) {
						if (userConfig?.watch?.clearScreen !== false) {
							clear();
						}

						spinner.start();
					}

					buildCount++;
					break;
				case 'BUNDLE_END':
					await event.result.close();

					buildCount--;

					if (buildCount === 0) {
						spinner.succeed(chalk.bold('Done'));
						log(chalk.bold.green('Watching files for changes...'));
					}

					break;

				case 'ERROR': {
					buildCount--;

					spinner.fail(chalk.bold('Failed'));
					log(formatRollupError(event.error));

					if (buildCount > 0) {
						spinner.start();
					}

					break;
				}
			}
		});
	}
}

function getRollupOptions({
	mode,
	input,
	minify,
	external,
	config,
}: {
	mode: InputOptions['platform'];
	input: string | Record<string, string>;
	minify: boolean;
	external: string[];
	config: Config;
}): InputOptions {
	const plugins = config.plugins ?? [];
	const hasTSCongig = fse.existsSync('tsconfig.json');

	return defineConfig({
		resolve: {
			...(hasTSCongig
				? {
						tsconfigFilename: `tsconfig.json`,
					}
				: {}),
		},
		input: typeof input !== 'string' ? 'entry' : input,
		// the app is downloaded by a browser that resolves nothing beyond the shared
		// deps the host guarantees, so what the author externalizes stays on the api
		// side — a bare specifier left in app.js is a request answered with a 404
		external: mode === 'browser'
			? APP_SHARED_DEPS
			: [...API_SHARED_DEPS, ...external, ...(config.external ?? [])],
		platform: mode!, // TODO why is undefined possible (and triggering an error) only during extensions-sdk's build?
		// match upstream: only app (browser) extensions are pinned to production; node extensions keep the real env
		// rolldown 1.1+ moved `define` under `transform`
		transform: mode === 'browser' ? { define: { 'process.env.NODE_ENV': JSON.stringify('production') } } : {},
		plugins: [
			typeof input !== 'string' ? virtual(input) : null,
			mode === 'browser' ? vue({ isProduction: true }) : null,
			mode === 'browser' ? styles() : null,
			...plugins,
			minify ? terser() : null, // rolldown builtin minifier is in still alpha https://rolldown.rs/guide/features#minification
		],
		onwarn(warning, warn) {
			if (warning.code === 'CIRCULAR_DEPENDENCY' && warning.ids?.every((id) => /\bnode_modules\b/.test(id))) return;

			warn(warning);
		},
	});
}

function getRollupOutputOptions({
	mode,
	output,
	format,
	sourcemap,
}: {
	mode: InputOptions['platform'];
	output: string;
	format: Format;
	sourcemap: boolean;
}): OutputOptions {
	const fileExtension = getFileExt(output);
	let outputFormat = format;

	if (mode === 'browser' || fileExtension === 'mjs') {
		outputFormat = 'esm';
	} else if (fileExtension === 'cjs') {
		outputFormat = 'cjs';
	}

	return {
		file: output,
		format: outputFormat,
		exports: 'auto',
		inlineDynamicImports: true,
		sourcemap,
	};
}

function formatRollupError(error: RollupError): string {
	let message = '';

	message += `${chalk.bold.red(`[${error.name}]`)} ${error.message}${
		error.plugin ? ` (plugin ${error.plugin})` : ''
	}\n`;

	if (error.url) {
		message += '\n' + chalk.green(error.url);
	}

	if (error.loc) {
		message += '\n' + chalk.green(`${error.loc.file ?? error.id}:${error.loc.line}:${error.loc.column}`);
	} else if (error.id) {
		message += '\n' + chalk.green(error.id);
	}

	if (error.frame) {
		message += '\n' + chalk.dim(error.frame);
	}

	if (error.stack) {
		message += '\n' + chalk.dim(error.stack);
	}

	return message;
}
