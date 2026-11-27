import { assertType, describe, test } from 'vitest';
import type { DirectusUser, DirectusUserPayload } from '../src/index.js';

describe('a user reads its emails through identities', () => {
	test('the user holds a primary identity and no email', () => {
		assertType<Pick<DirectusUser<any>, 'primary_identity' | 'identities'>>({
			primary_identity: {
				id: '4f1f6f0e-9a59-4c5e-8d4b-0c2a6f0d1e11',
				user: '0bc7b36a-9ba9-4ce0-83f0-0a526f354e07',
				kind: 'email',
				value: 'ada@example.com',
				verified: true,
				auth_data: null,
				user_info: null,
				scope: null,
			},
			identities: ['4f1f6f0e-9a59-4c5e-8d4b-0c2a6f0d1e11'],
		});

		// @ts-expect-error the email lives on the user's identities
		assertType<DirectusUser<any>['email']>('ada@example.com');
	});

	test('a create or update body still takes an email', () => {
		assertType<DirectusUserPayload<any>>({ email: 'ada@example.com' });
	});
});
