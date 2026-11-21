import { defineBundleApi } from '@directus/extensions-sdk/scalabus';
import { subscriptionsExamplesEndpoint } from './endpoint.js';
import { seedExamples } from './migrations/seed-examples.js';

export default defineBundleApi([
	seedExamples,
	subscriptionsExamplesEndpoint,
]);
