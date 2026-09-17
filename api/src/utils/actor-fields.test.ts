import { expect, test } from 'vitest';
import {
	createDefaultAccountability,
} from '../permissions/utils/create-default-accountability.js';
import { actorFields } from './actor-fields.js';

test('copies the four actor columns off the accountability', () => {
	expect(
		actorFields(
			createDefaultAccountability({
				user: 'user-1',
				ip: '10.0.0.1',
				userAgent: 'curl/8',
				origin: 'https://example.com',
			}),
		),
	).toEqual({
		user: 'user-1',
		ip: '10.0.0.1',
		user_agent: 'curl/8',
		origin: 'https://example.com',
		impersonator: null,
	});
});

test('names the impersonator beside the user it acts as', () => {
	expect(
		actorFields(
			createDefaultAccountability({ user: 'target', impersonator: 'admin' }),
		),
	).toMatchObject({ user: 'target', impersonator: 'admin' });
});

test('writes null, not undefined, for every missing attribute', () => {
	expect(actorFields(null)).toEqual({
		user: null,
		ip: null,
		user_agent: null,
		origin: null,
		impersonator: null,
	});

	expect(actorFields(createDefaultAccountability())).toEqual({
		user: null,
		ip: null,
		user_agent: null,
		origin: null,
		impersonator: null,
	});
});
