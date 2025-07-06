// src/app.ts
import { useLocalStorage } from "@vueuse/core";
import { defineStore } from "pinia";
import { ref } from "vue";
var useAppStore = defineStore("appStore", () => {
  const navbarOpen = useLocalStorage("app-store-navbar-open", window.innerWidth >= 1430);
  const sidebarOpen = useLocalStorage("app-store-sidebar-open", window.innerWidth >= 1430);
  const notificationsDrawerOpen = ref(false);
  const fullScreen = ref(false);
  const hydrated = ref(false);
  const hydrating = ref(false);
  const error = ref(null);
  const authenticated = ref(false);
  const accessTokenExpiry = ref(0);
  const basemap = ref("OpenStreetMap");
  return {
    navbarOpen,
    sidebarOpen,
    notificationsDrawerOpen,
    fullScreen,
    hydrated,
    hydrating,
    error,
    authenticated,
    accessTokenExpiry,
    basemap
  };
});
export {
  useAppStore
};
