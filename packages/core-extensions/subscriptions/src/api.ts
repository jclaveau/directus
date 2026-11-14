import { defineBundleApi } from '@directus/extensions-sdk/scalabus';
import { subscriptionsEndpoint } from './endpoint.js';
import { subscriptionsHook } from './hook.js';
import {
	createParkedSyncsPreset,
} from './migrations/create-parked-syncs-preset.js';
import {
	createSubscriptionTables,
} from './migrations/create-subscription-tables.js';
import {
	showSubscriptionCollections,
} from './migrations/show-subscription-collections.js';

export default defineBundleApi([
	createSubscriptionTables,
	createParkedSyncsPreset,
	showSubscriptionCollections,
	subscriptionsHook,
	subscriptionsEndpoint,
]);
