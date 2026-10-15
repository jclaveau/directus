import { SYSTEM_COLLECTION_NAMES } from '@directus/constants';
import { systemCollectionNames } from '@directus/system-data';
import { expect, test } from 'vitest';

test('SYSTEM_COLLECTION_NAMES lists the system collections the yaml defines', () => {
	expect(systemCollectionNames).toEqual([...SYSTEM_COLLECTION_NAMES]);
});
