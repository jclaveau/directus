import { useStore as useStore$1 } from "../../utils/store.js";
import { useEnv } from "@directus/env";

//#region src/websocket/collab/store.ts
const env = useEnv();
function useStore(uid, defaults) {
	return useStore$1(`${String(env["WEBSOCKETS_COLLAB_STORE_NAMESPACE"])}:${uid}`, { defaults });
}

//#endregion
export { useStore };