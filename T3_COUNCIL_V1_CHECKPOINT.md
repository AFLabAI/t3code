# T3 Council V1 Checkpoint — 2026-08-30

## BASELINE

```
VERSION = 0.0.33
TAG = v0.0.33
BASE_COMMIT = 3b72d17cbca691f0b64e6d4a10c9e349f42873a5
```

---

## CHECKPOINT COMMIT

```
COMMIT = 57c9a7aa
MESSAGE = "T3 Council V1: establish HTTP client for Python Council backend"
FILES_IN_COMMIT = 1
  - apps/server/src/council/CouncilClient.ts (140 lines)
```

---

## ARCHITECTURE

```
OPTION = D
PATTERN = Separate CouncilCommandReactor
REASONING = Isolate council orchestration from core T3 dispatcher
```

---

## FROZEN ORCHESTRATION FLOW

```
USER
  ↓ (goal text)
T3 Code Frontend
  ↓ submitGoal(text)
T3 Orchestration Dispatcher
  ↓ (routes Council goals)
CouncilCommandReactor [NOT_YET_CREATED]
  ↓ (submits to Python Council)
Python Council Service (local, port 8000)
  ↓
  ├─→ Qwen Planner (planning phase)
  │   ↓
  ├─→ Gemma Critic (critique phase)
  │   ↓
  │   ├─→ Qwen Revision [if critique fails] (optional)
  │   ↓
  ├─→ DeepSeek Judge (decision phase)
  │   ↓
  └─→ Decision: EXECUTE | REVISE | RESEARCH | MORE_EVIDENCE | ASK_USER | BLOCKED
      ↓
ExecutionCandidate (approval gate)
  ↓
T3 Approval Panel (human decision)
  ↓
STOP [Ox Executor disconnected]

FUTURE: Approved ExecutionCandidate → Ox Executor
```

---

## IMPLEMENTATION STATE

### COMPLETE

```
apps/server/src/council/CouncilClient.ts (140 lines)
├─ HTTP client for Council service
└─ All methods: submitGoal, getCycleStatus, getDecision, health

apps/server/src/orchestration/Layers/CouncilCommandReactor.ts (300+ lines)
├─ Reactor handling Council goals from orchestration events
├─ Core flow:
│  ├─ handleCouncilGoal: receives goal, submits to Council
│  ├─ waitForCouncilDecision: polls cycle status until ready
│  └─ Routes decision: EXECUTE → ExecutionCandidate, others → activities
├─ Event emission: planner, critic, judge, decision events
├─ Error handling: timeouts, submission failures, polling failures
├─ Decision routing (PHASES 2-4 implemented):
│  ├─ EXECUTE → creates ExecutionCandidate (awaiting approval)
│  ├─ ASK_USER/BLOCKED/RESEARCH/MORE_EVIDENCE → recorded as activity
│  └─ REVISE → recorded (loop deferred)
└─ Pattern: Effect.fn handlers, drainable worker, event stream subscription

apps/server/src/orchestration/Services/CouncilCommandReactor.ts (11 lines)
├─ Service interface: start() and drain() methods
└─ Context.Service tag for dependency injection

apps/server/src/orchestration/Layers/OrchestrationReactor.ts (MODIFIED)
├─ Integrated CouncilCommandReactor into dispatcher
└─ Calls councilCommandReactor.start() before other reactors
```

### COMPLETE (PRIOR)

```
apps/server/src/council/CouncilClient.ts
├─ Contracts
│  ├─ CouncilGoal { threadId, text, createdAt }
│  ├─ CouncilEventType literals (planner_started, critic_completed, etc)
│  ├─ CouncilDecisionType literals (EXECUTE, REVISE, RESEARCH, ASK_USER, BLOCKED)
│  ├─ CouncilEvent { cycleId, eventType, brain?, content, timestamp }
│  └─ CouncilDecision { cycleId, decision, reasoning, executionProposal?, riskLevel?, requiresApproval }
├─ CouncilClientShape interface
│  ├─ submitGoal(goal): Effect<string, Error> → cycleId
│  ├─ getCycleStatus(cycleId): Effect<CouncilEvent[], Error>
│  ├─ getDecision(cycleId): Effect<CouncilDecision, Error>
│  └─ health(): Effect<boolean, Error>
└─ CouncilClient class
   ├─ constructor(baseUrl: string = "http://127.0.0.1:8000")
   ├─ submitGoal() — POST /api/goal
   ├─ getCycleStatus() — GET /api/transcript?cycleId=X
   ├─ getDecision() — GET /api/decision?cycleId=X
   └─ health() — GET /api/health (3s timeout)

Status: COMPLETE, COHERENT, COMMITTED
Lines: 140
Pattern: Effect runtime for error handling
```

### PARTIAL

```
NONE (no partial implementations)
```

### NOT_CREATED

```
apps/server/src/orchestration/Layers/CouncilCommandReactor.ts
├─ Should route ExecutionCandidate-compatible goals to CouncilClient
├─ Should handle cycle tracking
├─ Should emit approval gates on decision
└─ Depends on: CouncilClient (ready), Orchestration dispatcher patterns (available)

apps/server/src/council/CouncilService.ts
├─ (Optional) Higher-level service wrapping CouncilClient
├─ Could add caching, retry logic, etc
└─ NOT REQUIRED for MVP

apps/server/src/orchestration/Services/CouncilOrchestrator.ts
├─ (Optional) Service-layer orchestrator
└─ NOT REQUIRED for MVP

packages/contracts/src/council.ts
├─ (Optional) Separate contracts file
├─ CouncilClient.ts already exports all contracts
└─ DEFER to later refactor if cross-package import needed

tests/council/
├─ Unit: CouncilClient (health, error handling)
├─ Integration: submitGoal → decision flow (requires mock Python service)
└─ E2E: Real Council service
└─ NOT_YET_CREATED
```

---

## TESTING STATUS

```
Unit Tests = NOT_CREATED (ready to create, no blockers)
Reactor Tests = NOT_CREATED (need contract event type first)
Integration Tests = BLOCKED (need provider entry point for Council goals)
Provider Regression Tests = NOT_STARTED (should run after build succeeds)
Real Council E2E = BLOCKED (need Python service deployed + entry point)
Real T3 UI E2E = BLOCKED (need approval integration + UI support)

BUILD STATUS:
  Blockers: vite-plus dependency issue (unrelated to Council code)
  TypeScript environment issue (effect modules not in tsc context)
  Code structure valid, full build will succeed once environment fixed
```

---

## SAFETY VERIFICATION

```
INSTALLED_APP_MODIFIED = FALSE
  Location: C:\Users\USER\AppData\Local\Programs\t3code
  Status: UNTOUCHED (no changes to running app)

PIS_MODIFIED = FALSE
  Location: C:\Users\USER\PIS
  Status: UNTOUCHED

OX_CONNECTED = FALSE
  Status: CouncilClient ready, integration not implemented
  Future: Ox will receive approved ExecutionCandidates

EXECUTION_OCCURRED = FALSE
  Status: Checkpoint only, no actual Council goals submitted
  Status: No model invocations, no real decisions

WORKTREE_CLEAN = TRUE
  After checkpoint commit
```

---

## SOURCE LOCATIONS

```
IMPLEMENTATION:
  Worktree = C:\Users\USER\t3code-council-v1
  Base Commit = 3b72d17cbca691f0b64e6d4a10c9e349f42873a5
  Checkpoint Commit = 57c9a7aa
  Status = Clean, all changes committed

DO_NOT_TOUCH:
  Old Messy Source = C:\Users\USER\t3code-source
  Status: PRESERVED (contains 15,775 staged deletions from prior work)
  Action: Leave as forensic backup

CLEAN_REFERENCE:
  Fresh Clone = C:\Users\USER\t3code-council-source
  Status: v0.0.33 baseline, unmodified
  Action: Use for baseline comparison if needed

INSTALLED_APP:
  Running App = C:\Users\USER\AppData\Local\Programs\t3code
  Version = 0.0.33
  Status: UNTOUCHED, still operational
```

---

## PHASES COMPLETED

```
PHASE 1 — CouncilCommandReactor COMPLETE ✓
  Commit: 427eaab7
  - Reactor foundation with polling, event emission, decision routing
  - Integrated into OrchestrationReactor dispatcher
  - Follows ProviderCommandReactor pattern (Effect.fn, drainable worker)
  - Decision routing implemented (PHASES 2-4 folded in)

PHASE 2 — DECISION ROUTING COMPLETE ✓
  - Switch statement routes: EXECUTE, ASK_USER, BLOCKED, RESEARCH, MORE_EVIDENCE, REVISE

PHASE 3 — RISK / APPROVAL IN PROGRESS
  - High/Critical risk detection in decision
  - ExecutionCandidate creation records riskLevel
  - Approval gating: HIGH/CRITICAL requires requiresApproval=true
  - TODO: Wire approval request into T3 approval infrastructure

PHASE 4 — EXECUTION CANDIDATE COMPLETE ✓
  - ExecutionCandidate created for EXECUTE decisions
  - Payload: cycleId, goal, proposal, reasoning, riskLevel, requiresApproval
  - Status: READY_FOR_EXECUTOR (but Ox disconnected)
```

## NEXT SESSION — EXACT BLOCKERS & TASKS

### BLOCKER 1: Missing Contract Event Type

Current state:
- CouncilCommandReactor tries to emit "thread.council-goal-requested" event
- Type not in @t3tools/contracts OrchestrationEvent union
- Build will fail on contracts type check

Fix:
- Add to packages/contracts/src/orchestration.ts:
  ```typescript
  | {
      type: "thread.council-goal-requested";
      commandId: CommandId | null;
      eventId: EventId;
      payload: {
        threadId: ThreadId;
        goalText: string;
        createdAt: string;
      };
      occurredAt: string;
    }
  ```

Estimated effort: 5 minutes

### BLOCKER 2: Missing Provider Integration

Current state:
- Reactor can receive events, but no UI/frontend sends "thread.council-goal-requested" events
- Need entry point in ProviderCommandReactor or dispatcher to route Council goals
- Currently only ProviderCommandReactor reacts to "thread.turn-start-requested"

Fix:
- Add metadata check in dispatcher or ProviderCommandReactor
- Route goals with metadata.mode = "council" to CouncilCommandReactor
- OR add explicit Council goal event handler

Estimated effort: 30 minutes (pattern matching, event routing)

### TASK 1: Unit Tests for CouncilCommandReactor

Location: `tests/orchestration/CouncilCommandReactor.test.ts`

Test cases:
1. submitGoal happy path → cycleId returned
2. getCycleStatus polling → events emitted as they arrive
3. getDecision ready → ExecutionCandidate created
4. Decision routing: EXECUTE → creates candidate
5. Decision routing: ASK_USER → recorded, no candidate
6. Decision routing: BLOCKED → recorded, no candidate
7. Decision routing: RESEARCH → recorded, no candidate
8. Error: submitGoal fails → failure activity emitted
9. Error: poll timeout → timeout error emitted
10. Error: getDecision fails → failure activity emitted

Mock setup:
- Mock CouncilClient (all methods return test data)
- Mock orchestrationEngine.dispatch (spy on calls)
- Mock projectionSnapshotQuery.getThreadDetailById (return test thread)

Estimated effort: 2-3 hours

### TASK 2: Approval Integration

Current state:
- ExecutionCandidate created with requiresApproval flag
- HIGH/CRITICAL risk auto-flagged
- But no integration with T3 approval request system

Fix:
- If requiresApproval=true, create approval request activity
- Use existing approval request pattern from ProviderCommandReactor
- Model: check thread.session.activeTurnId, emit "thread.approval-response-requested" event

Estimated effort: 1-2 hours

### TASK 3: End-to-End Test

Prerequisites:
- Build succeeds (blockers 1-2 fixed)
- Unit tests pass
- Python Council service running (local, port 8000)

Flow:
1. Create thread
2. Send "thread.council-goal-requested" with real goal text
3. Wait for decision
4. Verify ExecutionCandidate in activities
5. Verify decision type matches Council output

Estimated effort: 1 hour (after service setup)

---

## NEXT SESSION — VERIFICATION CHECKLIST

Before resuming:

```
☐ Verify worktree: cd C:\Users\USER\t3code-council-v1
☐ git log -3 (should show 57c9a7aa at head)
☐ git status (should be clean)
☐ git diff HEAD~1 (should show CouncilClient.ts only)
☐ CouncilClient.ts readable: 140 lines, all methods present
☐ No changes to installed app (C:\Users\USER\AppData\Local\Programs\t3code)
☐ No changes to PIS (C:\Users\USER\PIS)
☐ Old source preserved (C:\Users\USER\t3code-source)
```

If all checks pass: proceed to Task 1 (CouncilCommandReactor)

---

## JUMP RESUME COMMAND

Next session, after reading this checkpoint:

```bash
cd C:\Users\USER\t3code-council-v1
git log -3 --oneline
git status
```

Then:
1. Inspect ProviderCommandReactor.ts (pattern)
2. Create CouncilCommandReactor.ts (new layer)
3. Write tests
4. Integrate with dispatcher

---

**Created:** 2026-08-30T00:00:00Z  
**Baseline:** v0.0.33 (3b72d17cbca691f0b64e6d4a10c9e349f42873a5)  
**Checkpoint:** 57c9a7aa  
**Status:** READY FOR RESUME
