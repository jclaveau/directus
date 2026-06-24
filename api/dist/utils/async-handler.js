//#region src/utils/async-handler.ts
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
var async_handler_default = asyncHandler;

//#endregion
export { async_handler_default as default };