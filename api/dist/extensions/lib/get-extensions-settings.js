import database_default from "../../database/index.js";
import { getSchema } from "../../utils/get-schema.js";
import { ExtensionsService } from "../../services/extensions.js";
import { useEnv } from "@directus/env";
import { randomUUID } from "node:crypto";
import { list } from "@directus/extensions-registry";

//#region src/extensions/lib/get-extensions-settings.ts
/**
* Loads stored settings for all extensions. Creates empty new rows in extensions tables for
* extensions that don't have settings yet, and remove any settings for extensions that are no
* longer installed.
*/
const getExtensionsSettings = async ({ local, module, registry }) => {
	const service = new ExtensionsService({
		knex: database_default(),
		schema: await getSchema()
	});
	const existingSettings = await service.extensionsItemService.readByQuery({ limit: -1 });
	const newSettings = [];
	const removedSettingIds = [];
	const localSettings = existingSettings.filter(({ source }) => source === "local");
	const registrySettings = existingSettings.filter(({ source }) => source === "registry");
	const moduleSettings = existingSettings.filter(({ source }) => source === "module");
	const updateBundleEntriesSettings = (bundle, bundleSettings, allSettings) => {
		const bundleEntriesSettings = allSettings.filter(({ bundle: bundle$1 }) => bundle$1 === bundleSettings.id);
		for (const entry of bundleEntriesSettings) {
			if (bundle.entries.some(({ name }) => name === entry.folder)) continue;
			removedSettingIds.push(entry.id);
		}
		for (const entry of bundle.entries) {
			if (bundleEntriesSettings.some(({ folder }) => folder === entry.name)) continue;
			newSettings.push({
				id: randomUUID(),
				enabled: bundleSettings.enabled,
				source: bundleSettings.source,
				bundle: bundleSettings.id,
				folder: entry.name
			});
		}
	};
	const generateSettingsEntry = async (folder, extension, source) => {
		let marketplaceId;
		if (source === "registry") {
			const env = useEnv();
			const listOptions = {};
			if (env["MARKETPLACE_REGISTRY"] && typeof env["MARKETPLACE_REGISTRY"] === "string") listOptions.registry = env["MARKETPLACE_REGISTRY"];
			marketplaceId = (await list({ search: extension.name }, listOptions)).data.find((ext) => ext.name === extension.name)?.id;
		}
		const id = marketplaceId ?? randomUUID();
		if (extension.type === "bundle") {
			newSettings.push({
				id,
				enabled: true,
				source,
				bundle: null,
				folder
			});
			for (const entry of extension.entries) newSettings.push({
				id: randomUUID(),
				enabled: true,
				source,
				bundle: id,
				folder: entry.name
			});
		} else newSettings.push({
			id,
			enabled: true,
			source,
			bundle: null,
			folder
		});
	};
	for (const [folder, extension] of local.entries()) {
		const existingSettings$1 = localSettings.find((settings) => settings.folder === folder);
		if (existingSettings$1) {
			if (extension.type === "bundle") updateBundleEntriesSettings(extension, existingSettings$1, localSettings);
			continue;
		}
		const settingsForName = localSettings.find((settings) => settings.folder === extension.name);
		if (settingsForName && !local.has(extension.name)) {
			await service.extensionsItemService.updateOne(settingsForName.id, { folder });
			continue;
		}
		await generateSettingsEntry(folder, extension, "local");
	}
	for (const [folder, extension] of module.entries()) {
		const existingSettings$1 = moduleSettings.find((settings) => settings.folder === folder);
		if (!existingSettings$1) await generateSettingsEntry(folder, extension, "module");
		else if (extension.type === "bundle") updateBundleEntriesSettings(extension, existingSettings$1, moduleSettings);
	}
	for (const [folder, extension] of registry.entries()) {
		const existingSettings$1 = registrySettings.find((settings) => settings.folder === folder);
		if (!existingSettings$1) await generateSettingsEntry(folder, extension, "registry");
		else if (extension.type === "bundle") updateBundleEntriesSettings(extension, existingSettings$1, registrySettings);
	}
	if (removedSettingIds.length > 0) await service.extensionsItemService.deleteMany(removedSettingIds);
	if (newSettings.length > 0) await service.extensionsItemService.createMany(newSettings);
	return [...existingSettings.filter(({ id }) => !removedSettingIds.includes(id)), ...newSettings];
};

//#endregion
export { getExtensionsSettings };