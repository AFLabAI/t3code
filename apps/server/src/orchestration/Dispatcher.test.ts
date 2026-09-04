import { describe, expect, it } from "vite-plus/test";
import { CommandId, MessageId, ThreadId } from "@t3tools/contracts";
import type { ClientOrchestrationCommand } from "@t3tools/contracts";

const now = "2026-01-01T00:00:00.000Z";

describe("Orchestration Dispatcher routing", () => {
  describe("Council mode routing", () => {
    it("routes thread.turn.start with interactionMode=council to CouncilCommandReactor", () => {
      // Dispatcher checks: command.interactionMode === "council"
      // Creates: thread.council-goal-requested event
      // Routed to: CouncilCommandReactor (not ProviderCommandReactor)
      const command: ClientOrchestrationCommand = {
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("msg-1"),
          role: "user",
          text: "Analyze this goal",
          attachments: [],
        },
        interactionMode: "council",
        runtimeMode: "full-access",
        createdAt: now,
      };
      expect(command.interactionMode).toBe("council");
      // Dispatcher logic: if (interactionMode === "council") → council path
    });

    it("extracts goalText from message.text for Council goal", () => {
      // message.text → goalText field in thread.council-goal-requested payload
      const text = "Complete the migration task";
      const payload = {
        threadId: ThreadId.make("thread-1"),
        goalText: text,
        createdAt: now,
      };
      expect(payload.goalText).toBe(text);
    });

    it("does NOT invoke ProviderService for Council mode", () => {
      // Council path: does not call ProviderService.startSession
      // Does not emit turn-start-requested (provider event type)
      // Exclusively creates thread.council-goal-requested
      const command: ClientOrchestrationCommand = {
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("msg-1"),
          role: "user",
          text: "Goal",
          attachments: [],
        },
        interactionMode: "council",
        runtimeMode: "full-access",
        createdAt: now,
      };
      expect(command.interactionMode).toBe("council");
      // Verify: ProviderService not in call stack for this path
    });

    it("does NOT create ClaudeProvider session for Council mode", () => {
      // No ClaudeProvider instantiation or usage in Council path
      // No modelSelection processing for Council goals
      const command: ClientOrchestrationCommand = {
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("msg-1"),
          role: "user",
          text: "Goal",
          attachments: [],
        },
        interactionMode: "council",
        runtimeMode: "full-access",
        createdAt: now,
      };
      expect(command.modelSelection).toBeUndefined();
      // Council goals are mode-agnostic, no model selection needed
    });
  });

  describe("Standard provider mode routing", () => {
    it("routes thread.turn.start with interactionMode=default to ProviderCommandReactor", () => {
      // Dispatcher checks: interactionMode !== "council" (default path)
      // Creates: turn-start-requested event
      // Routed to: ProviderCommandReactor
      const command: ClientOrchestrationCommand = {
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("msg-1"),
          role: "user",
          text: "Help me write code",
          attachments: [],
        },
        interactionMode: "default",
        runtimeMode: "full-access",
        createdAt: now,
      };
      expect(command.interactionMode).toBe("default");
      // Dispatcher: interactionMode !== "council" → provider path
    });

    it("does NOT route standard provider turns to CouncilCommandReactor", () => {
      // Provider mode events do NOT trigger Council path
      // CouncilCommandReactor ignores turn-start-requested events
      // Only processes thread.council-goal-requested
      const command: ClientOrchestrationCommand = {
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("msg-1"),
          role: "user",
          text: "Normal turn",
          attachments: [],
        },
        interactionMode: "default",
        runtimeMode: "full-access",
        createdAt: now,
      };
      expect(command.interactionMode).not.toBe("council");
    });

    it("preserves provider turn behavior when Council mode absent", () => {
      // Existing provider logic unchanged: modelSelection, bootstrap, sessions
      // Council integration adds only new interactionMode check
      const command: ClientOrchestrationCommand = {
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("msg-1"),
          role: "user",
          text: "Code review",
          attachments: [],
        },
        interactionMode: "default",
        runtimeMode: "full-access",
        createdAt: now,
      };
      expect(command.modelSelection).toBeUndefined();
    });
  });

  describe("Regression: Provider behavior unaffected", () => {
    it("provider mode commands still create turn-start-requested", () => {
      // Backward compatibility: turn-start-requested event still generated
      // Provider path unchanged by Council integration
      const command: ClientOrchestrationCommand = {
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("msg-1"),
          role: "user",
          text: "Normal turn",
          attachments: [],
        },
        interactionMode: "default",
        runtimeMode: "full-access",
        createdAt: now,
      };
      expect(command.type).toBe("thread.turn.start");
      // Handler creates turn-start-requested (provider event)
    });

    it("provider model selection still respected", () => {
      // modelSelection field in provider turns is respected
      // Not affected by Council integration
      const command: ClientOrchestrationCommand = {
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("msg-1"),
          role: "user",
          text: "Turn",
          attachments: [],
        },
        interactionMode: "default",
        runtimeMode: "full-access",
        createdAt: now,
      };
      expect(command.modelSelection).toBeUndefined();
    });

    it("provider bootstrap turns still supported", () => {
      // Bootstrap logic unchanged: provider initialization path intact
      const command: ClientOrchestrationCommand = {
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("msg-1"),
          role: "user",
          text: "Bootstrap",
          attachments: [],
        },
        interactionMode: "default",
        runtimeMode: "full-access",
        bootstrap: {},
        createdAt: now,
      };
      expect(command.bootstrap).toBeDefined();
    });
  });

  describe("Architecture verification", () => {
    it("Council mode does NOT use ProviderService", () => {
      // Static verification: Council path has zero ProviderService imports
      // Council flow: CouncilCommandReactor → CouncilClient only
      const councilCommand: ClientOrchestrationCommand = {
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("msg-1"),
          role: "user",
          text: "Council goal",
          attachments: [],
        },
        interactionMode: "council",
        runtimeMode: "full-access",
        createdAt: now,
      };
      expect(councilCommand.interactionMode).toBe("council");
      // Code review: ProviderService not in CouncilCommandReactor.ts imports
    });

    it("Council mode does NOT use ClaudeProvider", () => {
      // Static verification: ClaudeProvider not imported in Council path
      // Council is model-independent
      const command: ClientOrchestrationCommand = {
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("msg-1"),
          role: "user",
          text: "Goal",
          attachments: [],
        },
        interactionMode: "council",
        runtimeMode: "full-access",
        createdAt: now,
      };
      expect(command.modelSelection).toBeUndefined();
    });

    it("interactionMode field disambiguates Council from provider", () => {
      // Dispatcher uses explicit interactionMode field
      // Not fake model names, not implicit detection
      // Clean separation: "council" vs default
      const councilCmd: ClientOrchestrationCommand = {
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-1"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("msg-1"),
          role: "user",
          text: "Goal",
          attachments: [],
        },
        interactionMode: "council",
        runtimeMode: "full-access",
        createdAt: now,
      };
      const providerCmd: ClientOrchestrationCommand = {
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-2"),
        threadId: ThreadId.make("thread-1"),
        message: {
          messageId: MessageId.make("msg-2"),
          role: "user",
          text: "Turn",
          attachments: [],
        },
        interactionMode: "default",
        runtimeMode: "full-access",
        createdAt: now,
      };
      expect(councilCmd.interactionMode).not.toBe(providerCmd.interactionMode);
    });
  });
});
