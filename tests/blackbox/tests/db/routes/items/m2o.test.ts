import { getUrl } from '@common/config';
import { CreateItem } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { requestGraphQL } from '@common/transport';
import type { PrimaryKeyType } from '@common/types';
import { PRIMARY_KEY_TYPES, USER } from '@common/variables';
import { without } from 'lodash-es';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it, test } from 'vitest';
import { CheckQueryFilters, type CachedTestsSchema, type TestsSchemaVendorValues } from '../../query/filter';
import {
	collectionCities,
	collectionCountries,
	collectionStates,
	getTestsSchema,
	seedDBValues,
	type City,
	type Country,
	type State,
} from './m2o.seed';

function createCountry(pkType: PrimaryKeyType) {
	const item: Country = {
		name: 'country-' + randomUUID(),
	};

	if (pkType === 'string') {
		item.id = 'country-' + randomUUID();
	}

	return item;
}

function createState(pkType: PrimaryKeyType) {
	const item: State = {
		name: 'state-' + randomUUID(),
	};

	if (pkType === 'string') {
		item.id = 'state-' + randomUUID();
	}

	return item;
}

function createCity(pkType: PrimaryKeyType) {
	const item: City = {
		name: 'city-' + randomUUID(),
	};

	if (pkType === 'string') {
		item.id = 'city-' + randomUUID();
	}

	return item;
}

const cachedSchema = PRIMARY_KEY_TYPES.reduce((acc, pkType) => {
	acc[pkType] = getTestsSchema(pkType);
	return acc;
}, {} as CachedTestsSchema);

const vendorSchemaValues: TestsSchemaVendorValues = {};

beforeAll(async () => {
	await seedDBValues(cachedSchema, vendorSchemaValues);
}, 300_000);

describe('Seed Database Values', () => {
	it.each(vendors)('%s', async (vendor) => {
		// Assert
		expect(vendorSchemaValues[vendor]).toBeDefined();
	});
});

describe.each(PRIMARY_KEY_TYPES)('/items', (pkType) => {
	const localCollectionCountries = `${collectionCountries}_${pkType}`;
	const localCollectionStates = `${collectionStates}_${pkType}`;
	const localCollectionCities = `${collectionCities}_${pkType}`;

	describe(`pkType: ${pkType}`, () => {
		describe('GET /:collection/:id', () => {
			describe(`retrieves a state's country`, () => {
				it.each(vendors)('%s', async (vendor) => {
					// Setup
					const insertedCountry = await CreateItem(vendor, {
						collection: localCollectionCountries,
						item: createCountry(pkType),
					});

					const state = createState(pkType);
					state.country_id = insertedCountry.id;
					const insertedState = await CreateItem(vendor, { collection: localCollectionStates, item: state });

					// Action
					const response = await request(getUrl(vendor))
						.get(`/items/${localCollectionStates}/${insertedState.id}`)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					const gqlResponse = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
						query: {
							[localCollectionStates]: {
								__args: {
									filter: {
										id: {
											_eq: insertedState.id,
										},
									},
								},
								country_id: {
									id: true,
								},
							},
						},
					});

					// Assert
					expect(response.statusCode).toEqual(200);
					expect(response.body.data).toMatchObject({ country_id: insertedCountry.id });

					expect(gqlResponse.statusCode).toEqual(200);

					expect(gqlResponse.body.data).toMatchObject({
						[localCollectionStates]: [{ country_id: { id: String(insertedCountry.id) } }],
					});
				});
			});
		});

		describe('GET /:collection', () => {
			describe('filters', () => {
				describe('on top level', () => {
					it.each(vendors)('%s', async (vendor) => {
						// Setup
						const state = createState(pkType);
						state.name = 'state-m2o-top-' + randomUUID();

						const insertedState = await CreateItem(vendor, {
							collection: localCollectionStates,
							item: state,
						});

						// Action
						const response = await request(getUrl(vendor))
							.get(`/items/${localCollectionStates}`)
							.query({
								filter: { id: { _eq: insertedState.id } },
							})
							.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

						const response2 = await request(getUrl(vendor))
							.get(`/items/${localCollectionStates}`)
							.query({
								filter: { name: { _eq: insertedState.name } },
							})
							.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

						const gqlResponse = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
							query: {
								[localCollectionStates]: {
									__args: {
										filter: {
											id: {
												_eq: insertedState.id,
											},
										},
									},
									id: true,
								},
							},
						});

						const gqlResponse2 = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
							query: {
								[localCollectionStates]: {
									__args: {
										filter: {
											name: {
												_eq: insertedState.name,
											},
										},
									},
									id: true,
								},
							},
						});

						// Assert
						expect(response.statusCode).toEqual(200);
						expect(response.body.data.length).toBe(1);
						expect(response.body.data[0]).toMatchObject({ id: insertedState.id });
						expect(response2.statusCode).toEqual(200);
						expect(response.body.data).toEqual(response2.body.data);

						expect(gqlResponse.statusCode).toBe(200);
						expect(gqlResponse.body.data[localCollectionStates].length).toBe(1);

						expect(gqlResponse.body.data[localCollectionStates][0]).toMatchObject({
							id: String(insertedState.id),
						});

						expect(gqlResponse2.statusCode).toBe(200);
						expect(gqlResponse.body.data).toEqual(gqlResponse2.body.data);
					});
				});

				describe('on m2o level', () => {
					it.each(vendors)('%s', async (vendor) => {
						// Setup
						const country = createCountry(pkType);
						country.name = 'country-m2o-' + randomUUID();

						const insertedCountry = await CreateItem(vendor, {
							collection: localCollectionCountries,
							item: country,
						});

						const state = createState(pkType);
						state.name = 'state-m2o-' + randomUUID();
						state.country_id = insertedCountry.id;
						const insertedState = await CreateItem(vendor, { collection: localCollectionStates, item: state });

						// Action
						const response = await request(getUrl(vendor))
							.get(`/items/${localCollectionStates}`)
							.query({
								filter: JSON.stringify({ country_id: { id: { _eq: insertedCountry.id } } }),
							})
							.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

						const response2 = await request(getUrl(vendor))
							.get(`/items/${localCollectionStates}`)
							.query({
								filter: JSON.stringify({ country_id: { name: { _eq: insertedCountry.name } } }),
							})
							.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

						const gqlResponse = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
							query: {
								[localCollectionStates]: {
									__args: {
										filter: {
											country_id: { id: { _eq: insertedCountry.id } },
										},
									},
									id: true,
								},
							},
						});

						const gqlResponse2 = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
							query: {
								[localCollectionStates]: {
									__args: {
										filter: {
											country_id: { name: { _eq: insertedCountry.name } },
										},
									},
									id: true,
								},
							},
						});

						// Assert
						expect(response.statusCode).toEqual(200);
						expect(response.body.data.length).toBe(1);
						expect(response.body.data[0]).toMatchObject({ id: insertedState.id });
						expect(response2.statusCode).toEqual(200);
						expect(response.body.data).toEqual(response2.body.data);

						expect(gqlResponse.statusCode).toBe(200);
						expect(gqlResponse.body.data[localCollectionStates].length).toBe(1);

						expect(gqlResponse.body.data[localCollectionStates][0]).toMatchObject({
							id: String(insertedState.id),
						});

						expect(gqlResponse2.statusCode).toBe(200);
						expect(gqlResponse.body.data).toEqual(gqlResponse2.body.data);
					});
				});
			});

			describe('filters with functions', () => {
				describe('on top level', () => {
					it.each(vendors)('%s', async (vendor) => {
						// Setup
						const states = [];
						const years = [1980, 1988];

						for (const year of years) {
							const state = createState(pkType);
							state.name = 'state-m2o-top-fn-' + randomUUID();
							state.test_datetime = new Date(new Date().setFullYear(year)).toISOString().slice(0, 19);
							states.push(state);
						}

						await CreateItem(vendor, {
							collection: localCollectionStates,
							item: states,
						});

						// Action
						const response = await request(getUrl(vendor))
							.get(`/items/${localCollectionStates}`)
							.query({
								filter: { 'year(test_datetime)': { _eq: years[0] } },
							})
							.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

						const response2 = await request(getUrl(vendor))
							.get(`/items/${localCollectionStates}`)
							.query({
								filter: { 'year(test_datetime)': { _eq: years[1] } },
							})
							.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

						const gqlResponse = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
							query: {
								[localCollectionStates]: {
									__args: {
										filter: {
											test_datetime_func: { year: { _eq: years[0] } },
										},
									},
									name: true,
								},
							},
						});

						const gqlResponse2 = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
							query: {
								[localCollectionStates]: {
									__args: {
										filter: {
											test_datetime_func: { year: { _eq: years[1] } },
										},
									},
									name: true,
								},
							},
						});

						// Assert
						expect(response.statusCode).toEqual(200);
						expect(response.body.data.length).toBe(1);
						expect(response.body.data[0]).toMatchObject({ name: states[0]?.name });
						expect(response2.statusCode).toEqual(200);
						expect(response2.body.data.length).toBe(1);
						expect(response2.body.data[0]).toMatchObject({ name: states[1]?.name });

						expect(gqlResponse.statusCode).toBe(200);
						expect(gqlResponse.body.data[localCollectionStates].length).toBe(1);

						expect(gqlResponse.body.data[localCollectionStates][0]).toMatchObject({
							name: states[0]?.name,
						});

						expect(gqlResponse2.statusCode).toBe(200);
						expect(gqlResponse2.body.data[localCollectionStates].length).toBe(1);

						expect(gqlResponse2.body.data[localCollectionStates][0]).toMatchObject({
							name: states[1]?.name,
						});
					});
				});

				describe('on m2o level', () => {
					it.each(vendors)('%s', async (vendor) => {
						// Setup
						const states = [];
						const years = [1983, 1990];

						for (const year of years) {
							const country = createCountry(pkType);
							country.name = 'country-m2o-fn-' + randomUUID();
							country.test_datetime = new Date(new Date().setFullYear(year)).toISOString().slice(0, 19);

							const insertedCountry = await CreateItem(vendor, {
								collection: localCollectionCountries,
								item: country,
							});

							const state = createState(pkType);
							state.name = 'state-m2o-fn-' + randomUUID();
							state.country_id = insertedCountry.id;
							states.push(state);
							await CreateItem(vendor, { collection: localCollectionStates, item: state });
						}

						// Action
						const response = await request(getUrl(vendor))
							.get(`/items/${localCollectionStates}`)
							.query({
								filter: JSON.stringify({ country_id: { 'year(test_datetime)': { _eq: years[0] } } }),
							})
							.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

						const response2 = await request(getUrl(vendor))
							.get(`/items/${localCollectionStates}`)
							.query({
								filter: JSON.stringify({ country_id: { 'year(test_datetime)': { _eq: years[1] } } }),
							})
							.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

						const gqlResponse = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
							query: {
								[localCollectionStates]: {
									__args: {
										filter: {
											country_id: {
												test_datetime_func: {
													year: {
														_eq: years[0],
													},
												},
											},
										},
									},
									name: true,
								},
							},
						});

						const gqlResponse2 = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
							query: {
								[localCollectionStates]: {
									__args: {
										filter: {
											country_id: {
												test_datetime_func: {
													year: {
														_eq: years[1],
													},
												},
											},
										},
									},
									name: true,
								},
							},
						});

						// Assert
						expect(response.statusCode).toEqual(200);
						expect(response.body.data.length).toBe(1);
						expect(response.body.data[0]).toMatchObject({ name: states[0]?.name });
						expect(response2.statusCode).toEqual(200);
						expect(response2.body.data.length).toBe(1);
						expect(response2.body.data[0]).toMatchObject({ name: states[1]?.name });

						expect(gqlResponse.statusCode).toBe(200);
						expect(gqlResponse.body.data[localCollectionStates].length).toBe(1);

						expect(gqlResponse.body.data[localCollectionStates][0]).toMatchObject({
							name: states[0]?.name,
						});

						expect(gqlResponse2.statusCode).toBe(200);
						expect(gqlResponse2.body.data[localCollectionStates].length).toBe(1);

						expect(gqlResponse2.body.data[localCollectionStates][0]).toMatchObject({
							name: states[1]?.name,
						});
					});
				});
			});

			describe('sorts', () => {
				describe('on top level', () => {
					beforeAll(async () => {
						for (const vendor of vendors) {
							// Setup
							const sortValues = [4, 2, 3, 5, 1];
							const states = [];

							for (const val of sortValues) {
								const state = createState(pkType);
								state.name = 'state-m2o-top-sort-' + val;
								states.push(state);
							}

							await CreateItem(vendor, {
								collection: localCollectionStates,
								item: states,
							});
						}
					});

					describe('without limit', () => {
						it.each(vendors)('%s', async (vendor) => {
							// Action
							const response = await request(getUrl(vendor))
								.get(`/items/${localCollectionStates}`)
								.query({
									sort: 'name',
									filter: { name: { _starts_with: 'state-m2o-top-sort-' } },
								})
								.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

							const response2 = await request(getUrl(vendor))
								.get(`/items/${localCollectionStates}`)
								.query({
									sort: '-name',
									filter: { name: { _starts_with: 'state-m2o-top-sort-' } },
								})
								.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

							const gqlResponse = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
								query: {
									[localCollectionStates]: {
										__args: {
											sort: 'name',
											filter: { name: { _starts_with: 'state-m2o-top-sort-' } },
										},
										id: true,
									},
								},
							});

							const gqlResponse2 = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
								query: {
									[localCollectionStates]: {
										__args: {
											sort: '-name',
											filter: { name: { _starts_with: 'state-m2o-top-sort-' } },
										},
										id: true,
									},
								},
							});

							// Assert
							expect(response.statusCode).toEqual(200);
							expect(response.body.data.length).toBe(5);
							expect(response2.statusCode).toEqual(200);
							expect(response.body.data).toEqual(response2.body.data.reverse());

							expect(gqlResponse.statusCode).toEqual(200);
							expect(gqlResponse.body.data[localCollectionStates].length).toBe(5);
							expect(gqlResponse2.statusCode).toEqual(200);

							expect(gqlResponse.body.data[localCollectionStates]).toEqual(
								gqlResponse2.body.data[localCollectionStates].reverse(),
							);
						});
					});

					describe.each([-1, 1, 3])('where limit = %s', (limit) => {
						it.each(vendors)('%s', async (vendor) => {
							// Setup
							const expectedLength = limit === -1 ? 5 : limit;
							const expectedAsc = [1, 2, 3, 4, 5].slice(0, expectedLength);
							const expectedDesc = [5, 4, 3, 2, 1].slice(0, expectedLength);

							// Action
							const response = await request(getUrl(vendor))
								.get(`/items/${localCollectionStates}`)
								.query({
									sort: 'name',
									filter: { name: { _starts_with: 'state-m2o-top-sort-' } },
									limit,
									fields: 'name',
								})
								.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

							const response2 = await request(getUrl(vendor))
								.get(`/items/${localCollectionStates}`)
								.query({
									sort: '-name',
									filter: { name: { _starts_with: 'state-m2o-top-sort-' } },
									limit,
									fields: 'name',
								})
								.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

							const gqlResponse = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
								query: {
									[localCollectionStates]: {
										__args: {
											sort: 'name',
											filter: { name: { _starts_with: 'state-m2o-top-sort-' } },
											limit,
										},
										id: true,
										name: true,
									},
								},
							});

							const gqlResponse2 = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
								query: {
									[localCollectionStates]: {
										__args: {
											sort: '-name',
											filter: { name: { _starts_with: 'state-m2o-top-sort-' } },
											limit,
										},
										id: true,
										name: true,
									},
								},
							});

							// Assert
							expect(response.statusCode).toEqual(200);
							expect(response.body.data.length).toBe(expectedLength);
							expect(response2.statusCode).toEqual(200);
							expect(response.body.data).not.toEqual(response2.body.data);

							expect(
								response.body.data.map((item: any) => {
									return parseInt(item.name.slice(-1));
								}),
							).toEqual(expectedAsc);

							expect(
								response2.body.data.map((item: any) => {
									return parseInt(item.name.slice(-1));
								}),
							).toEqual(expectedDesc);

							expect(gqlResponse.statusCode).toEqual(200);
							expect(gqlResponse.body.data[localCollectionStates].length).toBe(expectedLength);
							expect(gqlResponse2.statusCode).toEqual(200);

							expect(gqlResponse.body.data[localCollectionStates]).not.toEqual(
								gqlResponse2.body.data[localCollectionStates],
							);

							expect(
								gqlResponse.body.data[localCollectionStates].map((item: any) => {
									return parseInt(item.name.slice(-1));
								}),
							).toEqual(expectedAsc);

							expect(
								gqlResponse2.body.data[localCollectionStates].map((item: any) => {
									return parseInt(item.name.slice(-1));
								}),
							).toEqual(expectedDesc);
						});
					});
				});

				describe('on m2o level', () => {
					beforeAll(async () => {
						for (const vendor of vendors) {
							// Setup
							const sortValues = [4, 2, 3, 5, 1];

							for (const val of sortValues) {
								const country = createCountry(pkType);
								country.name = 'country-m2o-sort-' + val;

								const insertedCountry = await CreateItem(vendor, {
									collection: localCollectionCountries,
									item: country,
								});

								const state = createState(pkType);
								state.name = 'state-m2o-sort-' + randomUUID();
								state.country_id = insertedCountry.id;
								await CreateItem(vendor, { collection: localCollectionStates, item: state });
							}
						}
					});

					describe('without limit', () => {
						it.each(vendors)('%s', async (vendor) => {
							// Action
							const response = await request(getUrl(vendor))
								.get(`/items/${localCollectionStates}`)
								.query({
									sort: 'country_id.name',
									filter: { name: { _starts_with: 'state-m2o-sort-' } },
								})
								.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

							const response2 = await request(getUrl(vendor))
								.get(`/items/${localCollectionStates}`)
								.query({
									sort: '-country_id.name',
									filter: { name: { _starts_with: 'state-m2o-sort-' } },
								})
								.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

							const gqlResponse = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
								query: {
									[localCollectionStates]: {
										__args: {
											sort: 'country_id.name',
											filter: { name: { _starts_with: 'state-m2o-sort-' } },
										},
										id: true,
									},
								},
							});

							const gqlResponse2 = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
								query: {
									[localCollectionStates]: {
										__args: {
											sort: '-country_id.name',
											filter: { name: { _starts_with: 'state-m2o-sort-' } },
										},
										id: true,
									},
								},
							});

							// Assert
							expect(response.statusCode).toEqual(200);
							expect(response.body.data.length).toBe(5);
							expect(response2.statusCode).toEqual(200);
							expect(response.body.data).toEqual(response2.body.data.reverse());

							expect(gqlResponse.statusCode).toEqual(200);
							expect(gqlResponse.body.data[localCollectionStates].length).toBe(5);
							expect(gqlResponse2.statusCode).toEqual(200);

							expect(gqlResponse.body.data[localCollectionStates]).toEqual(
								gqlResponse2.body.data[localCollectionStates].reverse(),
							);
						});
					});

					describe.each([-1, 1, 3])('where limit = %s', (limit) => {
						it.each(vendors)('%s', async (vendor) => {
							// Setup
							const expectedLength = limit === -1 ? 5 : limit;
							const expectedAsc = [1, 2, 3, 4, 5].slice(0, expectedLength);
							const expectedDesc = [5, 4, 3, 2, 1].slice(0, expectedLength);

							// Action
							const response = await request(getUrl(vendor))
								.get(`/items/${localCollectionStates}`)
								.query({
									sort: 'country_id.name',
									filter: { name: { _starts_with: 'state-m2o-sort-' } },
									limit,
									fields: 'country_id.name',
								})
								.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

							const response2 = await request(getUrl(vendor))
								.get(`/items/${localCollectionStates}`)
								.query({
									sort: '-country_id.name',
									filter: { name: { _starts_with: 'state-m2o-sort-' } },
									limit,
									fields: 'country_id.name',
								})
								.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

							const gqlResponse = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
								query: {
									[localCollectionStates]: {
										__args: {
											sort: 'country_id.name',
											filter: { name: { _starts_with: 'state-m2o-sort-' } },
											limit,
										},
										id: true,
										country_id: {
											name: true,
										},
									},
								},
							});

							const gqlResponse2 = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
								query: {
									[localCollectionStates]: {
										__args: {
											sort: '-country_id.name',
											filter: { name: { _starts_with: 'state-m2o-sort-' } },
											limit,
										},
										id: true,
										country_id: {
											name: true,
										},
									},
								},
							});

							// Assert
							expect(response.statusCode).toEqual(200);
							expect(response.body.data.length).toBe(expectedLength);
							expect(response2.statusCode).toEqual(200);
							expect(response.body.data).not.toEqual(response2.body.data);

							expect(
								response.body.data.map((item: any) => {
									return parseInt(item.country_id.name.slice(-1));
								}),
							).toEqual(expectedAsc);

							expect(
								response2.body.data.map((item: any) => {
									return parseInt(item.country_id.name.slice(-1));
								}),
							).toEqual(expectedDesc);

							expect(gqlResponse.statusCode).toEqual(200);
							expect(gqlResponse.body.data[localCollectionStates].length).toBe(expectedLength);
							expect(gqlResponse2.statusCode).toEqual(200);

							expect(gqlResponse.body.data[localCollectionStates]).not.toEqual(
								gqlResponse2.body.data[localCollectionStates],
							);

							expect(
								gqlResponse.body.data[localCollectionStates].map((item: any) => {
									return parseInt(item.country_id.name.slice(-1));
								}),
							).toEqual(expectedAsc);

							expect(
								gqlResponse2.body.data[localCollectionStates].map((item: any) => {
									return parseInt(item.country_id.name.slice(-1));
								}),
							).toEqual(expectedDesc);
						});
					});
				});
			});

			describe('sorts with functions', () => {
				describe('on top level', () => {
					beforeAll(async () => {
						for (const vendor of vendors) {
							// Setup
							const sortValues = [4, 2, 3, 5, 1];
							const states = [];

							for (const val of sortValues) {
								const state = createState(pkType);
								state.name = 'state-m2o-top-sort-fn-' + randomUUID();

								state.test_datetime = new Date(new Date().setFullYear(parseInt(`202${val}`)))
									.toISOString()
									.slice(0, 19);

								states.push(state);
							}

							await CreateItem(vendor, {
								collection: localCollectionStates,
								item: states,
							});
						}
					});

					describe('without limit', () => {
						it.each(vendors)('%s', async (vendor) => {
							// Action
							const response = await request(getUrl(vendor))
								.get(`/items/${localCollectionStates}`)
								.query({
									sort: 'year(test_datetime)',
									filter: { name: { _starts_with: 'state-m2o-top-sort-fn-' } },
								})
								.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

							const response2 = await request(getUrl(vendor))
								.get(`/items/${localCollectionStates}`)
								.query({
									sort: '-year(test_datetime)',
									filter: { name: { _starts_with: 'state-m2o-top-sort-fn-' } },
								})
								.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

							const gqlResponse = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
								query: {
									[localCollectionStates]: {
										__args: {
											sort: 'year(test_datetime)',
											filter: { name: { _starts_with: 'state-m2o-top-sort-fn-' } },
										},
										id: true,
									},
								},
							});

							const gqlResponse2 = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
								query: {
									[localCollectionStates]: {
										__args: {
											sort: '-year(test_datetime)',
											filter: { name: { _starts_with: 'state-m2o-top-sort-fn-' } },
										},
										id: true,
									},
								},
							});

							// Assert
							expect(response.statusCode).toEqual(200);
							expect(response.body.data.length).toBe(5);
							expect(response2.statusCode).toEqual(200);
							expect(response.body.data).toEqual(response2.body.data.reverse());

							expect(gqlResponse.statusCode).toEqual(200);
							expect(gqlResponse.body.data[localCollectionStates].length).toBe(5);
							expect(gqlResponse2.statusCode).toEqual(200);

							expect(gqlResponse.body.data[localCollectionStates]).toEqual(
								gqlResponse2.body.data[localCollectionStates].reverse(),
							);
						});
					});

					describe.each([-1, 1, 3])('where limit = %s', (limit) => {
						it.each(vendors)('%s', async (vendor) => {
							// Setup
							const expectedLength = limit === -1 ? 5 : limit;
							const expectedAsc = [1, 2, 3, 4, 5].slice(0, expectedLength);
							const expectedDesc = [5, 4, 3, 2, 1].slice(0, expectedLength);

							// Action
							const response = await request(getUrl(vendor))
								.get(`/items/${localCollectionStates}`)
								.query({
									sort: 'year(test_datetime)',
									filter: { name: { _starts_with: 'state-m2o-top-sort-fn-' } },
									limit,
									fields: 'year(test_datetime)',
								})
								.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

							const response2 = await request(getUrl(vendor))
								.get(`/items/${localCollectionStates}`)
								.query({
									sort: '-year(test_datetime)',
									filter: { name: { _starts_with: 'state-m2o-top-sort-fn-' } },
									limit,
									fields: 'year(test_datetime)',
								})
								.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

							const gqlResponse = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
								query: {
									[localCollectionStates]: {
										__args: {
											sort: 'year(test_datetime)',
											filter: { name: { _starts_with: 'state-m2o-top-sort-fn-' } },
											limit,
										},
										id: true,
										test_datetime_func: {
											year: true,
										},
									},
								},
							});

							const gqlResponse2 = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
								query: {
									[localCollectionStates]: {
										__args: {
											sort: '-year(test_datetime)',
											filter: { name: { _starts_with: 'state-m2o-top-sort-fn-' } },
											limit,
										},
										id: true,
										test_datetime_func: {
											year: true,
										},
									},
								},
							});

							// Assert
							expect(response.statusCode).toEqual(200);
							expect(response.body.data.length).toBe(expectedLength);
							expect(response2.statusCode).toEqual(200);
							expect(response.body.data).not.toEqual(response2.body.data);

							expect(
								response.body.data.map((item: any) => {
									return parseInt(item.test_datetime_year.toString().slice(-1));
								}),
							).toEqual(expectedAsc);

							expect(
								response2.body.data.map((item: any) => {
									return parseInt(item.test_datetime_year.toString().slice(-1));
								}),
							).toEqual(expectedDesc);

							expect(gqlResponse.statusCode).toEqual(200);
							expect(gqlResponse.body.data[localCollectionStates].length).toBe(expectedLength);
							expect(gqlResponse2.statusCode).toEqual(200);

							expect(gqlResponse.body.data[localCollectionStates]).not.toEqual(
								gqlResponse2.body.data[localCollectionStates],
							);

							expect(
								gqlResponse.body.data[localCollectionStates].map((item: any) => {
									return parseInt(item.test_datetime_func.year.toString().slice(-1));
								}),
							).toEqual(expectedAsc);

							expect(
								gqlResponse2.body.data[localCollectionStates].map((item: any) => {
									return parseInt(item.test_datetime_func.year.toString().slice(-1));
								}),
							).toEqual(expectedDesc);
						});
					});
				});

				describe('on m2o level', () => {
					beforeAll(async () => {
						for (const vendor of vendors) {
							// Setup
							const sortValues = [4, 2, 3, 5, 1];

							for (const val of sortValues) {
								const country = createCountry(pkType);
								country.name = 'country-m2o-sort-fn-' + randomUUID();

								country.test_datetime = new Date(new Date().setFullYear(parseInt(`202${val}`)))
									.toISOString()
									.slice(0, 19);

								const insertedCountry = await CreateItem(vendor, {
									collection: localCollectionCountries,
									item: country,
								});

								const state = createState(pkType);
								state.name = 'state-m2o-sort-fn-' + randomUUID();
								state.country_id = insertedCountry.id;
								await CreateItem(vendor, { collection: localCollectionStates, item: state });
							}
						}
					});

					describe('without limit', () => {
						it.each(vendors)('%s', async (vendor) => {
							// Action
							const response = await request(getUrl(vendor))
								.get(`/items/${localCollectionStates}`)
								.query({
									sort: 'country_id.year(test_datetime)',
									filter: { name: { _starts_with: 'state-m2o-sort-fn-' } },
								})
								.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

							const response2 = await request(getUrl(vendor))
								.get(`/items/${localCollectionStates}`)
								.query({
									sort: '-country_id.year(test_datetime)',
									filter: { name: { _starts_with: 'state-m2o-sort-fn-' } },
								})
								.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

							const gqlResponse = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
								query: {
									[localCollectionStates]: {
										__args: {
											sort: 'country_id.year(test_datetime)',
											filter: { name: { _starts_with: 'state-m2o-sort-fn-' } },
										},
										id: true,
									},
								},
							});

							const gqlResponse2 = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
								query: {
									[localCollectionStates]: {
										__args: {
											sort: '-country_id.year(test_datetime)',
											filter: { name: { _starts_with: 'state-m2o-sort-fn-' } },
										},
										id: true,
									},
								},
							});

							// Assert
							expect(response.statusCode).toEqual(200);
							expect(response.body.data.length).toBe(5);
							expect(response2.statusCode).toEqual(200);
							expect(response.body.data).toEqual(response2.body.data.reverse());

							expect(gqlResponse.statusCode).toEqual(200);
							expect(gqlResponse.body.data[localCollectionStates].length).toBe(5);
							expect(gqlResponse2.statusCode).toEqual(200);

							expect(gqlResponse.body.data[localCollectionStates]).toEqual(
								gqlResponse2.body.data[localCollectionStates].reverse(),
							);
						});
					});

					describe.each([-1, 1, 3])('where limit = %s', (limit) => {
						it.each(vendors)('%s', async (vendor) => {
							// Setup
							const expectedLength = limit === -1 ? 5 : limit;
							const expectedAsc = [1, 2, 3, 4, 5].slice(0, expectedLength);
							const expectedDesc = [5, 4, 3, 2, 1].slice(0, expectedLength);

							// Action
							const response = await request(getUrl(vendor))
								.get(`/items/${localCollectionStates}`)
								.query({
									sort: 'country_id.year(test_datetime)',
									filter: { name: { _starts_with: 'state-m2o-sort-fn-' } },
									limit,
									fields: 'country_id.year(test_datetime)',
								})
								.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

							const response2 = await request(getUrl(vendor))
								.get(`/items/${localCollectionStates}`)
								.query({
									sort: '-country_id.year(test_datetime)',
									filter: { name: { _starts_with: 'state-m2o-sort-fn-' } },
									limit,
									fields: 'country_id.year(test_datetime)',
								})
								.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

							const gqlResponse = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
								query: {
									[localCollectionStates]: {
										__args: {
											sort: 'country_id.year(test_datetime)',
											filter: { name: { _starts_with: 'state-m2o-sort-fn-' } },
											limit,
										},
										id: true,
										country_id: {
											test_datetime_func: {
												year: true,
											},
										},
									},
								},
							});

							const gqlResponse2 = await requestGraphQL(getUrl(vendor), false, USER.ADMIN.TOKEN, {
								query: {
									[localCollectionStates]: {
										__args: {
											sort: '-country_id.year(test_datetime)',
											filter: { name: { _starts_with: 'state-m2o-sort-fn-' } },
											limit,
										},
										id: true,
										country_id: {
											test_datetime_func: {
												year: true,
											},
										},
									},
								},
							});

							// Assert
							expect(response.statusCode).toEqual(200);
							expect(response.body.data.length).toBe(expectedLength);
							expect(response2.statusCode).toEqual(200);
							expect(response.body.data).not.toEqual(response2.body.data);

							expect(
								response.body.data.map((item: any) => {
									return parseInt(item.country_id.test_datetime_year.toString().slice(-1));
								}),
							).toEqual(expectedAsc);

							expect(
								response2.body.data.map((item: any) => {
									return parseInt(item.country_id.test_datetime_year.toString().slice(-1));
								}),
							).toEqual(expectedDesc);

							expect(gqlResponse.statusCode).toEqual(200);
							expect(gqlResponse.body.data[localCollectionStates].length).toBe(expectedLength);
							expect(gqlResponse2.statusCode).toEqual(200);

							expect(gqlResponse.body.data[localCollectionStates]).not.toEqual(
								gqlResponse2.body.data[localCollectionStates],
							);

							expect(
								gqlResponse.body.data[localCollectionStates].map((item: any) => {
									return parseInt(item.country_id.test_datetime_func.year.toString().slice(-1));
								}),
							).toEqual(expectedAsc);

							expect(
								gqlResponse2.body.data[localCollectionStates].map((item: any) => {
									return parseInt(item.country_id.test_datetime_func.year.toString().slice(-1));
								}),
							).toEqual(expectedDesc);
						});
					});
				});
			});

			CheckQueryFilters(
				{
					method: 'get',
					path: `/items/${localCollectionCountries}`,
					token: USER.ADMIN.TOKEN,
				},
				localCollectionCountries,
				getTestsSchema(pkType)[localCollectionCountries],
				vendorSchemaValues,
			);

			CheckQueryFilters(
				{
					method: 'get',
					path: `/items/${localCollectionStates}`,
					token: USER.ADMIN.TOKEN,
				},
				localCollectionStates,
				getTestsSchema(pkType)[localCollectionStates],
				vendorSchemaValues,
			);

			CheckQueryFilters(
				{
					method: 'get',
					path: `/items/${localCollectionCities}`,
					token: USER.ADMIN.TOKEN,
				},
				localCollectionCities,
				getTestsSchema(pkType)[localCollectionCities],
				vendorSchemaValues,
			);
		});

		describe('Meta Service Tests', () => {
			describe('retrieves filter count correctly', () => {
				it.each(vendors)('%s', async (vendor) => {
					// Setup
					const name = 'test-meta-service-count';
					const country = createCountry(pkType);
					const country2 = createCountry(pkType);

					country.name = name;
					country2.name = name;

					const insertedCountry = await CreateItem(vendor, {
						collection: localCollectionCountries,
						item: country,
					});

					const insertedCountry2 = await CreateItem(vendor, {
						collection: localCollectionCountries,
						item: country2,
					});

					const state = createState(pkType);
					const state2 = createState(pkType);

					state.name = name;
					state2.name = name;
					state.country_id = insertedCountry.id;
					state2.country_id = insertedCountry2.id;

					await CreateItem(vendor, {
						collection: localCollectionStates,
						item: [state, state2],
					});

					// Action
					const response = await request(getUrl(vendor))
						.get(`/items/${localCollectionStates}`)
						.query({
							filter: JSON.stringify({
								name: { _eq: name },
								country_id: {
									name: {
										_eq: name,
									},
								},
							}),
							meta: '*',
						})
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					// Assert
					expect(response.statusCode).toBe(200);
					expect(response.body.meta.filter_count).toBe(2);
					expect(response.body.data.length).toBe(2);
				});
			});
		});

		test('Auto Increment Tests', (ctx) => {
			if (pkType !== 'integer') ctx.skip();

			describe('updates the auto increment value correctly', () => {
				it.each(without(vendors, 'cockroachdb', 'mssql', 'oracle'))('%s', async (vendor) => {
					// Setup
					const name = 'test-auto-increment-m2o';
					const largeIdCity = 102222;
					const largeIdState = 103333;
					const largeIdCountry = 104444;
					const city = createCity(pkType);
					const city2 = createCity(pkType);
					const state = createState(pkType);
					const state2 = createState(pkType);
					const country = createCountry(pkType);
					const country2 = createCountry(pkType);

					city.id = largeIdCity;
					state.id = largeIdState;
					country.id = largeIdCountry;
					city.name = name;
					city2.name = name;
					state.name = name;
					state2.name = name;
					country.name = name;
					country2.name = name;

					await CreateItem(vendor, {
						collection: localCollectionCities,
						item: [
							{
								...city,
								state_id: {
									...state,
									country_id: country,
								},
							},
							{
								...city2,
								state_id: {
									...state2,
									country_id: country2,
								},
							},
						],
					});

					// Action
					const response = await request(getUrl(vendor))
						.get(`/items/${localCollectionCities}`)
						.query({
							filter: JSON.stringify({
								name: { _eq: name },
							}),
							fields: 'id,state_id.id,state_id.country_id.id',
						})
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					// Assert
					expect(response.statusCode).toBe(200);
					expect(response.body.data.length).toBe(2);

					expect(response.body.data.map((city: any) => city.id)).toEqual(
						Array.from({ length: 2 }, (_, index) => largeIdCity + index),
					);

					expect(response.body.data.map((city: any) => city.state_id.id)).toEqual(
						Array.from({ length: 2 }, (_, index) => largeIdState + index),
					);

					expect(response.body.data.map((city: any) => city.state_id.country_id.id)).toEqual(
						Array.from({ length: 2 }, (_, index) => largeIdCountry + index),
					);
				});
			});
		});
	});
});
