import { SYSTEM_COLLECTION_NAMES } from '@directus/constants';
import { isSystemCollection, systemCollectionNames } from '@directus/system-data';
import { expect, test } from 'vitest';

test('SYSTEM_COLLECTION_NAMES lists the system collections the yaml defines', () => {
	expect(systemCollectionNames).toEqual([...SYSTEM_COLLECTION_NAMES]);
});

// Written through raw knex: as a user collection, /items served it cached (#643).
test('the scoped-cache pending purges table is a system collection', () => {
	expect(isSystemCollection('directus_scoped_cache_pending_purges')).toBe(true);
});
