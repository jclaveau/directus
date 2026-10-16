import type { Knex } from 'knex';
import knex from 'knex';
import { MockClient, Tracker, createTracker } from 'knex-mock-client';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Helpers } from '../database/helpers/index.js';
import { getHelpers } from '../database/helpers/index.js';
import { PayloadService } from './index.js';
import { SchemaBuilder } from '@directus/schema-builder';
import type { Item, Accountability, FieldOverview } from '@directus/types';
import { ForbiddenError, InvalidPayloadError } from '@directus/errors';

vi.mock('../../src/database/index', () => ({
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

describe('Integration Tests', () => {
	let db: Knex;
	let tracker: Tracker;

	beforeAll(async () => {
		vi.stubEnv('TZ', 'UTC');
		db = knex.default({ client: MockClient });
		tracker = createTracker(db);
	});

	afterEach(() => {
		tracker.reset();
		vi.restoreAllMocks();
	});

	describe('Services / PayloadService', () => {
		describe('transformers', () => {
			let service: PayloadService;
			let helpers: Helpers;

			beforeEach(() => {
				service = new PayloadService('test', {
					knex: db,
					schema: { collections: {}, relations: [] },
				});

				helpers = getHelpers(db);
			});

			describe('csv', () => {
				test('Returns undefined for illegal values', async () => {
					const result = await service.transformers['cast-csv']!({
						value: 123,
						action: 'read',
						payload: {},
						accountability: { role: null } as Accountability,
						specials: [],
						helpers,
					});

					expect(result).toBe(undefined);
				});

				test('Returns [] for empty strings', async () => {
					const result = await service.transformers['cast-csv']!({
						value: '',
						action: 'read',
						payload: {},
						accountability: { role: null } as Accountability,
						specials: [],
						helpers,
					});

					expect(result).toMatchObject([]);
				});

				test('Returns array values as is', async () => {
					const result = await service.transformers['cast-csv']!({
						value: ['test', 'directus'],
						action: 'read',
						payload: {},
						accountability: { role: null } as Accountability,
						specials: [],
						helpers,
					});

					expect(result).toEqual(['test', 'directus']);
				});

				test('Splits the CSV string', async () => {
					const result = await service.transformers['cast-csv']!({
						value: 'test,directus',
						action: 'read',
						payload: {},
						accountability: { role: null } as Accountability,
						specials: [],
						helpers,
					});

					expect(result).toMatchObject(['test', 'directus']);
				});

				test('Saves array values as joined string', async () => {
					const result = await service.transformers['cast-csv']!({
						value: ['test', 'directus'],
						action: 'create',
						payload: {},
						accountability: { role: null } as Accountability,
						specials: [],
						helpers,
					});

					expect(result).toBe('test,directus');
				});

				test('Saves string values as is', async () => {
					const result = await service.transformers['cast-csv']!({
						value: 'test,directus',
						action: 'create',
						payload: {},
						accountability: { role: null } as Accountability,
						specials: [],
						helpers,
					});

					expect(result).toBe('test,directus');
				});
			});

			describe('cast-json', () => {
				test('parses a JSON string on read', async () => {
					const result = await service.transformers['cast-json']!({
						value: '{"tags":["a","b"]}',
						action: 'read',
						payload: {},
						accountability: null,
						specials: [],
						helpers,
					});

					expect(result).toEqual({ tags: ['a', 'b'] });
				});

				test('returns an unparsable string as is on read', async () => {
					const result = await service.transformers['cast-json']!({
						value: 'not json',
						action: 'read',
						payload: {},
						accountability: null,
						specials: [],
						helpers,
					});

					expect(result).toBe('not json');
				});

				test('returns an already parsed value as is on read', async () => {
					const result = await service.transformers['cast-json']!({
						value: { tags: ['a'] },
						action: 'read',
						payload: {},
						accountability: null,
						specials: [],
						helpers,
					});

					expect(result).toEqual({ tags: ['a'] });
				});

				test('leaves a JSON string untouched on update', async () => {
					const result = await service.transformers['cast-json']!({
						value: '{"tags":["a"]}',
						action: 'update',
						payload: {},
						accountability: null,
						specials: [],
						helpers,
					});

					expect(result).toBe('{"tags":["a"]}');
				});
			});

			describe('user and role stamps', () => {
				test('user-created stamps the user on create', async () => {
					const result = await service.transformers['user-created']!({
						value: 'someone-else',
						action: 'create',
						payload: {},
						accountability: { role: 'role-a', user: 'user-a' } as Accountability,
						specials: [],
						helpers,
					});

					expect(result).toBe('user-a');
				});

				test('user-created stamps null without a user on create', async () => {
					const result = await service.transformers['user-created']!({
						value: 'someone-else',
						action: 'create',
						payload: {},
						accountability: null,
						specials: [],
						helpers,
					});

					expect(result).toBe(null);
				});

				test('user-created keeps the value on update', async () => {
					const result = await service.transformers['user-created']!({
						value: 'someone-else',
						action: 'update',
						payload: {},
						accountability: { role: 'role-a', user: 'user-a' } as Accountability,
						specials: [],
						helpers,
					});

					expect(result).toBe('someone-else');
				});

				test('user-updated stamps the user on update', async () => {
					const result = await service.transformers['user-updated']!({
						value: 'someone-else',
						action: 'update',
						payload: {},
						accountability: { role: 'role-a', user: 'user-a' } as Accountability,
						specials: [],
						helpers,
					});

					expect(result).toBe('user-a');
				});

				test('user-updated stamps null without a user on update', async () => {
					const result = await service.transformers['user-updated']!({
						value: 'someone-else',
						action: 'update',
						payload: {},
						accountability: null,
						specials: [],
						helpers,
					});

					expect(result).toBe(null);
				});

				test('user-updated keeps the value on create', async () => {
					const result = await service.transformers['user-updated']!({
						value: 'someone-else',
						action: 'create',
						payload: {},
						accountability: { role: 'role-a', user: 'user-a' } as Accountability,
						specials: [],
						helpers,
					});

					expect(result).toBe('someone-else');
				});

				test('role-created stamps the role on create', async () => {
					const result = await service.transformers['role-created']!({
						value: 'other-role',
						action: 'create',
						payload: {},
						accountability: { role: 'role-a', user: 'user-a' } as Accountability,
						specials: [],
						helpers,
					});

					expect(result).toBe('role-a');
				});

				test('role-created stamps null without a role on create', async () => {
					const result = await service.transformers['role-created']!({
						value: 'other-role',
						action: 'create',
						payload: {},
						accountability: null,
						specials: [],
						helpers,
					});

					expect(result).toBe(null);
				});

				test('role-created keeps the value on update', async () => {
					const result = await service.transformers['role-created']!({
						value: 'other-role',
						action: 'update',
						payload: {},
						accountability: { role: 'role-a', user: 'user-a' } as Accountability,
						specials: [],
						helpers,
					});

					expect(result).toBe('other-role');
				});

				test('role-updated stamps the role on update', async () => {
					const result = await service.transformers['role-updated']!({
						value: 'other-role',
						action: 'update',
						payload: {},
						accountability: { role: 'role-a', user: 'user-a' } as Accountability,
						specials: [],
						helpers,
					});

					expect(result).toBe('role-a');
				});

				test('role-updated stamps null without a role on update', async () => {
					const result = await service.transformers['role-updated']!({
						value: 'other-role',
						action: 'update',
						payload: {},
						accountability: null,
						specials: [],
						helpers,
					});

					expect(result).toBe(null);
				});

				test('role-updated keeps the value on create', async () => {
					const result = await service.transformers['role-updated']!({
						value: 'other-role',
						action: 'create',
						payload: {},
						accountability: { role: 'role-a', user: 'user-a' } as Accountability,
						specials: [],
						helpers,
					});

					expect(result).toBe('other-role');
				});
			});

			describe('date stamps', () => {
				beforeEach(() => {
					vi.useFakeTimers({ now: new Date('2026-01-02T03:04:05.000Z') });
				});

				afterEach(() => {
					vi.useRealTimers();
				});

				test('date-created stamps the current time on create', async () => {
					const result = await service.transformers['date-created']!({
						value: '1999-01-01T00:00:00.000Z',
						action: 'create',
						payload: {},
						accountability: null,
						specials: [],
						helpers,
					});

					expect(result).toEqual(new Date('2026-01-02T03:04:05.000Z'));
				});

				test('date-created keeps the value on update', async () => {
					const result = await service.transformers['date-created']!({
						value: '1999-01-01T00:00:00.000Z',
						action: 'update',
						payload: {},
						accountability: null,
						specials: [],
						helpers,
					});

					expect(result).toBe('1999-01-01T00:00:00.000Z');
				});

				test('date-updated stamps the current time on update', async () => {
					const result = await service.transformers['date-updated']!({
						value: '1999-01-01T00:00:00.000Z',
						action: 'update',
						payload: {},
						accountability: null,
						specials: [],
						helpers,
					});

					expect(result).toEqual(new Date('2026-01-02T03:04:05.000Z'));
				});

				test('date-updated keeps the value on create', async () => {
					const result = await service.transformers['date-updated']!({
						value: '1999-01-01T00:00:00.000Z',
						action: 'create',
						payload: {},
						accountability: null,
						specials: [],
						helpers,
					});

					expect(result).toBe('1999-01-01T00:00:00.000Z');
				});
			});
		});

		describe('processField', () => {
			test('returns the raw value of a field without specials', async () => {
				const result = await new PayloadService('test', {
					knex: db,
					schema: { collections: {}, relations: [] },
				}).processField(
					{ field: 'title', special: null } as unknown as FieldOverview,
					{ title: 'Hello' },
					'create',
					null,
				);

				expect(result).toBe('Hello');
			});
		});

		describe('processGeometries', () => {
			test('parses a GeoJSON string before converting it on write', () => {
				const service = new PayloadService('test', {
					knex: db,
					schema: { collections: {}, relations: [] },
				});

				const fromGeoJsonSpy = vi
					.spyOn(service.helpers.st, 'fromGeoJSON')
					.mockReturnValue('converted-point' as never);

				const result = service.processGeometries(
					[['location', { type: 'geometry.Point' } as FieldOverview]],
					[{ location: '{"type":"Point","coordinates":[1,2]}' }],
					'create',
				);

				expect(fromGeoJsonSpy).toHaveBeenCalledWith({
					type: 'Point',
					coordinates: [1, 2],
				});

				expect(result).toEqual([{ location: 'converted-point' }]);
			});

			test('converts a GeoJSON object as is on write', () => {
				const service = new PayloadService('test', {
					knex: db,
					schema: { collections: {}, relations: [] },
				});

				const fromGeoJsonSpy = vi
					.spyOn(service.helpers.st, 'fromGeoJSON')
					.mockReturnValue('converted-point' as never);

				const result = service.processGeometries(
					[['location', { type: 'geometry.Point' } as FieldOverview]],
					[{ location: { type: 'Point', coordinates: [1, 2] } }],
					'update',
				);

				expect(fromGeoJsonSpy).toHaveBeenCalledWith({
					type: 'Point',
					coordinates: [1, 2],
				});

				expect(result).toEqual([{ location: 'converted-point' }]);
			});
		});

		describe('processDates', () => {
			let service: PayloadService;

			const schema = new SchemaBuilder()
				.collection('test', (c) => {
					c.field('id').id();
					c.field('date_field').date();
					c.field('datetime_field').dateTime();
					c.field('timestamp_field').timestamp();
				})
				.build();

			const fieldEntries = Object.entries(schema.collections['test']!.fields);

			beforeEach(() => {
				service = new PayloadService('test', {
					knex: db,
					schema,
				});
			});

			describe('processes dates', () => {
				test('with zero values', () => {
					const result = service.processDates(
						fieldEntries,
						[
							{
								date_field: '0000-00-00',
								datetime_field: '0000-00-00 00:00:00',
								timestamp_field: '0000-00-00 00:00:00.000',
							},
						],
						'read',
					);

					expect(result).toMatchObject([
						{
							date_field: null,
							datetime_field: null,
							timestamp_field: null,
						},
					]);
				});

				test('with unpadded values', () => {
					const result = service.processDates(
						fieldEntries,
						[
							{
								date_field: new Date(1, 1, 3).setFullYear(1),
								datetime_field: new Date(1, 1, 3, 4, 5, 6).setFullYear(1),
								timestamp_field: new Date(1, 1, 3, 4, 5, 6, 7).setFullYear(1),
							},
						],
						'read',
					);

					expect(result).toMatchObject([
						{
							date_field: '0001-02-03',
							datetime_field: '0001-02-03T04:05:06',
							timestamp_field: new Date(new Date(1, 1, 3, 4, 5, 6, 7).setFullYear(1)).toISOString(),
						},
					]);
				});

				test('with typical values', () => {
					const result = service.processDates(
						fieldEntries,
						[
							{
								date_field: '2022-01-10',
								datetime_field: '2021-09-31 12:34:56',
								timestamp_field: '1980-12-08 00:11:22.333',
							},
						],
						'read',
					);

					expect(result).toMatchObject([
						{
							date_field: '2022-01-10',
							datetime_field: '2021-10-01T12:34:56',
							timestamp_field: new Date('1980-12-08 00:11:22.333').toISOString(),
						},
					]);
				});

				test('with date object values', () => {
					const result = service.processDates(
						fieldEntries,
						[
							{
								date_field: new Date(1666777777000),
								datetime_field: new Date(1666666666000),
								timestamp_field: new Date(1666555444333),
							},
						],
						'read',
					);

					expect(result).toMatchObject([
						{
							date_field: toLocalISOString(new Date(1666777777000)).slice(0, 10),
							datetime_field: toLocalISOString(new Date(1666666666000)),
							timestamp_field: new Date(1666555444333).toISOString(),
						},
					]);
				});

				test('with alias and typical values', () => {
					const result = service.processDates(
						fieldEntries,
						[
							{
								'date-alias': '2022-01-10',
								'datetime-alias': '2021-09-31 12:34:56',
								'timestamp-alias': '1980-12-08 00:11:22.333',
							},
						],
						'read',
						{ 'date-alias': 'date_field', 'datetime-alias': 'datetime_field', 'timestamp-alias': 'timestamp_field' },
					);

					expect(result).toMatchObject([
						{
							'date-alias': '2022-01-10',
							'datetime-alias': '2021-10-01T12:34:56',
							'timestamp-alias': new Date('1980-12-08 00:11:22.333').toISOString(),
						},
					]);
				});

				test('with alias and object values', () => {
					const result = service.processDates(
						fieldEntries,
						[
							{
								'date-alias': new Date(1666777777000),
								'datetime-alias': new Date(1666666666000),
								'timestamp-alias': new Date(1666555444333),
							},
						],
						'read',
						{ 'date-alias': 'date_field', 'datetime-alias': 'datetime_field', 'timestamp-alias': 'timestamp_field' },
					);

					expect(result).toMatchObject([
						{
							'date-alias': toLocalISOString(new Date(1666777777000)).slice(0, 10),
							'datetime-alias': toLocalISOString(new Date(1666666666000)),
							'timestamp-alias': new Date(1666555444333).toISOString(),
						},
					]);
				});

				test('with aggregate and typical values', () => {
					const result = service.processDates(
						fieldEntries,
						[
							{
								'max->date_field': '2022-01-10',
								'max->datetime_field': '2021-09-31 12:34:56',
								'max->timestamp_field': '1980-12-08 00:11:22.333',
							},
						],
						'read',
						{},
						{ max: ['date_field', 'datetime_field', 'timestamp_field'] },
					);

					expect(result).toMatchObject([
						{
							'max->date_field': '2022-01-10',
							'max->datetime_field': '2021-10-01T12:34:56',
							'max->timestamp_field': new Date('1980-12-08 00:11:22.333').toISOString(),
						},
					]);
				});

				test('with aggregate and object values', () => {
					const result = service.processDates(
						fieldEntries,
						[
							{
								'max->date_field': new Date(1666777777000),
								'max->datetime_field': new Date(1666666666000),
								'max->timestamp_field': new Date(1666555444333),
							},
						],
						'read',
						{},
						{ max: ['date_field', 'datetime_field', 'timestamp_field'] },
					);

					expect(result).toMatchObject([
						{
							'max->date_field': toLocalISOString(new Date(1666777777000)).slice(0, 10),
							'max->datetime_field': toLocalISOString(new Date(1666666666000)),
							'max->timestamp_field': new Date(1666555444333).toISOString(),
						},
					]);
				});
			});

			describe('parses dates on write', () => {
				test('turns a valid date string into a Date', () => {
					const result = service.processDates(
						fieldEntries,
						[{ date_field: '2022-01-10' }],
						'create',
					);

					expect(result).toEqual([{ date_field: new Date(2022, 0, 10) }]);
				});

				test('refuses an invalid date string', () => {
					expect(() => {
						service.processDates(
							fieldEntries,
							[{ date_field: 'not-a-date' }],
							'update',
						);
					}).toThrowError(InvalidPayloadError);

					expect(() => {
						service.processDates(
							fieldEntries,
							[{ date_field: 'not-a-date' }],
							'update',
						);
					}).toThrowError(new InvalidPayloadError({
						reason: 'Invalid Date format in field "date_field"',
					}));
				});
			});
		});

		describe('processDates on time columns', () => {
			const schema = new SchemaBuilder()
				.collection('test', (c) => {
					c.field('id').id();
					c.field('time_field').time();
				})
				.build();

			let service: PayloadService;

			beforeEach(() => {
				service = new PayloadService('test', { knex: db, schema });
			});

			test('formats a Date as a time of day on read', () => {
				const result = service.processDates(
					[['time_field', schema.collections['test']!.fields['time_field']!]],
					[{ time_field: new Date(2020, 0, 1, 13, 14, 15) }],
					'read',
				);

				expect(result).toEqual([{ time_field: '13:14:15' }]);
			});

			test('keeps a time string as is on read', () => {
				const result = service.processDates(
					[['time_field', schema.collections['test']!.fields['time_field']!]],
					[{ time_field: '13:14:15' }],
					'read',
				);

				expect(result).toEqual([{ time_field: '13:14:15' }]);
			});

			test('keeps a Date as is on write', () => {
				const result = service.processDates(
					[['time_field', schema.collections['test']!.fields['time_field']!]],
					[{ time_field: new Date(2020, 0, 1, 13, 14, 15) }],
					'create',
				);

				expect(result).toEqual([
					{ time_field: new Date(2020, 0, 1, 13, 14, 15) },
				]);
			});
		});

		describe('processAggregates', () => {
			let service: PayloadService;

			const schema = new SchemaBuilder()
				.collection('test', (c) => {
					c.field('id').id();
					c.field('users').integer();
					c.field('stars').integer();
				})
				.build();

			beforeEach(() => {
				service = new PayloadService('test', {
					knex: db,
					schema,
				});
			});

			test('empty payload should not change with aggregates', () => {
				const payload: Partial<Item>[] = [];

				service.processAggregates(payload, { sum: ['count'] });

				expect(payload).toMatchObject(payload);
			});

			test('payload should not change with no aggregates', () => {
				const payload = [
					{
						users: 1,
					},
				];

				service.processAggregates(payload);

				expect(payload).toMatchObject(payload);
			});

			test('payload should have expanded aggregate fields', () => {
				const payload = [
					{
						'sum->users': 3,
						'max->stars': 1,
					},
				];

				service.processAggregates(payload, {
					sum: ['users'],
					max: ['stars'],
				});

				expect(payload).toMatchObject([
					{
						sum: { users: 3 },
						max: {
							stars: 1,
						},
					},
				]);
			});

			test('payload should have not remove non aggregate fields', () => {
				const payload = [
					{
						users: 1,
						'sum->stars': 1,
					},
				];

				service.processAggregates(payload, {
					sum: ['stars'],
				});

				expect(payload).toMatchObject([
					{
						users: 1,
						sum: {
							stars: 1,
						},
					},
				]);
			});
		});

		describe('processValues', () => {
			let service: PayloadService;

			const REDACT_STR = '**********';

			const schema = new SchemaBuilder()
				.collection('test', (c) => {
					c.field('id').id();
					c.field('string').string();

					c.field('hidden')
						.hash()
						.options({
							special: ['hash', 'conceal'],
						});
				})
				.build();

			beforeEach(() => {
				service = new PayloadService('test', {
					knex: db,
					schema,
				});
			});

			test('processing special fields', async () => {
				const result = await service.processValues('read', {
					string: 'not-redacted',
					hidden: 'secret',
				});

				expect(result).toMatchObject({ string: 'not-redacted', hidden: REDACT_STR });
			});

			test('processing aliassed special fields', async () => {
				const result = await service.processValues(
					'read',
					{
						other_string: 'not-redacted',
						other_hidden: 'secret',
					},
					{ other_string: 'string', other_hidden: 'hidden' },
					{},
				);

				expect(result).toMatchObject({ other_string: 'not-redacted', other_hidden: REDACT_STR });
			});
		});

		describe('processO2M', () => {
			const schema = new SchemaBuilder()
				.collection('country', (c) => {
					c.field('id').id();
					c.field('cities').o2m('city', 'country_id');
				})
				.collection('city', (c) => {
					c.field('id').id();
					c.field('country_id').integer();
				})
				.build();

			let service: PayloadService;

			beforeEach(() => {
				service = new PayloadService('country', {
					knex: db,
					schema,
				});
			});

			test('throws ForbiddenError when a referenced O2M primary key does not exist', async () => {
				// The related-record lookup by PK resolves to no row, so the existing-record guard fails.
				tracker.on.select('city').response([]);

				await expect(service.processO2M({ cities: [99] }, 1)).rejects.toThrowError(ForbiddenError);

				await expect(service.processO2M({ cities: [99] }, 1)).rejects.toThrowError(
					"Could not find a 'city' record having the primary key 99 while processing O2M relation",
				);
			});
		});
	});
});

function toLocalISOString(date: Date) {
	const year = String(date.getFullYear());
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const seconds = String(date.getSeconds()).padStart(2, '0');

	return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}
