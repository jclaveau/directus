import { expect, it } from 'vitest';
import { removeIdentity } from '../src/rest/commands/utils/users.js';

it('removeIdentity deletes the identity on the authenticated user', () => {
	expect(removeIdentity('4f1f6f0e-9a59-4c5e-8d4b-0c2a6f0d1e11')()).toEqual({
		method: 'DELETE',
		path: '/users/me/identities/4f1f6f0e-9a59-4c5e-8d4b-0c2a6f0d1e11',
	});
});

it('removeIdentity refuses an empty identity', () => {
	expect(() => removeIdentity('')()).toThrow(new Error('Identity cannot be empty'));
});
