import { DirectusPermission } from "./permission.js";
import { DirectusFolder } from "./folder.js";
import { DirectusFile } from "./file.js";
import { DirectusUser } from "./user.js";
import { DirectusRole } from "./role.js";
import { DirectusCollection } from "./collection.js";
import { DirectusVersion } from "./version.js";
import { DirectusActivity } from "./activity.js";
import { DirectusComment } from "./comment.js";
import { DirectusDashboard } from "./dashboard.js";
import { DirectusExtension } from "./extension.js";
import { DirectusField } from "./field.js";
import { DirectusOperation } from "./operation.js";
import { DirectusFlow } from "./flow.js";
import { DirectusNotification } from "./notification.js";
import { DirectusPanel } from "./panel.js";
import { DirectusPreset } from "./preset.js";
import { DirectusRelation } from "./relation.js";
import { DirectusSettings } from "./settings.js";
import { DirectusShare } from "./share.js";
import { DirectusWebhook } from "./webhook.js";

//#region src/schema/core.d.ts
interface CoreSchema<Schema = any> {
  directus_activity: DirectusActivity<Schema>[];
  directus_collections: DirectusCollection<Schema>[];
  directus_comments: DirectusComment<Schema>[];
  directus_dashboards: DirectusDashboard<Schema>[];
  directus_extensions: DirectusExtension<Schema>[];
  directus_fields: DirectusField<Schema>[];
  directus_files: DirectusFile<Schema>[];
  directus_flows: DirectusFlow<Schema>[];
  directus_folders: DirectusFolder<Schema>[];
  directus_notifications: DirectusNotification<Schema>[];
  directus_operations: DirectusOperation<Schema>[];
  directus_panels: DirectusPanel<Schema>[];
  directus_permissions: DirectusPermission<Schema>[];
  directus_presets: DirectusPreset<Schema>[];
  directus_relations: DirectusRelation<Schema>[];
  directus_roles: DirectusRole<Schema>[];
  directus_settings: DirectusSettings<Schema>;
  directus_shares: DirectusShare<Schema>[];
  directus_users: DirectusUser<Schema>[];
  directus_versions: DirectusVersion<Schema>[];
  directus_webhooks: DirectusWebhook<Schema>[];
}
//#endregion
export { CoreSchema };
//# sourceMappingURL=core.d.ts.map