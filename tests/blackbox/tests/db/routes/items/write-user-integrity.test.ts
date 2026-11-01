import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { describe } from 'vitest';
import { defineWriteSteps } from './write-steps';

const feature = loadFeature(
	'./tests/db/routes/items/write-user-integrity.feature',
);

describe.each(vendors)('%s', (vendor) => {
	defineFeature(feature, (scenario) => {
		for (const { title } of feature.scenarios) {
			scenario(title, (steps) => {
				defineWriteSteps(steps, vendor);
			}, 60_000);
		}
	});
});
