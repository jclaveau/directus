import z, { z as z$1 } from "zod";
import { PERMISSION_ACTIONS } from "@directus/constants";

//#region ../packages/types/dist/index.js
const TransformationMethods = [
	"toFormat",
	"jpeg",
	"png",
	"tiff",
	"webp",
	"avif",
	"resize",
	"extend",
	"extract",
	"trim",
	"rotate",
	"flip",
	"flop",
	"sharpen",
	"median",
	"blur",
	"flatten",
	"gamma",
	"negate",
	"normalise",
	"normalize",
	"clahe",
	"convolve",
	"threshold",
	"linear",
	"recomb",
	"modulate",
	"tint",
	"greyscale",
	"grayscale",
	"toColorspace",
	"toColourspace",
	"removeAlpha",
	"ensureAlpha",
	"extractChannel",
	"bandbool"
];
const DatabaseClients = [
	"mysql",
	"postgres",
	"cockroachdb",
	"sqlite",
	"oracle",
	"mssql",
	"redshift"
];
/**
* Supported deployment provider types
*/
const DEPLOYMENT_PROVIDER_TYPES = ["vercel", "netlify"];
const SplitEntrypoint = z$1.object({
	app: z$1.string(),
	api: z$1.string()
});
const ExtensionSandboxRequestedScopes = z$1.object({
	request: z$1.optional(z$1.object({
		urls: z$1.array(z$1.string()),
		methods: z$1.array(z$1.union([
			z$1.literal("GET"),
			z$1.literal("POST"),
			z$1.literal("PATCH"),
			z$1.literal("PUT"),
			z$1.literal("DELETE")
		]))
	})),
	log: z$1.optional(z$1.object({})),
	sleep: z$1.optional(z$1.object({}))
});
const ExtensionSandboxOptions = z$1.optional(z$1.object({
	enabled: z$1.boolean(),
	requestedScopes: ExtensionSandboxRequestedScopes
}));
const Color = z$1.string();
const FamilyName = z$1.string().meta({ $ref: "FamilyName" });
const FontWeight = z$1.string().meta({ $ref: "FontWeight" });
const Length = z$1.string();
const Percentage = z$1.string();
const BoxShadow = z$1.string();
const Number = z$1.string();
const Size = z$1.string();
const LineWidth = z$1.union([
	z$1.string(),
	z$1.literal("thin"),
	z$1.literal("medium"),
	z$1.literal("thick")
]);
const FormRules = z$1.object({
	columnGap: z$1.union([Length, Percentage]).optional(),
	rowGap: z$1.union([Length, Percentage]).optional(),
	field: z$1.object({
		label: z$1.object({
			foreground: Color.optional(),
			fontFamily: FamilyName.optional(),
			fontWeight: FontWeight.optional()
		}).optional(),
		input: z$1.object({
			background: Color.optional(),
			backgroundSubdued: Color.optional(),
			foreground: Color.optional(),
			foregroundSubdued: Color.optional(),
			borderColor: Color.optional(),
			borderColorHover: Color.optional(),
			focusRingColor: Color.optional(),
			boxShadow: BoxShadow.optional(),
			height: Size.optional(),
			padding: z$1.union([Length, Percentage]).optional()
		}).optional()
	}).optional()
}).optional();
const Rules = z$1.object({
	borderRadius: z$1.union([Length, Percentage]).optional(),
	borderWidth: LineWidth.optional(),
	foreground: Color.optional(),
	foregroundSubdued: Color.optional(),
	foregroundAccent: Color.optional(),
	background: Color.optional(),
	backgroundNormal: Color.optional(),
	backgroundAccent: Color.optional(),
	backgroundSubdued: Color.optional(),
	borderColor: Color.optional(),
	borderColorAccent: Color.optional(),
	borderColorSubdued: Color.optional(),
	primary: Color.optional(),
	primaryBackground: Color.optional(),
	primarySubdued: Color.optional(),
	primaryAccent: Color.optional(),
	secondary: Color.optional(),
	secondaryBackground: Color.optional(),
	secondarySubdued: Color.optional(),
	secondaryAccent: Color.optional(),
	success: Color.optional(),
	successBackground: Color.optional(),
	successSubdued: Color.optional(),
	successAccent: Color.optional(),
	warning: Color.optional(),
	warningBackground: Color.optional(),
	warningSubdued: Color.optional(),
	warningAccent: Color.optional(),
	danger: Color.optional(),
	dangerBackground: Color.optional(),
	dangerSubdued: Color.optional(),
	dangerAccent: Color.optional(),
	fonts: z$1.object({
		display: z$1.object({
			fontFamily: FamilyName.optional(),
			fontWeight: FontWeight.optional()
		}).optional(),
		title: z$1.object({
			fontFamily: FamilyName.optional(),
			fontWeight: FontWeight.optional()
		}).optional(),
		sans: z$1.object({
			fontFamily: FamilyName.optional(),
			fontWeight: FontWeight.optional()
		}).optional(),
		serif: z$1.object({
			fontFamily: FamilyName.optional(),
			fontWeight: FontWeight.optional()
		}).optional(),
		monospace: z$1.object({
			fontFamily: FamilyName.optional(),
			fontWeight: FontWeight.optional()
		}).optional()
	}).optional(),
	shell: z$1.object({
		background: Color.optional(),
		backgroundAccent: Color.optional(),
		borderWidth: LineWidth.optional(),
		borderColor: Color.optional()
	}).optional(),
	navigation: z$1.object({
		project: z$1.object({
			foreground: Color.optional(),
			fontFamily: FamilyName.optional()
		}).optional(),
		modules: z$1.object({
			background: Color.optional(),
			borderWidth: LineWidth.optional(),
			borderColor: Color.optional(),
			button: z$1.object({
				foreground: Color.optional(),
				foregroundHover: Color.optional(),
				foregroundActive: Color.optional(),
				background: Color.optional(),
				backgroundHover: Color.optional(),
				backgroundActive: Color.optional()
			}).optional()
		}).optional(),
		list: z$1.object({
			icon: z$1.object({
				foreground: Color.optional(),
				foregroundHover: Color.optional(),
				foregroundActive: Color.optional()
			}).optional(),
			foreground: Color.optional(),
			foregroundHover: Color.optional(),
			foregroundActive: Color.optional(),
			background: Color.optional(),
			backgroundHover: Color.optional(),
			backgroundActive: Color.optional(),
			fontFamily: FamilyName.optional(),
			divider: z$1.object({
				borderColor: Color.optional(),
				borderWidth: LineWidth.optional()
			})
		}).optional()
	}).optional(),
	header: z$1.object({ title: z$1.object({
		foreground: Color.optional(),
		fontFamily: FamilyName.optional(),
		fontWeight: FontWeight.optional()
	}).optional() }).optional(),
	form: FormRules,
	sidebar: z$1.object({
		background: Color.optional(),
		foreground: Color.optional(),
		fontFamily: FamilyName.optional(),
		borderWidth: LineWidth.optional(),
		borderColor: Color.optional(),
		section: z$1.object({
			borderWidth: LineWidth.optional(),
			borderColor: Color.optional(),
			active: z$1.object({
				borderWidth: LineWidth.optional(),
				borderColor: Color.optional()
			}).optional(),
			toggle: z$1.object({
				icon: z$1.object({
					foreground: Color.optional(),
					foregroundHover: Color.optional(),
					foregroundActive: Color.optional()
				}).optional(),
				foreground: Color.optional(),
				foregroundHover: Color.optional(),
				foregroundActive: Color.optional(),
				background: Color.optional(),
				backgroundHover: Color.optional(),
				backgroundActive: Color.optional(),
				fontFamily: FamilyName.optional()
			}).optional(),
			form: FormRules
		}).optional()
	}).optional(),
	public: z$1.object({
		background: Color.optional(),
		foreground: Color.optional(),
		foregroundAccent: Color.optional(),
		art: z$1.object({
			background: Color.optional(),
			primary: Color.optional(),
			secondary: Color.optional(),
			speed: Number.optional()
		}).optional(),
		form: FormRules
	}).optional(),
	popover: z$1.object({ menu: z$1.object({
		background: Color.optional(),
		borderRadius: z$1.union([Length, Percentage]).optional(),
		boxShadow: BoxShadow.optional()
	}).optional() }).optional(),
	banner: z$1.object({
		background: Color.optional(),
		padding: z$1.union([Length, Percentage]).optional(),
		borderRadius: z$1.union([Length, Percentage]).optional(),
		avatar: z$1.object({
			background: Color.optional(),
			foreground: Color.optional(),
			borderRadius: z$1.union([Length, Percentage]).optional()
		}).optional(),
		headline: z$1.object({
			foreground: Color.optional(),
			fontFamily: FamilyName.optional(),
			fontWeight: FontWeight.optional()
		}).optional(),
		title: z$1.object({
			foreground: Color.optional(),
			fontFamily: FamilyName.optional(),
			fontWeight: FontWeight.optional()
		}).optional(),
		subtitle: z$1.object({
			foreground: Color.optional(),
			fontFamily: FamilyName.optional(),
			fontWeight: FontWeight.optional()
		}).optional(),
		art: z$1.object({ foreground: Color.optional() }).optional()
	}).optional()
});
const ThemeSchema = z$1.object({
	id: z$1.string(),
	name: z$1.string(),
	appearance: z$1.union([z$1.literal("light"), z$1.literal("dark")]),
	rules: Rules
});
/**
* Indicates the kind of change based on comparisons by deep-diff package
*/
const DiffKind = {
	NEW: "N",
	DELETE: "D",
	EDIT: "E",
	ARRAY: "A"
};
let UserIntegrityCheckFlag = /* @__PURE__ */ function(UserIntegrityCheckFlag$1) {
	UserIntegrityCheckFlag$1[UserIntegrityCheckFlag$1["None"] = 0] = "None";
	/** Check if the number of remaining admin users is greater than 0 */
	UserIntegrityCheckFlag$1[UserIntegrityCheckFlag$1["RemainingAdmins"] = 1] = "RemainingAdmins";
	/** Check if the number of users is within the limits */
	UserIntegrityCheckFlag$1[UserIntegrityCheckFlag$1["UserLimits"] = 2] = "UserLimits";
	UserIntegrityCheckFlag$1[UserIntegrityCheckFlag$1["All"] = 3] = "All";
	return UserIntegrityCheckFlag$1;
}({});
const zodStringOrNumber = z$1.union([z$1.string(), z$1.number()]);
const WebSocketMessage = z$1.object({
	type: z$1.string(),
	uid: zodStringOrNumber.optional()
}).passthrough();
const TYPE = { COLLAB: "collab" };
const COLLAB_BUS = "collab";
const COLORS = [
	"purple",
	"pink",
	"blue",
	"green",
	"yellow",
	"orange",
	"red"
];
const ACTION = {
	CLIENT: {
		JOIN: "join",
		LEAVE: "leave",
		UPDATE: "update",
		UPDATE_ALL: "updateAll",
		FOCUS: "focus",
		DISCARD: "discard"
	},
	SERVER: {
		INIT: "init",
		JOIN: "join",
		LEAVE: "leave",
		SAVE: "save",
		DELETE: "delete",
		UPDATE: "update",
		FOCUS: "focus",
		DISCARD: "discard",
		ERROR: "error"
	}
};
const BaseClientMessage = z.object({
	type: z.literal(TYPE.COLLAB),
	room: z.string()
});
const ClientMessage = z.discriminatedUnion("action", [
	z.object({
		type: z.literal(TYPE.COLLAB),
		action: z.literal(ACTION.CLIENT.JOIN),
		collection: z.string(),
		item: z.union([z.string(), z.number()]).nullable(),
		version: z.string().nullable(),
		color: z.enum(COLORS).nullable().optional(),
		initialChanges: z.record(z.string(), z.any()).optional()
	}),
	BaseClientMessage.extend({ action: z.literal(ACTION.CLIENT.LEAVE) }),
	BaseClientMessage.extend({
		action: z.literal(ACTION.CLIENT.UPDATE),
		field: z.string(),
		changes: z.unknown().optional()
	}),
	BaseClientMessage.extend({
		action: z.literal(ACTION.CLIENT.UPDATE_ALL),
		changes: z.record(z.string(), z.any()).optional()
	}),
	BaseClientMessage.extend({
		action: z.literal(ACTION.CLIENT.FOCUS),
		field: z.string().nullable()
	}),
	BaseClientMessage.extend({ action: z.literal(ACTION.CLIENT.DISCARD) })
]);

//#endregion
export { ACTION, COLLAB_BUS, COLORS, ClientMessage, DEPLOYMENT_PROVIDER_TYPES, DatabaseClients, DiffKind, TYPE, TransformationMethods, UserIntegrityCheckFlag, WebSocketMessage };