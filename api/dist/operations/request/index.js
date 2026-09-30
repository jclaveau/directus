import { getAxios } from "../../request/index.js";
import { isValidJSON } from "@directus/utils";
import encodeURL from "encodeurl";
import { defineOperationApi } from "@directus/extensions";
import { isAxiosError } from "axios";

//#region src/operations/request/index.ts
var request_default = defineOperationApi({
	id: "request",
	handler: async ({ url, method, body, headers }) => {
		const customHeaders = headers?.reduce((acc, { header, value }) => {
			acc[header] = value;
			return acc;
		}, {}) ?? {};
		if (!customHeaders["Content-Type"] && (typeof body === "object" || isValidJSON(body))) customHeaders["Content-Type"] = "application/json";
		const axios = await getAxios();
		try {
			const result = await axios({
				url: encodeURL(url),
				method,
				data: body,
				headers: customHeaders
			});
			return {
				status: result.status,
				statusText: result.statusText,
				headers: result.headers,
				data: result.data
			};
		} catch (error) {
			if (isAxiosError(error) && error.response) throw JSON.stringify({
				status: error.response.status,
				statusText: error.response.statusText,
				headers: error.response.headers,
				data: error.response.data
			});
			else throw error;
		}
	}
});

//#endregion
export { request_default as default };