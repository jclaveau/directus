import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { instanceUrlForFeature } from '@common/query-audit-steps';
import { describe } from 'vitest';
import { defineWriteSteps } from './write-steps';

const feature = loadFeature(
	'./tests/db/routes/items/write-unique-value.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const instanceUrl = instanceUrlForFeature(feature, vendor);

	defineFeature(feature, (scenario) => {
		for (const { title } of feature.scenarios) {
			scenario(title, (steps) => {
				defineWriteSteps(steps, vendor, instanceUrl);
			}, 60_000);
		}
	});
});
