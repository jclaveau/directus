import { useLogger } from "../logger/index.js";
import database_default from "../database/index.js";
import { transactionHoldingActions } from "../utils/transaction-holding-actions.js";
import { ItemsService, emitActionEvents } from "./items.js";
import { getExtensionManager } from "../extensions/index.js";
import { useEnv } from "@directus/env";
import { ForbiddenError, InvalidPayloadError, LimitExceededError, ServiceUnavailableError, UnprocessableContentError } from "@directus/errors";
import { isObject, oneLine } from "@directus/utils";
import { describe } from "@directus/extensions-registry";

//#region src/services/extensions.ts
var ExtensionReadError = class extends Error {
	originalError;
	constructor(originalError) {
		super();
		this.originalError = originalError;
	}
};
var ExtensionsService = class ExtensionsService {
	knex;
	accountability;
	schema;
	extensionsItemService;
	extensionsManager;
	constructor(options) {
		this.knex = options.knex || database_default();
		this.schema = options.schema;
		this.accountability = options.accountability || null;
		this.extensionsManager = getExtensionManager();
		this.extensionsItemService = new ItemsService("directus_extensions", {
			knex: this.knex,
			schema: this.schema,
			accountability: this.accountability
		});
	}
	async preInstall(extensionId, versionId) {
		const env = useEnv();
		const describeOptions = {};
		if (typeof env["MARKETPLACE_REGISTRY"] === "string") describeOptions.registry = env["MARKETPLACE_REGISTRY"];
		const extension = await describe(extensionId, describeOptions);
		const version = extension.data.versions.find((version$1) => version$1.id === versionId);
		if (!version) throw new ForbiddenError();
		const limit = env["EXTENSIONS_LIMIT"] ? Number(env["EXTENSIONS_LIMIT"]) : null;
		if (limit !== null) {
			if (this.extensionsManager.extensions.length + (version.bundled.length ?? 1) >= limit) throw new LimitExceededError({ category: "Extensions" });
		}
		return {
			extension,
			version
		};
	}
	async install(extensionId, versionId) {
		const { extension, version } = await this.preInstall(extensionId, versionId);
		await this.extensionsItemService.createOne({
			id: extensionId,
			enabled: true,
			folder: versionId,
			source: "registry",
			bundle: null
		});
		if (extension.data.type === "bundle" && version.bundled.length > 0) await this.extensionsItemService.createMany(version.bundled.map((entry) => ({
			enabled: true,
			folder: entry.name,
			source: "registry",
			bundle: extensionId
		})));
		await this.extensionsManager.install(versionId);
	}
	async uninstall(id) {
		const settings = await this.extensionsItemService.readOne(id);
		if (settings.source !== "registry") throw new InvalidPayloadError({ reason: "Cannot uninstall extensions that were not installed via marketplace" });
		if (settings.bundle !== null) throw new InvalidPayloadError({ reason: "Cannot uninstall sub extensions of bundles separately" });
		await this.deleteOne(id);
		await this.extensionsManager.uninstall(settings.folder);
	}
	async reinstall(id) {
		const settings = await this.extensionsItemService.readOne(id);
		if (settings.source !== "registry") throw new InvalidPayloadError({ reason: "Cannot reinstall extensions that were not installed via marketplace" });
		if (settings.bundle !== null) throw new InvalidPayloadError({ reason: "Cannot reinstall sub extensions of bundles separately" });
		const extensionId = settings.id;
		const versionId = settings.folder;
		await this.preInstall(extensionId, versionId);
		await this.extensionsManager.install(versionId);
	}
	async readAll() {
		const settings = await this.extensionsItemService.readByQuery({ limit: -1 });
		const regular = settings.filter(({ bundle }) => bundle === null);
		const bundled = settings.filter(({ bundle }) => bundle !== null);
		const output = [];
		for (const meta of regular) output.push({
			id: meta.id,
			bundle: meta.bundle,
			meta,
			schema: this.extensionsManager.getExtension(meta.source, meta.folder) ?? null
		});
		for (const meta of bundled) {
			const parentBundle = output.find((ext) => ext.id === meta.bundle);
			if (!parentBundle) continue;
			const parentSchema = parentBundle.schema;
			const schema = parentSchema?.entries.find((entry) => entry.name === meta.folder) ?? null;
			if (!schema && parentSchema?.entriesFrom !== "code") continue;
			output.push({
				id: meta.id,
				bundle: meta.bundle,
				meta,
				schema
			});
		}
		return output;
	}
	async readOne(id) {
		const meta = await this.extensionsItemService.readOne(id);
		const schema = this.extensionsManager.getExtension(meta.source, meta.folder) ?? null;
		return {
			id: meta.id,
			bundle: meta.bundle,
			schema,
			meta
		};
	}
	async updateOne(id, data) {
		if (!isObject(data.meta)) throw new InvalidPayloadError({ reason: `"meta" is required` });
		const updatedMeta = data.meta;
		const heldActionEvents = [];
		const result = await transactionHoldingActions(this.knex, heldActionEvents, async (trx) => {
			const service = new ExtensionsService({
				knex: trx,
				accountability: this.accountability,
				schema: this.schema
			});
			await service.extensionsItemService.updateOne(id, updatedMeta, { bypassEmitAction: (actionEvent) => {
				heldActionEvents.push(actionEvent);
			} });
			let extension;
			try {
				extension = await service.readOne(id);
			} catch (error) {
				throw new ExtensionReadError(error);
			}
			if ("enabled" in updatedMeta) await service.checkBundleAndSyncStatus(trx, id, extension);
			return extension;
		});
		await emitActionEvents(heldActionEvents, {});
		const reloadOutcome = await this.extensionsManager.reload().then(() => ({
			hasFailed: false,
			failure: void 0
		}), (failure) => ({
			hasFailed: true,
			failure
		}));
		if (reloadOutcome.hasFailed) useLogger().error(reloadOutcome.failure, "Failed to reload the extensions after an extension update");
		try {
			await this.extensionsManager.broadcastReloadNotification();
		} catch (broadcastFailure) {
			useLogger().error(broadcastFailure, "Failed to tell the other processes to reload the extensions");
		}
		if (reloadOutcome.hasFailed) throw new ServiceUnavailableError({
			service: "extensions",
			reason: oneLine`
					The extension settings were saved,
					but reloading the extensions failed
				`
		});
		return result;
	}
	/**
	* Updates the row of an entry of a bundle declaring its entries in code,
	* creating it first: an app entry has no row until an admin toggles it.
	*/
	async updateEntry(bundleId, entryName, data) {
		const bundle = await this.readOne(bundleId);
		if (bundle.schema?.entriesFrom !== "code") throw new InvalidPayloadError({ reason: `Extension ${JSON.stringify(bundleId)} is not a bundle declaring its entries in code` });
		if (!isObject(data.meta)) throw new InvalidPayloadError({ reason: `"meta" is required` });
		const [entryRow] = await this.extensionsItemService.readByQuery({
			filter: {
				bundle: { _eq: bundleId },
				folder: { _eq: entryName }
			},
			limit: 1
		});
		const entryId = entryRow?.id ?? await this.extensionsItemService.createOne({
			enabled: bundle.meta.enabled,
			source: bundle.meta.source,
			bundle: bundleId,
			folder: entryName
		});
		return this.updateOne(entryId, data);
	}
	async deleteOne(id) {
		await this.extensionsItemService.deleteOne(id);
		await this.extensionsItemService.deleteByQuery({ filter: { bundle: { _eq: id } } });
	}
	/**
	* Sync a bundles enabled status
	*  - If the extension or extensions parent is not a bundle changes are skipped
	*  - If a bundles status is toggled, all children are set to that status
	*  - If an entries status is toggled, then if the:
	*    - Parent bundle is non-partial throws UnprocessableContentError
	*    - Entry status change resulted in all children being disabled then the parent bundle is disabled
	*    - Entry status change resulted in at least one child being enabled then the parent bundle is enabled
	*/
	async checkBundleAndSyncStatus(trx, extensionId, extension) {
		if (extension.bundle === null && extension.schema?.type === "bundle") {
			await trx("directus_extensions").update({ enabled: extension.meta.enabled }).where({ bundle: extensionId }).orWhere({ id: extensionId });
			return;
		}
		const parentId = extension.bundle ?? extension.meta.bundle;
		if (!parentId) return;
		const parent = await this.readOne(parentId);
		if (parent.schema?.type !== "bundle") return;
		if (parent.schema.partial === false) throw new UnprocessableContentError({ reason: "Unable to toggle status of an entry for a bundle marked as non partial" });
		if (parent.schema.entriesFrom === "code") return;
		if (!!await trx("directus_extensions").where({ bundle: parentId }).where({ enabled: true }).first()) await trx("directus_extensions").update({ enabled: true }).where({ id: parentId });
		else await trx("directus_extensions").update({ enabled: false }).where({ id: parentId });
	}
};

//#endregion
export { ExtensionReadError, ExtensionsService };