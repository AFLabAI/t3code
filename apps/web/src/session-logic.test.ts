import {
  MessageId,
  PlanId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveTimelineEntries,
  deriveTimelineEntriesFromVisibleTurnItems,
  findLatestProposedPlan,
  isLatestRunSettled,
} from "./session-logic";

describe("V2 session presentation", () => {
  it("uses run status as the settlement boundary", () => {
    const runId = RunId.make("run-1");
    expect(
      isLatestRunSettled(
        {
          runId,
          status: "completed",
          startedAt: "2026-06-20T00:00:00.000Z",
          completedAt: "2026-06-20T00:01:00.000Z",
        },
        null,
      ),
    ).toBe(true);
    expect(
      isLatestRunSettled(
        { runId, status: "running", startedAt: null, completedAt: null },
        { status: "running", activeRunId: runId },
      ),
    ).toBe(false);
  });

  it("selects the latest proposed plan for a run", () => {
    const runId = RunId.make("run-1");
    const plan = findLatestProposedPlan(
      [
        {
          id: PlanId.make("plan-1"),
          runId,
          planMarkdown: "Plan",
          status: "active",
          implementedAt: null,
          implementationThreadId: ThreadId.make("thread-implementation"),
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:01.000Z",
        },
      ],
      runId,
    );
    expect(plan?.planMarkdown).toBe("Plan");
  });

<<<<<<< HEAD
  it("returns false for a proposed plan already implemented elsewhere", () => {
    expect(
      hasActionableProposedPlan({
        id: "plan-1",
        turnId: TurnId.make("turn-1"),
        planMarkdown: "# Plan",
        implementedAt: "2026-02-23T00:00:02.000Z",
        implementationThreadId: ThreadId.make("thread-implement"),
        createdAt: "2026-02-23T00:00:00.000Z",
        updatedAt: "2026-02-23T00:00:02.000Z",
      }),
    ).toBe(false);
  });
});

describe("workEntryIndicatesToolFailure", () => {
  const base = {
    id: "w1",
    createdAt: "2026-01-01T00:00:00.000Z",
    label: "Read",
  };

  it("is true for error tone", () => {
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        tone: "error",
        detail: "nothing special",
      }),
    ).toBe(true);
  });

  it("is true when lifecycle says failed even if detail is empty", () => {
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "failed",
      }),
    ).toBe(true);
  });

  it("detects file-not-found style tool output with completed lifecycle", () => {
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "completed",
        detail: "File not found: C:\\foo\\nonexistent.ts",
      }),
    ).toBe(true);
  });

  it("detects glob no files and PowerShell command errors", () => {
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        label: "Glob",
        tone: "tool",
        detail: "No files found",
      }),
    ).toBe(true);
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        label: "Bash",
        tone: "tool",
        detail:
          "The term 'this_is_not_a_command' is not recognized as the name of a cmdlet, function, script file, or operable program.",
      }),
    ).toBe(true);
  });

  it("is false for successful completed tools", () => {
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "completed",
        detail: "Found 3 matching files",
      }),
    ).toBe(false);
  });

  it("treats successful tool rows as success candidates", () => {
    expect(
      workEntryIndicatesToolSuccess({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "completed",
        detail: "ok",
      }),
    ).toBe(true);
    expect(
      workEntryIndicatesToolSuccess({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "inProgress",
        detail: "…",
      }),
    ).toBe(false);
    expect(workEntryIndicatesToolSuccess({ ...base, tone: "thinking", detail: "…" })).toBe(false);
    expect(
      workEntryIndicatesToolNeutralStatus({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "inProgress",
        detail: "…",
      }),
    ).toBe(true);
    expect(
      workEntryIndicatesToolNeutralStatus({
        ...base,
        tone: "tool",
        toolLifecycleStatus: "completed",
        detail: "ok",
      }),
    ).toBe(false);
  });

  it("does not run heuristics on non-tool info rows", () => {
    expect(
      workEntryIndicatesToolFailure({
        ...base,
        label: "Context compacted",
        tone: "info",
        detail: "File not found in conversation",
      }),
    ).toBe(false);
  });
});

describe("deriveWorkLogEntries", () => {
  it("keeps the latest task progress without emitting plan-update log entries", () => {
    const activities = [
      makeActivity({ id: "before", kind: "tool.completed", summary: "Read files", sequence: 0 }),
      makeActivity({
        id: "plan-1",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        turnId: "turn-1",
        sequence: 1,
        payload: { plan: [{ step: "Verify the composer", status: "inProgress" }] },
      }),
      makeActivity({
        id: "plan-2",
        kind: "turn.plan.updated",
        summary: "Plan updated",
        turnId: "turn-1",
        sequence: 2,
        payload: { plan: [{ step: "Verify the composer", status: "completed" }] },
      }),
      makeActivity({ id: "after", kind: "tool.completed", summary: "Ran tests", sequence: 3 }),
    ];
    expect(deriveWorkLogEntries(activities).map((entry) => entry.id)).toEqual(["before", "after"]);
    expect(deriveTurnPlans(activities)).toHaveLength(1);
    expect(deriveTurnPlans(activities)[0]?.plan.steps).toMatchObject([
      { step: "Verify the composer", status: "completed" },
    ]);
  });

  it("omits tool started entries and keeps completed entries", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-complete",
        createdAt: "2026-02-23T00:00:03.000Z",
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
      makeActivity({
        id: "tool-start",
        createdAt: "2026-02-23T00:00:02.000Z",
        summary: "Tool call",
        kind: "tool.started",
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries.map((entry) => entry.id)).toEqual(["tool-complete"]);
  });

  it("drops runtime warnings with no displayable content, keeps ones with a preview", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "warning-noise",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "runtime.warning",
        summary: "Claude system message 'background_tasks_changed' (no displayable text content)",
        tone: "info",
      }),
      makeActivity({
        id: "warning-signal",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "runtime.warning",
        summary: "Reconnecting... 2/5",
        tone: "info",
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries.map((entry) => entry.id)).toEqual(["warning-signal"]);
  });

  it("omits task.started but shows task.progress and task.completed", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "task-start",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "task.started",
        summary: "default task started",
        tone: "info",
      }),
      makeActivity({
        id: "task-progress",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "task.progress",
        summary: "Updating files",
        tone: "info",
      }),
      makeActivity({
        id: "task-complete",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "task.completed",
        summary: "Task completed",
        tone: "info",
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries.map((entry) => entry.id)).toEqual(["task-progress", "task-complete"]);
  });

  it("uses payload summary as label for task entries when available", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "task-progress-with-summary",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "task.progress",
        summary: "Reasoning update",
        tone: "info",
        payload: { summary: "Searching for API endpoints" },
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries[0]?.label).toBe("Searching for API endpoints");
  });

  it("uses payload detail as label for task.completed and preserves error tone", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "task-completed-failed",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "task.completed",
        summary: "Task failed",
        tone: "error",
        payload: { detail: "Failed to deploy changes" },
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries[0]?.label).toBe("Failed to deploy changes");
    expect(entries[0]?.tone).toBe("error");
  });

  it("keeps tool entries from every turn and tags each with its turn id", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "turn-1-tool",
        turnId: "turn-1",
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
      makeActivity({
        id: "turn-2-tool",
        turnId: "turn-2",
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries.map((entry) => entry.id)).toEqual(["turn-1-tool", "turn-2-tool"]);
    expect(entries.map((entry) => entry.turnId)).toEqual([
      TurnId.make("turn-1"),
      TurnId.make("turn-2"),
    ]);
  });

  it("omits checkpoint captured info entries", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "checkpoint",
        createdAt: "2026-02-23T00:00:01.000Z",
        summary: "Checkpoint captured",
        tone: "info",
      }),
      makeActivity({
        id: "tool-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        summary: "Ran command",
        tone: "tool",
        kind: "tool.completed",
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries.map((entry) => entry.id)).toEqual(["tool-complete"]);
  });

  it("omits ExitPlanMode lifecycle entries once the plan card is shown", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "exit-plan-updated",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          detail: 'ExitPlanMode: {"allowedPrompts":[{"tool":"Bash","prompt":"run tests"}]}',
        },
      }),
      makeActivity({
        id: "exit-plan-completed",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Tool call",
        payload: {
          detail: "ExitPlanMode: {}",
        },
      }),
      makeActivity({
        id: "real-work-log",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          detail: "Bash: bun test",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries.map((entry) => entry.id)).toEqual(["real-work-log"]);
  });

  it("orders work log by activity sequence when present", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "second",
        createdAt: "2026-02-23T00:00:03.000Z",
        sequence: 2,
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
      makeActivity({
        id: "first",
        createdAt: "2026-02-23T00:00:04.000Z",
        sequence: 1,
        summary: "Tool call complete",
        kind: "tool.completed",
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries.map((entry) => entry.id)).toEqual(["first", "second"]);
  });

  it("extracts command text for command tool activities", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command: ["bun", "run", "lint"],
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.command).toBe("bun run lint");
  });

  it("extracts failed tool lifecycle status from item payloads", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-failed",
        kind: "tool.updated",
        summary: "Glob",
        tone: "tool",
        payload: {
          itemType: "mcp_tool_call",
          status: "failed",
          detail: "No files found",
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.toolLifecycleStatus).toBe("failed");
  });

  it("defaults tool.completed entries to completed lifecycle status", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-done",
        kind: "tool.completed",
        summary: "Glob",
        tone: "tool",
        payload: {
          itemType: "mcp_tool_call",
          detail: "Found 3 files",
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.toolLifecycleStatus).toBe("completed");
  });

  it("preserves MCP server, tool, arguments, and results for expanded display", () => {
    const item = {
      type: "mcpToolCall",
      server: "t3-code",
      tool: "preview_status",
      arguments: {},
      status: "completed",
      result: { content: [{ type: "text", text: "attached" }] },
    };
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "mcp-tool-done",
        kind: "tool.completed",
        summary: "t3-code · preview_status",
        payload: {
          itemType: "mcp_tool_call",
          title: "t3-code · preview_status",
          data: { item },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.toolTitle).toBe("t3-code · preview_status");
    expect(entry?.toolData).toEqual(item);
  });

  it("keeps MCP payloads while collapsing lifecycle updates", () => {
    const item = {
      type: "mcpToolCall",
      server: "t3-code",
      tool: "preview_snapshot",
      arguments: { interactiveOnly: true },
      status: "completed",
    };
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "mcp-tool-progress",
        kind: "tool.updated",
        summary: "t3-code · preview_snapshot",
        payload: {
          itemType: "mcp_tool_call",
          toolCallId: "call-1",
          data: { item },
        },
      }),
      makeActivity({
        id: "mcp-tool-complete",
        kind: "tool.completed",
        summary: "t3-code · preview_snapshot",
        payload: {
          itemType: "mcp_tool_call",
          toolCallId: "call-1",
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.toolData).toEqual(item);
  });

  it("unwraps PowerShell command wrappers for displayed command text", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool-windows-wrapper",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command: "\"C:\\Program Files\\PowerShell\\7\\pwsh.exe\" -Command 'bun run lint'",
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.command).toBe("bun run lint");
    expect(entry?.rawCommand).toBe(
      "\"C:\\Program Files\\PowerShell\\7\\pwsh.exe\" -Command 'bun run lint'",
    );
  });

  it("unwraps PowerShell command wrappers from argv-style command payloads", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool-windows-wrapper-argv",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command: ["C:\\Program Files\\PowerShell\\7\\pwsh.exe", "-Command", "rg -n foo ."],
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.command).toBe("rg -n foo .");
    expect(entry?.rawCommand).toBe(
      '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "rg -n foo ."',
    );
  });

  it("extracts command text from command detail when structured command metadata is missing", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool-windows-detail-fallback",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          detail:
            '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo -NoProfile -Command \'rg -n -F "new Date()" .\' <exited with exit code 0>',
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.command).toBe('rg -n -F "new Date()" .');
    expect(entry?.rawCommand).toBe(
      `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoLogo -NoProfile -Command 'rg -n -F "new Date()" .'`,
    );
  });

  it("does not unwrap shell commands when no wrapper flag is present", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "command-tool-shell-script",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          data: {
            item: {
              command: "bash script.sh",
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.command).toBe("bash script.sh");
    expect(entry?.rawCommand).toBeUndefined();
  });

  it("keeps compact Codex tool metadata used for icons and labels", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-with-metadata",
        kind: "tool.completed",
        summary: "bash",
        payload: {
          itemType: "command_execution",
          title: "bash",
          status: "completed",
          detail: '{ "dev": "vite dev --port 3000" } <exited with exit code 0>',
          data: {
            item: {
              command: ["bun", "run", "dev"],
              result: {
                content: '{ "dev": "vite dev --port 3000" } <exited with exit code 0>',
                exitCode: 0,
              },
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry).toMatchObject({
      command: "bun run dev",
      detail: '{ "dev": "vite dev --port 3000" }',
      itemType: "command_execution",
      toolTitle: "bash",
    });
  });

  it("extracts changed file paths for file-change tool activities", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "file-tool",
        kind: "tool.completed",
        summary: "File change",
        payload: {
          itemType: "file_change",
          data: {
            item: {
              changes: [
                { path: "apps/web/src/components/ChatView.tsx" },
                { filename: "apps/web/src/session-logic.ts" },
              ],
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.changedFiles).toEqual([
      "apps/web/src/components/ChatView.tsx",
      "apps/web/src/session-logic.ts",
    ]);
  });

  it("drops duplicated tool detail when it only repeats the title", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "read-file-generic",
        kind: "tool.completed",
        summary: "Read File",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Read File",
          detail: "Read File",
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities);
    expect(entry?.toolTitle).toBe("Read File");
    expect(entry?.detail).toBeUndefined();
  });

  it("uses grep raw output summaries instead of repeating the generic tool label", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "grep-update",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "grep",
        payload: {
          itemType: "web_search",
          title: "grep",
          detail: "grep",
          data: {
            toolCallId: "tool-grep-1",
            kind: "search",
            rawInput: {},
          },
        },
      }),
      makeActivity({
        id: "grep-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "grep",
        payload: {
          itemType: "web_search",
          title: "grep",
          detail: "grep",
          data: {
            toolCallId: "tool-grep-1",
            kind: "search",
            rawOutput: {
              totalFiles: 19,
              truncated: false,
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "grep-complete",
      toolTitle: "grep",
      detail: "19 files",
      itemType: "web_search",
    });
  });

  it("uses completed read-file output previews and still collapses the same tool call", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "read-update",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Read File",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Read File",
          detail: "Read File",
          data: {
            toolCallId: "tool-read-1",
            kind: "read",
            rawInput: {},
          },
        },
      }),
      makeActivity({
        id: "read-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Read File",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Read File",
          detail: "Read File",
          data: {
            toolCallId: "tool-read-1",
            kind: "read",
            rawOutput: {
              content:
                'import * as Effect from "effect/Effect"\nimport * as Layer from "effect/Layer"\n',
            },
          },
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "read-complete",
      toolTitle: "Read File",
      detail: 'import * as Effect from "effect/Effect"',
      itemType: "dynamic_tool_call",
    });
  });

  it("does not use command stdout as the detail when Cursor omits the command input", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "cursor-command-complete",
        createdAt: "2026-04-16T22:40:42.221Z",
        kind: "tool.completed",
        summary: "Ran command",
        payload: {
          itemType: "command_execution",
          title: "Ran command",
          data: {
            toolCallId: "toolu_vrtx_01WypXgRM8PPygBtrVAZwzy5",
            kind: "execute",
            rawInput: {},
            rawOutput: {
              exitCode: 0,
              stdout: "total 960\napps\npackages\n",
              stderr: "",
            },
          },
        },
      }),
    ];

    const [entry] = deriveWorkLogEntries(activities, undefined);
    expect(entry).toMatchObject({
      id: "cursor-command-complete",
      label: "Ran command",
      itemType: "command_execution",
      toolTitle: "Ran command",
    });
    expect(entry?.detail).toBeUndefined();
    expect(entry?.command).toBeUndefined();
  });

  it("collapses legacy completed tool rows that are missing tool metadata", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "legacy-read-update",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Read File",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Read File",
          detail: "Read File",
          data: {
            toolCallId: "tool-read-legacy",
            kind: "read",
            rawInput: {},
          },
        },
      }),
      makeActivity({
        id: "legacy-read-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Read File",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Read File",
          detail: "Read File",
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "legacy-read-complete",
      toolTitle: "Read File",
      itemType: "dynamic_tool_call",
    });
    expect(entries[0]?.detail).toBeUndefined();
  });

  it("collapses repeated lifecycle updates for the same tool call into one entry", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-update-1",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "tool-update-2",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
          data: {
            item: {
              command: ["sed", "-n", "1,40p", "/tmp/app.ts"],
            },
          },
        },
      }),
      makeActivity({
        id: "tool-complete",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "tool.completed",
        summary: "Tool call completed",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "tool-complete",
      createdAt: "2026-02-23T00:00:03.000Z",
      label: "Tool call completed",
      detail: 'Read: {"file_path":"/tmp/app.ts"}',
      command: "sed -n 1,40p /tmp/app.ts",
      itemType: "dynamic_tool_call",
      toolTitle: "Tool call",
    });
  });

  it("keeps separate tool entries when an identical call starts after the prior one completed", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "tool-1-update",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "tool-1-complete",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Tool call completed",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "tool-2-update",
        createdAt: "2026-02-23T00:00:03.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "tool-2-complete",
        createdAt: "2026-02-23T00:00:04.000Z",
        kind: "tool.completed",
        summary: "Tool call completed",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities);

    expect(entries.map((entry) => entry.id)).toEqual(["tool-1-complete", "tool-2-complete"]);
  });

  it("collapses same-timestamp lifecycle rows even when completed sorts before updated by id", () => {
    const activities: OrchestrationThreadActivity[] = [
      makeActivity({
        id: "z-update-earlier",
        createdAt: "2026-02-23T00:00:01.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "a-complete-same-timestamp",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.completed",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
      makeActivity({
        id: "z-update-same-timestamp",
        createdAt: "2026-02-23T00:00:02.000Z",
        kind: "tool.updated",
        summary: "Tool call",
        payload: {
          itemType: "dynamic_tool_call",
          title: "Tool call",
          detail: 'Read: {"file_path":"/tmp/app.ts"}',
        },
      }),
    ];

    const entries = deriveWorkLogEntries(activities);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe("a-complete-same-timestamp");
  });
});

describe("deriveTimelineEntries", () => {
  it("includes proposed plans alongside messages and work entries in chronological order", () => {
=======
  it("orders conversation and generic V2 work entries", () => {
>>>>>>> aedd7c58a2 (Complete orchestration V2 frontend cutover)
    const entries = deriveTimelineEntries(
      [
        {
          id: "message-1" as never,
          role: "user",
          text: "Hello",
          runId: null,
          streaming: false,
          createdAt: "2026-06-20T00:00:00.000Z",
          updatedAt: "2026-06-20T00:00:00.000Z",
        },
      ],
      [],
      [],
    );
    expect(entries.map((entry) => entry.kind)).toEqual(["message"]);
  });

  it("uses visible turn item order and keeps interruption lifecycle entries standalone", () => {
    const now = DateTime.makeUnsafe("2026-06-20T00:00:00.000Z");
    const threadId = ThreadId.make("thread-visible");
    const runId = RunId.make("run-visible");
    const base = (id: string, ordinal: number) => ({
      id: TurnItemId.make(id),
      threadId,
      runId,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal,
      status: "completed" as const,
      title: null,
      startedAt: now,
      completedAt: now,
      updatedAt: now,
    });
    const userItem = {
      ...base("item-user", 0),
      type: "user_message" as const,
      messageId: MessageId.make("message-user"),
      inputIntent: "turn_start" as const,
      text: "Start",
      attachments: [],
      createdBy: "user" as const,
      creationSource: "web" as const,
    } satisfies OrchestrationV2TurnItem;
    const requestItem = {
      ...base("item-interrupt-request", 1),
      type: "run_interrupt_request" as const,
      message: "Stopping",
    } satisfies OrchestrationV2TurnItem;
    const commandItem = {
      ...base("item-command", 2),
      type: "command_execution" as const,
      input: "sleep 1",
      output: "done",
      exitCode: 0,
    } satisfies OrchestrationV2TurnItem;
    const resultItem = {
      ...base("item-interrupt-result", 3),
      type: "run_interrupt_result" as const,
      message: "Stopped",
    } satisfies OrchestrationV2TurnItem;
    const visibleTurnItems: ReadonlyArray<OrchestrationV2ProjectedTurnItem> = [
      userItem,
      requestItem,
      commandItem,
      resultItem,
    ].map((item, position) => ({
      position,
      visibility: "local" as const,
      sourceThreadId: threadId,
      sourceItemId: item.id,
      item,
    }));

    const entries = deriveTimelineEntriesFromVisibleTurnItems({
      visibleTurnItems,
      optimisticMessages: [],
    });

    expect(entries.map((entry) => [entry.kind, entry.id])).toEqual([
      ["message", userItem.messageId],
      ["event", requestItem.id],
      ["work", commandItem.id],
      ["event", resultItem.id],
    ]);
    const commandEntry = entries[2];
    expect(commandEntry?.kind).toBe("work");
    if (commandEntry?.kind === "work") {
      expect(commandEntry.entry.projectedItem).toBe(visibleTurnItems[2]);
      expect(commandEntry.entry.structuredPayload).toBe(commandItem);
    }
  });
});

describe("deriveWorkLogEntries quiet-timeline guarantee", () => {
  it("N concurrent subagents produce exactly N lifecycle rows, zero attributed tool rows", () => {
    const activities: OrchestrationThreadActivity[] = [];
    for (let agent = 0; agent < 5; agent += 1) {
      const taskId = `task-${agent}`;
      // Progress ticks (several per agent) + attributed tool rows.
      for (let tick = 0; tick < 4; tick += 1) {
        activities.push(
          makeActivity({
            kind: "task.progress",
            summary: `agent ${agent} tick ${tick}`,
            tone: "info",
            payload: { taskId, summary: `working ${tick}`, role: "explorer" },
            turnId: "turn-batch",
            sequence: agent * 20 + tick,
          }),
        );
        activities.push(
          makeActivity({
            kind: "tool.completed",
            summary: "Read",
            payload: { itemType: "dynamic_tool_call", agentId: taskId },
            sequence: agent * 20 + 10 + tick,
          }),
        );
      }
      activities.push(
        makeActivity({
          kind: "task.completed",
          summary: "Task completed",
          tone: "info",
          payload: {
            taskId,
            status: "completed",
            summary: `agent ${agent} done`,
            role: "explorer",
          },
          turnId: "turn-batch",
          sequence: agent * 20 + 19,
        }),
      );
    }

    const entries = deriveWorkLogEntries(activities);
    // A1 CTA design: all direct spawns in one turn collapse into ONE
    // call-to-action row carrying the batch's agent ids.
    const spawnRows = entries.filter((entry) => entry.agentSpawn !== undefined);
    expect(spawnRows).toHaveLength(1);
    expect(spawnRows[0]!.agentSpawn!.agentTaskIds).toHaveLength(5);
    expect(spawnRows[0]!.agentSpawn!.workflowId).toBeNull();
    // No agent-attributed tool rows leak into the main log.
    expect(entries.some((entry) => entry.sourceActivityKind?.startsWith("tool."))).toBe(false);
  });

  it("a workflow run and its members collapse into one CTA row keyed to the coordinator", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        kind: "task.progress",
        summary: "coordinator",
        tone: "info",
        payload: { taskId: "wf-1", taskType: "local_workflow", workflowName: "math-check" },
        sequence: 1,
      }),
      makeActivity({
        kind: "task.progress",
        summary: "member",
        tone: "info",
        payload: { taskId: "wf-1:wf:0", status: "running", parentAgentId: "wf-1" },
        sequence: 2,
      }),
      makeActivity({
        kind: "task.completed",
        summary: "member done",
        tone: "info",
        payload: { taskId: "wf-1:wf:1", status: "completed", parentAgentId: "wf-1" },
        sequence: 3,
      }),
    ]);
    const spawnRows = entries.filter((entry) => entry.agentSpawn !== undefined);
    expect(spawnRows).toHaveLength(1);
    expect(spawnRows[0]!.agentSpawn!.workflowId).toBe("wf-1");
    expect(spawnRows[0]!.agentSpawn!.agentTaskIds).toEqual(
      expect.arrayContaining(["wf-1", "wf-1:wf:0", "wf-1:wf:1"]),
    );
  });

  it("keeps unattributed tool rows (over-hiding loses the only signal)", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        kind: "tool.completed",
        summary: "Bash",
        payload: { itemType: "command_execution", command: "ls" },
      }),
    ]);
    expect(entries).toHaveLength(1);
  });

  it("folds timelineBypass agent rows into one CTA (Codex children, workflow members)", () => {
    // Codex children carry their parent's spawn turn (spawnTurnId stamping),
    // which is what batches a fleet into one CTA.
    const entries = deriveWorkLogEntries([
      makeActivity({
        kind: "task.progress",
        summary: "child work",
        tone: "info",
        payload: { taskId: "child-1", timelineBypass: true },
        turnId: "turn-spawn",
      }),
      makeActivity({
        kind: "task.progress",
        summary: "child work again",
        tone: "info",
        payload: { taskId: "child-2", timelineBypass: true },
        turnId: "turn-spawn",
      }),
    ]);
    // Not suppressed outright (a Codex fleet's rows are ALL bypassed and
    // still need a CTA anchor) — but never more than the batch's single row.
    expect(entries).toHaveLength(1);
    expect(entries[0]!.agentSpawn?.agentTaskIds).toEqual(["child-1", "child-2"]);
  });

  it("timelineBypass non-agent rows (background shells) stay suppressed", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        kind: "task.progress",
        summary: "stall",
        tone: "info",
        payload: { taskId: "sh-1", taskType: "local_bash", timelineBypass: true },
      }),
    ]);
    expect(entries).toHaveLength(0);
  });

  it("drops task.updated and tool.progress from the work log (fold input only)", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        kind: "task.updated",
        summary: "Task running",
        tone: "info",
        payload: { taskId: "task-1", status: "running" },
      }),
      makeActivity({
        kind: "tool.progress",
        summary: "Read",
        tone: "info",
        payload: { taskId: "task-1", toolName: "Read" },
      }),
    ]);
    expect(entries).toHaveLength(0);
  });
});

describe("rerun workflows", () => {
  it("turn-less direct spawns do not collapse into one global batch", () => {
    // Rows that lost their turn id (defensive path) group per task, so two
    // unrelated turn-less spawns never merge into one immortal CTA.
    const entries = deriveWorkLogEntries([
      makeActivity({
        kind: "task.started",
        summary: "Task started",
        payload: { taskId: "loose-1", taskType: "local_agent", role: "a" },
        sequence: 1,
      }),
      makeActivity({
        kind: "task.started",
        summary: "Task started",
        payload: { taskId: "loose-2", taskType: "local_agent", role: "b" },
        sequence: 2,
      }),
    ]);
    const spawnRows = entries.filter((entry) => entry.agentSpawn !== undefined);
    expect(spawnRows).toHaveLength(2);
    expect(spawnRows.map((row) => row.agentSpawn!.agentTaskIds)).toEqual([
      ["loose-1"],
      ["loose-2"],
    ]);
  });

  it("each workflow run gets its own CTA row (distinct coordinator ids)", () => {
    const entries = deriveWorkLogEntries([
      makeActivity({
        kind: "task.progress",
        summary: "run 1",
        tone: "info",
        payload: { taskId: "wf-run1", taskType: "local_workflow", workflowName: "math-check" },
        turnId: "turn-1",
        sequence: 1,
      }),
      makeActivity({
        kind: "task.completed",
        summary: "run 1 done",
        tone: "info",
        payload: { taskId: "wf-run1", status: "completed", taskType: "local_workflow" },
        turnId: "turn-1",
        sequence: 2,
      }),
      makeActivity({
        kind: "task.progress",
        summary: "run 2",
        tone: "info",
        payload: { taskId: "wf-run2", taskType: "local_workflow", workflowName: "math-check" },
        turnId: "turn-2",
        sequence: 3,
      }),
    ]);
    const spawnRows = entries.filter((entry) => entry.agentSpawn !== undefined);
    expect(spawnRows.map((row) => row.agentSpawn!.workflowId)).toEqual(["wf-run1", "wf-run2"]);
    expect(spawnRows.map((row) => row.turnId)).toEqual(["turn-1", "turn-2"]);
  });
});

describe("PROVIDER_OPTIONS", () => {
  it("advertises Codex, Claude, OpenCode, and Cursor as available providers", () => {
    const claude = PROVIDER_OPTIONS.find((option) => option.value === "claudeAgent");
    const opencode = PROVIDER_OPTIONS.find((option) => option.value === "opencode");
    const cursor = PROVIDER_OPTIONS.find((option) => option.value === "cursor");
    expect(PROVIDER_OPTIONS).toEqual([
      { value: "codex", label: "Codex", available: true },
      { value: "claudeAgent", label: "Claude", available: true },
      { value: "opencode", label: "OpenCode", available: true },
      { value: "cursor", label: "Cursor", available: true },
    ]);
    expect(claude).toEqual({
      value: "claudeAgent",
      label: "Claude",
      available: true,
    });
    expect(opencode).toEqual({
      value: "opencode",
      label: "OpenCode",
      available: true,
    });
    expect(cursor).toEqual({
      value: "cursor",
      label: "Cursor",
      available: true,
    });
  });
});
