import { z } from "zod";

//#region src/shared/schemas/options.d.ts
declare const SplitEntrypoint: z.ZodObject<{
  app: z.ZodString;
  api: z.ZodString;
}, z.core.$strip>;
type SplitEntrypoint = z.infer<typeof SplitEntrypoint>;
declare const ExtensionSandboxRequestedScopes: z.ZodObject<{
  request: z.ZodOptional<z.ZodObject<{
    urls: z.ZodArray<z.ZodString>;
    methods: z.ZodArray<z.ZodUnion<readonly [z.ZodLiteral<"GET">, z.ZodLiteral<"POST">, z.ZodLiteral<"PATCH">, z.ZodLiteral<"PUT">, z.ZodLiteral<"DELETE">]>>;
  }, z.core.$strip>>;
  log: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
  sleep: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
}, z.core.$strip>;
declare const ExtensionSandboxOptions: z.ZodOptional<z.ZodObject<{
  enabled: z.ZodBoolean;
  requestedScopes: z.ZodObject<{
    request: z.ZodOptional<z.ZodObject<{
      urls: z.ZodArray<z.ZodString>;
      methods: z.ZodArray<z.ZodUnion<readonly [z.ZodLiteral<"GET">, z.ZodLiteral<"POST">, z.ZodLiteral<"PATCH">, z.ZodLiteral<"PUT">, z.ZodLiteral<"DELETE">]>>;
    }, z.core.$strip>>;
    log: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
    sleep: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
  }, z.core.$strip>;
}, z.core.$strip>>;
type ExtensionSandboxOptions = z.infer<typeof ExtensionSandboxOptions>;
type ExtensionSandboxRequestedScopes = z.infer<typeof ExtensionSandboxRequestedScopes>;
declare const ExtensionOptionsBundleEntry: z.ZodUnion<readonly [z.ZodObject<{
  type: z.ZodEnum<{
    hook: "hook";
    endpoint: "endpoint";
  }>;
  name: z.ZodString;
  source: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
  type: z.ZodEnum<{
    interface: "interface";
    display: "display";
    layout: "layout";
    module: "module";
    panel: "panel";
    theme: "theme";
  }>;
  name: z.ZodString;
  source: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
  type: z.ZodEnum<{
    operation: "operation";
  }>;
  name: z.ZodString;
  source: z.ZodObject<{
    app: z.ZodString;
    api: z.ZodString;
  }, z.core.$strip>;
}, z.core.$strip>]>;
type ExtensionOptionsBundleEntry = z.infer<typeof ExtensionOptionsBundleEntry>;
declare const ExtensionOptionsBase: z.ZodObject<{
  host: z.ZodString;
  hidden: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
declare const ExtensionOptionsApp: z.ZodObject<{
  type: z.ZodEnum<{
    interface: "interface";
    display: "display";
    layout: "layout";
    module: "module";
    panel: "panel";
    theme: "theme";
  }>;
  path: z.ZodString;
  source: z.ZodString;
}, z.core.$strip>;
declare const ExtensionOptionsApi: z.ZodObject<{
  type: z.ZodEnum<{
    hook: "hook";
    endpoint: "endpoint";
  }>;
  path: z.ZodString;
  source: z.ZodString;
  sandbox: z.ZodOptional<z.ZodObject<{
    enabled: z.ZodBoolean;
    requestedScopes: z.ZodObject<{
      request: z.ZodOptional<z.ZodObject<{
        urls: z.ZodArray<z.ZodString>;
        methods: z.ZodArray<z.ZodUnion<readonly [z.ZodLiteral<"GET">, z.ZodLiteral<"POST">, z.ZodLiteral<"PATCH">, z.ZodLiteral<"PUT">, z.ZodLiteral<"DELETE">]>>;
      }, z.core.$strip>>;
      log: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
      sleep: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
    }, z.core.$strip>;
  }, z.core.$strip>>;
}, z.core.$strip>;
declare const ExtensionOptionsHybrid: z.ZodObject<{
  type: z.ZodEnum<{
    operation: "operation";
  }>;
  path: z.ZodObject<{
    app: z.ZodString;
    api: z.ZodString;
  }, z.core.$strip>;
  source: z.ZodObject<{
    app: z.ZodString;
    api: z.ZodString;
  }, z.core.$strip>;
  sandbox: z.ZodOptional<z.ZodObject<{
    enabled: z.ZodBoolean;
    requestedScopes: z.ZodObject<{
      request: z.ZodOptional<z.ZodObject<{
        urls: z.ZodArray<z.ZodString>;
        methods: z.ZodArray<z.ZodUnion<readonly [z.ZodLiteral<"GET">, z.ZodLiteral<"POST">, z.ZodLiteral<"PATCH">, z.ZodLiteral<"PUT">, z.ZodLiteral<"DELETE">]>>;
      }, z.core.$strip>>;
      log: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
      sleep: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
    }, z.core.$strip>;
  }, z.core.$strip>>;
}, z.core.$strip>;
declare const ExtensionOptionsBundle: z.ZodObject<{
  type: z.ZodLiteral<"bundle">;
  partial: z.ZodOptional<z.ZodBoolean>;
  path: z.ZodObject<{
    app: z.ZodString;
    api: z.ZodString;
  }, z.core.$strip>;
  entries: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
    type: z.ZodEnum<{
      hook: "hook";
      endpoint: "endpoint";
    }>;
    name: z.ZodString;
    source: z.ZodString;
  }, z.core.$strip>, z.ZodObject<{
    type: z.ZodEnum<{
      interface: "interface";
      display: "display";
      layout: "layout";
      module: "module";
      panel: "panel";
      theme: "theme";
    }>;
    name: z.ZodString;
    source: z.ZodString;
  }, z.core.$strip>, z.ZodObject<{
    type: z.ZodEnum<{
      operation: "operation";
    }>;
    name: z.ZodString;
    source: z.ZodObject<{
      app: z.ZodString;
      api: z.ZodString;
    }, z.core.$strip>;
  }, z.core.$strip>]>>;
}, z.core.$strip>;
declare const ExtensionOptionsBundleEntries: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
  type: z.ZodEnum<{
    hook: "hook";
    endpoint: "endpoint";
  }>;
  name: z.ZodString;
  source: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
  type: z.ZodEnum<{
    interface: "interface";
    display: "display";
    layout: "layout";
    module: "module";
    panel: "panel";
    theme: "theme";
  }>;
  name: z.ZodString;
  source: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
  type: z.ZodEnum<{
    operation: "operation";
  }>;
  name: z.ZodString;
  source: z.ZodObject<{
    app: z.ZodString;
    api: z.ZodString;
  }, z.core.$strip>;
}, z.core.$strip>]>>;
type ExtensionOptionsBundleEntries = z.infer<typeof ExtensionOptionsBundleEntries>;
declare const ExtensionOptions: z.ZodIntersection<z.ZodObject<{
  host: z.ZodString;
  hidden: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>, z.ZodUnion<readonly [z.ZodObject<{
  type: z.ZodEnum<{
    interface: "interface";
    display: "display";
    layout: "layout";
    module: "module";
    panel: "panel";
    theme: "theme";
  }>;
  path: z.ZodString;
  source: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
  type: z.ZodEnum<{
    hook: "hook";
    endpoint: "endpoint";
  }>;
  path: z.ZodString;
  source: z.ZodString;
  sandbox: z.ZodOptional<z.ZodObject<{
    enabled: z.ZodBoolean;
    requestedScopes: z.ZodObject<{
      request: z.ZodOptional<z.ZodObject<{
        urls: z.ZodArray<z.ZodString>;
        methods: z.ZodArray<z.ZodUnion<readonly [z.ZodLiteral<"GET">, z.ZodLiteral<"POST">, z.ZodLiteral<"PATCH">, z.ZodLiteral<"PUT">, z.ZodLiteral<"DELETE">]>>;
      }, z.core.$strip>>;
      log: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
      sleep: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
    }, z.core.$strip>;
  }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
  type: z.ZodEnum<{
    operation: "operation";
  }>;
  path: z.ZodObject<{
    app: z.ZodString;
    api: z.ZodString;
  }, z.core.$strip>;
  source: z.ZodObject<{
    app: z.ZodString;
    api: z.ZodString;
  }, z.core.$strip>;
  sandbox: z.ZodOptional<z.ZodObject<{
    enabled: z.ZodBoolean;
    requestedScopes: z.ZodObject<{
      request: z.ZodOptional<z.ZodObject<{
        urls: z.ZodArray<z.ZodString>;
        methods: z.ZodArray<z.ZodUnion<readonly [z.ZodLiteral<"GET">, z.ZodLiteral<"POST">, z.ZodLiteral<"PATCH">, z.ZodLiteral<"PUT">, z.ZodLiteral<"DELETE">]>>;
      }, z.core.$strip>>;
      log: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
      sleep: z.ZodOptional<z.ZodObject<{}, z.core.$strip>>;
    }, z.core.$strip>;
  }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
  type: z.ZodLiteral<"bundle">;
  partial: z.ZodOptional<z.ZodBoolean>;
  path: z.ZodObject<{
    app: z.ZodString;
    api: z.ZodString;
  }, z.core.$strip>;
  entries: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
    type: z.ZodEnum<{
      hook: "hook";
      endpoint: "endpoint";
    }>;
    name: z.ZodString;
    source: z.ZodString;
  }, z.core.$strip>, z.ZodObject<{
    type: z.ZodEnum<{
      interface: "interface";
      display: "display";
      layout: "layout";
      module: "module";
      panel: "panel";
      theme: "theme";
    }>;
    name: z.ZodString;
    source: z.ZodString;
  }, z.core.$strip>, z.ZodObject<{
    type: z.ZodEnum<{
      operation: "operation";
    }>;
    name: z.ZodString;
    source: z.ZodObject<{
      app: z.ZodString;
      api: z.ZodString;
    }, z.core.$strip>;
  }, z.core.$strip>]>>;
}, z.core.$strip>]>>;
type ExtensionOptions = z.infer<typeof ExtensionOptions>;
//#endregion
export { ExtensionOptions, ExtensionOptionsApi, ExtensionOptionsApp, ExtensionOptionsBase, ExtensionOptionsBundle, ExtensionOptionsBundleEntries, ExtensionOptionsBundleEntry, ExtensionOptionsHybrid, ExtensionSandboxOptions, ExtensionSandboxRequestedScopes, SplitEntrypoint };