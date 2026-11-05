import { defineFeature, loadFeature } from '@common/cucumber';
import { getUrl } from '@common/config';
import vendors from '@common/get-dbs-to-test';
import { describe } from 'vitest';
import { defineNestedWriteSteps } from './nested-o2m-steps';

const feature = loadFeature(
	'./tests/db/routes/items/read-mixed-permission-cases.feature',
);

describe.each(vendors)('%s', (vendor) => {
	defineFeature(feature, (scenario) => {
		scenario(
			'a field granted through a relation reads beside fields granted on every row',
			(steps) => {
				defineNestedWriteSteps(steps, vendor, () => getUrl(vendor));
			},
		);
	});
});
