import { useLocalStorage } from "@vueuse/core";
import { defineStore } from "pinia";
import { ref } from "vue";

//#region src/app.ts
/**
* Global application state
*/
const useAppStore = defineStore("appStore", () => {
	return {
		navbarOpen: useLocalStorage("app-store-navbar-open", window.innerWidth >= 1430),
		sidebarOpen: useLocalStorage("app-store-sidebar-open", window.innerWidth >= 1430),
		notificationsDrawerOpen: ref(false),
		fullScreen: ref(false),
		hydrated: ref(false),
		hydrating: ref(false),
		error: ref(null),
		authenticated: ref(false),
		accessTokenExpiry: ref(0),
		basemap: ref("OpenStreetMap")
	};
});

//#endregion
export { useAppStore };