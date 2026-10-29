/**
 * The part of auth that proxy.ts and the forms may import without pulling in
 * the database. Everything else comes from "@/modules/auth" (server only).
 */
export const SESSION_COOKIE = "replenish_session";
export { PASSWORD_MIN, PASSWORD_MAX } from "./limits";
