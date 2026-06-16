import { defineStore } from "pinia";
import { ref } from "vue";

//#region src/app.ts
/**
* Global application state
*/
const useAppStore = defineStore("appStore", () => {
	return {
		notificationsDrawerOpen: ref(false),
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