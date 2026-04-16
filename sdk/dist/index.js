// src/rest/utils/get-auth-endpoint.ts
function getAuthEndpoint(provider) {
  if (provider) return `/auth/login/${provider}`;
  return "/auth/login";
}

// src/utils/get-request-url.ts
var SEPARATOR = "/";
var mergePaths = (a, b) => {
  if (a.endsWith(SEPARATOR)) a = a.slice(0, -1);
  if (!b.startsWith(SEPARATOR)) b = SEPARATOR + b;
  return a + b;
};
var getRequestUrl = (baseUrl, path, params) => {
  const newPath = baseUrl.pathname === SEPARATOR ? path : mergePaths(baseUrl.pathname, path);
  const url = new globalThis.URL(newPath, baseUrl);
  if (params) {
    for (const [k, v] of Object.entries(queryToParams(params))) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const [k2, v2] of Object.entries(v)) {
          url.searchParams.set(`${k}[${k2}]`, String(v2));
        }
      } else {
        url.searchParams.set(k, v);
      }
    }
  }
  return url;
};

// src/utils/is-response.ts
function isFetchResponse(result) {
  if (typeof result !== "object" || !result) return false;
  return "headers" in result && "ok" in result && "json" in result && typeof result.json === "function" && "text" in result && typeof result.json === "function";
}

// src/utils/extract-data.ts
async function extractData(response) {
  if (typeof response !== "object" || !response) return;
  if (isFetchResponse(response)) {
    const type = response.headers.get("Content-Type")?.toLowerCase();
    if (type?.startsWith("application/json") || type?.startsWith("application/health+json")) {
      const result = await response.json();
      if (!response.ok || "errors" in result) throw result;
      if ("data" in result) return result.data;
      return result;
    }
    if (type?.startsWith("text/html") || type?.startsWith("text/plain")) {
      const result = await response.text();
      if (!response.ok) throw result;
      return result;
    }
    if (response.status === 204) {
      return null;
    }
    return response;
  }
  if ("errors" in response) throw response;
  if ("data" in response) return response.data;
  return response;
}

// src/utils/request.ts
var request = async (url, options, fetcher = globalThis.fetch) => {
  options.headers = typeof options.headers === "object" && !Array.isArray(options.headers) ? options.headers : {};
  return fetcher(url, options).then((response) => {
    return extractData(response).catch((reason) => {
      const result = {
        message: "Unknown api error",
        errors: reason && typeof reason === "object" && "errors" in reason ? reason.errors : reason,
        response
      };
      if (reason && typeof reason === "object" && "data" in reason) result.data = reason.data;
      if (result.errors[0] && result.errors[0].message) {
        result.message = result.errors[0].message;
      }
      return Promise.reject(result);
    });
  });
};

// src/auth/utils/memory-storage.ts
var memoryStorage = () => {
  let store = null;
  return {
    get: async () => store,
    set: async (value) => {
      store = value;
    }
  };
};

// src/auth/composable.ts
var defaultConfigValues = {
  msRefreshBeforeExpires: 3e4,
  // 30 seconds
  autoRefresh: true
};
var MAX_INT32 = 2 ** 31 - 1;
var authentication = (mode = "cookie", config = {}) => {
  return (client) => {
    const authConfig = { ...defaultConfigValues, ...config };
    let refreshPromise = null;
    let refreshTimeout = null;
    const storage = authConfig.storage ?? memoryStorage();
    const resetStorage = async () => storage.set({ access_token: null, refresh_token: null, expires: null, expires_at: null });
    const activeRefresh = async () => {
      try {
        await refreshPromise;
      } finally {
        refreshPromise = null;
      }
    };
    const refreshIfExpired = async () => {
      const authData = await storage.get();
      if (refreshPromise || !authData?.expires_at) {
        return activeRefresh();
      }
      if (authData.expires_at < (/* @__PURE__ */ new Date()).getTime() + authConfig.msRefreshBeforeExpires) {
        refresh2().catch((_err) => {
        });
      }
      return activeRefresh();
    };
    const setCredentials = async (data) => {
      const expires = data.expires ?? 0;
      data.expires_at = (/* @__PURE__ */ new Date()).getTime() + expires;
      await storage.set(data);
      if (authConfig.autoRefresh && expires > authConfig.msRefreshBeforeExpires && expires < MAX_INT32) {
        if (refreshTimeout) clearTimeout(refreshTimeout);
        refreshTimeout = setTimeout(() => {
          refreshTimeout = null;
          refresh2().catch((_err) => {
          });
        }, expires - authConfig.msRefreshBeforeExpires);
      }
    };
    const refresh2 = async (options = {}) => {
      const awaitRefresh = async () => {
        const authData = await storage.get();
        await resetStorage();
        const fetchOptions = {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          }
        };
        if ("credentials" in authConfig) {
          fetchOptions.credentials = authConfig.credentials;
        }
        const body = { mode: options.mode ?? mode };
        if (mode === "json" && authData?.refresh_token) {
          body["refresh_token"] = authData.refresh_token;
        }
        fetchOptions.body = JSON.stringify(body);
        const requestUrl = getRequestUrl(client.url, "/auth/refresh");
        return request(requestUrl.toString(), fetchOptions, client.globals.fetch).then(
          (data) => setCredentials(data).then(() => data)
        );
      };
      refreshPromise = awaitRefresh();
      return refreshPromise;
    };
    async function login2(payload, options = {}) {
      await resetStorage();
      const authData = payload;
      if ("otp" in options) authData["otp"] = options.otp;
      authData["mode"] = options.mode ?? mode;
      const path = getAuthEndpoint(options.provider);
      const requestUrl = getRequestUrl(client.url, path);
      const fetchOptions = {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(authData)
      };
      if ("credentials" in authConfig) {
        fetchOptions.credentials = authConfig.credentials;
      }
      const data = await request(requestUrl.toString(), fetchOptions, client.globals.fetch);
      await setCredentials(data);
      return data;
    }
    return {
      refresh: refresh2,
      login: login2,
      async logout(options = {}) {
        const authData = await storage.get();
        const fetchOptions = {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          }
        };
        if ("credentials" in authConfig) {
          fetchOptions.credentials = authConfig.credentials;
        }
        const body = { mode: options.mode ?? mode };
        if (mode === "json" && authData?.refresh_token) {
          body["refresh_token"] = authData.refresh_token;
        }
        fetchOptions.body = JSON.stringify(body);
        const requestUrl = getRequestUrl(client.url, "/auth/logout");
        await request(requestUrl.toString(), fetchOptions, client.globals.fetch);
        this.stopRefreshing();
        await resetStorage();
      },
      stopRefreshing() {
        if (refreshTimeout) {
          clearTimeout(refreshTimeout);
        }
      },
      async getToken() {
        await refreshIfExpired().catch(() => {
        });
        const data = await storage.get();
        return data?.access_token ?? null;
      },
      async setToken(access_token) {
        return storage.set({
          access_token,
          refresh_token: null,
          expires: null,
          expires_at: null
        });
      }
    };
  };
};

// src/auth/static.ts
var staticToken = (access_token) => {
  return (_client) => {
    let token = access_token ?? null;
    return {
      async getToken() {
        return token;
      },
      async setToken(access_token2) {
        token = access_token2;
      }
    };
  };
};

// src/client.ts
var defaultGlobals = {
  fetch: globalThis.fetch,
  WebSocket: globalThis.WebSocket,
  URL: globalThis.URL,
  logger: globalThis.console
};
var createDirectus = (url, options = {}) => {
  const globals = options.globals ? { ...defaultGlobals, ...options.globals } : defaultGlobals;
  return {
    globals,
    url: new globals.URL(url),
    with(createExtension) {
      return {
        ...this,
        ...createExtension(this)
      };
    }
  };
};

// src/graphql/composable.ts
var defaultConfigValues2 = {};
var graphql = (config = {}) => {
  return (client) => {
    const gqlConfig = { ...defaultConfigValues2, ...config };
    return {
      async query(query, variables, scope = "items") {
        const fetchOptions = {
          method: "POST",
          body: JSON.stringify({ query, variables })
        };
        if ("credentials" in gqlConfig) {
          fetchOptions.credentials = gqlConfig.credentials;
        }
        const headers = {};
        if ("getToken" in this) {
          const token = await this.getToken();
          if (token) {
            headers["Authorization"] = `Bearer ${token}`;
          }
        }
        if ("Content-Type" in headers === false) {
          headers["Content-Type"] = "application/json";
        }
        fetchOptions.headers = headers;
        const requestPath = scope === "items" ? "/graphql" : "/graphql/system";
        const requestUrl = getRequestUrl(client.url, requestPath);
        return await request(requestUrl.toString(), fetchOptions, client.globals.fetch);
      }
    };
  };
};

// src/realtime/commands/auth.ts
function auth(creds) {
  return JSON.stringify({ ...creds, type: "auth" });
}

// src/realtime/commands/pong.ts
var pong = () => JSON.stringify({ type: "pong" });

// src/realtime/utils/generate-uid.ts
function* generateUid() {
  let uid = 1;
  while (true) {
    yield String(uid);
    uid++;
  }
}

// src/realtime/utils/message-callback.ts
var messageCallback = (socket, timeout = 1e3) => new Promise((resolve, reject) => {
  const handler = (data) => {
    try {
      const message = JSON.parse(data.data);
      if (typeof message === "object" && !Array.isArray(message) && message !== null) {
        unbind();
        resolve(message);
      } else {
        unbind();
        abort();
      }
    } catch {
      unbind();
      resolve(data);
    }
  };
  const abort = () => reject();
  const unbind = () => {
    clearTimeout(timer);
    socket.removeEventListener("message", handler);
    socket.removeEventListener("error", abort);
    socket.removeEventListener("close", abort);
  };
  socket.addEventListener("message", handler);
  socket.addEventListener("error", abort);
  socket.addEventListener("close", abort);
  const timer = setTimeout(() => {
    unbind();
    resolve(void 0);
  }, timeout);
});

// src/realtime/composable.ts
var defaultRealTimeConfig = {
  authMode: "handshake",
  heartbeat: true,
  debug: false,
  reconnect: {
    delay: 1e3,
    // 1 second
    retries: 10
  }
};
function realtime(config = {}) {
  return (client) => {
    config = { ...defaultRealTimeConfig, ...config };
    let uid = generateUid();
    let state = {
      code: "closed"
    };
    const reconnectState = {
      attempts: 0,
      active: false
    };
    let wasManuallyDisconnected = false;
    const subscriptions = /* @__PURE__ */ new Set();
    const hasAuth = (client2) => "getToken" in client2;
    const debug = (level, ...data) => config.debug && client.globals.logger[level]("[Directus SDK]", ...data);
    const withStrictAuth = async (url, currentClient) => {
      const newUrl = new client.globals.URL(url);
      if (config.authMode === "strict" && hasAuth(currentClient)) {
        const token = await currentClient.getToken();
        if (token) newUrl.searchParams.set("access_token", token);
      }
      return newUrl.toString();
    };
    const getSocketUrl = async (currentClient) => {
      if ("url" in config) return await withStrictAuth(config.url, currentClient);
      if (["ws:", "wss:"].includes(client.url.protocol)) {
        return await withStrictAuth(client.url, currentClient);
      }
      const newUrl = new client.globals.URL(client.url.toString());
      newUrl.protocol = client.url.protocol === "https:" ? "wss:" : "ws:";
      newUrl.pathname = "/websocket";
      return await withStrictAuth(newUrl, currentClient);
    };
    const reconnect = (self) => {
      const reconnectPromise = new Promise((resolve, reject) => {
        if (!config.reconnect || wasManuallyDisconnected) return reject();
        debug(
          "info",
          `reconnect #${reconnectState.attempts} ` + (reconnectState.attempts >= config.reconnect.retries ? "maximum retries reached" : `trying again in ${Math.max(100, config.reconnect.delay)}ms`)
        );
        if (reconnectState.active) return reconnectState.active;
        if (reconnectState.attempts >= config.reconnect.retries) {
          reconnectState.attempts = -1;
          return reject();
        }
        setTimeout(
          () => self.connect().then((ws) => {
            subscriptions.forEach((sub) => {
              self.sendMessage(sub);
            });
            return ws;
          }).then(resolve).catch(reject),
          Math.max(100, config.reconnect.delay)
        );
      });
      reconnectState.attempts += 1;
      reconnectState.active = reconnectPromise.catch(() => {
      }).finally(() => {
        reconnectState.active = false;
      });
    };
    const eventHandlers = {
      open: /* @__PURE__ */ new Set([]),
      error: /* @__PURE__ */ new Set([]),
      close: /* @__PURE__ */ new Set([]),
      message: /* @__PURE__ */ new Set([])
    };
    function isAuthError(message) {
      return "type" in message && "status" in message && "error" in message && "code" in message["error"] && "message" in message["error"] && message["type"] === "auth" && message["status"] === "error";
    }
    async function handleAuthError(message, currentClient) {
      if (state.code !== "open") return;
      if (message.error.code === "TOKEN_EXPIRED") {
        debug("warn", "Authentication token expired!");
        if (hasAuth(currentClient)) {
          const access_token = await currentClient.getToken();
          if (!access_token) {
            throw Error("No token for re-authenticating the websocket");
          }
          state.connection.send(auth({ access_token }));
        }
      }
      if (message.error.code === "AUTH_TIMEOUT") {
        if (state.firstMessage && config.authMode === "public") {
          debug("warn", 'Authentication failed! Currently the "authMode" is "public" try using "handshake" instead');
          config.reconnect = false;
        } else {
          debug("warn", "Authentication timed out!");
        }
        return state.connection.close();
      }
      if (message.error.code === "AUTH_FAILED") {
        if (state.firstMessage && config.authMode === "public") {
          debug("warn", 'Authentication failed! Currently the "authMode" is "public" try using "handshake" instead');
          config.reconnect = false;
          return state.connection.close();
        }
        debug("warn", "Authentication failed!");
      }
    }
    const handleMessages = async (currentClient) => {
      while (state.code === "open") {
        const message = await messageCallback(state.connection).catch(() => {
        });
        if (!message) continue;
        if (isAuthError(message)) {
          await handleAuthError(message, currentClient);
          state.firstMessage = false;
          continue;
        }
        if (config.heartbeat && message["type"] === "ping") {
          state.connection.send(pong());
          state.firstMessage = false;
          continue;
        }
        eventHandlers["message"].forEach((handler) => {
          if (state.code === "open") handler.call(state.connection, message);
        });
        state.firstMessage = false;
      }
    };
    return {
      async connect() {
        wasManuallyDisconnected = false;
        if (state.code === "connecting") {
          return await state.connection;
        } else if (state.code !== "closed") {
          throw new Error(`Cannot connect when state is "${state.code}"`);
        }
        const self = this;
        const url = await getSocketUrl(self);
        debug("info", `Connecting to ${url}...`);
        const connectPromise = new Promise((resolve, reject) => {
          let resolved = false;
          const ws = new client.globals.WebSocket(url);
          ws.addEventListener("open", async (evt) => {
            debug("info", `Connection open.`);
            state = { code: "open", connection: ws, firstMessage: true };
            reconnectState.attempts = 0;
            reconnectState.active = false;
            handleMessages(self);
            if (config.authMode === "handshake" && hasAuth(self)) {
              const access_token = await self.getToken();
              if (!access_token) {
                throw Error(
                  "No token for authenticating the websocket. Make sure to provide one or call the login() function beforehand."
                );
              }
              ws.send(auth({ access_token }));
              const confirm = await messageCallback(ws);
              if (!(confirm && "type" in confirm && "status" in confirm && confirm["type"] === "auth" && confirm["status"] === "ok")) {
                return reject("Authentication failed while opening websocket connection");
              } else {
                debug("info", "Authentication successful!");
              }
            }
            eventHandlers["open"].forEach((handler) => handler.call(ws, evt));
            resolved = true;
            resolve(ws);
          });
          ws.addEventListener("error", (evt) => {
            debug("warn", `Connection errored.`);
            eventHandlers["error"].forEach((handler) => handler.call(ws, evt));
            ws.close();
            state = { code: "error" };
            if (!resolved) reject(evt);
          });
          ws.addEventListener("close", (evt) => {
            debug("info", `Connection closed.`);
            eventHandlers["close"].forEach((handler) => handler.call(ws, evt));
            uid = generateUid();
            state = { code: "closed" };
            reconnect(this);
            if (!resolved) reject(evt);
          });
        });
        state = {
          code: "connecting",
          connection: connectPromise
        };
        return connectPromise;
      },
      disconnect() {
        wasManuallyDisconnected = true;
        if (state.code === "open") {
          state.connection.close();
        }
      },
      onWebSocket(event, callback) {
        if (event === "message") {
          const updatedCallback = function(event2) {
            if (typeof event2.data !== "string") return callback.call(this, event2);
            try {
              return callback.call(this, JSON.parse(event2.data));
            } catch {
              return callback.call(this, event2);
            }
          };
          eventHandlers[event].add(updatedCallback);
          return () => eventHandlers[event].delete(updatedCallback);
        }
        eventHandlers[event].add(callback);
        return () => eventHandlers[event].delete(callback);
      },
      sendMessage(message) {
        if (state.code !== "open") {
          throw new Error(
            'Cannot send messages without an open connection. Make sure you are calling "await client.connect()".'
          );
        }
        if (typeof message === "string") {
          return state.connection.send(message);
        }
        if ("uid" in message === false) {
          message["uid"] = uid.next().value;
        }
        state.connection.send(JSON.stringify(message));
      },
      async subscribe(collection, options = {}) {
        if ("uid" in options === false) options.uid = uid.next().value;
        subscriptions.add({ ...options, collection, type: "subscribe" });
        if (state.code !== "open") {
          debug("info", "No connection available for subscribing!");
          await this.connect();
        }
        this.sendMessage({ ...options, collection, type: "subscribe" });
        let subscribed = true;
        async function* subscriptionGenerator() {
          while (subscribed && state.code === "open") {
            const message = await messageCallback(state.connection).catch(() => {
            });
            if (!message) continue;
            if ("type" in message && "status" in message && message["type"] === "subscribe" && message["status"] === "error") {
              throw message;
            }
            if ("type" in message && "uid" in message && message["type"] === "subscription" && message["uid"] === options.uid) {
              yield message;
            }
          }
          if (config.reconnect && reconnectState.active) {
            await reconnectState.active;
            if (state.code === "open") {
              state.connection.send(JSON.stringify({ ...options, collection, type: "subscribe" }));
              yield* subscriptionGenerator();
            }
          }
        }
        const unsubscribe = () => {
          subscriptions.delete({ ...options, collection, type: "subscribe" });
          this.sendMessage({ uid: options.uid, type: "unsubscribe" });
          subscribed = false;
        };
        return {
          subscription: subscriptionGenerator(),
          unsubscribe
        };
      }
    };
  };
}

// src/realtime/utils/sleep.ts
var sleep = (delay) => new Promise((resolve) => setTimeout(() => resolve(), delay));

// src/rest/commands/auth/login.ts
function login(payload, options = {}) {
  return () => {
    const path = getAuthEndpoint(options.provider);
    const authData = payload;
    if ("otp" in options) authData["otp"] = options.otp;
    authData["mode"] = options.mode ?? "cookie";
    return { path, method: "POST", body: JSON.stringify(authData) };
  };
}

// src/rest/commands/auth/logout.ts
var logout = (options = {}) => () => {
  const logoutData = {
    mode: options.mode ?? "cookie"
  };
  if (logoutData.mode === "json" && options.refresh_token) {
    logoutData["refresh_token"] = options.refresh_token;
  }
  return {
    path: "/auth/logout",
    method: "POST",
    body: JSON.stringify(logoutData)
  };
};

// src/rest/commands/auth/password-request.ts
var passwordRequest = (email, reset_url) => () => ({
  path: "/auth/password/request",
  method: "POST",
  body: JSON.stringify({ email, ...reset_url ? { reset_url } : {} })
});

// src/rest/commands/auth/password-reset.ts
var passwordReset = (token, password) => () => ({
  path: "/auth/password/reset",
  method: "POST",
  body: JSON.stringify({ token, password })
});

// src/rest/commands/auth/providers.ts
var readProviders = (sessionOnly = false) => () => ({
  path: sessionOnly ? "/auth?sessionOnly" : "/auth",
  method: "GET"
});

// src/rest/commands/auth/refresh.ts
var refresh = (options = {}) => () => {
  const refreshData = {
    mode: options.mode ?? "cookie"
  };
  if (refreshData.mode === "json" && options.refresh_token) {
    refreshData["refresh_token"] = options.refresh_token;
  }
  return {
    path: "/auth/refresh",
    method: "POST",
    body: JSON.stringify(refreshData)
  };
};

// src/rest/commands/create/collections.ts
var createCollection = (item, query) => () => ({
  path: `/collections`,
  params: query ?? {},
  body: JSON.stringify(item),
  method: "POST"
});

// src/rest/commands/create/comments.ts
var createComments = (items, query) => () => ({
  path: `/comments`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "POST"
});
var createComment = (item, query) => () => ({
  path: `/comments`,
  params: query ?? {},
  body: JSON.stringify(item),
  method: "POST"
});

// src/rest/commands/create/dashboards.ts
var createDashboards = (items, query) => () => ({
  path: `/dashboards`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "POST"
});
var createDashboard = (item, query) => () => ({
  path: `/dashboards`,
  params: query ?? {},
  body: JSON.stringify(item),
  method: "POST"
});

// src/rest/commands/create/fields.ts
var createField = (collection, item, query) => () => ({
  path: `/fields/${collection}`,
  params: query ?? {},
  body: JSON.stringify(item),
  method: "POST"
});

// src/rest/commands/create/files.ts
var uploadFiles = (data, query) => () => ({
  path: "/files",
  method: "POST",
  body: data,
  params: query ?? {},
  headers: { "Content-Type": "multipart/form-data" }
});
var importFile = (url, data = {}, query) => () => ({
  path: "/files/import",
  method: "POST",
  body: JSON.stringify({ url, data }),
  params: query ?? {}
});

// src/rest/commands/create/flows.ts
var createFlows = (items, query) => () => ({
  path: `/flows`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "POST"
});
var createFlow = (item, query) => () => ({
  path: `/flows`,
  params: query ?? {},
  body: JSON.stringify(item),
  method: "POST"
});

// src/rest/commands/create/folders.ts
var createFolders = (items, query) => () => ({
  path: `/folders`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "POST"
});
var createFolder = (item, query) => () => ({
  path: `/folders`,
  params: query ?? {},
  body: JSON.stringify(item),
  method: "POST"
});

// src/rest/utils/is-system-collection.ts
function isSystemCollection(collection) {
  const collections = ["directus_access", "directus_activity", "directus_collections", "directus_comments", "directus_fields", "directus_files", "directus_folders", "directus_migrations", "directus_permissions", "directus_policies", "directus_presets", "directus_relations", "directus_revisions", "directus_roles", "directus_sessions", "directus_settings", "directus_users", "directus_webhooks", "directus_dashboards", "directus_panels", "directus_notifications", "directus_shares", "directus_flows", "directus_operations", "directus_translations", "directus_versions", "directus_extensions"];
  return collections.includes(collection);
}

// src/rest/commands/create/items.ts
var createItems = (collection, items, query) => () => {
  const _collection = String(collection);
  if (isSystemCollection(_collection)) {
    throw new Error("Cannot use createItems for core collections");
  }
  return {
    path: `/items/${_collection}`,
    params: query ?? {},
    body: JSON.stringify(items),
    method: "POST"
  };
};
var createItem = (collection, item, query) => () => {
  const _collection = String(collection);
  if (isSystemCollection(_collection)) {
    throw new Error("Cannot use createItem for core collections");
  }
  return {
    path: `/items/${_collection}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "POST"
  };
};

// src/rest/commands/create/notifications.ts
var createNotifications = (items, query) => () => ({
  path: `/notifications`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "POST"
});
var createNotification = (item, query) => () => ({
  path: `/notifications`,
  params: query ?? {},
  body: JSON.stringify(item),
  method: "POST"
});

// src/rest/commands/create/operations.ts
var createOperations = (items, query) => () => ({
  path: `/operations`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "POST"
});
var createOperation = (item, query) => () => ({
  path: `/operations`,
  params: query ?? {},
  body: JSON.stringify(item),
  method: "POST"
});

// src/rest/commands/create/panels.ts
var createPanels = (items, query) => () => ({
  path: `/panels`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "POST"
});
var createPanel = (item, query) => () => ({
  path: `/panels`,
  params: query ?? {},
  body: JSON.stringify(item),
  method: "POST"
});

// src/rest/commands/create/permissions.ts
var createPermissions = (items, query) => () => ({
  path: `/permissions`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "POST"
});
var createPermission = (item, query) => () => ({
  path: `/permissions`,
  params: query ?? {},
  body: JSON.stringify(item),
  method: "POST"
});

// src/rest/commands/create/policies.ts
var createPolicies = (items, query) => () => ({
  path: `/policies`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "POST"
});
var createPolicy = (item, query) => () => ({
  path: `/policies`,
  params: query ?? {},
  body: JSON.stringify(item),
  method: "POST"
});

// src/rest/commands/create/presets.ts
var createPresets = (items, query) => () => ({
  path: `/presets`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "POST"
});
var createPreset = (item, query) => () => ({
  path: `/presets`,
  params: query ?? {},
  body: JSON.stringify(item),
  method: "POST"
});

// src/rest/commands/create/relations.ts
var createRelation = (item) => () => ({
  path: `/relations`,
  body: JSON.stringify(item),
  method: "POST"
});

// src/rest/commands/create/roles.ts
var createRoles = (items, query) => () => ({
  path: `/roles`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "POST"
});
var createRole = (item, query) => () => ({
  path: `/roles`,
  params: query ?? {},
  body: JSON.stringify(item),
  method: "POST"
});

// src/rest/commands/create/shares.ts
var createShares = (items, query) => () => ({
  path: `/shares`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "POST"
});
var createShare = (item, query) => () => ({
  path: `/shares`,
  params: query ?? {},
  body: JSON.stringify(item),
  method: "POST"
});

// src/rest/commands/create/translations.ts
var createTranslations = (items, query) => () => ({
  path: `/translations`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "POST"
});
var createTranslation = (item, query) => () => ({
  path: `/translations`,
  params: query ?? {},
  body: JSON.stringify(item),
  method: "POST"
});

// src/rest/commands/create/users.ts
var createUsers = (items, query) => () => ({
  path: `/users`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "POST"
});
var createUser = (item, query) => () => ({
  path: `/users`,
  params: query ?? {},
  body: JSON.stringify(item),
  method: "POST"
});

// src/rest/commands/create/versions.ts
var createContentVersions = (items, query) => () => ({
  path: `/versions`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "POST"
});
var createContentVersion = (item, query) => () => ({
  path: `/versions`,
  params: query ?? {},
  body: JSON.stringify(item),
  method: "POST"
});

// src/rest/commands/create/webhooks.ts
var createWebhooks = (items, query) => () => ({
  path: `/webhooks`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "POST"
});
var createWebhook = (item, query) => () => ({
  path: `/webhooks`,
  params: query ?? {},
  body: JSON.stringify(item),
  method: "POST"
});

// src/rest/commands/delete/collections.ts
var deleteCollection = (collection) => () => ({
  path: `/collections/${collection}`,
  method: "DELETE"
});

// src/rest/utils/query-to-params.ts
var formatFields = (fields) => {
  const walkFields = (value, chain = []) => {
    if (typeof value === "object") {
      const result = [];
      for (const key in value) {
        const nestedField = value[key] ?? [];
        if (Array.isArray(nestedField)) {
          for (const item of nestedField) {
            result.push(walkFields(item, [...chain, key]));
          }
        } else if (typeof nestedField === "object") {
          for (const scope of Object.keys(nestedField)) {
            const fields2 = nestedField[scope];
            for (const item of fields2) {
              result.push(walkFields(item, [...chain, `${key}:${scope}`]));
            }
          }
        }
      }
      return result.flatMap((items) => items);
    }
    return [...chain, String(value)].join(".");
  };
  return fields.flatMap((value) => walkFields(value));
};
var queryToParams = (query) => {
  const params = {};
  if (Array.isArray(query.fields) && query.fields.length > 0) {
    params["fields"] = formatFields(query.fields).join(",");
  }
  if (query.filter && Object.keys(query.filter).length > 0) {
    params["filter"] = JSON.stringify(query.filter);
  }
  if (query.search) {
    params["search"] = query.search;
  }
  if ("sort" in query && query.sort) {
    params["sort"] = typeof query.sort === "string" ? query.sort : query.sort.join(",");
  }
  if (typeof query.limit === "number" && query.limit >= -1) {
    params["limit"] = String(query.limit);
  }
  if (typeof query.offset === "number" && query.offset >= 0) {
    params["offset"] = String(query.offset);
  }
  if (typeof query.page === "number" && query.page >= 1) {
    params["page"] = String(query.page);
  }
  if (query.deep && Object.keys(query.deep).length > 0) {
    params["deep"] = JSON.stringify(query.deep);
  }
  if (query.alias && Object.keys(query.alias).length > 0) {
    params["alias"] = JSON.stringify(query.alias);
  }
  if (query.aggregate && Object.keys(query.aggregate).length > 0) {
    params["aggregate"] = JSON.stringify(query.aggregate);
  }
  if (query.groupBy && query.groupBy.length > 0) {
    params["groupBy"] = query.groupBy.join(",");
  }
  for (const [key, value] of Object.entries(query)) {
    if (key in params) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      params[key] = String(value);
    } else {
      params[key] = JSON.stringify(value);
    }
  }
  return params;
};

// src/rest/utils/throw-if-empty.ts
var throwIfEmpty = (value, message) => {
  if (value.length === 0) {
    throw new Error(message);
  }
};

// src/rest/utils/throw-core-collection.ts
var throwIfCoreCollection = (value, message) => {
  if (isSystemCollection(String(value))) {
    throw new Error(message);
  }
};

// src/rest/commands/delete/comments.ts
var deleteComments = (keysOrQuery) => () => {
  let payload = {};
  if (Array.isArray(keysOrQuery)) {
    throwIfEmpty(keysOrQuery, "keysOrQuery cannot be empty");
    payload = { keys: keysOrQuery };
  } else {
    throwIfEmpty(Object.keys(keysOrQuery), "keysOrQuery cannot be empty");
    payload = { query: keysOrQuery };
  }
  return {
    path: `/comments`,
    body: JSON.stringify(payload),
    method: "DELETE"
  };
};
var deleteComment = (key) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/comments/${key}`,
    method: "DELETE"
  };
};

// src/rest/commands/delete/dashboards.ts
var deleteDashboards = (keys) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/dashboards`,
    body: JSON.stringify(keys),
    method: "DELETE"
  };
};
var deleteDashboard = (key) => () => {
  throwIfEmpty(key, "Key cannot be empty");
  return {
    path: `/dashboards/${key}`,
    method: "DELETE"
  };
};

// src/rest/commands/delete/fields.ts
var deleteField = (collection, field) => () => {
  throwIfEmpty(collection, "Collection cannot be empty");
  throwIfEmpty(field, "Field cannot be empty");
  return {
    path: `/fields/${collection}/${field}`,
    method: "DELETE"
  };
};

// src/rest/commands/delete/files.ts
var deleteFiles = (keys) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/files`,
    body: JSON.stringify(keys),
    method: "DELETE"
  };
};
var deleteFile = (key) => () => {
  throwIfEmpty(key, "Key cannot be empty");
  return {
    path: `/files/${key}`,
    method: "DELETE"
  };
};

// src/rest/commands/delete/flows.ts
var deleteFlows = (keys) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/flows`,
    body: JSON.stringify(keys),
    method: "DELETE"
  };
};
var deleteFlow = (key) => () => {
  throwIfEmpty(key, "Key cannot be empty");
  return {
    path: `/flows/${key}`,
    method: "DELETE"
  };
};

// src/rest/commands/delete/folders.ts
var deleteFolders = (keys) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/folders`,
    body: JSON.stringify(keys),
    method: "DELETE"
  };
};
var deleteFolder = (key) => () => {
  throwIfEmpty(key, "Key cannot be empty");
  return {
    path: `/folders/${key}`,
    method: "DELETE"
  };
};

// src/rest/commands/delete/items.ts
var deleteItems = (collection, keysOrQuery) => () => {
  let payload = {};
  throwIfEmpty(String(collection), "Collection cannot be empty");
  throwIfCoreCollection(collection, "Cannot use deleteItems for core collections");
  if (Array.isArray(keysOrQuery)) {
    throwIfEmpty(keysOrQuery, "keysOrQuery cannot be empty");
    payload = { keys: keysOrQuery };
  } else {
    throwIfEmpty(Object.keys(keysOrQuery), "keysOrQuery cannot be empty");
    payload = { query: keysOrQuery };
  }
  return {
    path: `/items/${collection}`,
    body: JSON.stringify(payload),
    method: "DELETE"
  };
};
var deleteItem = (collection, key) => () => {
  throwIfEmpty(String(collection), "Collection cannot be empty");
  throwIfCoreCollection(collection, "Cannot use deleteItem for core collections");
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/items/${collection}/${key}`,
    method: "DELETE"
  };
};

// src/rest/commands/delete/notifications.ts
var deleteNotifications = (keys) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/notifications`,
    body: JSON.stringify(keys),
    method: "DELETE"
  };
};
var deleteNotification = (key) => () => {
  throwIfEmpty(key, "Key cannot be empty");
  return {
    path: `/notifications/${key}`,
    method: "DELETE"
  };
};

// src/rest/commands/delete/operations.ts
var deleteOperations = (keys) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/operations`,
    body: JSON.stringify(keys),
    method: "DELETE"
  };
};
var deleteOperation = (key) => () => {
  throwIfEmpty(key, "Key cannot be empty");
  return {
    path: `/operations/${key}`,
    method: "DELETE"
  };
};

// src/rest/commands/delete/panels.ts
var deletePanels = (keys) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/panels`,
    body: JSON.stringify(keys),
    method: "DELETE"
  };
};
var deletePanel = (key) => () => {
  throwIfEmpty(key, "Key cannot be empty");
  return {
    path: `/panels/${key}`,
    method: "DELETE"
  };
};

// src/rest/commands/delete/permissions.ts
var deletePermissions = (keys) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/permissions`,
    body: JSON.stringify(keys),
    method: "DELETE"
  };
};
var deletePermission = (key) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/permissions/${key}`,
    method: "DELETE"
  };
};

// src/rest/commands/delete/policies.ts
var deletePolicies = (keys) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/policies`,
    body: JSON.stringify(keys),
    method: "DELETE"
  };
};
var deletePolicy = (key) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/policies/${key}`,
    method: "DELETE"
  };
};

// src/rest/commands/delete/presets.ts
var deletePresets = (keys) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/presets`,
    body: JSON.stringify(keys),
    method: "DELETE"
  };
};
var deletePreset = (key) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/presets/${key}`,
    method: "DELETE"
  };
};

// src/rest/commands/delete/relations.ts
var deleteRelation = (collection, field) => () => {
  throwIfEmpty(collection, "Collection cannot be empty");
  throwIfEmpty(field, "Field cannot be empty");
  return {
    path: `/relations/${collection}/${field}`,
    method: "DELETE"
  };
};

// src/rest/commands/delete/roles.ts
var deleteRoles = (keys) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/roles`,
    body: JSON.stringify(keys),
    method: "DELETE"
  };
};
var deleteRole = (key) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/roles/${key}`,
    method: "DELETE"
  };
};

// src/rest/commands/delete/shares.ts
var deleteShares = (keys) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/shares`,
    body: JSON.stringify(keys),
    method: "DELETE"
  };
};
var deleteShare = (key) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/shares/${key}`,
    method: "DELETE"
  };
};

// src/rest/commands/delete/translations.ts
var deleteTranslations = (keys) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/translations`,
    body: JSON.stringify(keys),
    method: "DELETE"
  };
};
var deleteTranslation = (key) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/translations/${key}`,
    method: "DELETE"
  };
};

// src/rest/commands/delete/users.ts
var deleteUsers = (keys) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/users`,
    body: JSON.stringify(keys),
    method: "DELETE"
  };
};
var deleteUser = (key) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/users/${key}`,
    method: "DELETE"
  };
};

// src/rest/commands/delete/versions.ts
var deleteContentVersions = (keys) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/versions`,
    body: JSON.stringify(keys),
    method: "DELETE"
  };
};
var deleteContentVersion = (key) => () => {
  throwIfEmpty(key, "Key cannot be empty");
  return {
    path: `/versions/${key}`,
    method: "DELETE"
  };
};

// src/rest/commands/delete/webhooks.ts
var deleteWebhooks = (keys) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/webhooks`,
    body: JSON.stringify(keys),
    method: "DELETE"
  };
};
var deleteWebhook = (key) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/webhooks/${key}`,
    method: "DELETE"
  };
};

// src/rest/commands/read/activity.ts
var readActivities = (query) => () => ({
  path: `/activity`,
  params: query ?? {},
  method: "GET"
});
var readActivity = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/activity/${key}`,
    params: query ?? {},
    method: "GET"
  };
};

// src/rest/commands/read/aggregate.ts
var aggregate = (collection, options) => () => {
  const collectionName = String(collection);
  throwIfEmpty(collectionName, "Collection cannot be empty");
  const path = isSystemCollection(collectionName) ? `/${collectionName.substring(9)}` : `/items/${collectionName}`;
  return {
    path,
    method: "GET",
    params: {
      ...options.query ?? {},
      ...options.groupBy ? { groupBy: options.groupBy } : {},
      aggregate: options.aggregate
    }
  };
};

// src/rest/commands/read/assets.ts
var readAssetRaw = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/assets/${key}`,
    params: query ?? {},
    method: "GET",
    onResponse: (response) => response.body
  };
};
var readAssetBlob = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/assets/${key}`,
    params: query ?? {},
    method: "GET",
    onResponse: (response) => response.blob()
  };
};
var readAssetArrayBuffer = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/assets/${key}`,
    params: query ?? {},
    method: "GET",
    onResponse: (response) => response.arrayBuffer()
  };
};

// src/rest/commands/read/collections.ts
var readCollections = () => () => ({
  path: `/collections`,
  method: "GET"
});
var readCollection = (collection) => () => {
  throwIfEmpty(collection, "Collection cannot be empty");
  return {
    path: `/collections/${collection}`,
    method: "GET"
  };
};

// src/rest/commands/read/comments.ts
var readComments = (query) => () => ({
  path: `/comments`,
  params: query ?? {},
  method: "GET"
});
var readComment = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/comments/${key}`,
    params: query ?? {},
    method: "GET"
  };
};

// src/rest/commands/read/dashboards.ts
var readDashboards = (query) => () => ({
  path: `/dashboards`,
  params: query ?? {},
  method: "GET"
});
var readDashboard = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/dashboards/${key}`,
    params: query ?? {},
    method: "GET"
  };
};

// src/rest/commands/read/extensions.ts
var readExtensions = () => () => ({
  path: `/extensions/`,
  method: "GET"
});

// src/rest/commands/read/fields.ts
var readFields = () => () => ({
  path: `/fields`,
  method: "GET"
});
var readFieldsByCollection = (collection) => () => {
  throwIfEmpty(collection, "Collection cannot be empty");
  return {
    path: `/fields/${collection}`,
    method: "GET"
  };
};
var readField = (collection, field) => () => {
  throwIfEmpty(collection, "Collection cannot be empty");
  throwIfEmpty(field, "Field cannot be empty");
  return {
    path: `/fields/${collection}/${field}`,
    method: "GET"
  };
};

// src/rest/commands/read/files.ts
var readFiles = (query) => () => ({
  path: `/files`,
  params: query ?? {},
  method: "GET"
});
var readFile = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/files/${key}`,
    params: query ?? {},
    method: "GET"
  };
};

// src/rest/commands/read/flows.ts
var readFlows = (query) => () => ({
  path: `/flows`,
  params: query ?? {},
  method: "GET"
});
var readFlow = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/flows/${key}`,
    params: query ?? {},
    method: "GET"
  };
};

// src/rest/commands/read/folders.ts
var readFolders = (query) => () => ({
  path: `/folders`,
  params: query ?? {},
  method: "GET"
});
var readFolder = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/folders/${key}`,
    params: query ?? {},
    method: "GET"
  };
};

// src/rest/commands/read/items.ts
var readItems = (collection, query) => () => {
  throwIfEmpty(String(collection), "Collection cannot be empty");
  throwIfCoreCollection(collection, "Cannot use readItems for core collections");
  return {
    path: `/items/${collection}`,
    params: query ?? {},
    method: "GET"
  };
};
var readItem = (collection, key, query) => () => {
  throwIfEmpty(String(collection), "Collection cannot be empty");
  throwIfCoreCollection(collection, "Cannot use readItem for core collections");
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/items/${collection}/${key}`,
    params: query ?? {},
    method: "GET"
  };
};

// src/rest/commands/read/notifications.ts
var readNotifications = (query) => () => ({
  path: `/notifications`,
  params: query ?? {},
  method: "GET"
});
var readNotification = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/notifications/${key}`,
    params: query ?? {},
    method: "GET"
  };
};

// src/rest/commands/read/operations.ts
var readOperations = (query) => () => ({
  path: `/operations`,
  params: query ?? {},
  method: "GET"
});
var readOperation = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/operations/${key}`,
    params: query ?? {},
    method: "GET"
  };
};

// src/rest/commands/read/panels.ts
var readPanels = (query) => () => ({
  path: `/panels`,
  params: query ?? {},
  method: "GET"
});
var readPanel = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/panels/${key}`,
    params: query ?? {},
    method: "GET"
  };
};

// src/rest/commands/read/permissions.ts
var readPermissions = (query) => () => ({
  path: `/permissions`,
  params: query ?? {},
  method: "GET"
});
var readPermission = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/permissions/${key}`,
    params: query ?? {},
    method: "GET"
  };
};
var readItemPermissions = (collection, key) => () => {
  throwIfEmpty(String(collection), "Collection cannot be empty");
  const item = key ? `${collection}/${key}` : `${collection}`;
  return {
    path: `/permissions/me/${item}`,
    method: "GET"
  };
};
var readUserPermissions = () => () => ({
  path: `/permissions/me`,
  method: "GET"
});

// src/rest/commands/read/policies.ts
var readPolicies = (query) => () => ({
  path: `/policies`,
  params: query ?? {},
  method: "GET"
});
var readPolicy = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/policies/${key}`,
    params: query ?? {},
    method: "GET"
  };
};
var readPolicyGlobals = () => () => ({
  path: `/policies/me/globals`,
  method: "GET"
});

// src/rest/commands/read/presets.ts
var readPresets = (query) => () => ({
  path: `/presets`,
  params: query ?? {},
  method: "GET"
});
var readPreset = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/presets/${key}`,
    params: query ?? {},
    method: "GET"
  };
};

// src/rest/commands/read/relations.ts
var readRelations = () => () => ({
  path: `/relations`,
  method: "GET"
});
var readRelationByCollection = (collection) => () => ({
  path: `/relations/${collection}`,
  method: "GET"
});
var readRelation = (collection, field) => () => {
  throwIfEmpty(collection, "Collection cannot be empty");
  throwIfEmpty(field, "Field cannot be empty");
  return {
    path: `/relations/${collection}/${field}`,
    method: "GET"
  };
};

// src/rest/commands/read/revisions.ts
var readRevisions = (query) => () => ({
  path: `/revisions`,
  params: query ?? {},
  method: "GET"
});
var readRevision = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/revisions/${key}`,
    params: query ?? {},
    method: "GET"
  };
};

// src/rest/commands/read/roles.ts
var readRoles = (query) => () => ({
  path: `/roles`,
  params: query ?? {},
  method: "GET"
});
var readRole = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/roles/${key}`,
    params: query ?? {},
    method: "GET"
  };
};
var readRolesMe = (query) => () => ({
  path: `/roles/me`,
  params: query ?? {},
  method: "GET"
});

// src/rest/commands/read/settings.ts
var readSettings = (query) => () => ({
  path: `/settings`,
  params: query ?? {},
  method: "GET"
});

// src/rest/commands/read/shares.ts
var readShares = (query) => () => ({
  path: `/shares`,
  params: query ?? {},
  method: "GET"
});
var readShare = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/shares/${key}`,
    params: query ?? {},
    method: "GET"
  };
};

// src/rest/commands/read/singleton.ts
var readSingleton = (collection, query) => () => {
  throwIfEmpty(String(collection), "Collection cannot be empty");
  throwIfCoreCollection(collection, "Cannot use readSingleton for core collections");
  return {
    path: `/items/${collection}`,
    params: query ?? {},
    method: "GET"
  };
};

// src/rest/commands/read/translations.ts
var readTranslations = (query) => () => ({
  path: `/translations`,
  params: query ?? {},
  method: "GET"
});
var readTranslation = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/translations/${key}`,
    params: query ?? {},
    method: "GET"
  };
};

// src/rest/commands/read/users.ts
var readUsers = (query) => () => ({
  path: `/users`,
  params: query ?? {},
  method: "GET"
});
var readUser = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/users/${key}`,
    params: query ?? {},
    method: "GET"
  };
};
var readMe = (query) => () => ({
  path: `/users/me`,
  params: query ?? {},
  method: "GET"
});

// src/rest/commands/read/versions.ts
var readContentVersions = (query) => () => ({
  path: `/versions`,
  params: query ?? {},
  method: "GET"
});
var readContentVersion = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/versions/${key}`,
    params: query ?? {},
    method: "GET"
  };
};

// src/rest/commands/read/webhooks.ts
var readWebhooks = (query) => () => ({
  path: `/webhooks`,
  params: query ?? {},
  method: "GET"
});
var readWebhook = (key, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/webhooks/${key}`,
    params: query ?? {},
    method: "GET"
  };
};

// src/rest/commands/schema/apply.ts
var schemaApply = (diff) => () => ({
  method: "POST",
  path: "/schema/apply",
  body: JSON.stringify(diff)
});

// src/rest/commands/schema/diff.ts
var schemaDiff = (snapshot, force = false) => () => ({
  method: "POST",
  path: "/schema/diff",
  params: force ? { force } : {},
  body: JSON.stringify(snapshot)
});

// src/rest/commands/schema/snapshot.ts
var schemaSnapshot = () => () => ({
  method: "GET",
  path: "/schema/snapshot"
});

// src/rest/commands/server/graphql.ts
var readGraphqlSdl = (scope = "item") => () => ({
  method: "GET",
  path: scope === "item" ? "/server/specs/graphql" : "/server/specs/graphql/system"
});

// src/rest/commands/server/health.ts
var serverHealth = () => () => ({
  method: "GET",
  path: "/server/health"
});

// src/rest/commands/server/info.ts
var serverInfo = () => () => ({
  method: "GET",
  path: "/server/info"
});

// src/rest/commands/server/openapi.ts
var readOpenApiSpec = () => () => ({
  method: "GET",
  path: "/server/specs/oas"
});

// src/rest/commands/server/ping.ts
var serverPing = () => () => ({
  method: "GET",
  path: "/server/ping"
});

// src/rest/commands/update/collections.ts
var updateCollection = (collection, item, query) => () => {
  throwIfEmpty(collection, "Collection cannot be empty");
  return {
    path: `/collections/${collection}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};
var updateCollectionsBatch = (items, query) => () => ({
  path: `/collections`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "PATCH"
});

// src/rest/commands/update/comments.ts
var updateComments = (keysOrQuery, item, query) => () => {
  let payload = {};
  if (Array.isArray(keysOrQuery)) {
    throwIfEmpty(keysOrQuery, "keysOrQuery cannot be empty");
    payload = { keys: keysOrQuery };
  } else {
    throwIfEmpty(Object.keys(keysOrQuery), "keysOrQuery cannot be empty");
    payload = { query: keysOrQuery };
  }
  payload["data"] = item;
  return {
    path: `/comments`,
    params: query ?? {},
    body: JSON.stringify(payload),
    method: "PATCH"
  };
};
var updateComment = (key, item, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/comments/${key}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};

// src/rest/commands/update/dashboards.ts
var updateDashboards = (keys, item, query) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/dashboards`,
    params: query ?? {},
    body: JSON.stringify({ keys, data: item }),
    method: "PATCH"
  };
};
var updateDashboardsBatch = (items, query) => () => ({
  path: `/dashboards`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "PATCH"
});
var updateDashboard = (key, item, query) => () => {
  throwIfEmpty(key, "Key cannot be empty");
  return {
    path: `/dashboards/${key}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};

// src/rest/commands/update/extensions.ts
var updateExtension = (bundle, name, data) => () => {
  if (bundle !== null) throwIfEmpty(bundle, "Bundle cannot be an empty string");
  throwIfEmpty(name, "Name cannot be empty");
  return {
    path: bundle ? `/extensions/${bundle}/${name}` : `/extensions/${name}`,
    params: {},
    body: JSON.stringify(data),
    method: "PATCH"
  };
};

// src/rest/commands/update/fields.ts
var updateField = (collection, field, item, query) => () => {
  throwIfEmpty(collection, "Keys cannot be empty");
  throwIfEmpty(field, "Field cannot be empty");
  return {
    path: `/fields/${collection}/${field}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};

// src/rest/commands/update/files.ts
var updateFiles = (keys, item, query) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/files`,
    params: query ?? {},
    body: JSON.stringify({ keys, data: item }),
    method: "PATCH"
  };
};
var updateFilesBatch = (items, query) => () => ({
  path: `/files`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "PATCH"
});
var updateFile = (key, item, query) => () => {
  throwIfEmpty(key, "Key cannot be empty");
  if (item instanceof FormData) {
    return {
      path: `/files/${key}`,
      params: query ?? {},
      body: item,
      method: "PATCH",
      headers: { "Content-Type": "multipart/form-data" }
    };
  }
  return {
    path: `/files/${key}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};

// src/rest/commands/update/flows.ts
var updateFlows = (keys, item, query) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/flows`,
    params: query ?? {},
    body: JSON.stringify({ keys, data: item }),
    method: "PATCH"
  };
};
var updateFlowsBatch = (items, query) => () => ({
  path: `/flows`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "PATCH"
});
var updateFlow = (key, item, query) => () => {
  throwIfEmpty(key, "Key cannot be empty");
  return {
    path: `/flows/${key}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};

// src/rest/commands/update/folders.ts
var updateFolders = (keys, item, query) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/folders`,
    params: query ?? {},
    body: JSON.stringify({ keys, data: item }),
    method: "PATCH"
  };
};
var updateFoldersBatch = (items, query) => () => ({
  path: `/folders`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "PATCH"
});
var updateFolder = (key, item, query) => () => {
  throwIfEmpty(key, "Key cannot be empty");
  return {
    path: `/folders/${key}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};

// src/rest/commands/update/items.ts
var updateItems = (collection, keysOrQuery, item, query) => () => {
  let payload = {};
  throwIfEmpty(String(collection), "Collection cannot be empty");
  throwIfCoreCollection(collection, "Cannot use updateItems for core collections");
  if (Array.isArray(keysOrQuery)) {
    throwIfEmpty(keysOrQuery, "keysOrQuery cannot be empty");
    payload = { keys: keysOrQuery };
  } else {
    throwIfEmpty(Object.keys(keysOrQuery), "keysOrQuery cannot be empty");
    payload = { query: keysOrQuery };
  }
  payload["data"] = item;
  return {
    path: `/items/${collection}`,
    params: query ?? {},
    body: JSON.stringify(payload),
    method: "PATCH"
  };
};
var updateItemsBatch = (collection, items, query) => () => {
  throwIfEmpty(String(collection), "Collection cannot be empty");
  throwIfCoreCollection(collection, "Cannot use updateItems for core collections");
  return {
    path: `/items/${collection}`,
    params: query ?? {},
    body: JSON.stringify(items),
    method: "PATCH"
  };
};
var updateItem = (collection, key, item, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  throwIfEmpty(String(collection), "Collection cannot be empty");
  throwIfCoreCollection(collection, "Cannot use updateItem for core collections");
  return {
    path: `/items/${collection}/${key}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};

// src/rest/commands/update/notifications.ts
var updateNotifications = (keys, item, query) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/notifications`,
    params: query ?? {},
    body: JSON.stringify({ keys, data: item }),
    method: "PATCH"
  };
};
var updateNotificationsBatch = (items, query) => () => ({
  path: `/notifications`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "PATCH"
});
var updateNotification = (key, item, query) => () => {
  throwIfEmpty(key, "Key cannot be empty");
  return {
    path: `/notifications/${key}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};

// src/rest/commands/update/operations.ts
var updateOperations = (keys, item, query) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/operations`,
    params: query ?? {},
    body: JSON.stringify({ keys, data: item }),
    method: "PATCH"
  };
};
var updateOperationsBatch = (items, query) => () => ({
  path: `/operations`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "PATCH"
});
var updateOperation = (key, item, query) => () => {
  throwIfEmpty(key, "Key cannot be empty");
  return {
    path: `/operations/${key}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};

// src/rest/commands/update/panels.ts
var updatePanels = (keys, item, query) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/panels`,
    params: query ?? {},
    body: JSON.stringify({ keys, data: item }),
    method: "PATCH"
  };
};
var updatePanelsBatch = (items, query) => () => ({
  path: `/panels`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "PATCH"
});
var updatePanel = (key, item, query) => () => {
  throwIfEmpty(key, "Key cannot be empty");
  return {
    path: `/panels/${key}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};

// src/rest/commands/update/permissions.ts
var updatePermissions = (keys, item, query) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/permissions`,
    params: query ?? {},
    body: JSON.stringify({ keys, data: item }),
    method: "PATCH"
  };
};
var updatePermissionsBatch = (items, query) => () => ({
  path: `/permissions`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "PATCH"
});
var updatePermission = (key, item, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/permissions/${key}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};

// src/rest/commands/update/policies.ts
var updatePolicies = (keys, item, query) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/policies`,
    params: query ?? {},
    body: JSON.stringify({ keys, data: item }),
    method: "PATCH"
  };
};
var updatePoliciesBatch = (items, query) => () => ({
  path: `/policies`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "PATCH"
});
var updatePolicy = (key, item, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/policies/${key}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};

// src/rest/commands/update/presets.ts
var updatePresets = (keys, item, query) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/presets`,
    params: query ?? {},
    body: JSON.stringify({ keys, data: item }),
    method: "PATCH"
  };
};
var updatePresetsBatch = (items, query) => () => ({
  path: `/presets`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "PATCH"
});
var updatePreset = (key, item, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/presets/${key}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};

// src/rest/commands/update/relations.ts
var updateRelation = (collection, field, item, query) => () => {
  throwIfEmpty(collection, "Collection cannot be empty");
  throwIfEmpty(field, "Field cannot be empty");
  return {
    path: `/relations/${collection}/${field}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};

// src/rest/commands/update/roles.ts
var updateRoles = (keys, item, query) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/roles`,
    params: query ?? {},
    body: JSON.stringify({ keys, data: item }),
    method: "PATCH"
  };
};
var updateRolesBatch = (items, query) => () => ({
  path: `/roles`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "PATCH"
});
var updateRole = (key, item, query) => () => {
  throwIfEmpty(key, "Key cannot be empty");
  return {
    path: `/roles/${key}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};

// src/rest/commands/update/settings.ts
var updateSettings = (item, query) => () => ({
  path: `/settings`,
  params: query ?? {},
  body: JSON.stringify(item),
  method: "PATCH"
});

// src/rest/commands/update/shares.ts
var updateShares = (keys, item, query) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/shares`,
    params: query ?? {},
    body: JSON.stringify({ keys, data: item }),
    method: "PATCH"
  };
};
var updateSharesBatch = (items, query) => () => ({
  path: `/shares`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "PATCH"
});
var updateShare = (key, item, query) => () => {
  throwIfEmpty(key, "Key cannot be empty");
  return {
    path: `/shares/${key}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};

// src/rest/commands/update/singleton.ts
var updateSingleton = (collection, item, query) => () => {
  throwIfEmpty(String(collection), "Collection cannot be empty");
  throwIfCoreCollection(collection, "Cannot use updateSingleton for core collections");
  return {
    path: `/items/${collection}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};

// src/rest/commands/update/translations.ts
var updateTranslations = (keys, item, query) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/translations`,
    params: query ?? {},
    body: JSON.stringify({ keys, data: item }),
    method: "PATCH"
  };
};
var updateTranslationsBatch = (items, query) => () => ({
  path: `/translations`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "PATCH"
});
var updateTranslation = (key, item, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/translations/${key}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};

// src/rest/commands/update/users.ts
var updateUsers = (keys, item, query) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/users`,
    params: query ?? {},
    body: JSON.stringify({ keys, data: item }),
    method: "PATCH"
  };
};
var updateUsersBatch = (items, query) => () => ({
  path: `/users`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "PATCH"
});
var updateUser = (key, item, query) => () => {
  throwIfEmpty(key, "Key cannot be empty");
  return {
    path: `/users/${key}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};
var updateMe = (item, query) => () => ({
  path: `/users/me`,
  params: query ?? {},
  body: JSON.stringify(item),
  method: "PATCH"
});

// src/rest/commands/update/versions.ts
var updateContentVersions = (keys, item, query) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/versions`,
    params: query ?? {},
    body: JSON.stringify({ keys, data: item }),
    method: "PATCH"
  };
};
var updateContentVersionsBatch = (items, query) => () => ({
  path: `/versions`,
  params: query ?? {},
  body: JSON.stringify(items),
  method: "PATCH"
});
var updateContentVersion = (key, item, query) => () => {
  throwIfEmpty(key, "Key cannot be empty");
  return {
    path: `/versions/${key}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};

// src/rest/commands/update/webhooks.ts
var updateWebhooks = (keys, item, query) => () => {
  throwIfEmpty(keys, "Keys cannot be empty");
  return {
    path: `/webhooks`,
    params: query ?? {},
    body: JSON.stringify({ keys, data: item }),
    method: "PATCH"
  };
};
var updateWebhook = (key, item, query) => () => {
  throwIfEmpty(String(key), "Key cannot be empty");
  return {
    path: `/webhooks/${key}`,
    params: query ?? {},
    body: JSON.stringify(item),
    method: "PATCH"
  };
};

// src/rest/commands/utils/cache.ts
var clearCache = () => (system = false) => ({
  method: "POST",
  path: `/utils/cache/clear${system ? "?system" : ""}`
});

// src/rest/commands/utils/export.ts
var utilsExport = (collection, format, query, file) => () => ({
  method: "POST",
  path: `/utils/export/${collection}`,
  body: JSON.stringify({ format, query, file })
});

// src/rest/commands/utils/flows.ts
var triggerFlow = (method, id, data) => () => {
  if (method === "GET") {
    return {
      path: `/flows/trigger/${id}`,
      params: data ?? {},
      method: "GET"
    };
  }
  return {
    path: `/flows/trigger/${id}`,
    body: JSON.stringify(data ?? {}),
    method: "POST"
  };
};

// src/rest/commands/utils/hash.ts
var generateHash = (string) => () => ({
  method: "POST",
  path: `/utils/hash/generate`,
  body: JSON.stringify({ string })
});
var verifyHash = (string, hash) => () => ({
  method: "POST",
  path: `/utils/hash/verify`,
  body: JSON.stringify({ string, hash })
});

// src/rest/commands/utils/import.ts
var utilsImport = (collection, data) => () => ({
  path: `/utils/import/${collection}`,
  method: "POST",
  body: data,
  headers: { "Content-Type": "multipart/form-data" }
});

// src/rest/commands/utils/shares.ts
var authenticateShare = (share, password, mode = "cookie") => () => {
  const data = { share, password, mode };
  return { path: "/shares/auth", method: "POST", body: JSON.stringify(data) };
};
var inviteShare = (share, emails) => () => ({
  path: `/shares/invite`,
  method: "POST",
  body: JSON.stringify({ share, emails })
});
var readShareInfo = (id) => () => ({
  path: `/shares/info/${id}`,
  method: "GET"
});

// src/rest/commands/utils/sort.ts
var utilitySort = (collection, item, to) => () => ({
  method: "POST",
  path: `/utils/sort/${collection}`,
  body: JSON.stringify({ item, to })
});

// src/rest/commands/utils/users.ts
var inviteUser = (email, role, invite_url) => () => ({
  path: `/users/invite`,
  method: "POST",
  body: JSON.stringify({
    email,
    role,
    ...invite_url ? { invite_url } : {}
  })
});
var acceptUserInvite = (token, password) => () => ({
  path: `/users/invite/accept`,
  method: "POST",
  body: JSON.stringify({
    token,
    password
  })
});
var registerUser = (email, password, options = {}) => () => ({
  path: `/users/register`,
  method: "POST",
  body: JSON.stringify({
    email,
    password,
    ...options
  })
});
var registerUserVerify = (token) => () => ({
  path: `/users/register/verify-email`,
  params: { token },
  method: "GET"
});
var generateTwoFactorSecret = (password) => () => ({
  path: `/users/me/tfa/generate`,
  method: "POST",
  body: JSON.stringify({
    password
  })
});
var enableTwoFactor = (secret, otp) => () => ({
  path: `/users/me/tfa/enable`,
  method: "POST",
  body: JSON.stringify({
    secret,
    otp
  })
});
var disableTwoFactor = (otp) => () => ({
  path: `/users/me/tfa/disable`,
  method: "POST",
  body: JSON.stringify({ otp })
});

// src/rest/commands/utils/versions.ts
var saveToContentVersion = (id, item) => () => {
  throwIfEmpty(id, "ID cannot be empty");
  return {
    path: `/versions/${id}/save`,
    method: "POST",
    body: JSON.stringify(item)
  };
};
var compareContentVersion = (id) => () => {
  throwIfEmpty(id, "ID cannot be empty");
  return {
    path: `/versions/${id}/compare`,
    method: "GET"
  };
};
var promoteContentVersion = (id, mainHash, fields) => () => {
  throwIfEmpty(id, "ID cannot be empty");
  return {
    path: `/versions/${id}/promote`,
    method: "POST",
    body: JSON.stringify(fields ? { mainHash, fields } : { mainHash })
  };
};

// src/rest/commands/utils/random.ts
var randomString = (length) => () => ({
  method: "GET",
  path: `/utils/random/string`,
  params: length !== void 0 ? { length } : {}
});

// src/rest/composable.ts
var defaultConfigValues3 = {};
var rest = (config = {}) => {
  return (client) => {
    const restConfig = { ...defaultConfigValues3, ...config };
    return {
      async request(getOptions) {
        const options = getOptions();
        if (!options.headers) {
          options.headers = {};
        }
        if ("Content-Type" in options.headers === false) {
          options.headers["Content-Type"] = "application/json";
        } else if (options.headers["Content-Type"] === "multipart/form-data") {
          delete options.headers["Content-Type"];
        }
        if ("getToken" in this && "Authorization" in options.headers === false) {
          const token = await this.getToken();
          if (token) {
            options.headers["Authorization"] = `Bearer ${token}`;
          }
        }
        const requestUrl = getRequestUrl(client.url, options.path, options.params);
        let fetchOptions = {
          method: options.method ?? "GET",
          headers: options.headers ?? {}
        };
        if ("credentials" in restConfig) {
          fetchOptions.credentials = restConfig.credentials;
        }
        if (options.body) {
          fetchOptions["body"] = options.body;
        }
        if (options.onRequest) {
          fetchOptions = await options.onRequest(fetchOptions);
        }
        if (restConfig.onRequest) {
          fetchOptions = await restConfig.onRequest(fetchOptions);
        }
        let result = await request(requestUrl.toString(), fetchOptions, client.globals.fetch);
        if ("onResponse" in options) {
          result = await options.onResponse(result, fetchOptions);
        }
        if ("onResponse" in config) {
          result = await config.onResponse(result, fetchOptions);
        }
        return result;
      }
    };
  };
};

// src/rest/helpers/with-options.ts
function withOptions(getOptions, extraOptions) {
  return () => {
    const options = getOptions();
    if (typeof extraOptions === "function") {
      options.onRequest = extraOptions;
    } else {
      options.onRequest = (options2) => ({
        ...options2,
        ...extraOptions
      });
    }
    return options;
  };
}

// src/rest/helpers/with-search.ts
function withSearch(getOptions) {
  return () => {
    const options = getOptions();
    if (options.method === "GET" && options.params) {
      options.method = "SEARCH";
      options.body = JSON.stringify({
        query: {
          ...options.params,
          fields: formatFields(options.params["fields"] ?? [])
        }
      });
      delete options.params;
    }
    return options;
  };
}

// src/rest/helpers/with-token.ts
function withToken(token, getOptions) {
  return () => {
    const options = getOptions();
    if (token) {
      if (!options.headers) options.headers = {};
      options.headers["Authorization"] = `Bearer ${token}`;
    }
    return options;
  };
}

// src/rest/helpers/custom-endpoint.ts
function customEndpoint(options) {
  return () => options;
}

// src/utils/is-directus-error.ts
function isDirectusError(error) {
  return typeof error === "object" && error !== null && "errors" in error && Array.isArray(error.errors) && "message" in error.errors[0] && "extensions" in error.errors[0] && "code" in error.errors[0].extensions;
}
export {
  acceptUserInvite,
  aggregate,
  auth,
  authenticateShare,
  authentication,
  clearCache,
  compareContentVersion,
  createCollection,
  createComment,
  createComments,
  createContentVersion,
  createContentVersions,
  createDashboard,
  createDashboards,
  createDirectus,
  createField,
  createFlow,
  createFlows,
  createFolder,
  createFolders,
  createItem,
  createItems,
  createNotification,
  createNotifications,
  createOperation,
  createOperations,
  createPanel,
  createPanels,
  createPermission,
  createPermissions,
  createPolicies,
  createPolicy,
  createPreset,
  createPresets,
  createRelation,
  createRole,
  createRoles,
  createShare,
  createShares,
  createTranslation,
  createTranslations,
  createUser,
  createUsers,
  createWebhook,
  createWebhooks,
  customEndpoint,
  deleteCollection,
  deleteComment,
  deleteComments,
  deleteContentVersion,
  deleteContentVersions,
  deleteDashboard,
  deleteDashboards,
  deleteField,
  deleteFile,
  deleteFiles,
  deleteFlow,
  deleteFlows,
  deleteFolder,
  deleteFolders,
  deleteItem,
  deleteItems,
  deleteNotification,
  deleteNotifications,
  deleteOperation,
  deleteOperations,
  deletePanel,
  deletePanels,
  deletePermission,
  deletePermissions,
  deletePolicies,
  deletePolicy,
  deletePreset,
  deletePresets,
  deleteRelation,
  deleteRole,
  deleteRoles,
  deleteShare,
  deleteShares,
  deleteTranslation,
  deleteTranslations,
  deleteUser,
  deleteUsers,
  deleteWebhook,
  deleteWebhooks,
  disableTwoFactor,
  enableTwoFactor,
  formatFields,
  generateHash,
  generateTwoFactorSecret,
  generateUid,
  getAuthEndpoint,
  graphql,
  importFile,
  inviteShare,
  inviteUser,
  isDirectusError,
  login,
  logout,
  memoryStorage,
  messageCallback,
  passwordRequest,
  passwordReset,
  pong,
  promoteContentVersion,
  queryToParams,
  randomString,
  readActivities,
  readActivity,
  readAssetArrayBuffer,
  readAssetBlob,
  readAssetRaw,
  readCollection,
  readCollections,
  readComment,
  readComments,
  readContentVersion,
  readContentVersions,
  readDashboard,
  readDashboards,
  readExtensions,
  readField,
  readFields,
  readFieldsByCollection,
  readFile,
  readFiles,
  readFlow,
  readFlows,
  readFolder,
  readFolders,
  readGraphqlSdl,
  readItem,
  readItemPermissions,
  readItems,
  readMe,
  readNotification,
  readNotifications,
  readOpenApiSpec,
  readOperation,
  readOperations,
  readPanel,
  readPanels,
  readPermission,
  readPermissions,
  readPolicies,
  readPolicy,
  readPolicyGlobals,
  readPreset,
  readPresets,
  readProviders,
  readRelation,
  readRelationByCollection,
  readRelations,
  readRevision,
  readRevisions,
  readRole,
  readRoles,
  readRolesMe,
  readSettings,
  readShare,
  readShareInfo,
  readShares,
  readSingleton,
  readTranslation,
  readTranslations,
  readUser,
  readUserPermissions,
  readUsers,
  readWebhook,
  readWebhooks,
  realtime,
  refresh,
  registerUser,
  registerUserVerify,
  rest,
  saveToContentVersion,
  schemaApply,
  schemaDiff,
  schemaSnapshot,
  serverHealth,
  serverInfo,
  serverPing,
  sleep,
  staticToken,
  throwIfCoreCollection,
  throwIfEmpty,
  triggerFlow,
  updateCollection,
  updateCollectionsBatch,
  updateComment,
  updateComments,
  updateContentVersion,
  updateContentVersions,
  updateContentVersionsBatch,
  updateDashboard,
  updateDashboards,
  updateDashboardsBatch,
  updateExtension,
  updateField,
  updateFile,
  updateFiles,
  updateFilesBatch,
  updateFlow,
  updateFlows,
  updateFlowsBatch,
  updateFolder,
  updateFolders,
  updateFoldersBatch,
  updateItem,
  updateItems,
  updateItemsBatch,
  updateMe,
  updateNotification,
  updateNotifications,
  updateNotificationsBatch,
  updateOperation,
  updateOperations,
  updateOperationsBatch,
  updatePanel,
  updatePanels,
  updatePanelsBatch,
  updatePermission,
  updatePermissions,
  updatePermissionsBatch,
  updatePolicies,
  updatePoliciesBatch,
  updatePolicy,
  updatePreset,
  updatePresets,
  updatePresetsBatch,
  updateRelation,
  updateRole,
  updateRoles,
  updateRolesBatch,
  updateSettings,
  updateShare,
  updateShares,
  updateSharesBatch,
  updateSingleton,
  updateTranslation,
  updateTranslations,
  updateTranslationsBatch,
  updateUser,
  updateUsers,
  updateUsersBatch,
  updateWebhook,
  updateWebhooks,
  uploadFiles,
  utilitySort,
  utilsExport,
  utilsImport,
  verifyHash,
  withOptions,
  withSearch,
  withToken
};
//# sourceMappingURL=index.js.map