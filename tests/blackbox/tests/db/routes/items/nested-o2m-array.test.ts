import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { oneLine } from '@directus/utils';
import { describe } from 'vitest';
import { defineNestedWriteSteps } from './nested-o2m-steps';
import { startAuditedInstance } from './query-audit-steps';

const feature = loadFeature('./tests/db/routes/items/nested-o2m-array.feature');

describe.each(vendors)('%s', (vendor) => {
	const instanceUrl = startAuditedInstance(vendor);

	defineFeature(feature, (scenario) => {
		for (const title of [
			oneLine`
				a child named by its key joins the parent, the ones left out are
				nullified
			`,
			'a child named by a key no row has is refused, writing nothing',
			oneLine`
				an object child with a key is updated, and moved when it is
				another's
			`,
			oneLine`
				a batch deletes the children each parent leaves out when the
				relation deletes
			`,
			oneLine`
				a null list deletes every child of its parent when the relation
				deletes
			`,
			oneLine`
				a create of several parents links each its own children, moving
				one over
			`,
			oneLine`
				a batch swaps children between its parents, nullifying each one's
				others
			`,
			oneLine`
				an update of several keys leaves a child they all list on the last
				key
			`,
			oneLine`
				a many-to-many list links junction rows and nullifies the ones left
				out
			`,
		]) {
			scenario(title, (steps) => {
				defineNestedWriteSteps(steps, vendor, instanceUrl);
			}, 60_000);
		}
	});
});
