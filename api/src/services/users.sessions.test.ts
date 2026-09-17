import { SchemaBuilder } from '@directus/schema-builder';
import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { expect, test, vi } from 'vitest';
import { endSessions } from '../utils/end-sessions.js';
import { UsersService } from './users.js';

// users.test.ts spies clearUserSessions away; what it hands endSessions is here.

vi.mock('../database/index.js', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

vi.mock('./mail', () => ({ MailService: vi.fn() }));

vi.mock('@directus/env', () => {
	return { useEnv: () => ({ EMAIL_TEMPLATES_PATH: './templates' }) };
});

vi.mock('../utils/end-sessions.js', () => ({ endSessions: vi.fn() }));

test('clears sessions through endSessions, sparing the caller', async () => {
	const db = knex.default({ client: MockClient });
	const schema = new SchemaBuilder().build();
	const service = new UsersService({ knex: db, schema }) as any;

	await service.clearUserSessions(['user-1'], 'here');

	expect(endSessions).toHaveBeenCalledWith(db, {
		users: ['user-1'],
		exceptToken: 'here',
	});
});
