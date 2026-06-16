import { withCache } from "./with-cache.js";

//#region src/permissions/utils/fetch-share-info.ts
const fetchShareInfo = withCache("share-info", _fetchShareInfo, (shareId) => ({ shareId }));
async function _fetchShareInfo(shareId, context) {
	const { SharesService } = await import("../../services/shares.js");
	return await new SharesService(context).readOne(shareId, { fields: [
		"collection",
		"item",
		"role",
		"user_created.id",
		"user_created.role"
	] });
}

//#endregion
export { _fetchShareInfo, fetchShareInfo };