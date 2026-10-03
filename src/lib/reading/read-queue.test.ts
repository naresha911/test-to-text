import { describe, expect, test } from "bun:test";

import { createSerialQueue } from "@/lib/reading/read-queue";

describe("createSerialQueue", () => {
  test("runs tasks in the order they were enqueued", async () => {
    const queue = createSerialQueue();
    const order: number[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue(async () => {
      await firstGate;
      order.push(1);
    });
    const second = queue(async () => {
      order.push(2);
    });

    expect(order).toEqual([]);
    releaseFirst();
    await first;
    await second;
    expect(order).toEqual([1, 2]);
  });

  test("a failed task does not block the next one", async () => {
    const queue = createSerialQueue();
    const order: number[] = [];

    const first = queue(async () => {
      order.push(1);
      throw new Error("stop");
    });
    const second = queue(async () => {
      order.push(2);
    });

    await expect(first).rejects.toThrow("stop");
    await second;
    expect(order).toEqual([1, 2]);
  });
});
