import { isIn, isTypeIn, pathToRelativeUrl, pluralize } from '@directus/utils/node';
import path from 'path';
import { APP_EXTENSION_TYPES, HYBRID_EXTENSION_TYPES } from '../../shared/constants/index.js';
import type {
	AppExtension,
	BundleExtension,
	Extension,
	ExtensionSettings,
	HybridExtension,
} from '../../shared/types/index.js';

export function generateExtensionsEntrypoint(
	extensionMaps: Record<string, Map<string, Extension>>,
	settings: ExtensionSettings[],
): string {
	const appOrHybridExtensions: (AppExtension | HybridExtension)[] = [];
	const bundleExtensions: BundleExtension[] = [];

	const codeBundles: {
		source: string;
		folder: string;
		extension: BundleExtension;
		disabledNames: string[];
	}[] = [];

	for (const [source, extensions] of Object.entries(extensionMaps)) {
		for (const [folder, extension] of extensions.entries()) {
			const settingsForExtension = settings.find((setting) => setting.source === source && setting.folder === folder);

			if (!settingsForExtension) continue;

			if (isIn(extension.type, [...APP_EXTENSION_TYPES, ...HYBRID_EXTENSION_TYPES]) && settingsForExtension.enabled) {
				appOrHybridExtensions.push(extension as AppExtension | HybridExtension);
			}

			if (extension.type === 'bundle' && extension.entriesFrom === 'code') {
				const disabledNames = settings
					.filter((setting) => {
						return setting.bundle === settingsForExtension.id
							&& setting.enabled === false;
					})
					.map((setting) => setting.folder);

				codeBundles.push({ source, folder, extension, disabledNames });
			}
			else if (extension.type === 'bundle') {
				const appBundle: BundleExtension = {
					...extension,
					entries: extension.entries.filter((entry) => {
						const isApp = isIn(entry.type, [...APP_EXTENSION_TYPES, ...HYBRID_EXTENSION_TYPES]);
						if (isApp === false) return false;

						const enabled =
							settings.find(
								(setting) =>
									setting.source === source &&
									setting.folder === entry.name &&
									setting.bundle === settingsForExtension.id,
							)?.enabled ?? false;

						return enabled;
					}),
				};

				if (appBundle.entries.length > 0) {
					bundleExtensions.push(appBundle);
				}
			}
		}
	}

	const appOrHybridExtensionImports = [...APP_EXTENSION_TYPES, ...HYBRID_EXTENSION_TYPES].flatMap((type) =>
		appOrHybridExtensions
			.filter((extension) => extension.type === type)
			.map(
				(extension, i) =>
					`import ${type}${i} from './${pathToRelativeUrl(
						path.resolve(
							extension.path,
							isTypeIn(extension, HYBRID_EXTENSION_TYPES) ? extension.entrypoint.app : extension.entrypoint,
						),
					)}';`,
			),
	);

	const bundleExtensionImports = bundleExtensions.map((extension, i) =>
		extension.entries.length > 0
			? `import {${[...APP_EXTENSION_TYPES, ...HYBRID_EXTENSION_TYPES]
					.filter((type) => extension.entries.some((entry) => entry.type === type))
					.map((type) => `${pluralize(type)} as ${type}Bundle${i}`)
					.join(',')}} from './${pathToRelativeUrl(path.resolve(extension.path, extension.entrypoint.app))}';`
			: '',
	);

	const codeBundleImports = codeBundles.map(({ extension, disabledNames }, i) => {
		return `import bundleCode${i} from './${pathToRelativeUrl(
			path.resolve(extension.path, extension.entrypoint.app),
		)}';`
			+ `const codeEntries${i} = bundleCode${i}.entries.filter((entry) => `
			+ `!${JSON.stringify(disabledNames)}.includes(entry.name));`;
	});

	const extensionExports = [...APP_EXTENSION_TYPES, ...HYBRID_EXTENSION_TYPES].map(
		(type) =>
			`export const ${pluralize(type)} = [${appOrHybridExtensions
				.filter((extension) => extension.type === type)
				.map((_, i) => `${type}${i}`)
				.concat(
					bundleExtensions
						.map((extension, i) =>
							extension.entries.some((entry) => entry.type === type) ? `...${type}Bundle${i}` : null,
						)
						.filter((e): e is string => e !== null),
				)
				.concat(
					codeBundles.map((_, i) => {
						return `...codeEntries${i}.filter((entry) => `
							+ `entry.type === ${JSON.stringify(type)})`
							+ `.map((entry) => entry.config)`;
					}),
				)
				.join(',')}];`,
	);

	const bundleEntriesExport = codeBundles.length > 0
		? `export const bundleEntries = [${codeBundles
				.map(({ source, folder }, i) => {
					return `{source:${JSON.stringify(source)},`
						+ `folder:${JSON.stringify(folder)},`
						+ `entries:bundleCode${i}.entries.map((entry) => `
						+ `({type:entry.type,name:entry.name}))}`;
				})
				.join(',')}];`
		: '';

	return `${appOrHybridExtensionImports.join('')}`
		+ `${bundleExtensionImports.join('')}`
		+ `${codeBundleImports.join('')}`
		+ `${extensionExports.join('')}${bundleEntriesExport}`;
}
