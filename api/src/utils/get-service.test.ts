import { ForbiddenError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import knex, { type Knex } from 'knex';
import { MockClient } from 'knex-mock-client';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getService } from './get-service.js';

vi.mock('../database/index.js', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

const schema = new SchemaBuilder().build();

let db: Knex;

beforeAll(() => {
	db = knex.default({ client: MockClient });
});

describe('Utils / getService', () => {
	it('should throw ForbiddenError for an unhandled directus_* collection', () => {
		expect(() => getService('directus_unknown', { knex: db, schema })).toThrowError(ForbiddenError);

		expect(() => getService('directus_unknown', { knex: db, schema })).toThrowError(
			'Forbidden access to directus_* collections',
		);
	});
});
