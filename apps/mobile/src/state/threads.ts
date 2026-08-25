import { useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentThreadDetailAtoms,
  createEnvironmentThreadShellAtoms,
  createEnvironmentThreadStateAtoms,
  EMPTY_ENVIRONMENT_THREAD_STATE,
  type EnvironmentThreadState,
  createThreadEnvironmentAtoms,
} from "@t3tools/client-runtime/state/threads";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom, type AtomRegistry } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { prepareMobileTurnAttachments } from "../lib/attachmentUpload";
import { attachmentEnvironment } from "./attachments";
import { environmentSession } from "./session";
import { serverEnvironment } from "./server";
import { environmentSnapshotAtom } from "./shell";
import { shouldRetryThreadOutboxDelivery } from "./thread-outbox-model";

const threadCommands = createThreadEnvironmentAtoms(connectionAtomRuntime);

async function startMobileThreadTurn(
  registry: AtomRegistry.AtomRegistry,
  target: Parameters<typeof threadCommands.startTurn.run>[1],
) {
  if (target.input.message.attachments.length === 0) {
    return threadCommands.startTurn.run(registry, target);
  }

  const serverConfig = registry.get(serverEnvironment.configValueAtom(target.environmentId));
  const supportsUploads =
    serverConfig === null ? null : serverConfig.environment.capabilities.attachmentUploads === true;
  const connection = Option.getOrNull(
    registry.get(environmentSession.preparedConnectionValueAtom(target.environmentId)),
  );
  let prepared: Awaited<ReturnType<typeof prepareMobileTurnAttachments>>;
  try {
    prepared = await prepareMobileTurnAttachments({
      environmentId: target.environmentId,
      ...(target.input.commandId === undefined ? {} : { commandId: target.input.commandId }),
      httpBaseUrl: connection?.httpBaseUrl ?? null,
      supportsUploads,
      attachments: target.input.message.attachments,
      createUploadUrl: async (input) => {
        const result = await runAtomCommand(
          registry,
          attachmentEnvironment.createUploadUrl,
          { environmentId: target.environmentId, input },
          { reportFailure: false },
        );
        if (result._tag === "Failure") {
          throw Cause.squash(result.cause);
        }
        return result.value;
      },
      deleteUpload: async (attachmentId) => {
        await runAtomCommand(
          registry,
          attachmentEnvironment.remove,
          { environmentId: target.environmentId, input: { attachmentId } },
          { reportFailure: false, reportDefect: false },
        );
      },
    });
  } catch (error) {
    return AsyncResult.failure(Cause.fail(error));
  }

  const result = await threadCommands.startTurn.run(registry, {
    ...target,
    input: {
      ...target.input,
      message: { ...target.input.message, attachments: prepared.attachments },
    },
  });
  const retryable =
    result._tag === "Failure" &&
    (Cause.hasInterruptsOnly(result.cause) ||
      shouldRetryThreadOutboxDelivery(Cause.squash(result.cause)));
  if (target.input.commandId === undefined || !retryable) {
    void prepared.release();
  }
  return result;
}

export const threadEnvironment = {
  ...threadCommands,
  startTurn: { label: threadCommands.startTurn.label, run: startMobileThreadTurn },
};
export const environmentThreads = createEnvironmentThreadStateAtoms(connectionAtomRuntime);
export const environmentThreadDetails = createEnvironmentThreadDetailAtoms(
  environmentThreads.stateAtom,
);
export const environmentThreadShells = createEnvironmentThreadShellAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: environmentSnapshotAtom,
});

const EMPTY_THREAD_STATE_ATOM = Atom.make(AsyncResult.success(EMPTY_ENVIRONMENT_THREAD_STATE)).pipe(
  Atom.withLabel("mobile-environment-thread:empty"),
);

export function useEnvironmentThread(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): EnvironmentThreadState {
  const result = useAtomValue(
    environmentId !== null && threadId !== null
      ? environmentThreads.stateAtom(environmentId, threadId)
      : EMPTY_THREAD_STATE_ATOM,
  );
  return Option.getOrElse(
    AsyncResult.value(result),
    () => EMPTY_ENVIRONMENT_THREAD_STATE,
  ) as EnvironmentThreadState;
}
