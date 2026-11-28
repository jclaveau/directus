import { expect, test } from 'vitest';
import {
	describeUnverifiableEmail,
	isEmailUnverified,
} from './verified-email.js';

test.each([
	[{}, true, false],
	[{}, 'true', false],
	[{}, false, true],
	[{}, 'false', true],
	[{}, undefined, true],
	[{ requireVerifiedEmail: true }, undefined, true],
	[{ requireVerifiedEmail: false }, undefined, false],
	[{ requireVerifiedEmail: false }, false, false],
])(
	'a provider configured %j sees the flag %j as unverified: %s',
	(providerConfig, verifiedFlag, isUnverified) => {
		expect(isEmailUnverified(providerConfig, verifiedFlag)).toBe(isUnverified);
	},
);

test.each([
	[{ driver: 'openid' }],
	[{ driver: 'oauth2', emailVerifiedKey: 'verified' }],
	[{ driver: 'oauth2', requireVerifiedEmail: false }],
	[{ driver: 'saml', requireVerifiedEmail: false }],
	[{ driver: 'ldap', requireVerifiedEmail: false }],
	[{ driver: 'local' }],
])('a provider configured %j boots', (providerConfig) => {
	expect(describeUnverifiableEmail('sso', providerConfig)).toBe(null);
});

test('an oauth2 provider without the key is refused by default', () => {
	expect(describeUnverifiableEmail('mockoauth', { driver: 'oauth2' })).toBe(
		'"AUTH_MOCKOAUTH_REQUIRE_VERIFIED_EMAIL" is true by default, but provider'
		+ ' "mockoauth" (oauth2) can\'t tell a verified email:'
		+ ' set "AUTH_MOCKOAUTH_EMAIL_VERIFIED_KEY",'
		+ ' or set "AUTH_MOCKOAUTH_REQUIRE_VERIFIED_EMAIL" to false',
	);
});

test('a saml provider set to require it is refused', () => {
	expect(describeUnverifiableEmail('corp', {
		driver: 'saml',
		requireVerifiedEmail: true,
	})).toBe(
		'"AUTH_CORP_REQUIRE_VERIFIED_EMAIL" is true, but provider'
		+ ' "corp" (saml) can\'t tell a verified email:'
		+ ' set "AUTH_CORP_REQUIRE_VERIFIED_EMAIL" to false',
	);
});

test('an ldap provider is refused by default', () => {
	expect(describeUnverifiableEmail('directory', { driver: 'ldap' })).toBe(
		'"AUTH_DIRECTORY_REQUIRE_VERIFIED_EMAIL" is true by default, but provider'
		+ ' "directory" (ldap) can\'t tell a verified email:'
		+ ' set "AUTH_DIRECTORY_REQUIRE_VERIFIED_EMAIL" to false',
	);
});
