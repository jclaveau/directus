import { getAxios } from "../request/index.js";

//#region src/deployment/deployment.ts
var DeploymentDriver = class {
	credentials;
	options;
	constructor(credentials, options = {}) {
		this.credentials = credentials;
		this.options = options;
	}
	async axiosRequest(apiUrl, endpoint, options = {}) {
		const { params,...requestOptions } = options;
		const url = new URL(endpoint, apiUrl);
		if (params) for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
		const axios = await getAxios();
		const requestConfig = {
			url: url.toString(),
			method: requestOptions.method ?? "GET",
			validateStatus: () => true,
			headers: requestOptions.headers ?? {}
		};
		if (requestOptions.body) requestConfig.data = requestOptions.body;
		return await axios.request(requestConfig);
	}
};

//#endregion
export { DeploymentDriver };