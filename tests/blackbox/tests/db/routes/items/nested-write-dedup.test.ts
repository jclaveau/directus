import { getUrl } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { describe } from 'vitest';
import { defineNestedWriteSteps } from './nested-o2m-steps';

const feature = loadFeature(
	'./tests/db/routes/items/nested-write-dedup.feature',
);

describe.each(vendors)('%s', (vendor) => {
	defineFeature(feature, (scenario) => {
		for (const { title } of feature.scenarios) {
			scenario(title, (steps) => {
				defineNestedWriteSteps(steps, vendor, () => {
					return getUrl(vendor);
				});
			});
		}
	});
});
