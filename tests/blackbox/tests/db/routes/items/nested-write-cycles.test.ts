import { getUrl } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { describe } from 'vitest';
import { defineNestedWriteSteps } from './nested-o2m-steps';

const feature = loadFeature('./tests/db/routes/items/nested-write-cycles.feature');

describe.each(vendors)('%s', (vendor) => {
	defineFeature(feature, (scenario) => {
		for (const title of [
			'a child updates the row a child before it created as its nested child',
			'a child links to a child created before it',
			'a child nests a row pointing back at a child created before it',
			'the last of two children naming one row by key gets it',
			'a created row nests a row pointing back at a row created before it',
		]) {
			scenario(title, (steps) => {
				defineNestedWriteSteps(steps, vendor, () => getUrl(vendor));
			}, 60_000);
		}
	});
});
