import blackboxEndpoints from './endpoints.mjs';
import blackboxHooks from './hooks.mjs';

export default {
	hooks: [{ name: 'blackbox-hooks', config: blackboxHooks }],
	endpoints: [{ name: 'blackbox-endpoints', config: blackboxEndpoints }],
	operations: [],
};
