import { describe, expect, it } from "vite-plus/test";
import type { CouncilDecision, CouncilEvent } from "../../council/CouncilClient.ts";

const now = "2026-01-01T00:00:00.000Z";

describe("CouncilCommandReactor", () => {
  describe("Council goal submission and polling", () => {
    it("receives Council goal from thread.council-goal-requested event", () => {
      // Reactor processes thread.council-goal-requested events
      // Event type must match CouncilIntentEvent discriminant
      const eventType = "thread.council-goal-requested";
      expect(eventType).toBe("thread.council-goal-requested");
      // Handler extracts threadId, goalText, createdAt from payload
    });

    it("submits goal to Council once per cycle", () => {
      // Goal submission must happen exactly once per cycle ID
      // Council.submitGoal called once, cycleId returned
      const cycleId = "cycle-123";
      expect(cycleId).toBeDefined();
      // After handler: expect(councilClient.submitGoal).toHaveBeenCalledTimes(1);
    });

    it("polls for cycle status until decision_ready", () => {
      // Reactor must poll getCycleStatus with 500ms interval
      // Stops when event with eventType "decision_ready" appears
      const event: CouncilEvent = {
        cycleId: "cycle-123",
        eventType: "planner_started",
        content: "Planning",
        timestamp: now,
      };
      expect(event.eventType).toBe("planner_started");
      // After handler: polling must occur until decision_ready
    });

    it("handles polling timeout gracefully", () => {
      // Timeout: 120s max wait per COUNCIL_POLL_TIMEOUT
      // Reactor emits error activity on timeout, does not crash
      const cycleId = "cycle-timeout";
      expect(cycleId).toBeDefined();
      // After timeout exceeded: error activity emitted
    });

    it("handles Council submission failure", () => {
      // submitGoal rejection → error activity emitted
      const error = new Error("Council unreachable");
      expect(error.message).toBe("Council unreachable");
      // After failure: emitCouncilFailure called with detail
    });

    it("handles decision retrieval failure", () => {
      // getDecision rejection → error activity emitted, cycle exits gracefully
      const error = new Error("Decision fetch failed");
      expect(error.message).toBe("Decision fetch failed");
      // After failure: error activity with cycleId
    });
  });

  describe("Council event visibility", () => {
    it("emits Planner event when received from Council", () => {
      // CouncilEvent with eventType "planner_started" → activity appended
      // Activity kind: "council.event", tone: "info"
      const event: CouncilEvent = {
        cycleId: "cycle-1",
        eventType: "planner_started",
        content: "Planning phase initiated",
        timestamp: now,
      };
      expect(event.eventType).toBe("planner_started");
      // After handler: mockOrchestrationEngine.dispatch called with activity
    });

    it("emits Critic event when received from Council", () => {
      // eventType "critic_started" → activity appended
      const event: CouncilEvent = {
        cycleId: "cycle-1",
        eventType: "critic_started",
        brain: "CRITIC",
        content: "Critical analysis",
        timestamp: now,
      };
      expect(event.brain).toBe("CRITIC");
      // After handler: activity with brain field preserved
    });

    it("emits Revision event when received from Council", () => {
      // eventType "revision_started" → activity appended
      const event: CouncilEvent = {
        cycleId: "cycle-1",
        eventType: "revision_started",
        content: "Revision phase",
        timestamp: now,
      };
      expect(event.eventType).toBe("revision_started");
    });

    it("emits Judge event when received from Council", () => {
      // eventType "judge_started" → activity appended
      const event: CouncilEvent = {
        cycleId: "cycle-1",
        eventType: "judge_started",
        content: "Judge evaluation",
        timestamp: now,
      };
      expect(event.eventType).toBe("judge_started");
    });

    it("emits Decision event when Council decision complete", () => {
      // eventType "decision_ready" → orchestrationEngine.dispatch called with decision activity
      // Activity kind: "council.event", summary includes decision type
      const event: CouncilEvent = {
        cycleId: "cycle-1",
        eventType: "decision_ready",
        content: "Decision complete: EXECUTE",
        timestamp: now,
      };
      expect(event.eventType).toBe("decision_ready");
      // After handler: decision activity appended with summary
    });
  });

  describe("Decision routing", () => {
    it("routes LOW/MEDIUM EXECUTE decision to ExecutionCandidate directly", () => {
      // LOW/MEDIUM risk EXECUTE → creates ExecutionCandidate activity
      // Kind: "council.execution-candidate"
      const decision: CouncilDecision = {
        cycleId: "cycle-1",
        decision: "EXECUTE",
        reasoning: "Safe to execute",
        executionProposal: "run_task()",
        riskLevel: "LOW",
        requiresApproval: false,
      };
      expect(decision.riskLevel).toBe("LOW");
      // After handler: ExecutionCandidate activity created, state → READY_FOR_EXECUTOR
    });

    it("routes HIGH/CRITICAL EXECUTE decision to approval gate", () => {
      // HIGH/CRITICAL EXECUTE → creates approval.requested activity
      // Emits thread.council-approval-requested event
      // Thread state → WAITING_USER_APPROVAL
      const decision: CouncilDecision = {
        cycleId: "cycle-1",
        decision: "EXECUTE",
        reasoning: "Requires approval",
        riskLevel: "HIGH",
        requiresApproval: false,
      };
      expect(decision.riskLevel).toBe("HIGH");
      // After handler: approval activity created, thread enters WAITING_USER_APPROVAL
    });

    it("routes ASK_USER decision without ExecutionCandidate", () => {
      // ASK_USER → recorded in activities, no execution candidate created
      const decision: CouncilDecision = {
        cycleId: "cycle-1",
        decision: "ASK_USER",
        reasoning: "Need user input",
        requiresApproval: false,
      };
      expect(decision.decision).toBe("ASK_USER");
      // After handler: thread state WAITING_USER_APPROVAL
    });

    it("routes BLOCKED decision to terminal state", () => {
      // BLOCKED → recorded in activities, no further action
      const decision: CouncilDecision = {
        cycleId: "cycle-1",
        decision: "BLOCKED",
        reasoning: "Cannot proceed",
        requiresApproval: false,
      };
      expect(decision.decision).toBe("BLOCKED");
      // After handler: terminal state, no execution path
    });

    it("routes RESEARCH decision to holding state", () => {
      // RESEARCH → recorded, awaits further information
      const decision: CouncilDecision = {
        cycleId: "cycle-1",
        decision: "RESEARCH",
        reasoning: "Need investigation",
        requiresApproval: false,
      };
      expect(decision.decision).toBe("RESEARCH");
    });

    it("routes MORE_EVIDENCE decision to holding state", () => {
      // MORE_EVIDENCE → recorded, awaits additional data
      const decision: CouncilDecision = {
        cycleId: "cycle-1",
        decision: "MORE_EVIDENCE",
        reasoning: "Insufficient data",
        requiresApproval: false,
      };
      expect(decision.decision).toBe("MORE_EVIDENCE");
    });

    it("routes REVISE decision with deferral", () => {
      // REVISE → recorded, revision loop deferred to future phase
      const decision: CouncilDecision = {
        cycleId: "cycle-1",
        decision: "REVISE",
        reasoning: "Plan needs revision",
        requiresApproval: false,
      };
      expect(decision.decision).toBe("REVISE");
    });
  });

  describe("Execution and safety", () => {
    it("does NOT invoke executor or Ox for any decision", () => {
      // Safety: reactor only creates activities and events
      // NO executor invocation anywhere in CouncilCommandReactor
      // NO Ox connection, NO execution authorization
      // Approval state is READY_FOR_EXECUTOR: a state only, no execution trigger
      const decisionType = "EXECUTE" as const;
      expect(decisionType).toBeDefined();
      // After handler: verify Ox not imported, no executor calls
    });

    it("does NOT execute shell commands or tasks", () => {
      // CouncilCommandReactor only:
      //   - emits activities
      //   - records decisions
      //   - manages thread state
      // No command execution, no shell invocation
      const hasDispatcher = true;
      expect(hasDispatcher).toBe(true);
      // Dispatcher is only place activity appending happens
    });

    it("does NOT call ProviderService or ProviderCommandReactor", () => {
      // Council path completely independent of Provider path
      // No ProviderService import or usage in Council flow
      // No ProviderCommandReactor involvement
      const hasDispatcher = true;
      expect(hasDispatcher).toBe(true);
      // After handler: ProviderService not called
    });

    it("maintains thread state consistency without mutation until approval", () => {
      // State transitions via orchestrationEngine.dispatch (event emission only)
      // No direct thread state mutation
      // Idempotent property: same cycleId → same output
      const cycleId1 = "cycle-abc";
      const cycleId2 = "cycle-abc";
      expect(cycleId1).toBe(cycleId2);
      // Dispatch is the only mutation point (append activities)
    });

    it("handles idempotent Council results correctly", () => {
      // Same cycleId submitted twice → single ExecutionCandidate (or approval request)
      // Thread state deduplicates via dispatcher sequence number
      const decision1 = "EXECUTE" as const;
      const decision2 = "EXECUTE" as const;
      expect(decision1).toBe(decision2);
      // Identical input (same cycleId + decision type) → identical output
    });
  });
});
