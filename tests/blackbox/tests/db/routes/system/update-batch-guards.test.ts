import { getUrl } from '@common/config';
import {
	defineFeature,
	loadFeature,
	parseGherkinTable,
	type StepFunctions,
} from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { randomUUID } from 'crypto';
import { load as loadYaml } from 'js-yaml';
import request, { type Response } from 'supertest';
import { describe, expect } from 'vitest';

type RequestCell = {
	as?: string;
	method: 'GET' | 'PATCH';
	path: string;
	query?: Record<string, string>;
	payload?: unknown;
};

type Batch = {
	run: string;
	keysByName: Record<string, string>;
	tokensByName: Record<string, string>;
};

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

const feature = loadFeature(
	'./tests/db/routes/system/update-batch-guards.feature',
);

describe.each(vendors)('%s', (vendor) => {
	// `<run>` and every `<name>` a Given created; anything else stays as written.
	function withKeys(cell: string, batch: Batch) {
		return cell.replaceAll(/<([\w-]+)>/g, (placeholder, name: string) => {
			if (name === 'run') {
				return batch.run;
			}

			return batch.keysByName[name] ?? placeholder;
		});
	}

	// A cell is YAML: the fork's multiline notation dedents it as a block.
	function sendRequest(requestCell: string, batch: Batch) {
		const { as: name, method, path, query = {}, payload } = loadYaml(
			requestCell,
		) as RequestCell;

		const pendingRequest = method === 'PATCH'
			? request(getUrl(vendor)).patch(path)
			: request(getUrl(vendor)).get(path);

		pendingRequest.query(query).set(
			'Authorization',
			name === undefined
				? AUTH
				: `Bearer ${batch.tokensByName[name]}`,
		);

		return payload === undefined
			? pendingRequest
			: pendingRequest.send(payload as object);
	}

	function defineSteps({ given, and, then }: StepFunctions, batch: Batch) {
		// One row at a time, so a row can name one created before it.
		async function createRows(path: string, table: Record<string, string>[]) {
			for (const row of table) {
				const { as: name, ...cells } = row;

				const [rowToCreate] = parseGherkinTable(
					[Object.fromEntries(Object.entries(cells).map(([column, cell]) => {
						return [column, withKeys(cell, batch)];
					}))],
				);

				const response = await request(getUrl(vendor))
					.post(path)
					.query({ fields: 'id' })
					.send(rowToCreate)
					.set('Authorization', AUTH);

				expect(response.statusCode).toEqual(200);

				batch.keysByName[name!] = String(response.body.data.id);
			}
		}

		given(/^the rows of (\S+):$/, createRows);

		// `.optional` binds on the step's text, so it names the one path a second
		// Given creates rows of: the versions of the item the first one created.
		and.optional(/^the rows of (\/versions):$/, createRows);

		and.optional(
			/^a user who may update only their own row, as (\S+)$/,
			async (name: string) => {
				const policyResponse = await request(getUrl(vendor))
					.post('/policies')
					.send({
						name: `update-self-${batch.run}`,
						app_access: false,
						admin_access: false,
						permissions: [{
							collection: 'directus_users',
							action: 'update',
							fields: ['*'],
							permissions: { id: { _eq: '$CURRENT_USER' } },
						}],
					})
					.set('Authorization', AUTH);

				expect(policyResponse.statusCode).toEqual(200);

				const token = randomUUID();

				const userResponse = await request(getUrl(vendor))
					.post('/users')
					.query({ fields: 'id' })
					.send({
						first_name: name,
						email: `${name}-${batch.run}@example.com`,
						token,
						policies: [{ policy: policyResponse.body.data.id }],
					})
					.set('Authorization', AUTH);

				expect(userResponse.statusCode).toEqual(200);

				batch.keysByName[name] = String(userResponse.body.data.id);
				batch.tokensByName[name] = token;
			},
		);

		// A response cell states the keys it checks; an array still has to hold as
		// many items as it states.
		then(
			'these requests get these responses:',
			async (table: { request: string; response: string }[]) => {
				const responses: Response[] = [];

				for (const { request: requestCell } of table) {
					responses.push(
						await sendRequest(withKeys(requestCell, batch), batch),
					);
				}

				expect(responses.map((response) => {
					return { code: response.statusCode, body: response.body };
				})).toMatchObject(table.map(({ response }) => {
					return loadYaml(withKeys(response, batch)) ?? {};
				}));
			},
		);
	}

	defineFeature(feature, (scenario) => {
		for (const title of [
			'a batch setting a tfa_secret is refused and writes nothing',
			'a batch giving two users one email is refused and writes nothing',
			'a batch naming a user its sender may not update is forbidden',
			'a batch making a role its own parent is refused and writes nothing',
			'a batch moving a role under its own child is refused, writing nothing',
			'a batch putting two roles under each other is refused, writing nothing',
			'a batch closing a loop through three roles is refused, writing nothing',
			'a batch moving a role under its child while freeing the child is applied',
			'a batch setting an invalid ip_access on a policy is refused',
			'a batch giving two translations one key and language is refused',
			'a batch giving a version the reserved key "main" is refused',
			'a batch giving two versions of one item the same key is refused',
			'a batch moving an email to a user while freeing it is applied',
			'a batch moving a translation key to a row while freeing it is applied',
			'a batch moving a version key to a version while freeing it is applied',
		]) {
			scenario(title, (steps) => {
				defineSteps(steps, {
					run: randomUUID(),
					keysByName: {},
					tokensByName: {},
				});
			}, 60_000);
		}
	});
});
