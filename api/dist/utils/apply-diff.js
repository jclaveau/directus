import { useLogger } from "../logger/index.js";
import { DiffKind } from "../packages/types/dist/index.js";
import { flushCaches } from "../cache.js";
import { getHelpers } from "../database/helpers/index.js";
import database_default from "../database/index.js";
import emitter_default from "../emitter.js";
import { transaction } from "./transaction.js";
import { RelationsService } from "../services/relations.js";
import { getSchema } from "./get-schema.js";
import { FieldsService } from "../services/fields.js";
import { CollectionsService } from "../services/collections.js";
import { cloneDeep, merge, set } from "lodash-es";
import deepDiff from "deep-diff";

//#region src/utils/apply-diff.ts
const logger = useLogger();
async function applyDiff(currentSnapshot, snapshotDiff, options) {
	const database = options?.database ?? database_default();
	const helpers = getHelpers(database);
	const schema = options?.schema ?? await getSchema({
		database,
		bypassCache: true
	});
	const nestedActionEvents = [];
	const mutationOptions = {
		autoPurgeSystemCache: false,
		bypassEmitAction: (params) => nestedActionEvents.push(params),
		bypassLimits: true
	};
	const runPostColumnChange = await helpers.schema.preColumnChange();
	await transaction(database, async (trx) => {
		const collectionsService = new CollectionsService({
			knex: trx,
			schema
		});
		const getNestedCollectionsToCreate = (currentLevelCollection) => snapshotDiff.collections.filter(({ diff }) => diff[0].rhs?.meta?.group === currentLevelCollection);
		const createCollections = async (collections) => {
			for (const { collection, diff } of collections) if (diff?.[0]?.kind === DiffKind.NEW && diff[0].rhs) {
				const fields = snapshotDiff.fields.filter((fieldDiff) => fieldDiff.collection === collection).map((fieldDiff) => fieldDiff.diff[0].rhs).map((fieldDiff) => {
					if (["char", "varchar"].includes(String(fieldDiff.schema?.data_type).toLowerCase()) && fieldDiff.schema?.max_length === 36 && (fieldDiff.schema?.is_primary_key || fieldDiff.schema?.foreign_key_table && fieldDiff.schema?.foreign_key_column)) return merge(fieldDiff, {
						type: "uuid",
						schema: {
							data_type: "uuid",
							max_length: null
						}
					});
					else return fieldDiff;
				});
				try {
					await collectionsService.createOne({
						...diff[0].rhs,
						fields
					}, mutationOptions);
				} catch (err) {
					logger.error(`Failed to create collection "${collection}"`);
					throw err;
				}
				snapshotDiff.fields = snapshotDiff.fields.filter((fieldDiff) => fieldDiff.collection !== collection);
				await createCollections(getNestedCollectionsToCreate(collection));
			}
		};
		const deleteCollections = async (collections) => {
			for (const { collection, diff } of collections) if (diff?.[0]?.kind === DiffKind.DELETE) {
				const relations = schema.relations.filter((r) => r.related_collection === collection || r.collection === collection);
				if (relations.length > 0) {
					const relationsService$1 = new RelationsService({
						knex: trx,
						schema
					});
					for (const relation of relations) try {
						await relationsService$1.deleteOne(relation.collection, relation.field, mutationOptions);
					} catch (err) {
						logger.error(`Failed to delete collection "${collection}" due to relation "${relation.collection}.${relation.field}"`);
						throw err;
					}
					schema.relations = schema.relations.filter((r) => r.related_collection !== collection && r.collection !== collection);
				}
				try {
					await collectionsService.deleteOne(collection, mutationOptions);
				} catch (err) {
					logger.error(`Failed to delete collection "${collection}"`);
					throw err;
				}
			}
		};
		const filterCollectionsForCreation = ({ diff }) => {
			if (!(diff[0]?.kind === DiffKind.NEW)) return false;
			const groupName = diff[0].rhs.meta?.group;
			if (!groupName) return true;
			const parentExists = currentSnapshot.collections.find((c) => c.collection === groupName) !== void 0;
			const parentWillBeCreatedInThisApply = snapshotDiff.collections.filter(({ collection, diff: diff$1 }) => diff$1[0]?.kind === DiffKind.NEW && collection === groupName).length > 0;
			if (parentExists && !parentWillBeCreatedInThisApply) return true;
			return false;
		};
		await createCollections(snapshotDiff.collections.filter(filterCollectionsForCreation));
		const collectionsToDelete = snapshotDiff.collections.filter(({ diff }) => {
			if (diff.length === 0 || diff[0] === void 0) return false;
			return diff[0].kind === DiffKind.DELETE;
		});
		if (collectionsToDelete.length > 0) await deleteCollections(collectionsToDelete);
		for (const { collection, diff } of snapshotDiff.collections) if (diff?.[0]?.kind === DiffKind.EDIT || diff?.[0]?.kind === DiffKind.ARRAY) {
			const currentCollection = currentSnapshot.collections.find((field) => {
				return field.collection === collection;
			});
			if (currentCollection) try {
				const newValues = diff.reduce((acc, currentDiff) => {
					deepDiff.applyChange(acc, void 0, currentDiff);
					return acc;
				}, cloneDeep(currentCollection));
				await collectionsService.updateOne(collection, newValues, mutationOptions);
			} catch (err) {
				logger.error(`Failed to update collection "${collection}"`);
				throw err;
			}
		}
		let fieldsService = new FieldsService({
			knex: trx,
			schema: await getSchema({
				database: trx,
				bypassCache: true
			})
		});
		for (const { collection, field, diff } of snapshotDiff.fields) {
			if (diff?.[0]?.kind === DiffKind.NEW && !isNestedMetaUpdate(diff?.[0])) try {
				const rhs = diff[0].rhs;
				await fieldsService.createField(collection, rhs, void 0, mutationOptions);
				fieldsService = new FieldsService({
					knex: trx,
					schema: await getSchema({
						database: trx,
						bypassCache: true
					})
				});
			} catch (err) {
				logger.error(`Failed to create field "${collection}.${field}"`);
				throw err;
			}
			if (diff?.[0]?.kind === DiffKind.EDIT || diff?.[0]?.kind === DiffKind.ARRAY || isNestedMetaUpdate(diff[0])) {
				const currentField = currentSnapshot.fields.find((snapshotField) => {
					return snapshotField.collection === collection && snapshotField.field === field;
				});
				if (currentField) try {
					const newValues = diff.reduce((acc, currentDiff) => {
						deepDiff.applyChange(acc, void 0, currentDiff);
						return acc;
					}, cloneDeep(currentField));
					await fieldsService.updateField(collection, newValues, mutationOptions);
				} catch (err) {
					logger.error(`Failed to update field "${collection}.${field}"`);
					throw err;
				}
			}
			if (diff?.[0]?.kind === DiffKind.DELETE && !isNestedMetaUpdate(diff?.[0])) {
				try {
					await fieldsService.deleteField(collection, field, mutationOptions);
					fieldsService = new FieldsService({
						knex: trx,
						schema: await getSchema({
							database: trx,
							bypassCache: true
						})
					});
				} catch (err) {
					logger.error(`Failed to delete field "${collection}.${field}"`);
					throw err;
				}
				snapshotDiff.relations = snapshotDiff.relations.filter((relation) => (relation.collection === collection && relation.field === field && !relation.diff.some((diff$1) => diff$1.kind === DiffKind.NEW)) === false);
			}
		}
		for (const { collection, field, diff } of snapshotDiff.systemFields) if (diff?.[0]?.kind === DiffKind.EDIT) try {
			const newValues = diff.reduce((acc, currentDiff) => {
				deepDiff.applyChange(acc, void 0, currentDiff);
				return acc;
			}, {
				collection,
				field
			});
			await fieldsService.updateField(collection, newValues, mutationOptions);
		} catch (err) {
			logger.error(`Failed to update field "${collection}.${field}"`);
			throw err;
		}
		const relationsService = new RelationsService({
			knex: trx,
			schema: await getSchema({
				database: trx,
				bypassCache: true
			})
		});
		for (const { collection, field, diff } of snapshotDiff.relations) {
			const structure = {};
			for (const diffEdit of diff) set(structure, diffEdit.path, void 0);
			if (diff?.[0]?.kind === DiffKind.NEW) try {
				await relationsService.createOne({
					...diff[0].rhs,
					collection,
					field
				}, mutationOptions);
			} catch (err) {
				logger.error(`Failed to create relation "${collection}.${field}"`);
				throw err;
			}
			if (diff?.[0]?.kind === DiffKind.EDIT || diff?.[0]?.kind === DiffKind.ARRAY) {
				const currentRelation = currentSnapshot.relations.find((relation) => {
					return relation.collection === collection && relation.field === field;
				});
				if (currentRelation) try {
					const newValues = diff.reduce((acc, currentDiff) => {
						deepDiff.applyChange(acc, void 0, currentDiff);
						return acc;
					}, cloneDeep(currentRelation));
					await relationsService.updateOne(collection, field, newValues, mutationOptions);
				} catch (err) {
					logger.error(`Failed to update relation "${collection}.${field}"`);
					throw err;
				}
			}
			if (diff?.[0]?.kind === DiffKind.DELETE) try {
				await relationsService.deleteOne(collection, field, mutationOptions);
			} catch (err) {
				logger.error(`Failed to delete relation "${collection}.${field}"`);
				throw err;
			}
		}
	});
	if (runPostColumnChange) await helpers.schema.postColumnChange();
	await flushCaches();
	if (nestedActionEvents.length > 0) {
		const updatedSchema = await getSchema({
			database,
			bypassCache: true
		});
		for (const nestedActionEvent of nestedActionEvents) {
			nestedActionEvent.context.schema = updatedSchema;
			emitter_default.emitAction(nestedActionEvent.event, nestedActionEvent.meta, nestedActionEvent.context);
		}
	}
}
function isNestedMetaUpdate(diff) {
	if (!diff) return false;
	if (diff.kind !== DiffKind.NEW && diff.kind !== DiffKind.DELETE) return false;
	if (!diff.path || diff.path.length < 2 || diff.path[0] !== "meta") return false;
	return true;
}

//#endregion
export { applyDiff, isNestedMetaUpdate };