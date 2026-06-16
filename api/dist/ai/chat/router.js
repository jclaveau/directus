import async_handler_default from "../../utils/async-handler.js";
import { aiChatPostHandler } from "./controllers/chat.post.js";
import { aiObjectPostHandler } from "./controllers/object.post.js";
import { loadSettings } from "./middleware/load-settings.js";
import { Router } from "express";

//#region src/ai/chat/router.ts
const aiRouter = Router().post("/chat", async_handler_default(loadSettings), async_handler_default(aiChatPostHandler)).post("/object", async_handler_default(loadSettings), async_handler_default(aiObjectPostHandler));

//#endregion
export { aiRouter };