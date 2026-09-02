import { omit } from "lodash-es";

//#region src/utils/construct-flow-tree.ts
function constructFlowTree(flow) {
	const operationTree = constructOperationTree(flow.operations.find((operation) => operation.id === flow.operation) ?? null, flow.operations);
	return {
		...omit(flow, "operations"),
		operation: operationTree,
		options: flow.options ?? {}
	};
}
function constructOperationTree(root, operations) {
	if (root === null) return null;
	const resolveOperation = root.resolve !== null ? operations.find((operation) => operation.id === root.resolve) : null;
	const rejectOperation = root.reject !== null ? operations.find((operation) => operation.id === root.reject) : null;
	if (resolveOperation === void 0 || rejectOperation === void 0) throw new Error("Undefined reference in operations");
	return {
		...omit(root, "flow"),
		resolve: constructOperationTree(resolveOperation, operations),
		reject: constructOperationTree(rejectOperation, operations)
	};
}

//#endregion
export { constructFlowTree };