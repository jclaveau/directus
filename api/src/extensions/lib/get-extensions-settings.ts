import { APP_EXTENSION_TYPES } from '@directus/constants';
import type {
	AppExtensionType,
	BundleExtension,
	Extension,
	ExtensionSettings,
} from '@directus/types';
import { randomUUID } from 'node:crypto';
import getDatabase from '../../database/index.js';
import { ExtensionsService } from '../../services/extensions.js';
import { getSchema } from '../../utils/get-schema.js';
import { list } from '@directus/extensions-registry';

/**
 * Loads stored settings for all extensions. Creates empty new rows in extensions tables for
 * extensions that don't have settings yet, and remove any settings for extensions that are no
 * longer installed.
 *
 * A bundle declaring its entries in code only lists its api entries here: the
 * app reports its app entries (`syncAppEntries`), so their rows survive a load,
 * and come back into the bundle's `entries` from their stored `type`.
 */
export const getExtensionsSettings = async ({
	module,
	registry,
}: {
	module: Map<string, Extension>;
	registry: Map<string, Extension>;
}) => {
	const database = getDatabase();

	const service = new ExtensionsService({
		knex: database,
		schema: await getSchema(),
	});

	const existingSettings = await service.extensionsItemService.readByQuery({ limit: -1 });

	const newSettings: ExtensionSettings[] = [];
	const removedSettingIds: string[] = [];

	const registrySettings = existingSettings.filter(({ source }) => source === 'registry');
	const moduleSettings = existingSettings.filter(({ source }) => source === 'module');

	const updateBundleEntriesSettings = (
		bundle: BundleExtension,
		bundleSettings: ExtensionSettings,
		allSettings: ExtensionSettings[],
	) => {
		const bundleEntriesSettings = allSettings.filter(({ bundle }) => bundle === bundleSettings.id);

		// Remove settings of removed bundle entries from the DB
		for (const entry of bundleEntriesSettings) {
			const entryInBundle = bundle.entries.some(({ name }) => name === entry.folder);

			if (entryInBundle) continue;

			if (bundle.entriesFrom === 'code' && isAppEntryRow(entry)) {
				continue;
			}

			removedSettingIds.push(entry.id);
		}

		// Add new bundle entries to the settings
		for (const entry of bundle.entries) {
			const settingsExist = bundleEntriesSettings.some(({ folder }) => folder === entry.name);

			if (settingsExist) continue;

			newSettings.push({
				id: randomUUID(),
				enabled: bundleSettings.enabled,
				source: bundleSettings.source,
				bundle: bundleSettings.id,
				folder: entry.name,
				type: entry.type,
			});
		}
	};

	const generateSettingsEntry = async (
		folder: string,
		extension: Extension,
		source: 'registry' | 'module',
	) => {
		let marketplaceId;

		if (source === 'registry') {
			const marketplace = await list({ search: extension.name });
			marketplaceId = marketplace.data.find((ext) => ext.name === extension.name)?.id;
		}

		const id = marketplaceId ?? randomUUID();

		if (extension.type === 'bundle') {
			newSettings.push({
				id,
				enabled: true,
				source: source,
				bundle: null,
				folder: folder,
			});

			for (const entry of extension.entries) {
				newSettings.push({
					id: randomUUID(),
					enabled: true,
					source: source,
					bundle: id,
					folder: entry.name,
					type: entry.type,
				});
			}
		} else {
			newSettings.push({
				id,
				enabled: true,
				source: source,
				bundle: null,
				folder: folder,
			});
		}
	};

	for (const [folder, extension] of module.entries()) {
		const existingSettings = moduleSettings.find((settings) => settings.folder === folder);

		if (!existingSettings) {
			await generateSettingsEntry(folder, extension, 'module');
		} else if (extension.type === 'bundle') {
			updateBundleEntriesSettings(extension, existingSettings, moduleSettings);
		}
	}

	for (const [folder, extension] of registry.entries()) {
		const existingSettings = registrySettings.find((settings) => settings.folder === folder);

		if (!existingSettings) {
			await generateSettingsEntry(folder, extension, 'registry');
		} else if (extension.type === 'bundle') {
			updateBundleEntriesSettings(extension, existingSettings, registrySettings);
		}
	}

	if (removedSettingIds.length > 0) {
		await service.extensionsItemService.deleteMany(removedSettingIds);
	}

	if (newSettings.length > 0) {
		await service.extensionsItemService.createMany(newSettings);
	}

	const settings = [
		...existingSettings.filter(({ id }) => !removedSettingIds.includes(id)),
		...newSettings,
	];

	for (
		const [source, extensions] of [
			['module', module],
			['registry', registry],
		] as const
	) {
		for (const [folder, extension] of extensions) {
			if (extension.type !== 'bundle' || extension.entriesFrom !== 'code') {
				continue;
			}

			addAppEntryRows(extension, source, folder, settings);
		}
	}

	return settings;
};

function isAppEntryRow(settings: ExtensionSettings): boolean {
	return (APP_EXTENSION_TYPES as readonly (string | null | undefined)[]).includes(
		settings.type,
	);
}

function addAppEntryRows(
	bundle: BundleExtension,
	source: 'module' | 'registry',
	folder: string,
	settings: ExtensionSettings[],
): void {
	const bundleSettings = settings.find(
		(row) => row.source === source && row.folder === folder && row.bundle === null,
	);

	if (!bundleSettings) {
		return;
	}

	const appEntries = settings
		.filter((row) => row.bundle === bundleSettings.id && isAppEntryRow(row))
		.map((row) => ({ type: row.type as AppExtensionType, name: row.folder }));

	bundle.entries = [...bundle.entries, ...appEntries];
}
