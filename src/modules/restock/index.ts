/**
 * The server door to restocking: the scheduled low-stock check and finding the low products
 * online. Cron routes, scripts and (later) the buying step import from here. Nothing in this
 * module runs in a browser except the suggestion screens, which use ./client. Start with ./README.md.
 */
export { CHECK_LIMIT, describeLowProduct, runLowStockCheck, sweepNextChecks } from "./check";
export type { CheckOptions, LowProduct, LowStockCheck, SweepResult } from "./check";
export { channel3FromEnv, createChannel3 } from "./channel3";
export { zincFromEnv, createZinc } from "./zinc";
export { createRoutedSearch, searchFromEnv } from "./search";
export { isGrocery, SearchError } from "./search-types";
export type { ProductSearch, SearchContext } from "./search-types";
export { createMockSearch } from "./mock-search";
export { findForLowProducts, findOnline, SEARCH_LIMIT } from "./find";
export type { Finding, RestockResult } from "./find";
export { toRestockItem } from "./report";
export type { RestockItem, RestockListing, RestockReport } from "./report";
export { runRestock } from "./run";
export { REFRESH_AFTER_MS, runRestockAndAsk } from "./ask";
export type { AskReport } from "./ask";
export { startPurchase } from "./buy";
export type { PurchaseStart } from "./buy";
export { dismissSuggestion, getSuggestion, listSuggestions } from "./suggestions";
export type { Suggestion } from "./suggestions";
