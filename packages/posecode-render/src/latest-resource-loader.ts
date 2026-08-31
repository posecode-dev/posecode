/** Keep only the newest asynchronous resource request alive. */
export function createLatestResourceLoader<T extends { dispose(): void }>(options: {
  load(url: string): Promise<T>;
  activate(resource: T): void;
  fallback(): void;
  onError?(error: unknown): void;
}): {
  request(url: string | null): void;
  dispose(): void;
} {
  let generation = 0;
  let requestedUrl: string | null = null;
  let activeUrl: string | null = null;
  let disposed = false;

  return {
    request(url) {
      if (disposed) return;

      if (!url) {
        generation++;
        requestedUrl = null;
        activeUrl = null;
        options.fallback();
        return;
      }

      // Returning to the resource already on screen cancels a newer in-flight
      // request without refetching the resource that is still valid.
      if (url === activeUrl) {
        if (requestedUrl !== null) generation++;
        requestedUrl = null;
        return;
      }
      if (url === requestedUrl) return;

      const token = ++generation;
      requestedUrl = url;
      void options.load(url).then(
        (resource) => {
          // A generation token (not only URL equality) handles A → B → A:
          // the first A must be disposed instead of winning the final request.
          if (disposed || token !== generation) {
            resource.dispose();
            return;
          }
          requestedUrl = null;
          activeUrl = url;
          options.activate(resource);
        },
        (error: unknown) => {
          if (disposed || token !== generation) return;
          requestedUrl = null;
          activeUrl = null;
          options.fallback();
          options.onError?.(error);
        },
      );
    },
    dispose() {
      disposed = true;
      generation++;
      requestedUrl = null;
      activeUrl = null;
    },
  };
}
