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

type DeclaredPassthroughKeys<NamePrefix extends string> =
	keyof typeof ENV_VAR_PATTERN_DECLARATIONS extends infer DeclaredName
		? DeclaredName extends `${NamePrefix}${infer PassthroughKey}`
			? PassthroughKey extends `${string}*${string}` ? never : PassthroughKey
			: never
		: never;

type LibraryEnvVarKeys<LibraryOptions> = ScreamingSnakeCase<
	keyof LibraryOptions & string
>;

type ServiceProviderSettings = NonNullable<
	Parameters<typeof ServiceProvider>[0]
>;

type IdentityProviderSettings = NonNullable<
	Parameters<typeof IdentityProvider>[0]
>;

// A declared passthrough key no library reads is a typo that types nothing
test('every typed passthrough key exists in its library', () => {
	expectTypeOf<
		Exclude<
			DeclaredPassthroughKeys<'DB_SSL__'>,
			LibraryEnvVarKeys<ConnectionOptions>
		>
	>().toEqualTypeOf<never>();

	expectTypeOf<
		Exclude<
			DeclaredPassthroughKeys<'DB_CONNECTION_*_SSL__'>,
			LibraryEnvVarKeys<ConnectionOptions>
		>
	>().toEqualTypeOf<never>();

	expectTypeOf<
		Exclude<
			DeclaredPassthroughKeys<'AUTH_*_CLIENT_HTTP_'>,
			LibraryEnvVarKeys<HttpOptions>
		>
	>().toEqualTypeOf<never>();

	expectTypeOf<
		Exclude<
			DeclaredPassthroughKeys<'AUTH_*_SP_'>,
			LibraryEnvVarKeys<ServiceProviderSettings>
		>
	>().toEqualTypeOf<never>();

	expectTypeOf<
		Exclude<
			DeclaredPassthroughKeys<'AUTH_*_IDP_'>,
			LibraryEnvVarKeys<IdentityProviderSettings>
		>
	>().toEqualTypeOf<never>();
});
