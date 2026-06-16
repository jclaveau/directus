import async_handler_default from "../../utils/async-handler.js";
import { loadSettings } from "../chat/middleware/load-settings.js";
import { aiFileUploadHandler } from "./controllers/upload.js";
import { Router } from "express";

//#region src/ai/files/router.ts
const aiFilesRouter = Router().post("/", async_handler_default(loadSettings), async_handler_default(aiFileUploadHandler));

//#endregion
export { aiFilesRouter };