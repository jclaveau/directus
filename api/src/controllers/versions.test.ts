import { beforeEach, describe, expect, test, vi } from 'vitest';

const createMany = vi.fn();
const updateBatch = vi.fn();
const readMany = vi.fn();

vi.mock('../services/versions.js', () => {
	return {
		VersionsService: vi.fn(function () {
			return { createMany, updateBatch, readMany };
		}),
	};
});

vi.mock('../services/meta.js', () => ({ MetaService: vi.fn() }));
vi.mock('../middleware/respond.js', () => ({ respond: vi.fn() }));

const { default: router } = await import('./versions.js');

describe('versions controller', () => {
	beforeEach(() => vi.clearAllMocks());

	test('passes mutationBatching to the batch create', async () => {
		createMany.mockResolvedValue([1, 2]);
		readMany.mockResolvedValue([]);

		await router.stack.findLast(
			(l: any) => l.route?.path === '/' && l.route.methods['post'],
		)!.route!.stack[0]!.handle(
			{
				accountability: null,
				schema: {},
				body: [{ name: 'a' }, { name: 'b' }],
				query: { mutationBatching: 'disableBatching' },
				sanitizedQuery: {},
			} as any,
			{ locals: {} } as any,
			vi.fn(),
		);

		expect(createMany).toHaveBeenCalledWith(
			[{ name: 'a' }, { name: 'b' }],
			{ mutationBatching: 'disableBatching' },
		);
	});

	test('passes mutationBatching to the batch update', async () => {
		updateBatch.mockResolvedValue([1, 2]);
		readMany.mockResolvedValue([]);

		await router.stack.find(
			(l: any) => l.route?.path === '/' && l.route.methods['patch'],
		)!.route!.stack[1]!.handle(
			{
				accountability: null,
				schema: {},
				body: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }],
				query: { mutationBatching: 'disableBatching' },
				sanitizedQuery: {},
			} as any,
			{ locals: {} } as any,
			vi.fn(),
		);

		expect(updateBatch).toHaveBeenCalledWith(
			[{ id: 1, name: 'a' }, { id: 2, name: 'b' }],
			{ mutationBatching: 'disableBatching' },
		);
	});
});
