import { ENV_VAR_PATTERN_DECLARATIONS } from '@directus/env';
import type { IdentityProvider, ServiceProvider } from 'samlify';
import type { HttpOptions } from 'openid-client';
import type { ConnectionOptions } from 'node:tls';
import { expectTypeOf, test } from 'vitest';

type ScreamingSnakeCase<CamelName extends string> =
	CamelName extends `${infer FirstLetter}${infer OtherLetters}`
		? `${FirstLetter extends Uppercase<FirstLetter>
			? '_'
			: ''}${Uppercase<FirstLetter>}${ScreamingSnakeCase<OtherLetters>}`
		: CamelName;

type DeclaredKeys<NamePrefix extends string> =
	keyof typeof ENV_VAR_PATTERN_DECLARATIONS extends infer DeclaredName
		? DeclaredName extends `${NamePrefix}${infer KeyName}`
			? KeyName extends `${string}*${string}` ? never : KeyName
			: never
		: never;

type LibraryKeys<OptionSet> = ScreamingSnakeCase<keyof OptionSet & string>;

type ServiceProviderSettings = NonNullable<
	Parameters<typeof ServiceProvider>[0]
>;

type IdentityProviderSettings = NonNullable<
	Parameters<typeof IdentityProvider>[0]
>;

// A declared passthrough key no library reads is a typo that types nothing
test('every typed passthrough key exists in its library', () => {
	expectTypeOf<
		Exclude<DeclaredKeys<'DB_SSL__'>, LibraryKeys<ConnectionOptions>>
	>().toEqualTypeOf<never>();

	expectTypeOf<
		Exclude<
			DeclaredKeys<'DB_CONNECTION_*_SSL__'>,
			LibraryKeys<ConnectionOptions>
		>
	>().toEqualTypeOf<never>();

	expectTypeOf<
		Exclude<
			DeclaredKeys<'AUTH_*_CLIENT_HTTP_'>,
			LibraryKeys<HttpOptions>
		>
	>().toEqualTypeOf<never>();

	expectTypeOf<
		Exclude<
			DeclaredKeys<'AUTH_*_SP_'>,
			LibraryKeys<ServiceProviderSettings>
		>
	>().toEqualTypeOf<never>();

	expectTypeOf<
		Exclude<
			DeclaredKeys<'AUTH_*_IDP_'>,
			LibraryKeys<IdentityProviderSettings>
		>
	>().toEqualTypeOf<never>();
});
