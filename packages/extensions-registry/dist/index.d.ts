import { z } from "zod";
import { ExtensionType } from "@directus/extensions";
import * as stream_web0 from "stream/web";

//#region src/modules/account/types/account-options.d.ts
interface AccountOptions {
  registry?: string;
}
//#endregion
//#region src/modules/account/schemas/registry-account-response.d.ts
declare const RegistryAccountResponse: z.ZodObject<{
  data: z.ZodObject<{
    id: z.ZodString;
    username: z.ZodString;
    verified: z.ZodBoolean;
    github_username: z.ZodNullable<z.ZodString>;
    github_avatar_url: z.ZodNullable<z.ZodString>;
    github_name: z.ZodNullable<z.ZodString>;
    github_company: z.ZodNullable<z.ZodString>;
    github_blog: z.ZodNullable<z.ZodString>;
    github_location: z.ZodNullable<z.ZodString>;
    github_bio: z.ZodNullable<z.ZodString>;
  }, "strip", z.ZodTypeAny, {
    id: string;
    verified: boolean;
    username: string;
    github_name: string | null;
    github_avatar_url: string | null;
    github_username: string | null;
    github_company: string | null;
    github_blog: string | null;
    github_location: string | null;
    github_bio: string | null;
  }, {
    id: string;
    verified: boolean;
    username: string;
    github_name: string | null;
    github_avatar_url: string | null;
    github_username: string | null;
    github_company: string | null;
    github_blog: string | null;
    github_location: string | null;
    github_bio: string | null;
  }>;
}, "strip", z.ZodTypeAny, {
  data: {
    id: string;
    verified: boolean;
    username: string;
    github_name: string | null;
    github_avatar_url: string | null;
    github_username: string | null;
    github_company: string | null;
    github_blog: string | null;
    github_location: string | null;
    github_bio: string | null;
  };
}, {
  data: {
    id: string;
    verified: boolean;
    username: string;
    github_name: string | null;
    github_avatar_url: string | null;
    github_username: string | null;
    github_company: string | null;
    github_blog: string | null;
    github_location: string | null;
    github_bio: string | null;
  };
}>;
type RegistryAccountResponse = z.infer<typeof RegistryAccountResponse>;
//#endregion
//#region src/modules/account/account.d.ts
declare const account: (id: string, options?: AccountOptions) => Promise<{
  data: {
    id: string;
    verified: boolean;
    username: string;
    github_name: string | null;
    github_avatar_url: string | null;
    github_username: string | null;
    github_company: string | null;
    github_blog: string | null;
    github_location: string | null;
    github_bio: string | null;
  };
}>;
//#endregion
//#region src/modules/describe/types/describe-options.d.ts
interface DescribeOptions {
  registry?: string;
}
//#endregion
//#region src/modules/describe/schemas/registry-describe-response.d.ts
declare const RegistryDescribeResponse: z.ZodObject<{
  data: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodUnion<[z.ZodNull, z.ZodString]>;
    total_downloads: z.ZodNumber;
    downloads: z.ZodUnion<[z.ZodNull, z.ZodArray<z.ZodObject<{
      date: z.ZodString;
      count: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
      date: string;
      count: number;
    }, {
      date: string;
      count: number;
    }>, "many">]>;
    verified: z.ZodBoolean;
    readme: z.ZodUnion<[z.ZodNull, z.ZodString]>;
    type: z.ZodEnum<["interface", "display", "layout", "module", "panel", "theme", "hook", "endpoint", "operation", "bundle"]>;
    license: z.ZodNullable<z.ZodString>;
    versions: z.ZodArray<z.ZodObject<{
      id: z.ZodString;
      version: z.ZodString;
      verified: z.ZodBoolean;
      type: z.ZodEnum<["interface", "display", "layout", "module", "panel", "theme", "hook", "endpoint", "operation", "bundle"]>;
      host_version: z.ZodString;
      publish_date: z.ZodString;
      unpacked_size: z.ZodNumber;
      file_count: z.ZodNumber;
      url_bugs: z.ZodUnion<[z.ZodNull, z.ZodString]>;
      url_homepage: z.ZodUnion<[z.ZodNull, z.ZodString]>;
      url_repository: z.ZodUnion<[z.ZodNull, z.ZodString]>;
      license: z.ZodNullable<z.ZodString>;
      publisher: z.ZodObject<{
        id: z.ZodString;
        username: z.ZodString;
        verified: z.ZodBoolean;
        github_name: z.ZodNullable<z.ZodString>;
        github_avatar_url: z.ZodNullable<z.ZodString>;
      }, "strip", z.ZodTypeAny, {
        id: string;
        verified: boolean;
        username: string;
        github_name: string | null;
        github_avatar_url: string | null;
      }, {
        id: string;
        verified: boolean;
        username: string;
        github_name: string | null;
        github_avatar_url: string | null;
      }>;
      bundled: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        type: z.ZodString;
      }, "strip", z.ZodTypeAny, {
        type: string;
        name: string;
      }, {
        type: string;
        name: string;
      }>, "many">;
      maintainers: z.ZodNullable<z.ZodArray<z.ZodObject<{
        accounts_id: z.ZodObject<{
          id: z.ZodString;
          username: z.ZodString;
          verified: z.ZodBoolean;
          github_name: z.ZodNullable<z.ZodString>;
          github_avatar_url: z.ZodNullable<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
          id: string;
          verified: boolean;
          username: string;
          github_name: string | null;
          github_avatar_url: string | null;
        }, {
          id: string;
          verified: boolean;
          username: string;
          github_name: string | null;
          github_avatar_url: string | null;
        }>;
      }, "strip", z.ZodTypeAny, {
        accounts_id: {
          id: string;
          verified: boolean;
          username: string;
          github_name: string | null;
          github_avatar_url: string | null;
        };
      }, {
        accounts_id: {
          id: string;
          verified: boolean;
          username: string;
          github_name: string | null;
          github_avatar_url: string | null;
        };
      }>, "many">>;
    }, "strip", z.ZodTypeAny, {
      type: "interface" | "display" | "layout" | "module" | "panel" | "theme" | "hook" | "endpoint" | "operation" | "bundle";
      id: string;
      verified: boolean;
      host_version: string;
      license: string | null;
      publisher: {
        id: string;
        verified: boolean;
        username: string;
        github_name: string | null;
        github_avatar_url: string | null;
      };
      version: string;
      publish_date: string;
      unpacked_size: number;
      file_count: number;
      url_bugs: string | null;
      url_homepage: string | null;
      url_repository: string | null;
      bundled: {
        type: string;
        name: string;
      }[];
      maintainers: {
        accounts_id: {
          id: string;
          verified: boolean;
          username: string;
          github_name: string | null;
          github_avatar_url: string | null;
        };
      }[] | null;
    }, {
      type: "interface" | "display" | "layout" | "module" | "panel" | "theme" | "hook" | "endpoint" | "operation" | "bundle";
      id: string;
      verified: boolean;
      host_version: string;
      license: string | null;
      publisher: {
        id: string;
        verified: boolean;
        username: string;
        github_name: string | null;
        github_avatar_url: string | null;
      };
      version: string;
      publish_date: string;
      unpacked_size: number;
      file_count: number;
      url_bugs: string | null;
      url_homepage: string | null;
      url_repository: string | null;
      bundled: {
        type: string;
        name: string;
      }[];
      maintainers: {
        accounts_id: {
          id: string;
          verified: boolean;
          username: string;
          github_name: string | null;
          github_avatar_url: string | null;
        };
      }[] | null;
    }>, "many">;
  }, "strip", z.ZodTypeAny, {
    type: "interface" | "display" | "layout" | "module" | "panel" | "theme" | "hook" | "endpoint" | "operation" | "bundle";
    id: string;
    name: string;
    description: string | null;
    total_downloads: number;
    verified: boolean;
    license: string | null;
    downloads: {
      date: string;
      count: number;
    }[] | null;
    readme: string | null;
    versions: {
      type: "interface" | "display" | "layout" | "module" | "panel" | "theme" | "hook" | "endpoint" | "operation" | "bundle";
      id: string;
      verified: boolean;
      host_version: string;
      license: string | null;
      publisher: {
        id: string;
        verified: boolean;
        username: string;
        github_name: string | null;
        github_avatar_url: string | null;
      };
      version: string;
      publish_date: string;
      unpacked_size: number;
      file_count: number;
      url_bugs: string | null;
      url_homepage: string | null;
      url_repository: string | null;
      bundled: {
        type: string;
        name: string;
      }[];
      maintainers: {
        accounts_id: {
          id: string;
          verified: boolean;
          username: string;
          github_name: string | null;
          github_avatar_url: string | null;
        };
      }[] | null;
    }[];
  }, {
    type: "interface" | "display" | "layout" | "module" | "panel" | "theme" | "hook" | "endpoint" | "operation" | "bundle";
    id: string;
    name: string;
    description: string | null;
    total_downloads: number;
    verified: boolean;
    license: string | null;
    downloads: {
      date: string;
      count: number;
    }[] | null;
    readme: string | null;
    versions: {
      type: "interface" | "display" | "layout" | "module" | "panel" | "theme" | "hook" | "endpoint" | "operation" | "bundle";
      id: string;
      verified: boolean;
      host_version: string;
      license: string | null;
      publisher: {
        id: string;
        verified: boolean;
        username: string;
        github_name: string | null;
        github_avatar_url: string | null;
      };
      version: string;
      publish_date: string;
      unpacked_size: number;
      file_count: number;
      url_bugs: string | null;
      url_homepage: string | null;
      url_repository: string | null;
      bundled: {
        type: string;
        name: string;
      }[];
      maintainers: {
        accounts_id: {
          id: string;
          verified: boolean;
          username: string;
          github_name: string | null;
          github_avatar_url: string | null;
        };
      }[] | null;
    }[];
  }>;
}, "strip", z.ZodTypeAny, {
  data: {
    type: "interface" | "display" | "layout" | "module" | "panel" | "theme" | "hook" | "endpoint" | "operation" | "bundle";
    id: string;
    name: string;
    description: string | null;
    total_downloads: number;
    verified: boolean;
    license: string | null;
    downloads: {
      date: string;
      count: number;
    }[] | null;
    readme: string | null;
    versions: {
      type: "interface" | "display" | "layout" | "module" | "panel" | "theme" | "hook" | "endpoint" | "operation" | "bundle";
      id: string;
      verified: boolean;
      host_version: string;
      license: string | null;
      publisher: {
        id: string;
        verified: boolean;
        username: string;
        github_name: string | null;
        github_avatar_url: string | null;
      };
      version: string;
      publish_date: string;
      unpacked_size: number;
      file_count: number;
      url_bugs: string | null;
      url_homepage: string | null;
      url_repository: string | null;
      bundled: {
        type: string;
        name: string;
      }[];
      maintainers: {
        accounts_id: {
          id: string;
          verified: boolean;
          username: string;
          github_name: string | null;
          github_avatar_url: string | null;
        };
      }[] | null;
    }[];
  };
}, {
  data: {
    type: "interface" | "display" | "layout" | "module" | "panel" | "theme" | "hook" | "endpoint" | "operation" | "bundle";
    id: string;
    name: string;
    description: string | null;
    total_downloads: number;
    verified: boolean;
    license: string | null;
    downloads: {
      date: string;
      count: number;
    }[] | null;
    readme: string | null;
    versions: {
      type: "interface" | "display" | "layout" | "module" | "panel" | "theme" | "hook" | "endpoint" | "operation" | "bundle";
      id: string;
      verified: boolean;
      host_version: string;
      license: string | null;
      publisher: {
        id: string;
        verified: boolean;
        username: string;
        github_name: string | null;
        github_avatar_url: string | null;
      };
      version: string;
      publish_date: string;
      unpacked_size: number;
      file_count: number;
      url_bugs: string | null;
      url_homepage: string | null;
      url_repository: string | null;
      bundled: {
        type: string;
        name: string;
      }[];
      maintainers: {
        accounts_id: {
          id: string;
          verified: boolean;
          username: string;
          github_name: string | null;
          github_avatar_url: string | null;
        };
      }[] | null;
    }[];
  };
}>;
type RegistryDescribeResponse = z.infer<typeof RegistryDescribeResponse>;
//#endregion
//#region src/modules/describe/describe.d.ts
declare const describe: (id: string, options?: DescribeOptions) => Promise<{
  data: {
    type: "interface" | "display" | "layout" | "module" | "panel" | "theme" | "hook" | "endpoint" | "operation" | "bundle";
    id: string;
    name: string;
    description: string | null;
    total_downloads: number;
    verified: boolean;
    license: string | null;
    downloads: {
      date: string;
      count: number;
    }[] | null;
    readme: string | null;
    versions: {
      type: "interface" | "display" | "layout" | "module" | "panel" | "theme" | "hook" | "endpoint" | "operation" | "bundle";
      id: string;
      verified: boolean;
      host_version: string;
      license: string | null;
      publisher: {
        id: string;
        verified: boolean;
        username: string;
        github_name: string | null;
        github_avatar_url: string | null;
      };
      version: string;
      publish_date: string;
      unpacked_size: number;
      file_count: number;
      url_bugs: string | null;
      url_homepage: string | null;
      url_repository: string | null;
      bundled: {
        type: string;
        name: string;
      }[];
      maintainers: {
        accounts_id: {
          id: string;
          verified: boolean;
          username: string;
          github_name: string | null;
          github_avatar_url: string | null;
        };
      }[] | null;
    }[];
  };
}>;
//#endregion
//#region src/modules/download/types/download-options.d.ts
interface DownloadOptions {
  registry?: string;
}
//#endregion
//#region src/modules/download/download.d.ts
declare const download: (versionId: string, requireSandbox?: boolean, options?: DownloadOptions) => Promise<stream_web0.ReadableStream<any> | null>;
//#endregion
//#region src/modules/list/types/list-options.d.ts
interface ListOptions {
  registry?: string;
}
//#endregion
//#region src/modules/list/types/list-query.d.ts
interface ListQuery {
  type?: ExtensionType;
  search?: string;
  limit?: number;
  offset?: number;
  by?: string;
  sort?: 'popular' | 'recent' | 'downloads';
  sandbox?: boolean;
}
//#endregion
//#region src/modules/list/schemas/registry-list-response.d.ts
declare const RegistryListResponse: z.ZodObject<{
  meta: z.ZodObject<{
    filter_count: z.ZodNumber;
  }, "strip", z.ZodTypeAny, {
    filter_count: number;
  }, {
    filter_count: number;
  }>;
  data: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodUnion<[z.ZodNull, z.ZodString]>;
    total_downloads: z.ZodNumber;
    verified: z.ZodBoolean;
    type: z.ZodEnum<["interface", "display", "layout", "module", "panel", "theme", "hook", "endpoint", "operation", "bundle"]>;
    last_updated: z.ZodString;
    host_version: z.ZodString;
    sandbox: z.ZodBoolean;
    license: z.ZodNullable<z.ZodString>;
    publisher: z.ZodObject<{
      username: z.ZodString;
      verified: z.ZodBoolean;
      github_name: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
      verified: boolean;
      username: string;
      github_name: string | null;
    }, {
      verified: boolean;
      username: string;
      github_name: string | null;
    }>;
  }, "strip", z.ZodTypeAny, {
    type: "interface" | "display" | "layout" | "module" | "panel" | "theme" | "hook" | "endpoint" | "operation" | "bundle";
    id: string;
    name: string;
    description: string | null;
    total_downloads: number;
    verified: boolean;
    last_updated: string;
    host_version: string;
    sandbox: boolean;
    license: string | null;
    publisher: {
      verified: boolean;
      username: string;
      github_name: string | null;
    };
  }, {
    type: "interface" | "display" | "layout" | "module" | "panel" | "theme" | "hook" | "endpoint" | "operation" | "bundle";
    id: string;
    name: string;
    description: string | null;
    total_downloads: number;
    verified: boolean;
    last_updated: string;
    host_version: string;
    sandbox: boolean;
    license: string | null;
    publisher: {
      verified: boolean;
      username: string;
      github_name: string | null;
    };
  }>, "many">;
}, "strip", z.ZodTypeAny, {
  meta: {
    filter_count: number;
  };
  data: {
    type: "interface" | "display" | "layout" | "module" | "panel" | "theme" | "hook" | "endpoint" | "operation" | "bundle";
    id: string;
    name: string;
    description: string | null;
    total_downloads: number;
    verified: boolean;
    last_updated: string;
    host_version: string;
    sandbox: boolean;
    license: string | null;
    publisher: {
      verified: boolean;
      username: string;
      github_name: string | null;
    };
  }[];
}, {
  meta: {
    filter_count: number;
  };
  data: {
    type: "interface" | "display" | "layout" | "module" | "panel" | "theme" | "hook" | "endpoint" | "operation" | "bundle";
    id: string;
    name: string;
    description: string | null;
    total_downloads: number;
    verified: boolean;
    last_updated: string;
    host_version: string;
    sandbox: boolean;
    license: string | null;
    publisher: {
      verified: boolean;
      username: string;
      github_name: string | null;
    };
  }[];
}>;
type RegistryListResponse = z.infer<typeof RegistryListResponse>;
//#endregion
//#region src/modules/list/list.d.ts
declare const list: (query: ListQuery, options?: ListOptions) => Promise<{
  meta: {
    filter_count: number;
  };
  data: {
    type: "interface" | "display" | "layout" | "module" | "panel" | "theme" | "hook" | "endpoint" | "operation" | "bundle";
    id: string;
    name: string;
    description: string | null;
    total_downloads: number;
    verified: boolean;
    last_updated: string;
    host_version: string;
    sandbox: boolean;
    license: string | null;
    publisher: {
      verified: boolean;
      username: string;
      github_name: string | null;
    };
  }[];
}>;
//#endregion
export { type AccountOptions, type DescribeOptions, type DownloadOptions, type ListOptions, type ListQuery, type RegistryAccountResponse, type RegistryDescribeResponse, type RegistryListResponse, account, describe, download, list };