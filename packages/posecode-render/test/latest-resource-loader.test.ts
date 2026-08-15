import { describe, expect, it, vi } from "vitest";
import { createLatestResourceLoader } from "../src/latest-resource-loader.js";

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class Resource {
  disposed = false;
  constructor(readonly name: string) {}
  dispose(): void {
    this.disposed = true;
  }
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createLatestResourceLoader", () => {
  it("always reveals the fallback for an unmapped request", () => {
    const fallback = vi.fn();
    const loader = createLatestResourceLoader<Resource>({
      load: async () => new Resource("unused"),
      activate: vi.fn(),
      fallback,
    });

    loader.request(null);

    expect(fallback).toHaveBeenCalledOnce();
  });

  it("disposes a superseded load and activates only the newest resource", async () => {
    const a = deferred<Resource>();
    const b = deferred<Resource>();
    const activate = vi.fn();
    const loader = createLatestResourceLoader<Resource>({
      load: (url) => (url === "a" ? a.promise : b.promise),
      activate,
      fallback: vi.fn(),
    });
    const stale = new Resource("stale-a");
    const newest = new Resource("b");

    loader.request("a");
    loader.request("b");
    a.resolve(stale);
    b.resolve(newest);
    await flush();

    expect(stale.disposed).toBe(true);
    expect(activate).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledWith(newest);
  });

  it("uses generations rather than URL equality for A to B to A", async () => {
    const firstA = deferred<Resource>();
    const b = deferred<Resource>();
    const finalA = deferred<Resource>();
    const requests = [firstA, b, finalA];
    const activate = vi.fn();
    const loader = createLatestResourceLoader<Resource>({
      load: () => requests.shift()!.promise,
      activate,
      fallback: vi.fn(),
    });
    const stale = new Resource("first-a");
    const newest = new Resource("final-a");

    loader.request("a");
    loader.request("b");
    loader.request("a");
    firstA.resolve(stale);
    finalA.resolve(newest);
    await flush();

    expect(stale.disposed).toBe(true);
    expect(activate).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledWith(newest);
  });

  it("keeps the active resource when a pending replacement is cancelled", async () => {
    const firstA = deferred<Resource>();
    const b = deferred<Resource>();
    const load = vi.fn((url: string) => (url === "a" ? firstA.promise : b.promise));
    const activate = vi.fn();
    const loader = createLatestResourceLoader<Resource>({
      load,
      activate,
      fallback: vi.fn(),
    });
    const active = new Resource("active-a");
    const stale = new Resource("stale-b");

    loader.request("a");
    firstA.resolve(active);
    await flush();
    loader.request("b");
    loader.request("a");
    b.resolve(stale);
    await flush();

    expect(load).toHaveBeenCalledTimes(2);
    expect(activate).toHaveBeenCalledOnce();
    expect(active.disposed).toBe(false);
    expect(stale.disposed).toBe(true);
  });

  it("falls back after failure and allows a later retry", async () => {
    const first = deferred<Resource>();
    const retry = deferred<Resource>();
    const load = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(retry.promise);
    const fallback = vi.fn();
    const onError = vi.fn();
    const loader = createLatestResourceLoader<Resource>({
      load,
      activate: vi.fn(),
      fallback,
      onError,
    });

    loader.request("broken");
    first.reject(new Error("offline"));
    await flush();
    loader.request("broken");

    expect(fallback).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("disposes a resource that resolves after the loader is disposed", async () => {
    const pending = deferred<Resource>();
    const activate = vi.fn();
    const loader = createLatestResourceLoader<Resource>({
      load: () => pending.promise,
      activate,
      fallback: vi.fn(),
    });
    const resource = new Resource("late");

    loader.request("late");
    loader.dispose();
    pending.resolve(resource);
    await flush();

    expect(resource.disposed).toBe(true);
    expect(activate).not.toHaveBeenCalled();
  });
});
