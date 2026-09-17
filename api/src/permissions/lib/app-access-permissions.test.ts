import { appAccessMinimalPermissions } from '@directus/system-data';
import { expect, test } from 'vitest';

// The one implicit grant a target reads their trail through
test('the app-access grant on the activity trail hides the impersonator', () => {
	const grant = appAccessMinimalPermissions.find((permission) => {
		return permission.collection === 'directus_activity'
			&& permission.action === 'read';
	});

	expect(grant!.fields).not.toContain('*');
	expect(grant!.fields).not.toContain('impersonator');

	expect(grant!.fields)
		.toEqual(expect.arrayContaining(['id', 'action', 'user', 'item']));
});
