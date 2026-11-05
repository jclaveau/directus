import { defineFeature, loadFeature } from '@common/cucumber';
import { getUrl } from '@common/config';
import vendors from '@common/get-dbs-to-test';
import { describe } from 'vitest';
import { defineNestedWriteSteps } from './nested-o2m-steps';

const feature = loadFeature('./tests/db/routes/items/aggregate-o2m-some.feature');

describe.each(vendors)('%s', (vendor) => {
	defineFeature(feature, (scenario) => {
		for (const title of [
			'a count filtered by _some counts a parent with two links once',
			'a count filtered by _none counts a parent with two links once',
			'a count filtered through an o2m field without a quantifier '
				+ 'counts a parent with two links once',
		]) {
			scenario(title, (steps) => {
				defineNestedWriteSteps(steps, vendor, () => getUrl(vendor));
			});
		}
	});
});
