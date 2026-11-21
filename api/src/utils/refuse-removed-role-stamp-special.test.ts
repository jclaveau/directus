import { describe, expect, test } from 'vitest';
import {
	refuseRemovedRoleStampSpecial,
} from './refuse-removed-role-stamp-special.js';

describe('refuseRemovedRoleStampSpecial', () => {
	test('refuses a field listing role-created', () => {
		expect(() => {
			refuseRemovedRoleStampSpecial('directus_fields', {
				collection: 'articles',
				field: 'made_by_role',
				special: ['cast-json', 'role-created'],
			});
		}).toThrow(expect.objectContaining({
			message: 'Invalid payload. Field "made_by_role" of collection'
				+ ' "articles" uses the removed special "role-created": a user'
				+ ' can hold several roles, use "roles-created" on a json field.',
		}));
	});

	test('refuses role-updated sent as the stored comma separated text', () => {
		expect(() => {
			refuseRemovedRoleStampSpecial('directus_fields', {
				collection: 'articles',
				field: 'changed_by_role',
				special: 'cast-json,role-updated',
			});
		}).toThrow(expect.objectContaining({
			message: 'Invalid payload. Field "changed_by_role" of collection'
				+ ' "articles" uses the removed special "role-updated": a user'
				+ ' can hold several roles, use "roles-updated" on a json field.',
		}));
	});

	test('names a field and collection the payload leaves out as null', () => {
		expect(() => {
			refuseRemovedRoleStampSpecial('directus_fields', {
				special: ['role-created'],
			});
		}).toThrow(expect.objectContaining({
			message: 'Invalid payload. Field null of collection null uses the'
				+ ' removed special "role-created": a user can hold several roles,'
				+ ' use "roles-created" on a json field.',
		}));
	});

	test.each([
		['the new specials', 'directus_fields', { special: ['roles-created'] }],
		['no special', 'directus_fields', { special: null }],
		['a special that is no text', 'directus_fields', { special: [12] }],
		['a name of the object prototype', 'directus_fields', {
			special: 'toString',
		}],
		['another collection', 'articles', { special: ['role-created'] }],
	])('lets %s through', (_case, collection, payload) => {
		expect(() => {
			refuseRemovedRoleStampSpecial(collection, payload);
		}).not.toThrow();
	});
});
