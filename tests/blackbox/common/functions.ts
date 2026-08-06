import type { Permission, Query } from '@directus/types';
import { omit } from 'lodash-es';
import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getNoCacheUrl, getUrl, type Env } from './config';
import vendors, { type Vendor } from './get-dbs-to-test';
import type { PrimaryKeyType } from './types';
import { ROLE, USER } from './variables';

/**
 * The payload of a mutation that succeeded, refusing one that did not.
 *
 * Without this a rejected write returns `undefined` and the seed carries on, so
 * `seed-database.test.ts` reports green over a database it failed to build — the
 * seeds only assert `expect(true).toBeTruthy()`, and their catch never fires
 * because nothing throws.
 */
function dataOrThrow(response: Response, what: string) {
	if (!response.ok) {
		throw new Error(
			`Could not create ${what}: `
			+ `${response.status} ${JSON.stringify(response.body)}`,
		);
	}

	return response.body.data;
}

export function DisableTestCachingSetup() {
	beforeEach(async () => {
		process.env['TEST_NO_CACHE'] = 'true';
	});

	afterAll(async () => {
		delete process.env['TEST_NO_CACHE'];
	});
}

export function ClearCaches() {
	describe('Clear Caches', () => {
		it.each(vendors)(
			'%s',
			async (vendor) => {
				// Setup
				EnableTestCaching();

				// Assert
				const response = await request(getUrl(vendor))
					.post(`/utils/cache/clear?system`)
					.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`);

				const response2 = await request(getUrl(vendor))
					.get(`/fields`)
					.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`);

				expect(response.statusCode).toBe(200);
				expect(response2.statusCode).toBe(200);
			},
			30000,
		);
	});
}

export function EnableTestCaching() {
	delete process.env['TEST_NO_CACHE'];
}

export type OptionsCreateRole = {
	name: string;
};

export async function CreateRole(vendor: Vendor, options: OptionsCreateRole) {
	// Action
	const roleResponse = await request(getUrl(vendor))
		.get(`/roles`)
		.query({
			filter: { name: { _eq: options.name } },
		})
		.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`);

	if (roleResponse.body.data.length > 0) {
		return roleResponse.body.data[0];
	}

	const response = await request(getUrl(vendor))
		.post(`/roles`)
		.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`)
		.send({ name: options.name });

	return dataOrThrow(response, `role "${options.name}"`);
}

export type OptionsCreateUser = {
	token: string;
	email: string;
	password?: string;
	name?: string;
	role?: string;
	// Automatically removed params
	roleName?: string; // to generate role
};

export async function CreateUser(vendor: Vendor, options: Partial<OptionsCreateUser>) {
	// Validate options
	if (!options.token) {
		throw new Error('Missing required field: token');
	}

	if (!options.email) {
		throw new Error('Missing required field: email');
	}

	if (options.roleName) {
		const roleResponse = await request(getUrl(vendor))
			.get(`/roles`)
			.query({
				filter: { name: { _eq: options.roleName } },
				fields: ['id', 'name'],
			})
			.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`);

		if (roleResponse.body.data.length === 0) {
			throw new Error(`Role ${options.roleName} does not exist`);
		}

		options.role = roleResponse.body.data[0].id;
		delete options.roleName;
	}

	// Action
	const response = await request(getUrl(vendor))
		.post(`/users`)
		.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`)
		.send(options);

	return dataOrThrow(response, `user "${options.email}"`);
}

/**
 * A field created as part of its collection rather than by its own POST /fields.
 *
 * - `meta` is required because omitting it is silent and destructive: the server
 *   builds the directus_fields rows from `fields.filter((field) => field.meta)`,
 *   so a field without it becomes a bare column Directus does not manage — absent
 *   from `GET /fields/:collection/:field`, and from schema snapshots.
 * - Pass `{}` for a normal field, or `null` to mean the bare column on purpose.
 */
export type FoldedField = {
	field: string;
	type: string;
	meta: Record<string, any> | null;
	schema?: any;
};

export type OptionsCreateCollection = {
	collection: string;
	meta?: any;
	schema?: any;
	fields?: FoldedField[];
	env?: Env;
	// Automatically removed params
	primaryKeyType?: PrimaryKeyType;
};

/**
 * Fill in the collection defaults and prepend the primary-key field, ready to
 * POST.
 */
function buildCollectionPayload(
	options: Partial<OptionsCreateCollection>,
): Partial<OptionsCreateCollection> {
	if (!options.collection) {
		throw new Error('Missing required field: collection');
	}

	const defaultOptions = {
		meta: {},
		schema: {},
		fields: [] as FoldedField[],
		primaryKeyType: 'integer',
	};

	const payload = Object.assign({}, defaultOptions, options);

	// Nothing gates the blackbox typecheck, so refuse the omission here as well —
	// silently defaulting it would hide the bare-column trap FoldedField documents.
	payload.fields = payload.fields.map((field) => {
		if (!('meta' in field)) {
			throw new Error(
				`Field "${field.field}" of "${payload.collection}" must set meta: `
					+ `{} for a normal field, or null for a bare unmanaged column.`,
			);
		}

		return { schema: {}, ...field };
	});

	switch (payload.primaryKeyType) {
		case 'uuid':
			payload.fields.push({
				field: 'id',
				type: 'uuid',
				meta: { hidden: true, readonly: true, interface: 'input', special: ['uuid'] },
				schema: { is_primary_key: true, length: 36, has_auto_increment: false },
			});

			break;
		case 'string':
			payload.fields.push({
				field: 'id',
				type: 'string',
				meta: { hidden: false, readonly: false, interface: 'input' },
				schema: { is_primary_key: true, length: 255, has_auto_increment: false },
			});

			break;
		case 'integer':
		default:
			payload.fields.push({
				field: 'id',
				type: 'integer',
				meta: { hidden: true, interface: 'input', readonly: true },
				schema: { is_primary_key: true, has_auto_increment: true },
			});

			break;
	}

	delete payload.primaryKeyType;

	return payload;
}

export async function CreateCollection(
	vendor: Vendor,
	options: Partial<OptionsCreateCollection>,
) {
	const payload = buildCollectionPayload(options);

	// Action
	const collectionResponse = await request(getUrl(vendor, options.env))
		.get(`/collections/${payload.collection}`)
		.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`);

	if (collectionResponse.body.data) {
		return collectionResponse.body.data;
	}

	const response = await request(getUrl(vendor, options.env))
		.post(`/collections`)
		.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`)
		.send(payload);

	return dataOrThrow(response, `collection "${payload.collection}"`);
}

export type OptionsCreateCollections = {
	collections: Partial<OptionsCreateCollection>[];
	env?: Env;
};

/** Create several collections (each with its fields folded in) in one batch POST. */
export async function CreateCollections(
	vendor: Vendor,
	options: OptionsCreateCollections,
) {
	const payloads = options.collections.map((collection) => {
		return buildCollectionPayload(collection);
	});

	// The server rejects a duplicate before creating anything, and createMany runs
	// the whole batch in one transaction — so one leftover collection would roll
	// back every sibling. Listing once drops them for a single request, where the
	// per-collection probe CreateCollection does would cost one each.
	const listed = await request(getUrl(vendor, options.env))
		.get(`/collections`)
		.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`);

	const alreadyCreated = new Set<string>(
		(listed.body?.data ?? []).map(({ collection }: any) => collection),
	);

	const missing = payloads.filter((payload) => {
		return !alreadyCreated.has(payload.collection!);
	});

	if (missing.length === 0) {
		return [];
	}

	const response = await request(getUrl(vendor, options.env))
		.post(`/collections`)
		.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`)
		.send(missing);

	return dataOrThrow(
		response,
		`collections ${missing.map((one) => one.collection).join(', ')}`,
	);
}

export type OptionsDeleteCollection = {
	collection: string;
};

export async function DeleteCollection(vendor: Vendor, options: OptionsDeleteCollection) {
	// Action
	const response = await request(getUrl(vendor))
		.delete(`/collections/${options.collection}`)
		.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`);

	return response.body;
}

export type OptionsDeleteField = {
	collection: string;
	field: string;
};

export async function DeleteField(vendor: Vendor, options: OptionsDeleteField) {
	// Action
	const response = await request(getUrl(vendor))
		.delete(`/fields/${options.collection}/${options.field}`)
		.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`);

	return response.body;
}

export type OptionsCreateField = {
	collection: string;
	field: string;
	type: string;
	meta?: any;
	schema?: any;
};

export async function CreateField(vendor: Vendor, options: OptionsCreateField) {
	// Parse options
	const defaultOptions = {
		meta: {},
		schema: {},
	};

	options = Object.assign({}, defaultOptions, options);

	// Action
	const response = await request(getUrl(vendor))
		.post(`/fields/${options.collection}`)
		.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`)
		.send(options);

	// Idempotent re-seed: a shared shard can seed the same structure twice. The
	// server throws "already exists in collection" before creating (fields.ts), so
	// read the existing field back. Only the rare duplicate pays the extra GET.
	const alreadyExists =
		response.status === 400 &&
		response.body?.errors?.[0]?.message?.includes('already exists in collection');

	if (alreadyExists) {
		const existing = await request(getUrl(vendor))
			.get(`/fields/${options.collection}/${options.field}`)
			.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`);

		return existing.body.data;
	}

	return dataOrThrow(response, `field "${options.collection}.${options.field}"`);
}

export type OptionsCreateRelation = {
	collection: string;
	field: string;
	related_collection: string | null;
	meta?: any;
	schema?: any;
};

export async function CreateRelation(vendor: Vendor, options: OptionsCreateRelation) {
	// Parse options
	const defaultOptions = {
		meta: {},
		schema: {},
	};

	options = Object.assign({}, defaultOptions, options);

	// Action
	const relationResponse = await request(getUrl(vendor))
		.get(`/relations/${options.collection}/${options.field}`)
		.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`);

	if (relationResponse.statusCode === 200) {
		return relationResponse.body.data;
	}

	const response = await request(getUrl(vendor))
		.post(`/relations`)
		.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`)
		.send(options);

	return dataOrThrow(response, `relation "${options.collection}.${options.field}"`);
}

export type OptionsCreateFieldM2O = {
	collection: string;
	field: string;
	fieldMeta?: any;
	fieldSchema?: any;
	primaryKeyType?: PrimaryKeyType;
	otherCollection: string;
	relationMeta?: any;
	relationSchema?: any;
};

export async function CreateFieldM2O(vendor: Vendor, options: OptionsCreateFieldM2O) {
	// Parse options
	const defaultOptions = {
		fieldMeta: {},
		fieldSchema: {},
		primaryKeyType: 'integer',
		relationMeta: {},
		relationSchema: {
			on_delete: 'SET NULL',
		},
	};

	options = Object.assign({}, defaultOptions, options);

	const fieldOptions: OptionsCreateField = {
		collection: options.collection,
		field: options.field,
		type: options.primaryKeyType!,
		meta: options.fieldMeta ?? {},
		schema: options.fieldSchema ?? {},
	};

	if (!fieldOptions.meta.special) {
		fieldOptions.meta.special = ['m2o'];
	} else if (!fieldOptions.meta.special.includes('m2o')) {
		fieldOptions.meta.special.push('m2o');
	}

	// Action
	const field = await CreateField(vendor, fieldOptions);

	const relationOptions: OptionsCreateRelation = {
		collection: options.collection,
		field: options.field,
		meta: options.relationMeta,
		schema: options.relationSchema,
		related_collection: options.otherCollection,
	};

	const relation = await CreateRelation(vendor, relationOptions);

	return { field, relation };
}

export type OptionsCreateFieldO2M = {
	collection: string;
	field: string;
	fieldMeta?: any;
	otherCollection: string;
	otherField: string;
	primaryKeyType?: string;
	otherMeta?: any;
	otherSchema?: any;
	relationMeta?: any;
	relationSchema?: any;
};

export async function CreateFieldO2M(vendor: Vendor, options: OptionsCreateFieldO2M) {
	// Parse options
	const defaultOptions = {
		fieldMeta: {},
		primaryKeyType: 'integer',
		otherMeta: {},
		otherSchema: {},
		relationMeta: {},
		relationSchema: {
			on_delete: 'SET NULL',
		},
	};

	options = Object.assign({}, defaultOptions, options);

	const fieldOptions: OptionsCreateField = {
		collection: options.collection,
		field: options.field,
		type: 'alias',
		meta: options.fieldMeta,
		schema: null,
	};

	if (!fieldOptions.meta.special) {
		fieldOptions.meta.special = ['o2m'];
	} else if (!fieldOptions.meta.special.includes('o2m')) {
		fieldOptions.meta.special.push('o2m');
	}

	// Action
	const field = await CreateField(vendor, fieldOptions);

	const otherFieldOptions: OptionsCreateField = {
		collection: options.otherCollection,
		field: options.otherField,
		type: options.primaryKeyType!,
		meta: options.otherMeta,
		schema: options.otherSchema,
	};

	const otherField = await CreateField(vendor, otherFieldOptions);

	const relationOptions: OptionsCreateRelation = {
		collection: options.otherCollection,
		field: options.otherField,
		meta: { ...options.relationMeta, one_field: options.field },
		schema: options.relationSchema,
		related_collection: options.collection,
	};

	const relation = await CreateRelation(vendor, relationOptions);

	return { field, otherField, relation };
}

export type OptionsCreateFieldM2M = {
	collection: string;
	field: string;
	fieldMeta?: any;
	fieldSchema?: any;
	otherCollection: string;
	otherField: string;
	junctionCollection: string;
	primaryKeyType?: string;
	otherMeta?: any;
	otherSchema?: any;
	relationMeta?: any;
	relationSchema?: any;
	otherRelationSchema?: any;
};

export async function CreateFieldM2M(vendor: Vendor, options: OptionsCreateFieldM2M) {
	// Parse options
	const defaultOptions = {
		fieldMeta: {},
		fieldSchema: {},
		primaryKeyType: 'integer',
		otherMeta: {},
		otherSchema: {},
		relationMeta: {},
		relationSchema: {
			on_delete: 'SET NULL',
		},
		otherRelationSchema: {
			on_delete: 'SET NULL',
		},
	};

	options = Object.assign({}, defaultOptions, options);

	const fieldOptions: OptionsCreateField = {
		collection: options.collection,
		field: options.field,
		type: 'alias',
		meta: options.fieldMeta,
		schema: options.fieldSchema,
	};

	const isSelfReferencing = options.collection === options.otherCollection;

	if (!fieldOptions.meta.special) {
		fieldOptions.meta.special = ['m2m'];
	} else if (!fieldOptions.meta.special.includes('m2m')) {
		fieldOptions.meta.special.push('m2m');
	}

	// Action
	const field = await CreateField(vendor, fieldOptions);

	const otherFieldOptions: OptionsCreateField = {
		collection: options.otherCollection,
		field: options.otherField,
		type: 'alias',
		meta: options.otherMeta,
		schema: options.otherSchema,
	};

	if (!otherFieldOptions.meta.special) {
		otherFieldOptions.meta.special = ['m2m'];
	} else if (!otherFieldOptions.meta.special.includes('m2m')) {
		otherFieldOptions.meta.special.push('m2m');
	}

	const otherField = await CreateField(vendor, otherFieldOptions);

	const junctionCollectionOptions: OptionsCreateCollection = {
		collection: options.junctionCollection,
		primaryKeyType: 'integer',
	};

	const junctionCollection = await CreateCollection(vendor, junctionCollectionOptions);

	const junctionFieldName = `${options.collection}_id`;

	const junctionFieldOptions: OptionsCreateField = {
		collection: options.junctionCollection,
		field: junctionFieldName,
		type: options.primaryKeyType!,
	};

	const junctionField = await CreateField(vendor, junctionFieldOptions);

	const otherJunctionFieldName = `${options.otherCollection}_id${isSelfReferencing ? '2' : ''}`;

	const otherJunctionFieldOptions: OptionsCreateField = {
		collection: options.junctionCollection,
		field: otherJunctionFieldName,
		type: options.primaryKeyType!,
	};

	const otherJunctionField = await CreateField(vendor, otherJunctionFieldOptions);

	const relationOptions: OptionsCreateRelation = {
		collection: options.junctionCollection,
		field: junctionFieldName,
		meta: {
			...options.relationMeta,
			one_field: options.field,
			junction_field: otherJunctionFieldName,
		},
		schema: options.relationSchema,
		related_collection: options.collection,
	};

	const relation = await CreateRelation(vendor, relationOptions);

	const otherRelationOptions: OptionsCreateRelation = {
		collection: options.junctionCollection,
		field: otherJunctionFieldName,
		meta: {
			...options.relationMeta,
			one_field: options.otherField,
			junction_field: junctionFieldName,
		},
		schema: options.otherRelationSchema,
		related_collection: options.otherCollection,
	};

	const otherRelation = await CreateRelation(vendor, otherRelationOptions);

	return { field, otherField, junctionCollection, junctionField, otherJunctionField, relation, otherRelation };
}

export type OptionsCreateFieldM2A = {
	collection: string;
	field: string;
	relatedCollections: string[];
	fieldMeta?: any;
	fieldSchema?: any;
	junctionCollection: string;
	primaryKeyType?: string;
	relationMeta?: any;
	relationSchema?: any;
	itemRelationMeta?: any;
	itemRelationSchema?: any;
};

export async function CreateFieldM2A(vendor: Vendor, options: OptionsCreateFieldM2A) {
	// Parse options
	const defaultOptions = {
		fieldMeta: {},
		fieldSchema: {},
		primaryKeyType: 'integer',
		otherMeta: {},
		otherSchema: {},
		relationSchema: null,
		itemRelationSchema: {
			on_delete: 'SET NULL',
		},
	};

	options = Object.assign({}, defaultOptions, options);

	const fieldOptions: OptionsCreateField = {
		collection: options.collection,
		field: options.field,
		type: 'alias',
		meta: options.fieldMeta,
		schema: options.fieldSchema,
	};

	if (!fieldOptions.meta.special) {
		fieldOptions.meta.special = ['m2a'];
	} else if (!fieldOptions.meta.special.includes('m2a')) {
		fieldOptions.meta.special.push('m2a');
	}

	// Action
	const field = await CreateField(vendor, fieldOptions);

	const junctionCollectionOptions: OptionsCreateCollection = {
		collection: options.junctionCollection,
		primaryKeyType: 'integer',
	};

	const junctionCollection = await CreateCollection(vendor, junctionCollectionOptions);

	const junctionFieldName = `${options.junctionCollection}_id`;

	const junctionFieldOptions: OptionsCreateField = {
		collection: options.junctionCollection,
		field: junctionFieldName,
		type: options.primaryKeyType!,
		meta: { hidden: true },
	};

	const junctionField = await CreateField(vendor, junctionFieldOptions);

	const junctionFieldItemOptions: OptionsCreateField = {
		collection: options.junctionCollection,
		field: 'item',
		type: 'string',
		meta: { hidden: true },
	};

	const junctionFieldItem = await CreateField(vendor, junctionFieldItemOptions);

	const junctionFieldCollectionOptions: OptionsCreateField = {
		collection: options.junctionCollection,
		field: 'collection',
		type: 'string',
		meta: { hidden: true },
	};

	const junctionFieldCollection = await CreateField(vendor, junctionFieldCollectionOptions);

	const relationOptions: OptionsCreateRelation = {
		collection: options.junctionCollection,
		field: 'item',
		related_collection: null,
		meta: {
			one_allowed_collections: options.relatedCollections,
			one_collection_field: 'collection',
			junction_field: junctionFieldName,
		},
		schema: null,
	};

	const relation = await CreateRelation(vendor, relationOptions);

	const itemRelationOptions: OptionsCreateRelation = {
		collection: options.junctionCollection,
		field: junctionFieldName,
		related_collection: options.collection,
		meta: {
			one_field: options.field,
			junction_field: 'item',
		},
		schema: options.itemRelationSchema,
	};

	const itemRelation = await CreateRelation(vendor, itemRelationOptions);

	return {
		field,
		junctionCollection,
		junctionField,
		junctionFieldItem,
		junctionFieldCollection,
		relation,
		otherRelation: itemRelation,
	};
}

export type OptionsCreateItem = {
	collection: string;
	item: any;
	token?: string;
};

export async function CreateItem(vendor: Vendor, options: OptionsCreateItem) {
	// Seed on the cache server (fast, cached schema). Right after CreateCollections it
	// can serve a stale schema snapshot and 403 the brand-new collection under
	// concurrent seed load (TESTS_FLOW is admin_access, so it's schema lag, not a
	// permission gap). Fall back to the no-cache instance, which recomputes the schema
	// from the DB every request, so the just-created collection is always visible.
	const auth = `Bearer ${options.token ?? USER.TESTS_FLOW.TOKEN}`;

	let response = await request(getUrl(vendor))
		.post(`/items/${options.collection}`)
		.set('Authorization', auth)
		.send(options.item);

	if (response.status === 403) {
		response = await request(getNoCacheUrl(vendor))
			.post(`/items/${options.collection}`)
			.set('Authorization', auth)
			.send(options.item);
	}

	return dataOrThrow(response, `item in "${options.collection}"`);
}

export type OptionsReadItem = {
	collection: string;
} & Query;

export async function ReadItem(vendor: Vendor, options: OptionsReadItem) {
	// Parse options
	const defaultOptions = {
		filter: {},
		fields: '*',
	};

	options = Object.assign({}, defaultOptions, options);

	// Action
	const response = await request(getUrl(vendor))
		.get(`/items/${options.collection}`)
		.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`)
		.query(omit(options, 'collection'));

	return response.body.data;
}

export type OptionsUpdateItem = {
	id?: string | number;
	collection: string;
	item: any;
};

export async function UpdateItem(vendor: Vendor, options: OptionsUpdateItem) {
	// Action
	const response = await request(getUrl(vendor))
		.patch(`/items/${options.collection}/${options.id === undefined ? '' : options.id}`)
		.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`)
		.send(options.item);

	return dataOrThrow(response, `item update in "${options.collection}"`);
}

export type OptionsCreatePolicy = {
	name: string;
	appAccessEnabled: boolean;
	adminAccessEnabled: boolean;
	role?: keyof typeof ROLE;
};

export async function CreatePolicy(vendor: Vendor, options: OptionsCreatePolicy) {
	// Action
	const roleResponse = await request(getUrl(vendor))
		.get(`/policies`)
		.query({
			filter: { name: { _eq: options.name } },
		})
		.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`);

	if (roleResponse.body.data.length > 0) {
		return roleResponse.body.data[0];
	}

	let roleId = options.role;

	if (roleId && roleId in ROLE) {
		const role = await request(getUrl(vendor))
			.get('/roles')
			.query({ filter: { name: { _eq: ROLE[roleId].NAME } } })
			.set('Authorization', `Bearer ${USER.APP_ACCESS.TOKEN}`);

		roleId = role.body.data[0].id;
	}

	const response = await request(getUrl(vendor))
		.post(`/policies`)
		.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`)
		.send({
			name: options.name,
			app_access: options.appAccessEnabled,
			admin_access: options.adminAccessEnabled,
			roles: [{ role: roleId }],
		});

	return dataOrThrow(response, `policy "${options.name}"`);
}

export type OptionsCreatePermission = {
	role: keyof typeof ROLE;
	permission: Omit<Partial<Permission>, 'id' | 'role' | 'system'>;
	policy?: string;
	policyName?: string;
};

export async function CreatePermission(vendor: Vendor, options: OptionsCreatePermission) {
	let policyId = options.policy;
	let roleId = options.role;

	if (roleId in ROLE) {
		const role = await request(getUrl(vendor))
			.get('/roles')
			.query({ filter: { name: { _eq: ROLE[roleId].NAME } } })
			.set('Authorization', `Bearer ${USER.APP_ACCESS.TOKEN}`);

		roleId = role.body.data[0].id;
	}

	if (!policyId) {
		const policy = await CreatePolicy(vendor, {
			role: roleId,
			adminAccessEnabled: false,
			appAccessEnabled: false,
			name: options.policyName ? `${options.role}-${options.policyName}` : `${options.role}-${randomUUID()}`,
		});

		policyId = policy.id;
	}

	const response = await request(getUrl(vendor))
		.patch(`/policies/${policyId}`)
		.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`)
		.send({ permissions: { create: [{ ...options.permission, policy: options.policy }], update: [], delete: [] } });

	return dataOrThrow(response, `permission on policy "${options.policy}"`);
}

// TODO
// export async function UpdatePermission() {}
// export async function DeletePermission() {}
