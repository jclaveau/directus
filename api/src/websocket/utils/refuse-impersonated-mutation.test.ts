import type { Accountability } from '@directus/types';
import { beforeEach, expect, test, vi } from 'vitest';
import { refuseImpersonatedMutation } from './refuse-impersonated-mutation.js';

const env = vi.hoisted(() => ({} as Record<string, unknown>));
vi.mock('@directus/env', () => ({ useEnv: () => env }));

const impersonated = { user: 'jane', impersonator: 'admin' } as Accountability;
const own = { user: 'jane' } as Accountability;

const write = '{ delete_articles_item(id: 1) { id } }';
const read = '{ articles { id } }';
const mutation = `mutation ${write}`;
const query = read;

beforeEach(() => {
	delete env['IMPERSONATION_WRITES'];
});

test('a mutation under impersonation is refused while writes are off', () => {
	const errors = refuseImpersonatedMutation(impersonated, { query: mutation });

	expect(errors).toHaveLength(1);
	expect(errors![0]!.message).toContain('impersonation_read_only');
});

test('the named operation decides in a multi-operation document', () => {
	const document = `query Read ${read} mutation Write ${write}`;

	expect(refuseImpersonatedMutation(
		impersonated,
		{ query: document, operationName: 'Read' },
	))
		.toBeUndefined();

	expect(refuseImpersonatedMutation(
		impersonated,
		{ query: document, operationName: 'Write' },
	))
		.toHaveLength(1);
});

test.each([
	['a query under impersonation', impersonated, query],
	['a mutation by the user themselves', own, mutation],
	['a mutation by nobody', null, mutation],
	['a document that does not parse', impersonated, 'mutation {'],
])('%s passes to the server', (_, accountability, document) => {
	expect(refuseImpersonatedMutation(accountability, { query: document }))
		.toBeUndefined();
});

test('a mutation under impersonation runs once writes are on', () => {
	env['IMPERSONATION_WRITES'] = true;

	expect(refuseImpersonatedMutation(impersonated, { query: mutation }))
		.toBeUndefined();
});
