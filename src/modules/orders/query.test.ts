import { describe, expect, it } from "vitest";
import { monthRange, parseOrdersQuery } from "./query";

describe("parseOrdersQuery", () => {
  it("reads a month and a page", () => {
    expect(parseOrdersQuery({ month: "2026-11", page: "3" })).toEqual({ month: "2026-11", page: 3 });
  });

  it("falls back to no filter and the first page for anything odd", () => {
    expect(parseOrdersQuery({})).toEqual({ month: null, page: 1 });
    expect(parseOrdersQuery({ month: "2026-13", page: "0" })).toEqual({ month: null, page: 1 });
    expect(parseOrdersQuery({ month: "november", page: "-2" })).toEqual({ month: null, page: 1 });
    expect(parseOrdersQuery({ month: ["2026-11"], page: ["2"] })).toEqual({ month: null, page: 1 });
    expect(parseOrdersQuery({ month: "2026-11'; drop table", page: "1e9" })).toEqual({ month: null, page: 1 });
    expect(parseOrdersQuery({ page: "undefined" })).toEqual({ month: null, page: 1 });
  });
});

describe("monthRange", () => {
  it("runs from the start of the month to the start of the next, in UTC", () => {
    expect(monthRange("2026-11")).toEqual({ from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-12-01T00:00:00Z") });
  });

  it("rolls over the year", () => {
    expect(monthRange("2026-12").to).toEqual(new Date("2027-01-01T00:00:00Z"));
  });
});
