import { describe, expect, it, vi } from "vitest";
import { coalesceInFlightRead } from "./in-flight-read";

describe("overlapping read coordination", () => {
  it("shares concurrent requests but reads fresh data after completion", async () => {
    const read = vi.fn(async (key: string) => key);
    const shared = coalesceInFlightRead(read);
    await expect(Promise.all([shared("a"), shared("a"), shared("b")])).resolves.toEqual(["a", "a", "b"]);
    expect(read).toHaveBeenCalledTimes(2);
    await shared("a");
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("delivers failures to every caller and permits recovery on the next request", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("pool busy")).mockResolvedValueOnce(12);
    const shared = coalesceInFlightRead(read);
    const failures = await Promise.allSettled([shared("a"), shared("a")]);
    expect(failures.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(read).toHaveBeenCalledTimes(1);
    await expect(shared("a")).resolves.toBe(12);
  });
});
