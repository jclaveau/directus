import { clearSystemCache, getCache } from "../cache.js";
import database_default from "../database/index.js";
import { fetchAllowedFields } from "../permissions/modules/fetch-allowed-fields/fetch-allowed-fields.js";
import emitter_default from "../emitter.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { shouldClearCache } from "../utils/should-clear-cache.js";
import { getEntitlementManager } from "../license/entitlements/manager.js";
import "../license/index.js";
import { ForbiddenError, InvalidPayloadError } from "@directus/errors";
import { systemCollectionRows } from "@directus/system-data";

//#region src/services/utils.ts
var UtilsService = class {
	knex;
	accountability;
	schema;
	constructor(options) {
		this.knex = options.knex || database_default();
		this.accountability = options.accountability || null;
		this.schema = options.schema;
	}
	async sort(collection, { item, to }) {
		const sortField = (await this.knex.select("sort_field").from("directus_collections").where({ collection }).first() || systemCollectionRows)?.sort_field;
		if (!sortField) throw new InvalidPayloadError({ reason: `Collection "${collection}" doesn't have a sort field` });
		if (this.accountability && this.accountability.admin !== true) {
			await validateAccess({
				accountability: this.accountability,
				action: "update",
				collection
			}, {
				schema: this.schema,
				knex: this.knex
			});
			const allowedFields = await fetchAllowedFields({
				collection,
				action: "update",
				accountability: this.accountability
			}, {
				schema: this.schema,
				knex: this.knex
			});
			if (allowedFields[0] !== "*" && allowedFields.includes(sortField) === false) throw new ForbiddenError();
		}
		const primaryKeyField = this.schema.collections[collection].primary;
		const countResponse = await this.knex.count("* as count").from(collection).whereNull(sortField).first();
		if (countResponse?.count && +countResponse.count !== 0) {
			const lastSortValueResponse = await this.knex.max(sortField).from(collection).first();
			const rowsWithoutSortValue = await this.knex.select(primaryKeyField, sortField).from(collection).whereNull(sortField);
			let lastSortValue = lastSortValueResponse ? Object.values(lastSortValueResponse)[0] : 0;
			for (const row of rowsWithoutSortValue) {
				lastSortValue++;
				await this.knex(collection).update({ [sortField]: lastSortValue }).where({ [primaryKeyField]: row[primaryKeyField] });
			}
		}
		if ((await this.knex.select(sortField).count(sortField, { as: "count" }).groupBy(sortField).from(collection).havingRaw("count(??) > 1", [sortField]))?.length > 0) {
			const ids = await this.knex.select(primaryKeyField).from(collection).orderBy(sortField);
			for (let i = 0; i < ids.length; i++) await this.knex(collection).update({ [sortField]: i + 1 }).where(ids[i]);
		}
		const targetSortValue = (await this.knex.select(sortField).from(collection).where({ [primaryKeyField]: to }).first())[sortField];
		const sourceSortValue = (await this.knex.select(sortField).from(collection).where({ [primaryKeyField]: item }).first())[sortField];
		await this.knex(collection).update({ [sortField]: targetSortValue }).where({ [primaryKeyField]: item });
		if (sourceSortValue < targetSortValue) await this.knex(collection).decrement(sortField, 1).where(sortField, ">", sourceSortValue).andWhere(sortField, "<=", targetSortValue).andWhereNot({ [primaryKeyField]: item });
		else await this.knex(collection).increment(sortField, 1).where(sortField, ">=", targetSortValue).andWhere(sortField, "<=", sourceSortValue).andWhereNot({ [primaryKeyField]: item });
		const { cache } = getCache();
		if (shouldClearCache(cache, void 0, collection)) await cache.clear();
		emitter_default.emitAction(["items.sort", `${collection}.items.sort`], {
			collection,
			item,
			to
		}, {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability
		});
	}
	async clearCache({ system }) {
		if (this.accountability?.admin !== true) throw new ForbiddenError();
		const { cache } = getCache();
		if (system) {
			await clearSystemCache({ forced: true });
			await getEntitlementManager().clearCache();
		}
		return cache?.clear();
	}
};

//#endregion
export { UtilsService };