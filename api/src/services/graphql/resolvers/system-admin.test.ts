import { oneLine } from '@directus/utils';
import { SchemaComposer } from 'graphql-compose';
import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { afterEach, describe, expect, test, vi } from 'vitest';

// graphql-compose requires graphql's CommonJS build while vite hands the source
// the ESM one, so its instanceof checks refuse every type system-admin.ts builds.
vi.mock('graphql', async () => {
	const { createRequire } = await import('node:module');

	return createRequire(import.meta.url)('graphql');
});

vi.mock('../../../database/index.js', () => ({ default: vi.fn() }));

vi.mock('../../collections.js', () => {
	return {
		CollectionsService: class {
			async createOne() {}
			async updateOne() {}
			async readOne() {}
			async deleteOne() {}
		},
	};
});

vi.mock('../../fields.js', () => {
	return {
		FieldsService: class {
			async createField() {}
			async updateField() {}
			async deleteField() {}
			async readOne() {}
		},
	};
});

vi.mock('../../relations.js', () => {
	return {
		RelationsService: class {
			async createOne() {}
			async updateOne() {}
			async deleteOne() {}
			async readOne() {}
		},
	};
});

vi.mock('../../extensions.js', () => {
	return {
		ExtensionsService: class {
			async readAll() {}
			async updateOne() {}
			async readOne() {}
		},
	};
});

import { CollectionsService } from '../../collections.js';
import { ExtensionsService } from '../../extensions.js';
import { FieldsService } from '../../fields.js';
import { RelationsService } from '../../relations.js';
import { GraphQLService } from '../index.js';
import { resolveSystemAdmin } from './system-admin.js';

afterEach(() => {
	vi.restoreAllMocks();
});

const emptySchema = {
	read: { collections: {} },
	create: { collections: {} },
	update: { collections: {} },
	delete: { collections: {} },
} as any;

describe('resolveSystemAdmin', () => {
	test('adds nothing for a non-admin', () => {
		const gql = new GraphQLService({
			knex: knex({ client: MockClient }),
			schema: { collections: {} } as any,
			accountability: { user: 'user-1', role: null, roles: [], admin: false } as any,
			scope: 'system',
		});

		const schemaComposer = new SchemaComposer();

		resolveSystemAdmin(gql, emptySchema, schemaComposer);

		expect(schemaComposer.Mutation.getFieldNames()).toEqual([]);
	});

	test(oneLine`
		create_collections_item creates, then reads the new collection
	`, async () => {
		const gql = new GraphQLService({
			knex: knex({ client: MockClient }),
			schema: { collections: {} } as any,
			accountability: { user: 'admin-1', role: null, roles: [], admin: true } as any,
			scope: 'system',
		});

		const schemaComposer = new SchemaComposer();
		resolveSystemAdmin(gql, emptySchema, schemaComposer);

		const createOneSpy = vi
			.spyOn(CollectionsService.prototype, 'createOne')
			.mockResolvedValue('articles');

		const readOneSpy = vi
			.spyOn(CollectionsService.prototype, 'readOne')
			.mockResolvedValue({ collection: 'articles', meta: null, schema: null });

		const resolved = await schemaComposer.Mutation.getFieldConfig(
			'create_collections_item',
		).resolve!(undefined, { data: { collection: 'articles' } }, {}, {} as any);

		expect(resolved).toEqual({ collection: 'articles', meta: null, schema: null });
		expect(createOneSpy).toHaveBeenCalledWith({ collection: 'articles' });
		expect(readOneSpy).toHaveBeenCalledWith('articles');
	});

	test(oneLine`
		create_collections_item keeps the collection and schema the update strips
	`, () => {
		const gql = new GraphQLService({
			knex: knex({ client: MockClient }),
			schema: { collections: {} } as any,
			accountability: { user: 'admin-1', role: null, roles: [], admin: true } as any,
			scope: 'system',
		});

		const schemaComposer = new SchemaComposer();

		resolveSystemAdmin(gql, {
			...emptySchema,
			read: { collections: { directus_collections: { fields: {} } } },
		}, schemaComposer);

		expect(
			schemaComposer.Mutation
				.getFieldArgITC('create_collections_item', 'data')
				.getFieldNames(),
		).toEqual(['collection', 'meta', 'schema', 'fields']);

		expect(
			schemaComposer.Mutation
				.getFieldArgITC('update_collections_item', 'data')
				.getFieldNames(),
		).toEqual(['meta', 'fields']);
	});

	test('update_collections_item updates, then reads the collection', async () => {
		const gql = new GraphQLService({
			knex: knex({ client: MockClient }),
			schema: { collections: {} } as any,
			accountability: { user: 'admin-1', role: null, roles: [], admin: true } as any,
			scope: 'system',
		});

		const schemaComposer = new SchemaComposer();
		resolveSystemAdmin(gql, emptySchema, schemaComposer);

		const updateOneSpy = vi
			.spyOn(CollectionsService.prototype, 'updateOne')
			.mockResolvedValue('articles');

		const readOneSpy = vi
			.spyOn(CollectionsService.prototype, 'readOne')
			.mockResolvedValue({ collection: 'articles', meta: null, schema: null });

		const resolved = await schemaComposer.Mutation.getFieldConfig(
			'update_collections_item',
		).resolve!(
			undefined,
			{ collection: 'articles', data: { meta: { note: 'Blog posts' } } },
			{},
			{} as any,
		);

		expect(resolved).toEqual({ collection: 'articles', meta: null, schema: null });

		expect(updateOneSpy).toHaveBeenCalledWith('articles', {
			meta: { note: 'Blog posts' },
		});

		expect(readOneSpy).toHaveBeenCalledWith('articles');
	});

	test('delete_collections_item deletes and echoes the collection', async () => {
		const gql = new GraphQLService({
			knex: knex({ client: MockClient }),
			schema: { collections: {} } as any,
			accountability: { user: 'admin-1', role: null, roles: [], admin: true } as any,
			scope: 'system',
		});

		const schemaComposer = new SchemaComposer();
		resolveSystemAdmin(gql, emptySchema, schemaComposer);

		const deleteOneSpy = vi
			.spyOn(CollectionsService.prototype, 'deleteOne')
			.mockResolvedValue('articles');

		const resolved = await schemaComposer.Mutation.getFieldConfig(
			'delete_collections_item',
		).resolve!(undefined, { collection: 'articles' }, {}, {} as any);

		expect(resolved).toEqual({ collection: 'articles' });
		expect(deleteOneSpy).toHaveBeenCalledWith('articles');
	});

	test('create_fields_item creates, then reads the new field', async () => {
		const gql = new GraphQLService({
			knex: knex({ client: MockClient }),
			schema: { collections: {} } as any,
			accountability: { user: 'admin-1', role: null, roles: [], admin: true } as any,
			scope: 'system',
		});

		const schemaComposer = new SchemaComposer();
		resolveSystemAdmin(gql, emptySchema, schemaComposer);

		const createFieldSpy = vi
			.spyOn(FieldsService.prototype, 'createField')
			.mockResolvedValue(undefined);

		const readOneSpy = vi
			.spyOn(FieldsService.prototype, 'readOne')
			.mockResolvedValue({ collection: 'articles', field: 'title' } as any);

		const resolved = await schemaComposer.Mutation.getFieldConfig(
			'create_fields_item',
		).resolve!(
			undefined,
			{ collection: 'articles', data: { field: 'title', type: 'string' } },
			{},
			{} as any,
		);

		expect(resolved).toEqual({ collection: 'articles', field: 'title' });

		expect(createFieldSpy).toHaveBeenCalledWith('articles', {
			field: 'title',
			type: 'string',
		});

		expect(readOneSpy).toHaveBeenCalledWith('articles', 'title');
	});

	test('update_fields_item updates the named field, then reads it', async () => {
		const gql = new GraphQLService({
			knex: knex({ client: MockClient }),
			schema: { collections: {} } as any,
			accountability: { user: 'admin-1', role: null, roles: [], admin: true } as any,
			scope: 'system',
		});

		const schemaComposer = new SchemaComposer();
		resolveSystemAdmin(gql, emptySchema, schemaComposer);

		const updateFieldSpy = vi
			.spyOn(FieldsService.prototype, 'updateField')
			.mockResolvedValue('title');

		const readOneSpy = vi
			.spyOn(FieldsService.prototype, 'readOne')
			.mockResolvedValue({ collection: 'articles', field: 'title' } as any);

		const resolved = await schemaComposer.Mutation.getFieldConfig(
			'update_fields_item',
		).resolve!(
			undefined,
			{
				collection: 'articles',
				field: 'title',
				data: { field: 'title', meta: { note: 'Headline' } },
			},
			{},
			{} as any,
		);

		expect(resolved).toEqual({ collection: 'articles', field: 'title' });

		expect(updateFieldSpy).toHaveBeenCalledWith('articles', {
			field: 'title',
			meta: { note: 'Headline' },
		});

		expect(readOneSpy).toHaveBeenCalledWith('articles', 'title');
	});

	test(oneLine`
		update_fields_item reads back the field named by its arguments
	`, async () => {
		const gql = new GraphQLService({
			knex: knex({ client: MockClient }),
			schema: { collections: {} } as any,
			accountability: { user: 'admin-1', role: null, roles: [], admin: true } as any,
			scope: 'system',
		});

		const schemaComposer = new SchemaComposer();
		resolveSystemAdmin(gql, emptySchema, schemaComposer);

		vi.spyOn(FieldsService.prototype, 'updateField').mockResolvedValue('title');

		const readOneSpy = vi
			.spyOn(FieldsService.prototype, 'readOne')
			.mockResolvedValue({ collection: 'articles', field: 'title' } as any);

		await schemaComposer.Mutation.getFieldConfig('update_fields_item').resolve!(
			undefined,
			{
				collection: 'articles',
				field: 'title',
				data: { meta: { note: 'Headline' } },
			},
			{},
			{} as any,
		);

		expect(readOneSpy).toHaveBeenCalledWith('articles', 'title');
	});

	test('delete_fields_item deletes and echoes the field', async () => {
		const gql = new GraphQLService({
			knex: knex({ client: MockClient }),
			schema: { collections: {} } as any,
			accountability: { user: 'admin-1', role: null, roles: [], admin: true } as any,
			scope: 'system',
		});

		const schemaComposer = new SchemaComposer();
		resolveSystemAdmin(gql, emptySchema, schemaComposer);

		const deleteFieldSpy = vi
			.spyOn(FieldsService.prototype, 'deleteField')
			.mockResolvedValue(undefined);

		const resolved = await schemaComposer.Mutation.getFieldConfig(
			'delete_fields_item',
		).resolve!(undefined, { collection: 'articles', field: 'title' }, {}, {} as any);

		expect(resolved).toEqual({ collection: 'articles', field: 'title' });
		expect(deleteFieldSpy).toHaveBeenCalledWith('articles', 'title');
	});

	test('create_relations_item creates, then reads the new relation', async () => {
		const gql = new GraphQLService({
			knex: knex({ client: MockClient }),
			schema: { collections: {} } as any,
			accountability: { user: 'admin-1', role: null, roles: [], admin: true } as any,
			scope: 'system',
		});

		const schemaComposer = new SchemaComposer();
		resolveSystemAdmin(gql, emptySchema, schemaComposer);

		const createOneSpy = vi
			.spyOn(RelationsService.prototype, 'createOne')
			.mockResolvedValue(undefined);

		const readOneSpy = vi
			.spyOn(RelationsService.prototype, 'readOne')
			.mockResolvedValue({ collection: 'articles', field: 'author' } as any);

		const resolved = await schemaComposer.Mutation.getFieldConfig(
			'create_relations_item',
		).resolve!(
			undefined,
			{
				data: {
					collection: 'articles',
					field: 'author',
					related_collection: 'authors',
				},
			},
			{},
			{} as any,
		);

		expect(resolved).toEqual({ collection: 'articles', field: 'author' });

		expect(createOneSpy).toHaveBeenCalledWith({
			collection: 'articles',
			field: 'author',
			related_collection: 'authors',
		});

		expect(readOneSpy).toHaveBeenCalledWith('articles', 'author');
	});

	test(oneLine`
		update_relations_item updates the relation named by its arguments
	`, async () => {
		const gql = new GraphQLService({
			knex: knex({ client: MockClient }),
			schema: { collections: {} } as any,
			accountability: { user: 'admin-1', role: null, roles: [], admin: true } as any,
			scope: 'system',
		});

		const schemaComposer = new SchemaComposer();
		resolveSystemAdmin(gql, emptySchema, schemaComposer);

		const updateOneSpy = vi
			.spyOn(RelationsService.prototype, 'updateOne')
			.mockResolvedValue(undefined);

		vi.spyOn(RelationsService.prototype, 'readOne').mockResolvedValue({
			collection: 'articles',
			field: 'author',
		} as any);

		await schemaComposer.Mutation.getFieldConfig('update_relations_item').resolve!(
			undefined,
			{
				collection: 'articles',
				field: 'author',
				data: {
					collection: 'articles',
					field: 'author',
					meta: { sort_field: 'sort' },
				},
			},
			{},
			{} as any,
		);

		expect(updateOneSpy).toHaveBeenCalledWith('articles', 'author', {
			collection: 'articles',
			field: 'author',
			meta: { sort_field: 'sort' },
		});
	});

	test(oneLine`
		update_relations_item reads back the relation named by its arguments
	`, async () => {
		const gql = new GraphQLService({
			knex: knex({ client: MockClient }),
			schema: { collections: {} } as any,
			accountability: { user: 'admin-1', role: null, roles: [], admin: true } as any,
			scope: 'system',
		});

		const schemaComposer = new SchemaComposer();
		resolveSystemAdmin(gql, emptySchema, schemaComposer);

		vi.spyOn(RelationsService.prototype, 'updateOne').mockResolvedValue(undefined);

		const readOneSpy = vi
			.spyOn(RelationsService.prototype, 'readOne')
			.mockResolvedValue({ collection: 'articles', field: 'author' } as any);

		const resolved = await schemaComposer.Mutation.getFieldConfig(
			'update_relations_item',
		).resolve!(
			undefined,
			{
				collection: 'articles',
				field: 'author',
				data: { meta: { sort_field: 'sort' } },
			},
			{},
			{} as any,
		);

		expect(resolved).toEqual({ collection: 'articles', field: 'author' });
		expect(readOneSpy).toHaveBeenCalledWith('articles', 'author');
	});

	test('delete_relations_item deletes and echoes the relation', async () => {
		const gql = new GraphQLService({
			knex: knex({ client: MockClient }),
			schema: { collections: {} } as any,
			accountability: { user: 'admin-1', role: null, roles: [], admin: true } as any,
			scope: 'system',
		});

		const schemaComposer = new SchemaComposer();
		resolveSystemAdmin(gql, emptySchema, schemaComposer);

		const deleteOneSpy = vi
			.spyOn(RelationsService.prototype, 'deleteOne')
			.mockResolvedValue(undefined);

		const resolved = await schemaComposer.Mutation.getFieldConfig(
			'delete_relations_item',
		).resolve!(undefined, {
			collection: 'articles',
			field: 'author',
		}, {}, {} as any);

		expect(resolved).toEqual({ collection: 'articles', field: 'author' });
		expect(deleteOneSpy).toHaveBeenCalledWith('articles', 'author');
	});

	test('extensions lists every extension', async () => {
		const gql = new GraphQLService({
			knex: knex({ client: MockClient }),
			schema: { collections: {} } as any,
			accountability: { user: 'admin-1', role: null, roles: [], admin: true } as any,
			scope: 'system',
		});

		const schemaComposer = new SchemaComposer();
		resolveSystemAdmin(gql, emptySchema, schemaComposer);

		vi.spyOn(ExtensionsService.prototype, 'readAll').mockResolvedValue([
			{ id: 'extension-id', bundle: null, schema: null, meta: { enabled: true } },
		] as any);

		const resolved = await schemaComposer.Query
			.getFieldConfig('extensions')
			.resolve!(
			undefined,
			{},
			{},
			{} as any,
		);

		expect(resolved).toEqual([
			{ id: 'extension-id', bundle: null, schema: null, meta: { enabled: true } },
		]);
	});

	test('update_extensions_item updates, then reads the extension', async () => {
		const gql = new GraphQLService({
			knex: knex({ client: MockClient }),
			schema: { collections: {} } as any,
			accountability: { user: 'admin-1', role: null, roles: [], admin: true } as any,
			scope: 'system',
		});

		const schemaComposer = new SchemaComposer();
		resolveSystemAdmin(gql, emptySchema, schemaComposer);

		const updateOneSpy = vi
			.spyOn(ExtensionsService.prototype, 'updateOne')
			.mockResolvedValue({} as any);

		const readOneSpy = vi.spyOn(ExtensionsService.prototype, 'readOne')
			.mockResolvedValue({
			id: 'extension-id',
			bundle: null,
			schema: null,
			meta: { enabled: false },
		} as any);

		const resolved = await schemaComposer.Mutation.getFieldConfig(
			'update_extensions_item',
		).resolve!(
			undefined,
			{ id: 'extension-id', data: { meta: { enabled: false } } },
			{},
			{} as any,
		);

		expect(resolved).toEqual({
			id: 'extension-id',
			bundle: null,
			schema: null,
			meta: { enabled: false },
		});

		expect(updateOneSpy).toHaveBeenCalledWith('extension-id', {
			meta: { enabled: false },
		});

		expect(readOneSpy).toHaveBeenCalledWith('extension-id');
	});
});
