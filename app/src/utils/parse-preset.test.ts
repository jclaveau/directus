import { createTestingPinia } from '@pinia/testing';
import { setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePreset } from './parse-preset';

beforeEach(() => {
	setActivePinia(
		createTestingPinia({
			createSpy: vi.fn,
			initialState: {
				userStore: {
					currentUser: {
						id: '1',
						roles: [{ id: 'm1', role: { id: '1', name: 'admin' } }],
						effectiveRoles: [{ id: '1' }],
						// Custom nested user field
						org: { name: 'Directus' },
					},
				},
			},
		}),
	);
});

describe('parse-preset', () => {
	it('Should return preset with populated variables', () => {
		const preset = {
			roles: '$CURRENT_MEMBER_ROLES',
			orgName: '$CURRENT_USER.org.name',
		};

		const parsedPreset = parsePreset(preset);

		expect(parsedPreset).toEqual({
			roles: ['1'],
			orgName: 'Directus',
		});
	});
});
