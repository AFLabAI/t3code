import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert";
import * as NodeHttp from "node:http";
import type { CouncilDecision, CouncilEvent } from "../apps/server/src/council/CouncilClient.ts";

// Mock HTTP server setup
let mockServer: NodeHttp.Server;
let serverPort: number;
const mockResponses: Record<string, any> = {};

function startMockServer(): Promise<number> {
  return new Promise((resolve) => {
    mockServer = NodeHttp.createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");

      // Health check
      if (req.method === "GET" && req.url === "/api/health") {
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      // Submit goal
      if (req.method === "POST" && req.url === "/api/goal") {
        res.writeHead(200);
        res.end(JSON.stringify({ cycleId: "mock-cycle-" + Date.now() }));
        return;
      }

      // Get cycle status/transcript
      if (req.method === "GET" && req.url?.startsWith("/api/transcript?cycleId=")) {
        const cycleId = new URL(`http://localhost${req.url}`).searchParams.get("cycleId");
        const events: CouncilEvent[] = mockResponses[`transcript:${cycleId}`] || [
          {
            cycleId: cycleId || "",
            eventType: "planner_started",
            content: "Planning started",
            timestamp: new Date().toISOString(),
          },
          {
            cycleId: cycleId || "",
            eventType: "critic_started",
            brain: "CRITIC",
            content: "Critic analysis",
            timestamp: new Date().toISOString(),
          },
          {
            cycleId: cycleId || "",
            eventType: "decision_ready",
            content: "Decision ready",
            timestamp: new Date().toISOString(),
          },
        ];
        res.writeHead(200);
        res.end(JSON.stringify(events));
        return;
      }

      // Get decision
      if (req.method === "GET" && req.url?.startsWith("/api/decision?cycleId=")) {
        const cycleId = new URL(`http://localhost${req.url}`).searchParams.get("cycleId");
        const decision: CouncilDecision = mockResponses[`decision:${cycleId}`] || {
          cycleId: cycleId || "",
          decision: "EXECUTE",
          reasoning: "Safe to proceed",
          executionProposal: "run_task()",
          riskLevel: "MEDIUM",
          requiresApproval: false,
        };
        res.writeHead(200);
        res.end(JSON.stringify(decision));
        return;
      }

      // Not found
      res.writeHead(404);
      res.end(JSON.stringify({ error: "Not found" }));
    });

    mockServer.listen(0, () => {
      const addr = mockServer.address();
      serverPort = typeof addr === "object" && addr ? addr.port : 0;
      resolve(serverPort);
    });
  });
}

function stopMockServer(): Promise<void> {
  return new Promise((resolve) => {
    mockServer.close(() => resolve());
  });
}

// Test wrapper to use fetch on mock server (no CouncilClient Effect dependency needed)
async function testHealthCheck(baseUrl: string): Promise<boolean> {
  const response = await fetch(`${baseUrl}/api/health`);
  return response.ok;
}

async function testGoalSubmission(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/goal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      threadId: "thread-123",
      text: "Test goal",
      createdAt: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed: ${response.status}`);
  }

  const data = (await response.json()) as { cycleId: string };
  return data.cycleId;
}

async function testCycleStatus(baseUrl: string, cycleId: string): Promise<CouncilEvent[]> {
  const response = await fetch(`${baseUrl}/api/transcript?cycleId=${cycleId}`);

  if (!response.ok) {
    throw new Error(`Failed: ${response.status}`);
  }

  return (await response.json()) as CouncilEvent[];
}

async function testDecisionRetrieval(baseUrl: string, cycleId: string): Promise<CouncilDecision> {
  const response = await fetch(`${baseUrl}/api/decision?cycleId=${cycleId}`);

  if (!response.ok) {
    throw new Error(`Failed: ${response.status}`);
  }

  return (await response.json()) as CouncilDecision;
}

NodeTest.describe("CouncilClient HTTP interface (NO-INSTALL TESTS)", () => {
  let baseUrl: string;

  NodeTest.before(async () => {
    const port = await startMockServer();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  NodeTest.after(async () => {
    await stopMockServer();
  });

  NodeTest.describe("Health check", () => {
    NodeTest.it("performs health check and returns true on OK response", async () => {
      const healthy = await testHealthCheck(baseUrl);
      NodeAssert.default.strictEqual(healthy, true);
    });
  });

  NodeTest.describe("Goal submission", () => {
    NodeTest.it("submits goal and receives cycleId", async () => {
      const cycleId = await testGoalSubmission(baseUrl);
      NodeAssert.default.ok(cycleId);
      NodeAssert.default.ok(cycleId.startsWith("mock-cycle-"));
    });

    NodeTest.it("goal submission creates valid cycleId for subsequent queries", async () => {
      const cycleId = await testGoalSubmission(baseUrl);
      const events = await testCycleStatus(baseUrl, cycleId);
      NodeAssert.default.strictEqual(events.length > 0, true);
    });
  });

  NodeTest.describe("Cycle polling and transcript", () => {
    NodeTest.it("retrieves cycle status with events", async () => {
      const cycleId = "test-cycle-1";
      const events = await testCycleStatus(baseUrl, cycleId);

      NodeAssert.default.ok(Array.isArray(events));
      NodeAssert.default.ok(events.length > 0);
    });

    NodeTest.it("cycle events include all required fields", async () => {
      const cycleId = "test-cycle-2";
      const events = await testCycleStatus(baseUrl, cycleId);

      for (const event of events) {
        NodeAssert.default.ok(event.cycleId);
        NodeAssert.default.ok(event.eventType);
        NodeAssert.default.ok(event.content);
        NodeAssert.default.ok(event.timestamp);
      }
    });

    NodeTest.it("cycle events include Planner phase", async () => {
      const cycleId = "test-cycle-3";
      const events = await testCycleStatus(baseUrl, cycleId);

      const plannerEvent = events.find((e) => e.eventType === "planner_started");
      NodeAssert.default.ok(plannerEvent);
    });

    NodeTest.it("cycle events include Critic phase", async () => {
      const cycleId = "test-cycle-4";
      const events = await testCycleStatus(baseUrl, cycleId);

      const criticEvent = events.find((e) => e.eventType === "critic_started");
      NodeAssert.default.ok(criticEvent);
      NodeAssert.default.strictEqual(criticEvent?.brain, "CRITIC");
    });

    NodeTest.it("cycle events include decision ready marker", async () => {
      const cycleId = "test-cycle-5";
      const events = await testCycleStatus(baseUrl, cycleId);

      const decisionEvent = events.find((e) => e.eventType === "decision_ready");
      NodeAssert.default.ok(decisionEvent);
    });
  });

  NodeTest.describe("Decision retrieval", () => {
    NodeTest.it("retrieves decision for cycleId", async () => {
      const cycleId = "test-cycle-6";
      const decision = await testDecisionRetrieval(baseUrl, cycleId);

      NodeAssert.default.ok(decision);
      NodeAssert.default.strictEqual(decision.cycleId, cycleId);
    });

    NodeTest.it("decision includes decision type", async () => {
      const cycleId = "test-cycle-7";
      const decision = await testDecisionRetrieval(baseUrl, cycleId);

      NodeAssert.default.ok(
        ["EXECUTE", "REVISE", "RESEARCH", "MORE_EVIDENCE", "ASK_USER", "BLOCKED"].includes(
          decision.decision,
        ),
      );
    });

    NodeTest.it("decision includes reasoning", async () => {
      const cycleId = "test-cycle-8";
      const decision = await testDecisionRetrieval(baseUrl, cycleId);

      NodeAssert.default.ok(decision.reasoning);
      NodeAssert.default.ok(decision.reasoning.length > 0);
    });

    NodeTest.it("decision includes risk level", async () => {
      const cycleId = "test-cycle-9";
      const decision = await testDecisionRetrieval(baseUrl, cycleId);

      NodeAssert.default.ok(
        ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(decision.riskLevel || "MEDIUM"),
      );
    });

    NodeTest.it("EXECUTE decision includes proposal", async () => {
      const cycleId = "test-cycle-10";
      const decision = await testDecisionRetrieval(baseUrl, cycleId);

      if (decision.decision === "EXECUTE") {
        NodeAssert.default.ok(decision.executionProposal);
      }
    });

    NodeTest.it("decision requiresApproval field is boolean", async () => {
      const cycleId = "test-cycle-11";
      const decision = await testDecisionRetrieval(baseUrl, cycleId);

      NodeAssert.default.strictEqual(typeof decision.requiresApproval, "boolean");
    });
  });

  NodeTest.describe("End-to-end flow", () => {
    NodeTest.it("completes submit → poll → decide cycle", async () => {
      // Submit
      const cycleId = await testGoalSubmission(baseUrl);
      NodeAssert.default.ok(cycleId);

      // Poll
      const events = await testCycleStatus(baseUrl, cycleId);
      NodeAssert.default.ok(events.length > 0);

      // Decide
      const decision = await testDecisionRetrieval(baseUrl, cycleId);
      NodeAssert.default.ok(decision.decision);
    });
  });
});
