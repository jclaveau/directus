import { ItemsService } from "../services/items.js";
import { AccessService } from "../services/access.js";
import { ActivityService } from "../services/activity.js";
import { FilesService } from "../services/files.js";
import { SettingsService } from "../services/settings.js";
import { UsersService } from "../services/users.js";
import { NotificationsService } from "../services/notifications.js";
import { CommentsService } from "../services/comments.js";
import { DashboardsService } from "../services/dashboards.js";
import { FlowsService } from "../services/flows.js";
import { RevisionsService } from "../services/revisions.js";
import { FoldersService } from "../services/folders.js";
import { PresetsService } from "../services/presets.js";
import { RolesService } from "../services/roles.js";
import { VersionsService } from "../services/versions.js";
import { OperationsService } from "../services/operations.js";
import { PanelsService } from "../services/panels.js";
import { PermissionsService } from "../services/permissions.js";
import { PoliciesService } from "../services/policies.js";
import { SharesService } from "../services/shares.js";
import { TranslationsService } from "../services/translations.js";
import { WebhooksService } from "../services/webhooks.js";
import "../services/index.js";
import { ForbiddenError } from "@directus/errors";

//#region src/utils/get-service.ts
/**
* Select the correct service for the given collection. This allows the individual services to run
* their custom checks (f.e. it allows `UsersService` to prevent updating TFA secret from outside).
*/
function getService(collection, opts) {
	switch (collection) {
		case "directus_access": return new AccessService(opts);
		case "directus_activity": return new ActivityService(opts);
		case "directus_comments": return new CommentsService(opts);
		case "directus_dashboards": return new DashboardsService(opts);
		case "directus_files": return new FilesService(opts);
		case "directus_flows": return new FlowsService(opts);
		case "directus_folders": return new FoldersService(opts);
		case "directus_notifications": return new NotificationsService(opts);
		case "directus_operations": return new OperationsService(opts);
		case "directus_panels": return new PanelsService(opts);
		case "directus_permissions": return new PermissionsService(opts);
		case "directus_presets": return new PresetsService(opts);
		case "directus_policies": return new PoliciesService(opts);
		case "directus_revisions": return new RevisionsService(opts);
		case "directus_roles": return new RolesService(opts);
		case "directus_settings": return new SettingsService(opts);
		case "directus_shares": return new SharesService(opts);
		case "directus_translations": return new TranslationsService(opts);
		case "directus_users": return new UsersService(opts);
		case "directus_versions": return new VersionsService(opts);
		case "directus_webhooks": return new WebhooksService(opts);
		default:
			if (collection.startsWith("directus_")) throw new ForbiddenError({
				reason: "Forbidden access to directus_* collections",
				values: { collection }
			});
			return new ItemsService(collection, opts);
	}
}

//#endregion
export { getService };