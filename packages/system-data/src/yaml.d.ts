// Ambient declarations for the `*.yaml` imports unplugin-yaml resolves at
// build time, so type-checking does not lean on the plugin's own types path.
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
