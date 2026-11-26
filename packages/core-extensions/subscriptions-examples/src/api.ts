import { defineBundleApi } from '@directus/extensions-sdk/scalabus';
import { subscriptionsExamplesEndpoint } from './endpoint.js';
import { seedExamples } from './migrations/seed-examples.js';
import { showExamplesModule } from './migrations/show-examples-module.js';

export default defineBundleApi([
	seedExamples,
	showExamplesModule,
	subscriptionsExamplesEndpoint,
]);
