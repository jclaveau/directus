declare module '*.vue' {
	import type { DefineComponent } from 'vue';

	const vueComponent: DefineComponent;

	export default vueComponent;
}
