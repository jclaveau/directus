import { defineBundleApp, defineModule } from '@directus/extensions-sdk/scalabus';
import SubscriptionsModule from './module/subscriptions-module.vue';

export default defineBundleApp([
	defineModule('subscriptions-examples-module', {
		id: 'subscriptions-examples',
		name: 'Subscriptions',
		icon: 'card_membership',
		routes: [{ path: '', component: SubscriptionsModule }],
	}),
]);
