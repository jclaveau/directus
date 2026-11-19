import { fetchAll } from '@/utils/fetch-all';
import { createTestingPinia } from '@pinia/testing';
import { setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { usePresetsStore } from './presets';
import { useUserStore } from './user';

vi.mock('@/api');
vi.mock('@/utils/fetch-all');

beforeEach(() => {
	setActivePinia(
		createTestingPinia({
			createSpy: vi.fn,
			stubActions: false,
		}),
	);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('hydrate', () => {
	test('fetches the user, role and global presets', async () => {
		useUserStore().currentUser = {
			id: 'user-1',
			role: { id: 'role-1' },
		} as any;

		vi.mocked(fetchAll).mockResolvedValue([]);

		await usePresetsStore().hydrate();

		expect(vi.mocked(fetchAll).mock.calls).toEqual([
			[
				'/presets',
				{
					params: {
						'filter[user][_eq]': 'user-1',
					},
				},
			],
			[
				'/presets',
				{
					params: {
						'filter[role][_eq]': 'role-1',
						'filter[user][_null]': true,
					},
				},
			],
			[
				'/presets',
				{
					params: {
						'filter[role][_null]': true,
						'filter[user][_null]': true,
					},
				},
			],
		]);
	});

	test('skips the role presets of a user with no role', async () => {
		useUserStore().currentUser = {
			id: 'user-1',
			role: null,
		} as any;

		vi.mocked(fetchAll).mockResolvedValue([]);

		await usePresetsStore().hydrate();

		expect(vi.mocked(fetchAll).mock.calls).toEqual([
			[
				'/presets',
				{
					params: {
						'filter[user][_eq]': 'user-1',
					},
				},
			],
			[
				'/presets',
				{
					params: {
						'filter[role][_null]': true,
						'filter[user][_null]': true,
					},
				},
			],
		]);
	});
});

describe('getPresetForCollection', () => {
	test('prefers the role preset to the global one', () => {
		useUserStore().currentUser = {
			id: 'user-1',
			role: { id: 'role-1' },
		} as any;

		const presetsStore = usePresetsStore();

		presetsStore.collectionPresets = [
			{
				id: 1,
				collection: 'articles',
				user: null,
				role: null,
				bookmark: null,
			},
			{
				id: 2,
				collection: 'articles',
				user: null,
				role: 'role-1',
				bookmark: null,
			},
			{
				id: 3,
				collection: 'articles',
				user: null,
				role: 'role-2',
				bookmark: null,
			},
		] as any;

		expect(presetsStore.getPresetForCollection('articles')).toEqual({
			id: 2,
			collection: 'articles',
			user: null,
			role: 'role-1',
			bookmark: null,
		});
	});

	test('prefers the user preset to the role one', () => {
		useUserStore().currentUser = {
			id: 'user-1',
			role: { id: 'role-1' },
		} as any;

		const presetsStore = usePresetsStore();

		presetsStore.collectionPresets = [
			{
				id: 1,
				collection: 'articles',
				user: null,
				role: 'role-1',
				bookmark: null,
			},
			{
				id: 2,
				collection: 'articles',
				user: 'user-1',
				role: null,
				bookmark: null,
			},
		] as any;

		expect(presetsStore.getPresetForCollection('articles')).toEqual({
			id: 2,
			collection: 'articles',
			user: 'user-1',
			role: null,
			bookmark: null,
		});
	});
});
