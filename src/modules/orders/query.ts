import type { OrdersQuery } from "./types";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Reads the Orders screen's `?month=2026-11&page=2` safely: anything odd means no filter / the first page. */
export function parseOrdersQuery(params: { month?: unknown; page?: unknown }): OrdersQuery {
  const month = typeof params.month === "string" && MONTH.test(params.month) ? params.month : null;
  const page = typeof params.page === "string" && /^\d{1,6}$/.test(params.page) ? Math.max(1, Number(params.page)) : 1;
  return { month, page };
}

/** The first moment of the month and of the next one, in UTC. */
export function monthRange(month: string): { from: Date; to: Date } {
  const [year, number] = month.split("-").map(Number) as [number, number];
  return { from: new Date(Date.UTC(year, number - 1, 1)), to: new Date(Date.UTC(year, number, 1)) };
}
