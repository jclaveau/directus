import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { oneLine } from '@directus/utils';
import { describe } from 'vitest';
import { defineNestedWriteSteps } from './nested-o2m-steps';

const feature = loadFeature(
	'./tests/db/routes/items/nested-o2m-alterations.feature',
);

describe.each(vendors)('%s', (vendor) => {
	defineFeature(feature, (scenario) => {
		for (const title of [
			oneLine`
				created children with no sort follow the parent's highest sort
			`,
			oneLine`
				a create of several parents numbers each one's children from one
			`,
			oneLine`
				a highest sort of zero numbers the created children from one
			`,
			oneLine`
				children created where the relation has no sort field get only
				the parent
			`,
			oneLine`
				an updated child keeps its parent, and one of another parent moves
				over
			`,
			oneLine`
				a deleted child is nullified, one of another parent is left alone
			`,
			oneLine`
				a deleted child is deleted where the relation deletes, another's
				is kept
			`,
			oneLine`
				a batch moves a child one parent deletes onto the parent updating
				it
			`,
			oneLine`
				an alterations object of the wrong shape is refused, writing
				nothing
			`,
		]) {
			scenario(title, (steps) => {
				defineNestedWriteSteps(steps, vendor);
			}, 60_000);
		}
	});
});
