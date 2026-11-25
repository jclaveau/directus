import { defineOperationApi } from '@directus/extensions';

type Options = {
	milliseconds: string | number;
};

export default defineOperationApi<Options>({
	id: 'sleep',

	handler: async ({ milliseconds }) => { // bb-out-of-scope: #651 flows
		await new Promise((resolve) => setTimeout(resolve, Number(milliseconds)));
	},
});
