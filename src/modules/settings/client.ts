/**
 * The part of settings a browser component may import: the shapes and the
 * confidence floor. Everything else comes from "@/modules/settings" (server only).
 */
export { MIN_AUTOBUY_CONFIDENCE } from "@/core/user-settings";
export type { PlatformLimits, UserSettings } from "@/core/user-settings";
export { MAX_PREFERRED_STORES } from "./types";
export type { DeliveryAddress } from "./types";
