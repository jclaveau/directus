// Local ambient declarations for the esbuild-yaml plugin's `*.yaml` imports.
// esbuild-yaml v3.2 dropped the `esbuild-yaml/types` subpath; declaring locally keeps
// type-checking working across versions without depending on the package's types path.
declare module '*.yaml' {
	const value: Record<string, unknown>;
	export default value;
}

declare module '*.yml' {
	const value: Record<string, unknown>;
	export default value;
}

declare module '*.yaml?raw' {
	const value: string;
	export default value;
}

declare module '*.yml?raw' {
	const value: string;
	export default value;
}
