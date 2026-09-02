import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert";
import {
  routeCouncilDecision,
  requiresCouncilApproval,
  createExecutionCandidatePayload,
  mapCouncilEventIdentity,
} from "../apps/server/src/council/CouncilDecisionRouter.ts";

NodeTest.describe("Pure Council module imports", () => {
  NodeTest.it("imports CouncilDecisionRouter without dependencies", () => {
    NodeAssert.default.ok(routeCouncilDecision);
    NodeAssert.default.ok(requiresCouncilApproval);
    NodeAssert.default.ok(createExecutionCandidatePayload);
    NodeAssert.default.ok(mapCouncilEventIdentity);
  });

  NodeTest.it("functions are callable", () => {
    const decision = {
      cycleId: "test",
      decision: "EXECUTE" as const,
      reasoning: "test",
      requiresApproval: false,
    };

    const route = routeCouncilDecision(decision);
    NodeAssert.default.ok(route);
    NodeAssert.default.strictEqual(route.type, "EXECUTE");
  });
});
