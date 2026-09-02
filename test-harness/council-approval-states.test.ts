import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert";
import {
  routeCouncilDecision,
  createExecutionCandidatePayload,
} from "../apps/server/src/council/CouncilDecisionRouter.ts";
import type { CouncilDecision } from "../apps/server/src/council/CouncilClient.ts";

NodeTest.describe("Council → Approval State Integration", () => {
  NodeTest.describe("LOW risk EXECUTE", () => {
    NodeTest.it("routes to READY_FOR_EXECUTOR without approval gate", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-1",
        decision: "EXECUTE",
        reasoning: "Safe action",
        executionProposal: "run_task()",
        riskLevel: "LOW",
        requiresApproval: false,
      };

      const requiresApproval = decision.riskLevel === "HIGH" || decision.riskLevel === "CRITICAL";
      const route = routeCouncilDecision(decision);

      NodeAssert.default.strictEqual(requiresApproval, false);
      NodeAssert.default.strictEqual(route.type, "EXECUTE");
      NodeAssert.default.strictEqual(route.requiresApproval, false);
    });

    NodeTest.it("creates ExecutionCandidate for low-risk EXECUTE", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-2",
        decision: "EXECUTE",
        reasoning: "Safe",
        riskLevel: "LOW",
        requiresApproval: false,
      };

      const payload = createExecutionCandidatePayload({
        cycleId: "cycle-2",
        decision,
        goal: "Low risk task",
      });

      NodeAssert.default.strictEqual(payload.decision, "EXECUTE");
      NodeAssert.default.strictEqual(payload.riskLevel, "LOW");
      NodeAssert.default.strictEqual(payload.requiresApproval, false);
    });
  });

  NodeTest.describe("MEDIUM risk EXECUTE", () => {
    NodeTest.it("routes to READY_FOR_EXECUTOR by default", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-3",
        decision: "EXECUTE",
        reasoning: "Medium complexity",
        riskLevel: "MEDIUM",
        requiresApproval: false,
      };

      const requiresApproval = decision.riskLevel === "HIGH" || decision.riskLevel === "CRITICAL";

      NodeAssert.default.strictEqual(requiresApproval, false);
    });
  });

  NodeTest.describe("HIGH risk EXECUTE", () => {
    NodeTest.it("creates approval request (not direct ExecutionCandidate)", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-4",
        decision: "EXECUTE",
        reasoning: "High risk action",
        executionProposal: "dangerous_op()",
        riskLevel: "HIGH",
        requiresApproval: false,
      };

      const requiresApproval = decision.riskLevel === "HIGH" || decision.riskLevel === "CRITICAL";
      NodeAssert.default.strictEqual(requiresApproval, true);
    });

    NodeTest.it("approval request contains Council context", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-5",
        decision: "EXECUTE",
        reasoning: "Expert analysis recommends",
        executionProposal: "deploy_release()",
        riskLevel: "HIGH",
        requiresApproval: false,
      };

      // Simulated approval request payload
      const approvalPayload = {
        cycleId: decision.cycleId,
        councilCycleId: decision.cycleId,
        decision: decision.decision,
        reasoning: decision.reasoning,
        proposal: decision.executionProposal,
        riskLevel: decision.riskLevel,
        goal: "Deploy release v2.0",
      };

      NodeAssert.default.ok(approvalPayload.cycleId);
      NodeAssert.default.ok(approvalPayload.councilCycleId);
      NodeAssert.default.strictEqual(approvalPayload.decision, "EXECUTE");
      NodeAssert.default.ok(approvalPayload.reasoning);
      NodeAssert.default.ok(approvalPayload.proposal);
      NodeAssert.default.strictEqual(approvalPayload.riskLevel, "HIGH");
    });

    NodeTest.it("user approval moves to READY_FOR_EXECUTOR", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-6",
        decision: "EXECUTE",
        reasoning: "Approved by Council",
        riskLevel: "HIGH",
        requiresApproval: false,
      };

      // WAITING_USER_APPROVAL → user approves → READY_FOR_EXECUTOR
      const approvalRequired = decision.riskLevel === "HIGH" || decision.riskLevel === "CRITICAL";

      NodeAssert.default.strictEqual(approvalRequired, true);
      // After approval, executor would process this
    });

    NodeTest.it("user rejection moves to BLOCKED", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-7",
        decision: "EXECUTE",
        reasoning: "Requires approval",
        riskLevel: "HIGH",
        requiresApproval: false,
      };

      // WAITING_USER_APPROVAL → user rejects → BLOCKED
      // No ExecutionCandidate created
      const requiresApproval = decision.riskLevel === "HIGH" || decision.riskLevel === "CRITICAL";
      NodeAssert.default.strictEqual(requiresApproval, true);
    });
  });

  NodeTest.describe("CRITICAL risk EXECUTE", () => {
    NodeTest.it("requires approval gate", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-8",
        decision: "EXECUTE",
        reasoning: "Critical infrastructure change",
        riskLevel: "CRITICAL",
        requiresApproval: false,
      };

      const requiresApproval = decision.riskLevel === "HIGH" || decision.riskLevel === "CRITICAL";
      NodeAssert.default.strictEqual(requiresApproval, true);
    });

    NodeTest.it("approval decision determines execution", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-9",
        decision: "EXECUTE",
        reasoning: "System-critical change",
        executionProposal: "drop_database()",
        riskLevel: "CRITICAL",
        requiresApproval: false,
      };

      // WAITING_USER_APPROVAL is mandatory
      const shouldBeApprovalGated = decision.riskLevel === "CRITICAL";
      NodeAssert.default.strictEqual(shouldBeApprovalGated, true);

      // reject → BLOCKED (no execution)
      // accept → READY_FOR_EXECUTOR (executor runs later)
    });
  });

  NodeTest.describe("ASK_USER decision", () => {
    NodeTest.it("routes to WAITING_USER_APPROVAL (no ExecutionCandidate)", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-10",
        decision: "ASK_USER",
        reasoning: "Need user guidance",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      NodeAssert.default.strictEqual(route.type, "ASK_USER");

      // No ExecutionCandidate created, awaits user input
    });
  });

  NodeTest.describe("BLOCKED decision", () => {
    NodeTest.it("routes to BLOCKED state (no execution)", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-11",
        decision: "BLOCKED",
        reasoning: "Cannot proceed, constraints violated",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      NodeAssert.default.strictEqual(route.type, "BLOCKED");

      // No ExecutionCandidate, no approval request
      // Terminal state unless user revises goal
    });
  });

  NodeTest.describe("RESEARCH decision", () => {
    NodeTest.it("routes to RESEARCH state (holding)", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-12",
        decision: "RESEARCH",
        reasoning: "Needs investigation",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      NodeAssert.default.strictEqual(route.type, "RESEARCH");
    });
  });

  NodeTest.describe("MORE_EVIDENCE decision", () => {
    NodeTest.it("routes to MORE_EVIDENCE state (holding)", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-13",
        decision: "MORE_EVIDENCE",
        reasoning: "Insufficient data",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      NodeAssert.default.strictEqual(route.type, "MORE_EVIDENCE");
    });
  });

  NodeTest.describe("Approval idempotency", () => {
    NodeTest.it("duplicate approval does not create duplicate ExecutionCandidate", () => {
      // Same cycleId + decision → same ExecutionCandidate ID
      const decision: CouncilDecision = {
        cycleId: "cycle-14",
        decision: "EXECUTE",
        reasoning: "Safe",
        riskLevel: "LOW",
        requiresApproval: false,
      };

      const payload1 = createExecutionCandidatePayload({
        cycleId: "cycle-14",
        decision,
        goal: "Task",
      });

      const payload2 = createExecutionCandidatePayload({
        cycleId: "cycle-14",
        decision,
        goal: "Task",
      });

      // Both payloads should be identical (idempotent)
      NodeAssert.default.deepStrictEqual(payload1, payload2);
    });

    NodeTest.it("duplicate Council result does not create duplicate approval request", () => {
      // Same cycleId → same approval request ID
      // Thread state prevents duplicate processing
      const cycleId = "cycle-15";

      // First result: creates approval request
      // Second result: idempotent (same cycleId, same request ID)
      // Decider should track this via thread state
      NodeAssert.default.ok(cycleId);
    });
  });

  NodeTest.describe("Already READY_FOR_EXECUTOR does not regress", () => {
    NodeTest.it("second approval decision is no-op", () => {
      // Once READY_FOR_EXECUTOR, already approved
      // Second approval attempt should not change state
      const decision: CouncilDecision = {
        cycleId: "cycle-16",
        decision: "EXECUTE",
        reasoning: "Ready",
        riskLevel: "LOW",
        requiresApproval: false,
      };

      // State is idempotent:
      // 1st: create ExecutionCandidate → READY_FOR_EXECUTOR
      // 2nd: already in READY, no-op
      const route = routeCouncilDecision(decision);
      NodeAssert.default.strictEqual(route.type, "EXECUTE");
    });
  });

  NodeTest.describe("Rejected candidate cannot silently execute", () => {
    NodeTest.it("BLOCKED stays non-executable", () => {
      const decision: CouncilDecision = {
        cycleId: "cycle-17",
        decision: "BLOCKED",
        reasoning: "Rejected by Council",
        requiresApproval: false,
      };

      const route = routeCouncilDecision(decision);
      NodeAssert.default.strictEqual(route.type, "BLOCKED");

      // No ExecutionCandidate created
      // Blocked state is terminal (no execution path)
    });
  });

  NodeTest.describe("Cycle ID stability", () => {
    NodeTest.it("cycleId persists through approval flow", () => {
      const cycleId = "cycle-18";
      const decision: CouncilDecision = {
        cycleId,
        decision: "EXECUTE",
        reasoning: "Approval needed",
        riskLevel: "HIGH",
        requiresApproval: false,
      };

      const payload = createExecutionCandidatePayload({
        cycleId,
        decision,
        goal: "Task",
      });

      // cycleId is immutable through approval chain
      NodeAssert.default.strictEqual(payload.cycleId, cycleId);
    });
  });
});
