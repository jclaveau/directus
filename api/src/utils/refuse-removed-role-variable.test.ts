import { describe, expect, test } from 'vitest';
import {
	findRemovedRoleVariable,
	refuseRemovedRoleVariableInFilter,
	refuseRemovedRoleVariableInPayload,
} from './refuse-removed-role-variable.js';

describe('findRemovedRoleVariable', () => {
	test.each([
		['$CURRENT_ROLE', '$CURRENT_ROLE'],
		['$CURRENT_ROLE.name', '$CURRENT_ROLE.name'],
		['$CURRENT_ROLES', null],
		['$CURRENT_MEMBER_ROLES', null],
		['$CURRENT_ROLEX', null],
		[{ role: { _eq: '$CURRENT_ROLE' } }, '$CURRENT_ROLE'],
		[
			{ _or: [{ a: { _eq: 1 } }, { b: { _in: ['$CURRENT_ROLE'] } }] },
			'$CURRENT_ROLE',
		],
		[{ role: { _in: '$CURRENT_MEMBER_ROLES' } }, null],
		[null, null],
		[12, null],
	])('%j → %j', (value, expected) => {
		expect(findRemovedRoleVariable(value)).toEqual(expected);
	});
});

describe('refuseRemovedRoleVariableInPayload', () => {
	test('refuses a permission rule using $CURRENT_ROLE', () => {
		expect(() => {
			refuseRemovedRoleVariableInPayload('directus_permissions', {
				permissions: { role: { _eq: '$CURRENT_ROLE' } },
			});
		}).toThrow(expect.objectContaining({
			message: 'Invalid payload. Field "permissions" uses "$CURRENT_ROLE":'
				+ ' "$CURRENT_ROLE" was removed, a user can hold several roles:'
				+ ' use "$CURRENT_MEMBER_ROLES" with "_in" or "_nin".',
		}));
	});

	test('refuses a field option sent as JSON text', () => {
		expect(() => {
			refuseRemovedRoleVariableInPayload('directus_fields', {
				options: '{"filter":{"role":{"_eq":"$CURRENT_ROLE.name"}}}',
			});
		}).toThrow(expect.objectContaining({
			message: 'Invalid payload. Field "options" uses "$CURRENT_ROLE.name":'
				+ ' "$CURRENT_ROLE" was removed, a user can hold several roles:'
				+ ' use "$CURRENT_MEMBER_ROLES" with "_in" or "_nin".',
		}));
	});

	test('accepts a text option that is not JSON', () => {
		expect(() => {
			refuseRemovedRoleVariableInPayload('directus_operations', {
				options: 'plain text',
			});
		}).not.toThrow();
	});

	test('leaves the string alone in a collection holding data', () => {
		expect(() => {
			refuseRemovedRoleVariableInPayload('articles', {
				permissions: '$CURRENT_ROLE',
			});
		}).not.toThrow();
	});
});

describe('refuseRemovedRoleVariableInFilter', () => {
	test('refuses a query filter using $CURRENT_ROLE', () => {
		expect(() => {
			refuseRemovedRoleVariableInFilter({ role: { _eq: '$CURRENT_ROLE' } });
		}).toThrow(expect.objectContaining({
			message: 'Invalid query. The filter uses "$CURRENT_ROLE":'
				+ ' "$CURRENT_ROLE" was removed, a user can hold several roles:'
				+ ' use "$CURRENT_MEMBER_ROLES" with "_in" or "_nin".',
		}));
	});

	test('accepts $CURRENT_MEMBER_ROLES', () => {
		expect(() => {
			refuseRemovedRoleVariableInFilter({
				role: { _in: '$CURRENT_MEMBER_ROLES' },
			});
		}).not.toThrow();
	});
});
