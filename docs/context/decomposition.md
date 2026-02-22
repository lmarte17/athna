Great — I have everything I need from both the paper and your requirements. Here's an expanded, implementation-focused mapping you can share directly with your coding agents:

---

# Intelligent AI Delegation → Ghost Browser: Decomposition Design Brief

## Context for Coding Agents

Ghost Browser is an intent-first agentic browser. When a user types a natural language command (e.g. _"compare the top 3 standing desks under $500"_), the system must decompose that intent into a verifiable, executable subtask graph and dispatch those subtasks across a pool of headless Ghost Tab agents. The paper "Intelligent AI Delegation" (Tomašev et al., 2026, Google DeepMind) provides a formal framework that maps directly onto this architecture. What follows is a concrete translation of the paper's decomposition approach into Ghost Browser implementation decisions.

---

## 1. Structural Evaluation → Intent Classification at the Command Bar

**Paper concept:** Before decomposing, analyze task attributes — criticality, complexity, and resource constraints — to determine parallel vs. sequential execution.

**Ghost Browser implementation:**

When a user submits an intent, the orchestration layer must first classify it before spawning any Ghost Tabs. This is the entry point for decomposition logic.

```
Intent received → classify:
  - Simple (≤ 2 implied steps): no decomposition, single Ghost Tab
  - Compound (> 2 implied steps): decompose into ordered subtask list
  - Parallel-eligible: subtasks with no data dependency → spawn concurrently
  - Sequential-required: subtasks where step N depends on output of step N-1
```

Your requirements spec already notes that _"for complex intents (> 2 implied steps), the Navigator Engine must decompose the intent into an ordered subtask list before beginning execution."_ The paper gives you the formal basis for that threshold and the attributes to evaluate: don't just count steps, also assess whether subtasks are **independent** (can run in parallel Ghost Tabs) vs. **dependent** (must be serialized).

Concrete example:

- _"Search for mechanical keyboards on Amazon"_ → single subtask, one Ghost Tab, sequential
- _"Compare prices for the Keychron K2 on Amazon, Newegg, and Best Buy"_ → three parallel subtasks, three Ghost Tabs, results aggregated by Maker Engine (not currently implemented, but just an example of how this could work)
- _"Find the cheapest Keychron K2 and add it to my cart"_ → two sequential subtasks (find → add), second cannot start until first returns a URL

---

## 2. Contract-First Decomposition → Subtask Schema Design

**Paper concept:** Delegation is only permitted if the outcome can be precisely verified. If a subtask can't be verified, recursively decompose further until it can.

**Ghost Browser implementation:**

Every subtask object must carry an explicit **verification condition** alongside its goal. If the orchestration layer cannot define what "done" looks like for a subtask, that subtask must be broken down further before it gets dispatched to a Ghost Tab.

Proposed subtask schema:

```typescript
interface GhostSubtask {
  id: string;
  intent: string; // human-readable goal
  url?: string; // starting URL if known
  verification: {
    type:
      | "element_present" // AX tree contains target element
      | "url_matches" // navigation reached expected URL
      | "data_extracted" // result_json is non-empty and schema-valid
      | "action_confirmed" // e.g. cart count incremented
      | "human_review"; // escalate to user — cannot auto-verify
    condition: string; // specific predicate
  };
  execution_mode: "parallel" | "sequential";
  depends_on: string[]; // subtask IDs that must complete first
  assigned_to: "ghost_tab" | "human";
  checkpoint_state?: object; // last known good state for recovery
}
```

The `human_review` verification type is important — it's the paper's "recursive decomposition bottoms out at verifiability" applied to Ghost Browser. If the Navigator Engine produces an action whose success cannot be automatically confirmed (e.g., a checkout form with a CAPTCHA), the subtask must be flagged for human delegation rather than proceeding blindly.

---

## 3. Proposal Generation with Stored Alternatives → Decomposition Planner

**Paper concept:** Generate multiple decomposition proposals, estimate success rate/cost/duration for each, store alternatives in-context for adaptive re-use.

**Ghost Browser implementation:**

Rather than having the Navigator Engine commit to a single decomposition on the first Gemini call, the orchestration layer should request and cache alternatives. This is especially important for the hackathon demo — if a Ghost Tab hits an unexpected page state (login wall, bot detection, changed UI), the orchestration layer can fall back to an alternative plan without restarting from scratch.

Practical approach for the hackathon:

```
Decomposition call to Gemini Flash:
  System prompt instructs model to return:
    - primary_plan: SubtaskList
    - fallback_plan: SubtaskList  (alternative routing)
    - estimated_steps: number
    - confidence: 0.0–1.0

Orchestration layer stores both plans in task context.
On subtask failure: attempt fallback_plan before returning FAILED.
```

This maps to your existing requirements around checkpoint recovery — _"if a subtask fails, the orchestration layer can retry from the last checkpoint rather than restarting the entire task."_ The paper extends this: don't just retry the same plan, try the stored alternative.

---

## 4. Human vs. AI Stratification → Escalation Triggers

**Paper concept:** Decomposition must explicitly decide which nodes require human intervention. Humans and AI operate at different speeds and costs, creating latency/cost asymmetries that must be planned for, not discovered at runtime.

**Ghost Browser implementation:**

The orchestration layer needs a predefined set of **escalation conditions** that automatically route a subtask from Ghost Tab to the user. These should be declared at decomposition time, not discovered when the Ghost Tab fails.

Escalation conditions to implement:

```
Ghost Tab → Human escalation triggers:
  1. Authentication required (login wall detected, no cookie passthrough available)
  2. CAPTCHA or bot challenge detected
  3. Verification type = 'human_review' (set at decomposition time)
  4. Confidence < 0.5 after Tier 2 (Pro + screenshot) attempt
  5. Irreversible action pending (checkout, form submit, delete)
     → always require explicit user confirmation per your existing requirements
  6. Subtask failed after all fallback plans exhausted
```

When a subtask hits an escalation trigger, the task status feed in the foreground UI should surface a specific, actionable prompt — not a generic error. The paper emphasizes that human-AI handoffs introduce latency asymmetries into the execution graph; your UI should reflect this by making the handoff visible and fast to resolve.

---

## 5. Tiered Model Routing as Capability Matching

**Paper concept:** Match sub-tasks to delegatee capabilities. Narrow, specific subtasks match more reliably to specialized agents than generalist requests.

**Ghost Browser implementation:**

Your existing Tier 1 (Flash + AX tree) / Tier 2 (Pro + screenshot) system is already an instance of capability matching, but the paper suggests making it more intentional at decomposition time rather than purely reactive at execution time.

Proposed enhancement: annotate subtasks with a **perception requirement** at decomposition time, so the orchestration layer can pre-route to the right tier rather than always starting at Tier 1:

```typescript
interface GhostSubtask {
  // ... existing fields
  perception_hint:
    | "ax_tree_sufficient" // known structured page (e.g. search results)
    | "visual_required" // known canvas/custom UI page
    | "unknown"; // default: start Tier 1, escalate if needed
}
```

For example, a subtask targeting a well-known e-commerce site's search bar can be pre-annotated as `ax_tree_sufficient`. A subtask targeting a flight booking widget with custom date-pickers should be pre-annotated as `visual_required`, skipping the Tier 1 attempt and saving an unnecessary Flash call plus scroll cycle.

---

## 6. Adaptive Coordination → The Existing State Machine

**Paper concept:** Dynamically re-evaluate the delegation setup when triggers occur (task changes, resource changes, agent failures, verification failures).

**Ghost Browser implementation:**

This maps directly to your state machine (`IDLE → LOADING → PERCEIVING → ACTING → …`). The paper frames the adaptive cycle as: **detect trigger → diagnose root cause → evaluate response scenario → execute**. For Ghost Browser, concretely:

```
Triggers to handle in the state machine:
  External: user cancels task, user modifies intent mid-execution
  Internal:
    - Ghost Tab crashes → reassign subtask from pool
    - Verification fails → try fallback plan, then escalate
    - Confidence below threshold → escalate perception tier
    - Context window approaching limit → trigger summarization
    - Rate limit hit → queue with exponential backoff (Cloud Run proxy)

Response scenarios (in order of preference):
  1. Adjust operating parameters (e.g. switch perception tier)
  2. Re-delegate subtask to a fresh Ghost Tab from pool
  3. Re-run decomposition from current checkpoint
  4. Escalate to human
```

The paper makes a key point about **reversibility governing response scope**: reversible failures (a navigation went to the wrong page) allow automatic re-delegation; irreversible failures (a purchase was submitted) require immediate termination and human notification. Your requirement to always require confirmation before irreversible actions is the right implementation of this principle.

---

## Summary: What to Build for Phase 4.2 Decomposition

Based on the paper's framework mapped to your architecture, here's what the decomposition module needs to do when it lands in Phase 4.2:

1. **Intent classifier** — simple vs. compound, parallel vs. sequential eligibility
2. **Subtask schema** with explicit `verification`, `depends_on`, `assigned_to`, and `perception_hint` fields
3. **Decomposition planner call** to Gemini Flash that returns a primary plan and a fallback plan
4. **Escalation trigger registry** — a predefined list of conditions that route subtasks to human rather than Ghost Tab
5. **Checkpoint store** — persist subtask state so fallback plans can resume from the last verified step, not from scratch
6. **Adaptive re-evaluation hook** in the state machine that consults stored fallback plans before escalating to human

The paper's core insight, restated for Ghost Browser: **a subtask should never be dispatched to a Ghost Tab unless the orchestration layer already knows what "done" looks like and has a plan for what to do if it doesn't get there.**
