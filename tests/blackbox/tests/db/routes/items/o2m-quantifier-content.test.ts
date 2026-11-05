import { defineFeature, loadFeature } from '@common/cucumber';
import { getUrl } from '@common/config';
import vendors from '@common/get-dbs-to-test';
import { describe } from 'vitest';
import { defineNestedWriteSteps } from './nested-o2m-steps';

const feature = loadFeature(
	'./tests/db/routes/items/o2m-quantifier-content.feature',
);

describe.each(vendors)('%s', (vendor) => {
	defineFeature(feature, (scenario) => {
		for (const title of [
			'a _some with one condition keeps every parent a link matches',
			'a _some with two conditions needs one link matching both',
			'a _some over an _and needs one link matching both',
			'a _none with two conditions excludes only a link matching both',
			'a _none over an _or excludes a link matching either',
		]) {
			scenario(title, (steps) => {
				defineNestedWriteSteps(steps, vendor, () => getUrl(vendor));
			});
		}
	});
});
