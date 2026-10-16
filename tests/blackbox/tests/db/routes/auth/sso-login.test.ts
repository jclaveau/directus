import { getUrl } from '@common/config';
import { ROLE, USER } from '@common/variables';
import request from 'supertest';
import { expect } from 'vitest';
import { defineSsoFeature, SSO_CLIENT_ID } from './sso-steps';

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

// The role the feature names `sso_staff`.
const STAFF_ROLE_ID = '5b3e8f0a-9c41-4d6e-8a2f-1c7d3e9b6a04';

defineSsoFeature(
	'./tests/db/routes/auth/sso-login.feature',
	(issuerUrlByProvider) => {
		const oauthUrl = issuerUrlByProvider['mockoauth'];

		return {
			AUTH_PROVIDERS: 'mockoauth,mockopenid',

			AUTH_MOCKOAUTH_DRIVER: 'oauth2',
			AUTH_MOCKOAUTH_MODE: 'json',
			AUTH_MOCKOAUTH_CLIENT_ID: SSO_CLIENT_ID,
			AUTH_MOCKOAUTH_CLIENT_SECRET: 'sso-blackbox-secret',
			AUTH_MOCKOAUTH_AUTHORIZE_URL: `${oauthUrl}/authorize`,
			AUTH_MOCKOAUTH_ACCESS_URL: `${oauthUrl}/token`,
			AUTH_MOCKOAUTH_PROFILE_URL: `${oauthUrl}/userinfo`,
			AUTH_MOCKOAUTH_IDENTIFIER_KEY: 'sub',
			AUTH_MOCKOAUTH_FIRST_NAME_KEY: 'given_name',
			AUTH_MOCKOAUTH_LAST_NAME_KEY: 'family_name',
			AUTH_MOCKOAUTH_ALLOW_PUBLIC_REGISTRATION: 'true',
			AUTH_MOCKOAUTH_SYNC_USER_INFO: 'true',
			AUTH_MOCKOAUTH_DEFAULT_ROLE_ID: ROLE.TESTS_FLOW.ID,
			AUTH_MOCKOAUTH_ROLE_MAPPING:
				`json:${JSON.stringify({ staff: STAFF_ROLE_ID })}`,

			AUTH_MOCKOPENID_DRIVER: 'openid',
			AUTH_MOCKOPENID_MODE: 'json',
			AUTH_MOCKOPENID_CLIENT_ID: SSO_CLIENT_ID,
			AUTH_MOCKOPENID_CLIENT_SECRET: 'sso-blackbox-secret',
			AUTH_MOCKOPENID_ISSUER_URL: issuerUrlByProvider['mockopenid']!,
			AUTH_MOCKOPENID_ALLOW_PUBLIC_REGISTRATION: 'true',
			AUTH_MOCKOPENID_SYNC_USER_INFO: 'true',
			AUTH_MOCKOPENID_DEFAULT_ROLE_ID: ROLE.TESTS_FLOW.ID,
		};
	},
	{
		async beforeFeature(vendor) {
			const created = await request(getUrl(vendor))
				.post('/roles')
				.send({ id: STAFF_ROLE_ID, name: 'sso_staff' })
				.set('Authorization', AUTH);

			expect(created.statusCode).toBe(200);
		},
		// The users the logins created, then their role.
		async afterFeature(vendor) {
			const ssoUsers = await request(getUrl(vendor))
				.get('/users')
				.query({
					fields: 'id',
					filter: JSON.stringify({
						provider: { _in: ['mockoauth', 'mockopenid'] },
					}),
				})
				.set('Authorization', AUTH);

			await request(getUrl(vendor))
				.delete('/users')
				.send(ssoUsers.body.data.map((user: { id: string }) => user.id))
				.set('Authorization', AUTH);

			await request(getUrl(vendor))
				.delete(`/roles/${STAFF_ROLE_ID}`)
				.set('Authorization', AUTH);
		},
	},
);
