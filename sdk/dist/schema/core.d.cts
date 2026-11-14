import { DirectusPermission } from "./permission.cjs";
import { DirectusFolder } from "./folder.cjs";
import { DirectusFile } from "./file.cjs";
import { DirectusUser } from "./user.cjs";
import { DirectusRole } from "./role.cjs";
import { DirectusCollection } from "./collection.cjs";
import { DirectusVersion } from "./version.cjs";
import { DirectusActivity } from "./activity.cjs";
import { DirectusComment } from "./comment.cjs";
import { DirectusDashboard } from "./dashboard.cjs";
import { DirectusExtension } from "./extension.cjs";
import { DirectusField } from "./field.cjs";
import { DirectusOperation } from "./operation.cjs";
import { DirectusFlow } from "./flow.cjs";
import { DirectusNotification } from "./notification.cjs";
import { DirectusPanel } from "./panel.cjs";
import { DirectusPreset } from "./preset.cjs";
import { DirectusRelation } from "./relation.cjs";
import { DirectusSettings } from "./settings.cjs";
import { DirectusShare } from "./share.cjs";
import { DirectusWebhook } from "./webhook.cjs";

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
//# sourceMappingURL=core.d.cts.map