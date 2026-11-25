import { getUrl } from '@common/config';
import { USER } from '@common/variables';
import request from 'supertest';
import { expect } from 'vitest';
import { defineSsoFeature, SSO_CLIENT_ID } from './sso-steps';

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

// The role the feature names `<invited-role>`.
const INVITED_ROLE_ID = '3d7a9c15-6b2e-4f80-9a1c-5e8d2b7f4a36';

defineSsoFeature(
	'./tests/db/routes/auth/sso-login-invite.feature',
	(issuerUrlByProvider) => {
		const oauthUrl = issuerUrlByProvider['mockoauth'];

		return {
			AUTH_PROVIDERS: 'mockoauth,mockopenid',

			AUTH_MOCKOAUTH_DRIVER: 'oauth2',
			AUTH_MOCKOAUTH_REQUIRE_VERIFIED_EMAIL: 'false',
			AUTH_MOCKOAUTH_MODE: 'json',
			AUTH_MOCKOAUTH_CLIENT_ID: SSO_CLIENT_ID,
			AUTH_MOCKOAUTH_CLIENT_SECRET: 'sso-blackbox-secret',
			AUTH_MOCKOAUTH_AUTHORIZE_URL: `${oauthUrl}/authorize`,
			AUTH_MOCKOAUTH_ACCESS_URL: `${oauthUrl}/token`,
			AUTH_MOCKOAUTH_PROFILE_URL: `${oauthUrl}/userinfo`,
			AUTH_MOCKOAUTH_IDENTIFIER_KEY: 'sub',
			AUTH_MOCKOAUTH_ALLOW_PUBLIC_REGISTRATION: 'false',

			AUTH_MOCKOPENID_DRIVER: 'openid',
			AUTH_MOCKOPENID_REQUIRE_VERIFIED_EMAIL: 'false',
			AUTH_MOCKOPENID_MODE: 'json',
			AUTH_MOCKOPENID_CLIENT_ID: SSO_CLIENT_ID,
			AUTH_MOCKOPENID_CLIENT_SECRET: 'sso-blackbox-secret',
			AUTH_MOCKOPENID_ISSUER_URL: issuerUrlByProvider['mockopenid']!,
			AUTH_MOCKOPENID_ALLOW_PUBLIC_REGISTRATION: 'false',
		};
	},
	{
		keysByName: { 'invited-role': INVITED_ROLE_ID },
		async beforeFeature(vendor) {
			const created = await request(getUrl(vendor))
				.post('/roles')
				.send({ id: INVITED_ROLE_ID, name: 'sso_invited' })
				.set('Authorization', AUTH);

			expect(created.statusCode).toBe(200);
		},
		// The users the logins created, then the role, its invites with it.
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

			const deletedRole = await request(getUrl(vendor))
				.delete(`/roles/${INVITED_ROLE_ID}`)
				.set('Authorization', AUTH);

			expect(deletedRole.statusCode).toBe(204);
		},
	},
);
