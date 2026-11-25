import { getUrl } from '@common/config';
import {
	CreateCollection,
	DeleteCollection,
	DeleteCollectionIfPresent,
} from '@common/functions';
import { USER } from '@common/variables';
import request from 'supertest';
import { expect } from 'vitest';
import { defineSsoFeature, SSO_CLIENT_ID } from './sso-steps';

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

// The roles the feature names `sso_peer_staff` and `sso_peer_auditors`, and
// the policy giving the first its read.
const STAFF_ROLE_ID = '3d9a4c17-6e2b-4f80-9b15-2a7c8e4f1d36';
const AUDITORS_ROLE_ID = '8f1b6e2c-4a37-4d95-8c20-5e9d1a3b7f48';
const READER_POLICY_ID = 'c2e7a915-0b4d-4f68-a3e1-9d5f2b8c6a71';

const NOTES_COLLECTION = 'sso_peer_notes';

defineSsoFeature(
	'./tests/db/routes/auth/sso-login-peer.feature',
	(issuerUrlByProvider) => {
		const oauthUrl = issuerUrlByProvider['mockoauth'];

		return {
			CACHE_ENABLED: 'true',
			CACHE_STATUS_HEADER: 'x-cache-status',
			CACHE_AUTO_PURGE: 'true',
			CACHE_STORE: 'memory',
			REDIS_HOST: 'localhost',
			REDIS_PORT: '6108',
			CACHE_NAMESPACE: 'directus-sso-login-peer',

			AUTH_PROVIDERS: 'mockoauth',

			AUTH_MOCKOAUTH_DRIVER: 'oauth2',
			AUTH_MOCKOAUTH_REQUIRE_VERIFIED_EMAIL: 'false',
			AUTH_MOCKOAUTH_MODE: 'json',
			AUTH_MOCKOAUTH_CLIENT_ID: SSO_CLIENT_ID,
			AUTH_MOCKOAUTH_CLIENT_SECRET: 'sso-blackbox-secret',
			AUTH_MOCKOAUTH_AUTHORIZE_URL: `${oauthUrl}/authorize`,
			AUTH_MOCKOAUTH_ACCESS_URL: `${oauthUrl}/token`,
			AUTH_MOCKOAUTH_PROFILE_URL: `${oauthUrl}/userinfo`,
			AUTH_MOCKOAUTH_IDENTIFIER_KEY: 'sub',
			AUTH_MOCKOAUTH_ALLOW_PUBLIC_REGISTRATION: 'true',
			AUTH_MOCKOAUTH_SYNC_USER_INFO: 'true',
			AUTH_MOCKOAUTH_ROLE_MAPPING:
				`json:${JSON.stringify({
					staff: STAFF_ROLE_ID,
					auditors: AUDITORS_ROLE_ID,
				})}`,
		};
	},
	{
		spawnsPeer: true,
		async beforeFeature(vendor) {
			await DeleteCollectionIfPresent(vendor, { collection: NOTES_COLLECTION });

			await CreateCollection(vendor, {
				collection: NOTES_COLLECTION,
				fields: [{ field: 'label', type: 'string', meta: {} }],
			});

			const createdNote = await request(getUrl(vendor))
				.post(`/items/${NOTES_COLLECTION}`)
				.send({ id: 1, label: 'v1' })
				.set('Authorization', AUTH);

			expect(createdNote.statusCode).toBe(200);

			const createdPolicy = await request(getUrl(vendor))
				.post('/policies')
				.send({
					id: READER_POLICY_ID,
					name: 'sso_peer_reader',
					app_access: false,
					admin_access: false,
					permissions: [
						{ collection: NOTES_COLLECTION, action: 'read', fields: ['*'] },
					],
				})
				.set('Authorization', AUTH);

			expect(createdPolicy.statusCode).toBe(200);

			const createdRoles = await request(getUrl(vendor))
				.post('/roles')
				.send([
					{
						id: STAFF_ROLE_ID,
						name: 'sso_peer_staff',
						policies: [{ policy: READER_POLICY_ID }],
					},
					{ id: AUDITORS_ROLE_ID, name: 'sso_peer_auditors' },
				])
				.set('Authorization', AUTH);

			expect(createdRoles.statusCode).toBe(200);
		},
		// The user the logins created, then the roles, the policy, the notes.
		async afterFeature(vendor) {
			const ssoUsers = await request(getUrl(vendor))
				.get('/users')
				.query({
					fields: 'id',
					filter: JSON.stringify({ external_identifier: { _eq: 'grace-oauth' } }),
				})
				.set('Authorization', AUTH);

			expect(ssoUsers.statusCode).toBe(200);

			const ssoUserIds = ssoUsers.body.data.map((user: { id: string }) => {
				return user.id;
			});

			if (ssoUserIds.length > 0) {
				const deletedUsers = await request(getUrl(vendor))
					.delete('/users')
					.send(ssoUserIds)
					.set('Authorization', AUTH);

				expect(deletedUsers.statusCode).toBe(204);
			}

			const deletedRoles = await request(getUrl(vendor))
				.delete('/roles')
				.send([STAFF_ROLE_ID, AUDITORS_ROLE_ID])
				.set('Authorization', AUTH);

			expect(deletedRoles.statusCode).toBe(204);

			const deletedPolicy = await request(getUrl(vendor))
				.delete(`/policies/${READER_POLICY_ID}`)
				.set('Authorization', AUTH);

			expect(deletedPolicy.statusCode).toBe(204);

			await DeleteCollection(vendor, { collection: NOTES_COLLECTION });
		},
	},
);
