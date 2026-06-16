import { reduceSchema } from "../../utils/reduce-schema.js";
import { fetchPolicies } from "../lib/fetch-policies.js";
import { fetchRolesTree } from "../lib/fetch-roles-tree.js";
import { fetchAllowedFieldMap } from "../modules/fetch-allowed-field-map/fetch-allowed-field-map.js";
import { fetchGlobalAccess } from "../modules/fetch-global-access/fetch-global-access.js";
import { fetchShareInfo } from "./fetch-share-info.js";
import { mergePermissions } from "./merge-permissions.js";
import { fetchPermissions } from "../lib/fetch-permissions.js";
import { set, uniq } from "lodash-es";
import { schemaPermissions } from "@directus/system-data";

//#region src/permissions/utils/get-permissions-for-share.ts
async function getPermissionsForShare(accountability, collections, context) {
	const defaults = {
		action: "read",
		collection: "",
		permissions: {},
		policy: null,
		validation: null,
		presets: null,
		fields: null
	};
	const { collection, item, role, user_created } = await fetchShareInfo(accountability.share, context);
	const userAccountability = {
		user: user_created.id,
		role: user_created.role,
		roles: await fetchRolesTree(user_created.role, { knex: context.knex }),
		admin: false,
		app: false,
		ip: accountability.ip
	};
	const shareAccountability = {
		user: null,
		role,
		roles: await fetchRolesTree(role, { knex: context.knex }),
		admin: false,
		app: false,
		ip: accountability.ip
	};
	const [{ admin: shareIsAdmin }, { admin: userIsAdmin }, userPermissions, sharePermissions, shareFieldMap, userFieldMap] = await Promise.all([
		fetchGlobalAccess(shareAccountability, { knex: context.knex }),
		fetchGlobalAccess(userAccountability, { knex: context.knex }),
		getPermissionsForAccountability(userAccountability, context),
		getPermissionsForAccountability(shareAccountability, context),
		fetchAllowedFieldMap({
			accountability: shareAccountability,
			action: "read"
		}, context),
		fetchAllowedFieldMap({
			accountability: userAccountability,
			action: "read"
		}, context)
	]);
	const isAdmin = userIsAdmin && shareIsAdmin;
	let permissions = [];
	let reducedSchema;
	if (isAdmin) {
		defaults.fields = ["*"];
		reducedSchema = context.schema;
	} else if (userIsAdmin && !shareIsAdmin) {
		permissions = sharePermissions;
		reducedSchema = reduceSchema(context.schema, shareFieldMap);
	} else if (shareIsAdmin && !userIsAdmin) {
		permissions = userPermissions;
		reducedSchema = reduceSchema(context.schema, userFieldMap);
	} else {
		permissions = mergePermissions("intersection", sharePermissions, userPermissions);
		reducedSchema = reduceSchema(context.schema, shareFieldMap);
		reducedSchema = reduceSchema(reducedSchema, userFieldMap);
	}
	if (!isAdmin) defaults.fields = permissions.find((perm) => perm.collection === collection)?.fields ?? [];
	const parentPrimaryKeyField = context.schema.collections[collection].primary;
	const relationalPermissions = traverse(reducedSchema, parentPrimaryKeyField, item, collection);
	const allGeneratedPermissions = [
		{
			...defaults,
			collection,
			permissions: { [parentPrimaryKeyField]: { _eq: item } }
		},
		...relationalPermissions.map((generated) => ({
			...defaults,
			...generated
		})),
		...schemaPermissions
	];
	const allowedCollections = uniq(allGeneratedPermissions.map(({ collection: collection$1 }) => collection$1));
	const generatedPermissions = [];
	for (const collection$1 of allowedCollections) {
		const permissionsForCollection = allGeneratedPermissions.filter((permission) => permission.collection === collection$1);
		if (permissionsForCollection.length > 0) generatedPermissions.push(...mergePermissions("or", permissionsForCollection));
		else generatedPermissions.push(...permissionsForCollection);
	}
	if (isAdmin) return filterCollections(collections, generatedPermissions);
	return filterCollections(collections, mergePermissions("and", permissions.filter(({ action, collection: collection$1 }) => allowedCollections.includes(collection$1) && action === "read"), generatedPermissions));
}
function filterCollections(collections, permissions) {
	if (!collections) return permissions;
	return permissions.filter(({ collection }) => collections.includes(collection));
}
async function getPermissionsForAccountability(accountability, context) {
	return fetchPermissions({
		policies: await fetchPolicies(accountability, context),
		accountability
	}, context);
}
function traverse(schema, rootItemPrimaryKeyField, rootItemPrimaryKey, currentCollection, parentCollections = [], path = []) {
	const permissions = [];
	if (parentCollections.includes(currentCollection)) return permissions;
	const relationsInCollection = schema.relations.filter((relation) => {
		return relation.collection === currentCollection || relation.related_collection === currentCollection;
	});
	for (const relation of relationsInCollection) {
		let type;
		if (relation.related_collection === currentCollection) type = "o2m";
		else if (!relation.related_collection) type = "a2o";
		else type = "m2o";
		if (type === "o2m") {
			permissions.push({
				collection: relation.collection,
				permissions: getFilterForPath(type, [...path, relation.field], rootItemPrimaryKeyField, rootItemPrimaryKey)
			});
			permissions.push(...traverse(schema, rootItemPrimaryKeyField, rootItemPrimaryKey, relation.collection, [...parentCollections, currentCollection], [...path, relation.field]));
		}
		if (type === "a2o" && relation.meta?.one_allowed_collections) for (const collection of relation.meta.one_allowed_collections) permissions.push({
			collection,
			permissions: getFilterForPath(type, [...path, `$FOLLOW(${relation.collection},${relation.field},${relation.meta.one_collection_field})`], rootItemPrimaryKeyField, rootItemPrimaryKey)
		});
		if (type === "m2o") {
			permissions.push({
				collection: relation.related_collection,
				permissions: getFilterForPath(type, [...path, `$FOLLOW(${relation.collection},${relation.field})`], rootItemPrimaryKeyField, rootItemPrimaryKey)
			});
			if (relation.meta?.one_field) permissions.push(...traverse(schema, rootItemPrimaryKeyField, rootItemPrimaryKey, relation.related_collection, [...parentCollections, currentCollection], [...path, relation.meta?.one_field]));
		}
	}
	return permissions;
}
function getFilterForPath(type, path, rootPrimaryKeyField, rootPrimaryKey) {
	const filter = {};
	if (type === "m2o" || type === "a2o") set(filter, path.reverse(), { [rootPrimaryKeyField]: { _eq: rootPrimaryKey } });
	else set(filter, path.reverse(), { _eq: rootPrimaryKey });
	return filter;
}

//#endregion
export { getPermissionsForShare, traverse };