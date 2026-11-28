/**
 * Whether a provider's login carries an email it doesn't vouch for while
 * REQUIRE_VERIFIED_EMAIL is on, its default. Cognito sends the flag as the
 * string "true".
 */
export function isEmailUnverified(
	providerConfig: Record<string, any>,
	verifiedFlag: unknown,
): boolean {
	if (providerConfig['requireVerifiedEmail'] === false) {
		return false;
	}

	return !isEmailVouched(verifiedFlag);
}

/**
 * Whether a provider's verified flag vouches for its email: the `verified` of
 * the email identity it adds.
 */
export function isEmailVouched(verifiedFlag: unknown): boolean {
	return verifiedFlag === true || verifiedFlag === 'true';
}

/**
 * The boot refusal of a provider whose driver can't tell a verified email
 * while REQUIRE_VERIFIED_EMAIL is on: oauth2 without EMAIL_VERIFIED_KEY,
 * saml and ldap. Null when the provider can tell, or doesn't require it.
 * An openid IdP that never sends email_verified still boots: every first
 * login is then refused, with a warn line.
 */
export function describeUnverifiableEmail(
	providerName: string,
	providerConfig: Record<string, any>,
): string | null {
	const { driver, requireVerifiedEmail, emailVerifiedKey } = providerConfig;

	const driverTells = driver === 'openid'
		|| (driver === 'oauth2' && Boolean(emailVerifiedKey))
		|| ![
			'oauth2',
			'saml',
			'ldap',
		].includes(driver);

	if (requireVerifiedEmail === false || driverTells) {
		return null;
	}

	const envPrefix = `AUTH_${providerName.toUpperCase()}_`;
	const requireKey = JSON.stringify(`${envPrefix}REQUIRE_VERIFIED_EMAIL`);
	const disableHint = `set ${requireKey} to false`;

	const fixHint = driver === 'oauth2'
		? `set ${JSON.stringify(`${envPrefix}EMAIL_VERIFIED_KEY`)}, or ${disableHint}`
		: disableHint;

	const defaultNote = requireVerifiedEmail === undefined
		? ' by default'
		: '';

	return `${requireKey} is true${defaultNote}, but provider`
		+ ` ${JSON.stringify(providerName)} (${driver}) can't tell a verified`
		+ ` email: ${fixHint}`;
}
