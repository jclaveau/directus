import { describe, expect, test } from 'vitest';
import { cacheSettingRows, parseCacheSettingValue } from './cache-settings-panel';

describe('cacheSettingRows', () => {
	test('a row carries the value, its layer, the stored one and the fallback', () => {
		const rows = cacheSettingRows({
			key: 'directus_settings.cache_settings',
			sharedSettings: { audit_limit: 40 },
			resolved: {
				audit_limit: { value: 40, source: 'settings', fallback: 0 },
				scoped_index_ttl_factor: { value: 2, source: 'default', fallback: 2 },
			},
		});

		expect(rows[3]).toMatchObject({
			field: 'audit_limit',
			variable: 'CACHE_AUDIT_LIMIT',
			value: 40,
			source: 'settings',
			sharedSettings: 40,
			fallback: 0,
		});

		expect(rows[7]).toMatchObject({
			field: 'scoped_index_ttl_factor',
			variable: null,
			value: 2,
			source: 'default',
			sharedSettings: null,
			fallback: 2,
		});
	});

	test('nothing read yet leaves every row without a value or a layer', () => {
		expect(cacheSettingRows(null)[0]).toMatchObject({
			field: 'enabled',
			value: null,
			source: null,
			sharedSettings: null,
			fallback: null,
		});
	});
});

describe('parseCacheSettingValue', () => {
	test.each([
		['number', '1.5', 1.5],
		['number', 'many', null],
		['boolean', 'false', false],
		['boolean', 'true', true],
		['size', 'false', false],
		['size', '2mb', '2mb'],
		['text', '10m', '10m'],
		['text', 'false', 'false'],
		['number', '', null],
		['size', null, null],
	] as const)('%s %j is %j', (kind, raw, parsed) => {
		expect(parseCacheSettingValue(kind, raw)).toBe(parsed);
	});
});
