import { generateRouter } from '@/__utils__/router';
import { flushPromises, mount } from '@vue/test-utils';
import { expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import UserPopover from './user-popover.vue';

vi.mock('@/api', () => {
	return {
		default: {
			get: vi.fn(async () => {
				return {
					data: {
						data: {
							id: 'user-1',
							first_name: 'Alice',
							status: 'active',
							email: 'alice@example.com',
							roles: [
								{ id: 'membership-1', role: { name: 'Staff' } },
								{ id: 'membership-2', role: null },
							],
						},
					},
				};
			}),
		},
	};
});

const i18n = createI18n({
	legacy: false,
	locale: 'en',
	missingWarn: false,
	fallbackWarn: false,
});

test('a member role the viewer cannot read renders no chip', async () => {
	const wrapper = mount(UserPopover, {
		props: { user: 'user-1' },
		global: {
			plugins: [i18n, generateRouter()],
			stubs: {
				'v-menu': {
					emits: ['update:modelValue'],
					mounted() {
						this.$emit('update:modelValue', true);
					},
					template: '<div><slot /></div>',
				},
				'v-avatar': true,
				'v-image': true,
				'v-icon': true,
				'v-skeleton-loader': true,
				'v-chip': { template: '<span class="chip"><slot /></span>' },
			},
		},
	});

	await flushPromises();

	const chips = wrapper.findAll('.chip');

	expect(chips).toHaveLength(2);
	expect(chips[1]!.text()).toBe('Staff');
});
