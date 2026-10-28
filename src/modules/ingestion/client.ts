/**
 * The part of ingestion a browser component may import: the shapes of a
 * draft, and the one helper the review screen needs. Nothing here touches the
 * database or the server, so it is safe in client code. Everything else comes
 * from "@/modules/ingestion" (server only).
 */
export { toDisplayName } from "./receipt/parse";
export type { Draft, DraftLine, ExtractResult, Warning } from "./types";
export type { RunOutcome } from "./run";
