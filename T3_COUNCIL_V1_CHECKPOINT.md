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
Unit Tests = NOT_CREATED
Reactor Tests = NOT_CREATED
Integration Tests = NOT_CREATED
Provider Regression Tests = NOT_STARTED
Real Council E2E = BLOCKED (Council service not deployed)
Real T3 UI E2E = BLOCKED (CouncilCommandReactor not integrated)
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

## NEXT SESSION — EXACT FIRST TASK

### Task 1: CouncilCommandReactor Integration

Create: `apps/server/src/orchestration/Layers/CouncilCommandReactor.ts`

Requirements:
- Pattern: Matches existing ProviderCommandReactor, OrchestrationReactor
- Input: ExecutionCandidate or goal with metadata.type = "council"
- Process:
  1. Validate goal structure
  2. Instantiate CouncilClient
  3. submitGoal() to Python Council
  4. Poll getCycleStatus() until decision_ready
  5. Fetch getDecision()
  6. Emit approval gate with decision + proposal
- Output: ApprovalGate | Error
- Error handling: timeouts, network failures, invalid decisions
- Tests: 5-8 unit tests covering happy path + 3 error cases

Files to inspect first:
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts` (pattern model)
- `apps/server/src/orchestration/Layers/OrchestrationReactor.ts` (dispatcher integration)
- `apps/server/src/council/CouncilClient.ts` (already available)

Estimated effort: 2-3 hours implementation + testing

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
