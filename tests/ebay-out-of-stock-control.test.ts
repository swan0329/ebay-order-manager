import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { parseOutOfStockControl } = await import("@/lib/services/ebayOutOfStockControl");

describe("eBay out-of-stock control", () => {
  it("reads enabled and disabled preferences", () => {
    expect(parseOutOfStockControl("<GetUserPreferencesResponse><Ack>Success</Ack><OutOfStockControlPreference>true</OutOfStockControlPreference></GetUserPreferencesResponse>")).toBe(true);
    expect(parseOutOfStockControl("<GetUserPreferencesResponse><Ack>Success</Ack><OutOfStockControlPreference>false</OutOfStockControlPreference></GetUserPreferencesResponse>")).toBe(false);
  });

  it("surfaces eBay failures", () => {
    expect(() => parseOutOfStockControl("<GetUserPreferencesResponse><Ack>Failure</Ack><Errors><LongMessage>Not allowed</LongMessage></Errors></GetUserPreferencesResponse>")).toThrow("Not allowed");
  });
});
