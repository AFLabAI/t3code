import type { EnvironmentId } from "@t3tools/contracts";

import { releaseMobileTurnAttachments } from "../lib/attachmentUpload";
import { appAtomRegistry } from "./atom-registry";
import { createThreadOutboxManager } from "./thread-outbox-manager";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import { expoThreadOutboxStorage, flushThreadOutboxWrites } from "./thread-outbox-storage";

export * from "./thread-outbox-model";

export const threadOutboxManager = createThreadOutboxManager({
  registry: appAtomRegistry,
  storage: expoThreadOutboxStorage,
});

/**
 * Lands queued outbox mutations before the JS runtime is torn down (app update
 * restart). An enqueued message is published to the atom immediately but its
 * durable write waits behind the mutation queue, so draining only the writes
 * already mid-file would miss it.
 */
export async function flushThreadOutbox(): Promise<void> {
  await threadOutboxManager.serialize(async () => {});
  await flushThreadOutboxWrites();
}

export function ensureThreadOutboxLoaded(): void {
  void threadOutboxManager.load();
}

export function enqueueThreadOutboxMessage(message: QueuedThreadMessage): Promise<void> {
  return threadOutboxManager.enqueue(message);
}

/** Waits for pending writes to settle; false if the message was rolled back. */
export function confirmThreadOutboxMessageQueued(message: QueuedThreadMessage): Promise<boolean> {
  return threadOutboxManager.confirmQueued(message);
}

/** Rewrite a queued message; no-op (false) if it was removed in the meantime. */
export function updateThreadOutboxMessage(message: QueuedThreadMessage): Promise<boolean> {
  return threadOutboxManager.update(message);
}

export async function removeThreadOutboxMessage(message: QueuedThreadMessage): Promise<void> {
  await threadOutboxManager.remove(message);
  await releaseMobileTurnAttachments({
    environmentId: message.environmentId,
    commandId: message.commandId,
  });
}

export async function clearThreadOutboxEnvironment(environmentId: EnvironmentId): Promise<void> {
  await threadOutboxManager.clearEnvironment(environmentId);
  await releaseMobileTurnAttachments({ environmentId });
}
