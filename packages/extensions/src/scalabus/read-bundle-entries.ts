import { BUNDLE_ENTRIES_FORMAT, type BundleApiEntry } from './define-entry.js';

/**
 * The entries of a bundle's built `api.js`, whichever way it declares them:
 * `defineBundleApi([...])`, or the `{ hooks, endpoints, operations }` the
 * package.json `entries` build generates.
 */
export function readBundleEntries(bundleModule: unknown): BundleApiEntry[] {
	if (typeof bundleModule !== 'object' || bundleModule === null) {
		throw new Error(
			`Bundle module exports ${JSON.stringify(typeof bundleModule)}`
				+ ' instead of its entries',
		);
	}

	if ('format' in bundleModule) {
		if (bundleModule.format !== BUNDLE_ENTRIES_FORMAT) {
			throw new Error(
				'Bundle module declares an unknown format '
					+ `${JSON.stringify(bundleModule.format)};`
					+ ` expected ${JSON.stringify(BUNDLE_ENTRIES_FORMAT)}`,
			);
		}

		return (bundleModule as { entries: BundleApiEntry[] }).entries;
	}

	if (
		'hooks' in bundleModule
		&& 'endpoints' in bundleModule
		&& 'operations' in bundleModule
	) {
		const legacyModule = bundleModule as Record<
			'hooks' | 'endpoints' | 'operations',
			{ name: string; config: any }[]
		>;

		return [
			...legacyModule.hooks.map(({ name, config }) => {
				return { type: 'hook' as const, name, config };
			}),
			...legacyModule.endpoints.map(({ name, config }) => {
				return { type: 'endpoint' as const, name, config };
			}),
			...legacyModule.operations.map(({ name, config }) => {
				return { type: 'operation' as const, name, config };
			}),
		];
	}

	throw new Error(
		`Bundle module exports neither ${JSON.stringify(BUNDLE_ENTRIES_FORMAT)} entries`
			+ ` nor "hooks", "endpoints" and "operations"`,
	);
}
