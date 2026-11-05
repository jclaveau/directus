import { defineBundleApi } from '@directus/extensions-sdk/scalabus';
import { subscriptionsEndpoint } from './endpoint.js';
import { subscriptionsHook } from './hook.js';
import {
	createSubscriptionTables,
} from './migrations/create-subscription-tables.js';

export default defineBundleApi([
	createSubscriptionTables,
	subscriptionsHook,
	subscriptionsEndpoint,
]);
