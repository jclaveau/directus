import { describe, expect, test, vi } from 'vitest';
import bundleApp from './app.js';

vi.mock('./module/subscriptions-module.vue', () => ({ default: {} }));

describe('bundle app', () => {
	// An app entry named like an api one makes the app drop every entry of the
	// bundle: the endpoint already holds "subscriptions-examples".
	test('names its module apart from the endpoint, routed at the same id', () => {
		expect(bundleApp.entries).toEqual([{
			type: 'module',
			name: 'subscriptions-examples-module',
			config: {
				id: 'subscriptions-examples',
				name: 'Subscriptions',
				icon: 'card_membership',
				routes: [{ path: '', component: {} }],
			},
		}]);
	});
});
