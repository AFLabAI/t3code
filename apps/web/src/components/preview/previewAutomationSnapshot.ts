import type {
  DesktopPreviewAutomationSnapshotInput,
  DesktopPreviewAutomationSnapshotResult,
  PreviewAutomationSnapshot,
} from "@t3tools/contracts";

const PREVIEW_DESKTOP_RESPONSE_MARGIN_MS = 250;

export const responseBudgetMs = (timeoutMs: number, maximumMarginMs: number): number =>
  Math.max(0, timeoutMs - Math.max(1, Math.min(maximumMarginMs, Math.ceil(timeoutMs / 10))));

export const remainingBudgetMs = (deadline: number, now = performance.now()): number =>
  Math.max(0, Math.floor(deadline - now));

export const waitForLocalResponse = <A>(
  run: () => Promise<A>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<A> => {
  if (timeoutMs <= 0) return Promise.reject(onTimeout());
  return new Promise<A>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(onTimeout()), timeoutMs);
    void run().then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
};

interface ReadySnapshotTarget {
  readonly tabId: string;
  readonly runtimeTabId: string;
  readonly snapshot: (
    input: DesktopPreviewAutomationSnapshotInput,
  ) => Promise<DesktopPreviewAutomationSnapshotResult>;
}

export const requestPreviewAutomationSnapshot = async (options: {
  readonly connectionId: string;
  readonly requestId: string;
  readonly hostDeadline: number;
  readonly requireReady: (timeoutMs: number) => Promise<ReadySnapshotTarget>;
  readonly onTimeout: (tabId: string | null) => Error;
  readonly now?: () => number;
}): Promise<PreviewAutomationSnapshot> => {
  const now = options.now ?? (() => performance.now());
  const readinessBudgetMs = remainingBudgetMs(options.hostDeadline, now());
  if (readinessBudgetMs <= 0) throw options.onTimeout(null);

  const ready = await waitForLocalResponse(
    () => options.requireReady(readinessBudgetMs),
    readinessBudgetMs,
    () => options.onTimeout(null),
  );
  const hostRemainingMs = remainingBudgetMs(options.hostDeadline, now());
  if (hostRemainingMs <= 0) throw options.onTimeout(ready.tabId);

  const desktopTimeoutMs = responseBudgetMs(hostRemainingMs, PREVIEW_DESKTOP_RESPONSE_MARGIN_MS);
  if (desktopTimeoutMs <= 0) throw options.onTimeout(ready.tabId);

  const result = await waitForLocalResponse(
    () =>
      ready.snapshot({
        tabId: ready.runtimeTabId,
        connectionId: options.connectionId,
        requestId: options.requestId,
        timeoutMs: desktopTimeoutMs,
      }),
    hostRemainingMs,
    () => options.onTimeout(ready.tabId),
  );
  if (remainingBudgetMs(options.hostDeadline, now()) <= 0) {
    throw options.onTimeout(ready.tabId);
  }
  if (result._tag === "Timeout") throw options.onTimeout(ready.tabId);
  return result.snapshot;
};
