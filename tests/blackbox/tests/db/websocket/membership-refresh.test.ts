import { getUrl } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { insertTableRows, bindTableRowsSteps } from '@common/table-rows';
import { createWebSocketConn } from '@common/transport';
import { USER } from '@common/variables';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect } from 'vitest';
import { WebSocket } from 'ws';
import {
	type ScenarioKeys,
	withKeys,
} from '../routes/system/spawned-write-steps';
import { collectionMembershipNotes } from './membership-refresh.seed';

const feature = loadFeature('./tests/db/websocket/membership-refresh.feature');

const scenarioTitles = [
	'a role taken away ends what a socket opened before hears',
	'a membership moved to another role ends what a socket opened before hears',
	'a socket whose roles could not be refreshed is closed, told why',
];

describe.each(vendors)('%s', (vendor) => {
	defineFeature(feature, (scenario) => {
		for (const scenarioTitle of scenarioTitles) {
			scenario(scenarioTitle, ({ given, and, when, then }) => {
				const scenarioKeys: ScenarioKeys = { run: randomUUID(), keysByName: {} };
				let memberSocket: ReturnType<typeof createWebSocketConn>;

				bindTableRowsSteps(given, feature, scenarioTitle, (tableName, tableRows) => {
					return insertTableRows(vendor, tableName, tableRows.map((tableRow) => {
						return Object.fromEntries(Object.entries(tableRow)
							.map(([column, cell]) => [column, withKeys(cell, scenarioKeys)]));
					}));
				});

				and('the member\'s socket subscribed to the notes', async () => {
					memberSocket = createWebSocketConn(getUrl(vendor), {
						auth: { access_token: `member-${scenarioKeys.run}` },
					});

					await memberSocket.subscribe({
						uid: 'notes',
						collection: collectionMembershipNotes,
						event: 'create',
						query: { fields: ['label'] },
					});
				});

				and.optional('the next read of the member\'s roles fails', async () => {
					const response = await request(getUrl(vendor))
						.post('/roles-refresh-failure/arm')
						.send({ user: withKeys('<member>', scenarioKeys) })
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					expect(response.statusCode).toEqual(200);
				});

				when.optional('the admin takes every role of the member away', async () => {
					const response = await request(getUrl(vendor))
						.patch(`/users/${withKeys('<member>', scenarioKeys)}`)
						.send({ roles: [] })
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					expect(response.statusCode).toEqual(200);
				});

				when.optional(
					'the admin moves the membership of the member to the other role',
					async () => {
						const response = await request(getUrl(vendor))
							.patch(`/users/${withKeys('<member>', scenarioKeys)}`)
							.send({
								roles: {
									update: [
										{
											id: withKeys('<membership>', scenarioKeys),
											role: withKeys('<other-role>', scenarioKeys),
										},
									],
								},
							})
							.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

						expect(response.statusCode).toEqual(200);
					},
				);

				and.optional(/^the admin creates the note "(.+)"$/, async (label: string) => {
					const response = await request(getUrl(vendor))
						.post(`/items/${collectionMembershipNotes}`)
						.send({ label: withKeys(label, scenarioKeys) })
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					expect(response.statusCode).toEqual(200);
				});

				// Refused, it carries no uid: WebSocketError.fromError drops it.
				then.optional('the member\'s socket is refused the note', async () => {
					expect(await memberSocket.getMessages(1)).toEqual([
						{
							type: 'subscribe',
							status: 'error',
							error: {
								code: 'FORBIDDEN',
								message: 'You don\'t have permission to access collection'
									+ ' "test_ws_membership_notes" or it does not exist.'
									+ ' Queried in root.',
							},
						},
					]);
				});

				// The subscribe reply alone.
				and.optional('the member\'s socket heard of no note', async () => {
					memberSocket.conn.close();

					expect(memberSocket.getMessageCount('notes')).toBe(1);
				});

				then.optional(
					'the member\'s socket is told its roles could not be refreshed',
					async () => {
						// The server closes the socket right after telling it, so the
						// message is read off a closed socket.
						expect(await memberSocket.getMessages(1, {
							targetState: WebSocket.CLOSED,
						})).toEqual([
							{
								type: 'auth',
								status: 'error',
								error: {
									code: 'ROLES_REFRESH_FAILED',
									message: 'The memberships of user'
										+ ` ${JSON.stringify(withKeys('<member>', scenarioKeys))}`
										+ ' changed and the roles of this socket could not be'
										+ ' refreshed: reconnect to authenticate again.',
								},
							},
						]);
					},
				);

				and.optional('the member\'s socket is closed', async () => {
					await memberSocket.waitForState(WebSocket.CLOSED);

					expect(memberSocket.conn.readyState).toBe(WebSocket.CLOSED);
				});
			}, 60_000);
		}
	});
});
