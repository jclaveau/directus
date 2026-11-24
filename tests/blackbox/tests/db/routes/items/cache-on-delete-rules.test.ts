import {
	DeleteCollection,
	DeleteCollectionIfPresent,
	DeleteFieldIfPresent,
} from '@common/functions';
import { USER } from '@common/variables';
import request from 'supertest';
import { expect } from 'vitest';
import { defineSpawnedWriteFeature } from '../system/spawned-write-steps';

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

// Each collection that hangs off another one, with the rule its foreign key
// carries; a parent comes before its children.
// TODO(#610): MariaDB refuses a table with ON DELETE SET DEFAULT.
const RELATED_COLLECTIONS = [
	{ collection: 'on_delete_task', field: null, parent: null, rule: null },
	{
		collection: 'on_delete_node',
		field: 'parent',
		parent: 'on_delete_node',
		rule: 'CASCADE',
	},
	{
		collection: 'on_delete_comment',
		field: 'task',
		parent: 'on_delete_task',
		rule: 'CASCADE',
	},
	{
		collection: 'on_delete_reaction',
		field: 'comment',
		parent: 'on_delete_comment',
		rule: 'CASCADE',
	},
	{
		collection: 'on_delete_link',
		field: 'task',
		parent: 'on_delete_task',
		rule: 'SET NULL',
	},
	{
		collection: 'on_delete_pin',
		field: 'task',
		parent: 'on_delete_task',
		rule: 'SET DEFAULT',
	},
	{
		collection: 'on_delete_lock',
		field: 'task',
		parent: 'on_delete_task',
		rule: 'RESTRICT',
	},
];

defineSpawnedWriteFeature(
	'./tests/db/routes/items/cache-on-delete-rules.feature',
	{
		envOverrides: {
			CACHE_ENABLED: 'true',
			CACHE_STATUS_HEADER: 'x-cache-status',
			CACHE_PURGED_TAGS_HEADER: 'x-scoped-cache-purged-tags',
			CACHE_AUTO_PURGE: 'true',
			CACHE_AUTO_PURGE_MODE: 'scoped',
			CACHE_STORE: 'redis',
			REDIS_HOST: 'localhost',
			REDIS_PORT: '6108',
			CACHE_NAMESPACE: 'directus-cache-on-delete-rules',
			CACHE_SCOPED_MAX_ON_DELETE_ROWS: '2',
		},
		// Created through the feature's own instance, so its schema holds them.
		async beforeFeature(vendor, instanceUrl) {
			await DeleteFieldIfPresent(vendor, {
				collection: 'on_delete_node',
				field: 'parent',
			});

			for (const { collection } of [...RELATED_COLLECTIONS].reverse()) {
				await DeleteCollectionIfPresent(vendor, { collection });
			}

			for (const { collection, field, parent, rule } of RELATED_COLLECTIONS) {
				const created = await request(instanceUrl)
					.post('/collections')
					.send({
						collection,
						schema: {},
						meta: { scoped_cache_fields: ['owner'] },
						fields: [
							{
								field: 'id',
								type: 'uuid',
								meta: { hidden: true, readonly: true, special: ['uuid'] },
								schema: {
									is_primary_key: true,
									length: 36,
									has_auto_increment: false,
								},
							},
							{ field: 'owner', type: 'string', meta: {} },
							...(field === null
								? []
								: [{ field, type: 'uuid', meta: {}, schema: {} }]),
						],
					})
					.set('Authorization', AUTH);

				expect(created.statusCode).toEqual(200);

				if (field === null) {
					continue;
				}

				const related = await request(instanceUrl)
					.post('/relations')
					.send({
						collection,
						field,
						related_collection: parent,
						schema: { on_delete: rule },
					})
					.set('Authorization', AUTH);

				expect(related.statusCode).toEqual(200);
			}
		},
		async afterFeature(vendor) {
			// Directus drops the table before its self foreign key, then fails on it.
			await DeleteFieldIfPresent(vendor, {
				collection: 'on_delete_node',
				field: 'parent',
			});

			for (const { collection } of [...RELATED_COLLECTIONS].reverse()) {
				await DeleteCollection(vendor, { collection });
			}
		},
	},
);
