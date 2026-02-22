import type {
  ActionExecutionResult,
  AgentActionInput,
  GhostTabCdpClient,
  InteractiveElementIndexResult
} from "../cdp/client.js";
import { encodeNormalizedAXTreeForNavigator } from "../ax-tree/toon-runtime.js";
import type {
  NavigatorActionDecision,
  NavigatorEngine,
  NavigatorEscalationReason,
  NavigatorInferenceTier
} from "../navigator/engine.js";

const DEFAULT_MAX_STEPS = 20;
const DEFAULT_HISTORY_WINDOW = 5;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;
const DEFAULT_AX_DEFICIENT_INTERACTIVE_THRESHOLD = 5;
const DEFAULT_SCROLL_STEP_PX = 800;
const DEFAULT_MAX_SCROLL_STEPS = 8;
const DEFAULT_MAX_NO_PROGRESS_STEPS = 6;
const ESTIMATED_TIER1_CALL_COST_USD = 0.00015;
const ESTIMATED_TIER2_CALL_COST_USD = 0.003;

export type LoopState = "LOADING" | "PERCEIVING" | "INFERRING" | "ACTING" | "COMPLETE" | "FAILED";
export type ResolvedPerceptionTier = NavigatorInferenceTier | "TIER_3_SCROLL";
type EscalationTargetTier = NavigatorInferenceTier | "TIER_3_SCROLL";

export interface PerceptionActionTaskInput {
  intent: string;
  startUrl: string;
  maxSteps?: number;
  confidenceThreshold?: number;
  axDeficientInteractiveThreshold?: number;
  scrollStepPx?: number;
  maxScrollSteps?: number;
  maxNoProgressSteps?: number;
}

export interface LoopStepRecord {
  step: number;
  urlAtPerception: string;
  urlAfterAction: string;
  state: LoopState;
  currentUrl: string;
  inferredAction: NavigatorActionDecision | null;
  action: NavigatorActionDecision | null;
  execution: ActionExecutionResult | null;
  tiersAttempted: NavigatorInferenceTier[];
  resolvedTier: ResolvedPerceptionTier;
  escalationReason: NavigatorEscalationReason | null;
  axDeficientDetected: boolean;
  scrollCount: number;
  noProgressStreak: number;
  interactiveElementCount: number;
  normalizedNodeCount: number;
  normalizedCharCount: number;
  navigatorNormalizedTreeCharCount: number;
  navigatorObservationCharCount: number;
  usedToonEncoding: boolean;
  timestamp: string;
}

export interface EscalationEvent {
  step: number;
  reason: NavigatorEscalationReason;
  fromTier: NavigatorInferenceTier;
  toTier: EscalationTargetTier;
  urlAtEscalation: string;
  triggerConfidence: number | null;
  confidenceThreshold: number;
  resolvedTier: ResolvedPerceptionTier;
  resolvedConfidence: number | null;
  timestamp: string;
}

export interface TierUsageMetrics {
  tier1Calls: number;
  tier2Calls: number;
  tier3Scrolls: number;
  axDeficientDetections: number;
  lowConfidenceEscalations: number;
  noProgressEscalations: number;
  unsafeActionEscalations: number;
  resolvedAtTier1: number;
  resolvedAtTier2: number;
  estimatedCostUsd: number;
}

export interface PerceptionActionTaskResult {
  status: "DONE" | "FAILED" | "MAX_STEPS";
  intent: string;
  startUrl: string;
  finalUrl: string;
  stepsTaken: number;
  history: LoopStepRecord[];
  escalations: EscalationEvent[];
  tierUsage: TierUsageMetrics;
  finalAction: NavigatorActionDecision | null;
  finalExecution: ActionExecutionResult | null;
}

export interface PerceptionActionLoopOptions {
  cdpClient: GhostTabCdpClient;
  navigatorEngine: NavigatorEngine;
  maxSteps?: number;
  confidenceThreshold?: number;
  axDeficientInteractiveThreshold?: number;
  scrollStepPx?: number;
  maxScrollSteps?: number;
  maxNoProgressSteps?: number;
  logger?: (line: string) => void;
}

class PerceptionActionLoop {
  private readonly maxSteps: number;
  private readonly confidenceThreshold: number;
  private readonly axDeficientInteractiveThreshold: number;
  private readonly scrollStepPx: number;
  private readonly maxScrollSteps: number;
  private readonly maxNoProgressSteps: number;
  private readonly logger: (line: string) => void;

  constructor(private readonly options: PerceptionActionLoopOptions) {
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.confidenceThreshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    this.axDeficientInteractiveThreshold =
      options.axDeficientInteractiveThreshold ?? DEFAULT_AX_DEFICIENT_INTERACTIVE_THRESHOLD;
    this.scrollStepPx = options.scrollStepPx ?? DEFAULT_SCROLL_STEP_PX;
    this.maxScrollSteps = options.maxScrollSteps ?? DEFAULT_MAX_SCROLL_STEPS;
    this.maxNoProgressSteps = options.maxNoProgressSteps ?? DEFAULT_MAX_NO_PROGRESS_STEPS;
    this.logger = options.logger ?? ((line: string) => console.info(line));
  }

  async runTask(input: PerceptionActionTaskInput): Promise<PerceptionActionTaskResult> {
    if (!input.intent || !input.intent.trim()) {
      throw new Error("Task intent is required.");
    }

    if (!input.startUrl || !input.startUrl.trim()) {
      throw new Error("Task startUrl is required.");
    }

    const maxSteps = input.maxSteps ?? this.maxSteps;
    const confidenceThreshold = input.confidenceThreshold ?? this.confidenceThreshold;
    const axDeficientInteractiveThreshold =
      input.axDeficientInteractiveThreshold ?? this.axDeficientInteractiveThreshold;
    const scrollStepPx = input.scrollStepPx ?? this.scrollStepPx;
    const maxScrollSteps = input.maxScrollSteps ?? this.maxScrollSteps;
    const maxNoProgressSteps = input.maxNoProgressSteps ?? this.maxNoProgressSteps;

    if (maxSteps <= 0) {
      throw new Error("maxSteps must be greater than zero.");
    }
    if (confidenceThreshold < 0 || confidenceThreshold > 1) {
      throw new Error("confidenceThreshold must be between 0 and 1.");
    }
    if (axDeficientInteractiveThreshold <= 0) {
      throw new Error("axDeficientInteractiveThreshold must be greater than zero.");
    }
    if (scrollStepPx <= 0) {
      throw new Error("scrollStepPx must be greater than zero.");
    }
    if (maxScrollSteps < 0) {
      throw new Error("maxScrollSteps must be zero or greater.");
    }
    if (maxNoProgressSteps <= 0) {
      throw new Error("maxNoProgressSteps must be greater than zero.");
    }

    const history: LoopStepRecord[] = [];
    const escalations: EscalationEvent[] = [];
    const previousActions: NavigatorActionDecision[] = [];
    const previousObservations: string[] = [];
    const tierUsage = createInitialTierUsageMetrics();
    let scrollCount = 0;
    let noProgressStreak = 0;

    this.logger(`[loop] state=LOADING intent="${input.intent}" startUrl=${input.startUrl}`);
    await this.options.cdpClient.navigate(input.startUrl);

    let currentUrl = await this.options.cdpClient.getCurrentUrl();
    let finalAction: NavigatorActionDecision | null = null;
    let finalExecution: ActionExecutionResult | null = null;

    for (let step = 1; step <= maxSteps; step += 1) {
      const urlAtPerception = currentUrl;
      this.logger(`[loop][step ${step}] state=PERCEIVING url=${urlAtPerception}`);
      const indexResult = await this.options.cdpClient.extractInteractiveElementIndex({
        includeBoundingBoxes: true,
        charBudget: 8_000
      });
      const treeEncoding = await encodeNormalizedAXTreeForNavigator(indexResult.normalizedAXTree.nodes);
      const observation = {
        currentUrl: urlAtPerception,
        interactiveElementIndex: indexResult.elements,
        normalizedAXTree: treeEncoding.payload,
        previousActions: previousActions.slice(-DEFAULT_HISTORY_WINDOW),
        previousObservations: previousObservations.slice(-DEFAULT_HISTORY_WINDOW)
      };
      const tier1ObservationCharCount = JSON.stringify(observation).length;
      const tiersAttempted: NavigatorInferenceTier[] = [];
      const axDeficientDetected = indexResult.elementCount < axDeficientInteractiveThreshold;
      const shouldBypassTier1ForNoProgress = noProgressStreak > 0 && !axDeficientDetected;
      let escalationReason: NavigatorEscalationReason | null = null;
      let inferredAction: NavigatorActionDecision | null = null;
      let tier2ObservationCharCount = 0;
      let resolvedTier: ResolvedPerceptionTier = "TIER_1_AX";
      let tier2EscalationEvent: EscalationEvent | null = null;

      if (shouldBypassTier1ForNoProgress) {
        escalationReason = "NO_PROGRESS";
        tierUsage.noProgressEscalations += 1;
        tier2EscalationEvent = createEscalationEvent({
          step,
          reason: escalationReason,
          fromTier: "TIER_1_AX",
          toTier: "TIER_2_VISION",
          urlAtEscalation: urlAtPerception,
          triggerConfidence: null,
          confidenceThreshold,
          resolvedTier: "TIER_2_VISION",
          resolvedConfidence: null
        });
        escalations.push(tier2EscalationEvent);
        this.logger(
          `[loop][step ${step}] escalation=NO_PROGRESS streak=${noProgressStreak} url=${urlAtPerception}`
        );
      } else if (!axDeficientDetected) {
        tiersAttempted.push("TIER_1_AX");
        tierUsage.tier1Calls += 1;
        this.logger(
          `[loop][step ${step}] state=INFERRING tier=TIER_1_AX url=${urlAtPerception} elements=${indexResult.elementCount} normalizedChars=${indexResult.normalizedCharCount} navigatorTreeChars=${treeEncoding.encodedCharCount} observationChars=${tier1ObservationCharCount} toon=${treeEncoding.usedToonEncoding}`
        );
        const tier1Action = await this.options.navigatorEngine.decideNextAction({
          intent: input.intent,
          observation,
          tier: "TIER_1_AX"
        });
        const isUnsafeTier1Action = tier1Action.action === "FAILED";

        if (!isUnsafeTier1Action && tier1Action.confidence >= confidenceThreshold) {
          inferredAction = tier1Action;
          resolvedTier = "TIER_1_AX";
          tierUsage.resolvedAtTier1 += 1;
        } else {
          escalationReason = isUnsafeTier1Action ? "UNSAFE_ACTION" : "LOW_CONFIDENCE";
          if (escalationReason === "LOW_CONFIDENCE") {
            tierUsage.lowConfidenceEscalations += 1;
          } else {
            tierUsage.unsafeActionEscalations += 1;
          }
          tier2EscalationEvent = createEscalationEvent({
            step,
            reason: escalationReason,
            fromTier: "TIER_1_AX",
            toTier: "TIER_2_VISION",
            urlAtEscalation: urlAtPerception,
            triggerConfidence: tier1Action.confidence,
            confidenceThreshold,
            resolvedTier: "TIER_2_VISION",
            resolvedConfidence: null
          });
          escalations.push(tier2EscalationEvent);
          this.logger(
            `[loop][step ${step}] escalation=${escalationReason} threshold=${confidenceThreshold.toFixed(2)} confidence=${tier1Action.confidence.toFixed(2)} action=${tier1Action.action} url=${urlAtPerception}`
          );
        }
      } else {
        escalationReason = "AX_DEFICIENT";
        tierUsage.axDeficientDetections += 1;
        tier2EscalationEvent = createEscalationEvent({
          step,
          reason: escalationReason,
          fromTier: "TIER_1_AX",
          toTier: "TIER_2_VISION",
          urlAtEscalation: urlAtPerception,
          triggerConfidence: null,
          confidenceThreshold,
          resolvedTier: "TIER_2_VISION",
          resolvedConfidence: null
        });
        escalations.push(tier2EscalationEvent);
        this.logger(
          `[loop][step ${step}] escalation=AX_DEFICIENT elements=${indexResult.elementCount} threshold=${axDeficientInteractiveThreshold} url=${urlAtPerception}`
        );
      }

      if (!inferredAction) {
        tiersAttempted.push("TIER_2_VISION");
        tierUsage.tier2Calls += 1;

        const screenshot = await this.options.cdpClient.captureScreenshot({
          mode: "viewport"
        });
        const tier2Observation = {
          ...observation,
          screenshot: {
            base64: screenshot.base64,
            mimeType: screenshot.mimeType,
            width: screenshot.width,
            height: screenshot.height,
            mode: screenshot.mode
          }
        };
        tier2ObservationCharCount = JSON.stringify({
          ...observation,
          screenshot: {
            mimeType: screenshot.mimeType,
            width: screenshot.width,
            height: screenshot.height,
            mode: screenshot.mode
          }
        }).length;

        this.logger(
          `[loop][step ${step}] state=INFERRING tier=TIER_2_VISION url=${urlAtPerception} observationChars=${tier2ObservationCharCount} reason=${escalationReason ?? "NONE"}`
        );
        inferredAction = await this.options.navigatorEngine.decideNextAction({
          intent: input.intent,
          observation: tier2Observation,
          tier: "TIER_2_VISION",
          escalationReason
        });
        resolvedTier = "TIER_2_VISION";
        if (tier2EscalationEvent) {
          tier2EscalationEvent.resolvedTier = "TIER_2_VISION";
          tier2EscalationEvent.resolvedConfidence = inferredAction.confidence;
        }
      }

      if (!inferredAction) {
        throw new Error("Navigator produced no action decision.");
      }

      let actionToExecute = inferredAction;
      if (
        resolvedTier === "TIER_2_VISION" &&
        shouldTriggerTier3Scroll({
          action: inferredAction,
          confidenceThreshold,
          noProgressStreak,
          escalationReason
        })
      ) {
        const tier3Escalation: EscalationEvent = createEscalationEvent({
          step,
          reason: "RETRY_AFTER_SCROLL",
          fromTier: "TIER_2_VISION",
          toTier: "TIER_3_SCROLL",
          urlAtEscalation: urlAtPerception,
          triggerConfidence: inferredAction.confidence,
          confidenceThreshold,
          resolvedTier: "TIER_3_SCROLL",
          resolvedConfidence: inferredAction.confidence
        });
        escalations.push(tier3Escalation);

        if (scrollCount >= maxScrollSteps) {
          escalationReason = "RETRY_AFTER_SCROLL";
          tier3Escalation.resolvedTier = "TIER_2_VISION";
          actionToExecute = {
            action: "FAILED",
            target: null,
            text: `Tiered perception aborted after ${maxScrollSteps} scroll steps at ${urlAtPerception}.`,
            confidence: inferredAction.confidence,
            reasoning: "Tier 2 still could not locate a reliable target after maximum scroll retries."
          };
          this.logger(
            `[loop][step ${step}] state=FAILED reason=MAX_SCROLL_STEPS_REACHED scrollCount=${scrollCount} max=${maxScrollSteps} url=${urlAtPerception}`
          );
        } else {
          escalationReason = "RETRY_AFTER_SCROLL";
          scrollCount += 1;
          tierUsage.tier3Scrolls += 1;
          resolvedTier = "TIER_3_SCROLL";
          actionToExecute = {
            action: "SCROLL",
            target: inferredAction.target,
            text: String(scrollStepPx),
            confidence: inferredAction.confidence,
            reasoning:
              "Tier 3 fallback: scroll viewport and restart perception from Tier 1 at the next position."
          };
          this.logger(
            `[loop][step ${step}] state=ACTING tier=TIER_3_SCROLL action=SCROLL px=${scrollStepPx} scrollCount=${scrollCount}/${maxScrollSteps} url=${urlAtPerception}`
          );
        }
      } else if (resolvedTier === "TIER_2_VISION") {
        tierUsage.resolvedAtTier2 += 1;
      }

      finalAction = actionToExecute;
      const observationCharCount = Math.max(tier1ObservationCharCount, tier2ObservationCharCount);
      assertTier1ConfidencePolicy({
        step,
        url: urlAtPerception,
        resolvedTier,
        action: actionToExecute,
        confidenceThreshold
      });

      this.logger(
        `[loop][step ${step}] state=ACTING tier=${resolvedTier} action=${actionToExecute.action} confidence=${actionToExecute.confidence.toFixed(2)} url=${urlAtPerception}`
      );
      const execution = await this.options.cdpClient.executeAction(this.toAgentAction(actionToExecute));
      finalExecution = execution;
      currentUrl = execution.currentUrl;
      noProgressStreak = isNoProgressStep({
        urlAtPerception,
        urlAfterAction: currentUrl,
        execution
      })
        ? noProgressStreak + 1
        : 0;

      history.push(
        createStepRecord({
          step,
          urlAtPerception,
          urlAfterAction: currentUrl,
          state: execution.status === "failed" ? "FAILED" : "ACTING",
          currentUrl,
          inferredAction,
          action: actionToExecute,
          execution,
          tiersAttempted,
          resolvedTier,
          escalationReason,
          axDeficientDetected,
          scrollCount,
          noProgressStreak,
          indexResult,
          navigatorNormalizedTreeCharCount: treeEncoding.encodedCharCount,
          navigatorObservationCharCount: observationCharCount,
          usedToonEncoding: treeEncoding.usedToonEncoding
        })
      );

      previousActions.push(actionToExecute);
      previousObservations.push(
        `step=${step} tier=${resolvedTier} action=${actionToExecute.action} confidence=${actionToExecute.confidence.toFixed(2)} nav=${execution.navigationObserved} dom=${execution.domMutationObserved} url=${currentUrl}`
      );

      if (actionToExecute.action === "DONE" || execution.status === "done") {
        this.logger(`[loop] state=COMPLETE status=DONE steps=${step} finalUrl=${currentUrl}`);
        return {
          status: "DONE",
          intent: input.intent,
          startUrl: input.startUrl,
          finalUrl: currentUrl,
          stepsTaken: step,
          history,
          escalations,
          tierUsage: finalizeTierUsageMetrics(tierUsage),
          finalAction: actionToExecute,
          finalExecution: execution
        };
      }

      if (actionToExecute.action === "FAILED" || execution.status === "failed") {
        this.logger(`[loop] state=FAILED status=FAILED steps=${step} finalUrl=${currentUrl}`);
        return {
          status: "FAILED",
          intent: input.intent,
          startUrl: input.startUrl,
          finalUrl: currentUrl,
          stepsTaken: step,
          history,
          escalations,
          tierUsage: finalizeTierUsageMetrics(tierUsage),
          finalAction: actionToExecute,
          finalExecution: execution
        };
      }

      if (noProgressStreak >= maxNoProgressSteps) {
        const loopGuardFailure: NavigatorActionDecision = {
          action: "FAILED",
          target: null,
          text: `Aborted after ${noProgressStreak} no-progress steps at ${currentUrl}.`,
          confidence: actionToExecute.confidence,
          reasoning:
            "Loop guard triggered because actions produced no navigation, DOM mutation, or URL change."
        };
        finalAction = loopGuardFailure;
        this.logger(
          `[loop] state=FAILED reason=NO_PROGRESS_LOOP steps=${step} streak=${noProgressStreak}/${maxNoProgressSteps} finalUrl=${currentUrl}`
        );
        return {
          status: "FAILED",
          intent: input.intent,
          startUrl: input.startUrl,
          finalUrl: currentUrl,
          stepsTaken: step,
          history,
          escalations,
          tierUsage: finalizeTierUsageMetrics(tierUsage),
          finalAction: loopGuardFailure,
          finalExecution: execution
        };
      }
    }

    this.logger(`[loop] state=FAILED status=MAX_STEPS steps=${maxSteps} finalUrl=${currentUrl}`);
    return {
      status: "MAX_STEPS",
      intent: input.intent,
      startUrl: input.startUrl,
      finalUrl: currentUrl,
      stepsTaken: maxSteps,
      history,
      escalations,
      tierUsage: finalizeTierUsageMetrics(tierUsage),
      finalAction,
      finalExecution
    };
  }

  private toAgentAction(action: NavigatorActionDecision): AgentActionInput {
    return {
      action: action.action,
      target: action.target,
      text: action.text,
      confidence: action.confidence,
      reasoning: action.reasoning
    };
  }
}

function createStepRecord(input: {
  step: number;
  urlAtPerception: string;
  urlAfterAction: string;
  state: LoopState;
  currentUrl: string;
  inferredAction: NavigatorActionDecision | null;
  action: NavigatorActionDecision | null;
  execution: ActionExecutionResult | null;
  tiersAttempted: NavigatorInferenceTier[];
  resolvedTier: ResolvedPerceptionTier;
  escalationReason: NavigatorEscalationReason | null;
  axDeficientDetected: boolean;
  scrollCount: number;
  noProgressStreak: number;
  indexResult: InteractiveElementIndexResult;
  navigatorNormalizedTreeCharCount: number;
  navigatorObservationCharCount: number;
  usedToonEncoding: boolean;
}): LoopStepRecord {
  return {
    step: input.step,
    urlAtPerception: input.urlAtPerception,
    urlAfterAction: input.urlAfterAction,
    state: input.state,
    currentUrl: input.currentUrl,
    inferredAction: input.inferredAction,
    action: input.action,
    execution: input.execution,
    tiersAttempted: input.tiersAttempted,
    resolvedTier: input.resolvedTier,
    escalationReason: input.escalationReason,
    axDeficientDetected: input.axDeficientDetected,
    scrollCount: input.scrollCount,
    noProgressStreak: input.noProgressStreak,
    interactiveElementCount: input.indexResult.elementCount,
    normalizedNodeCount: input.indexResult.normalizedNodeCount,
    normalizedCharCount: input.indexResult.normalizedCharCount,
    navigatorNormalizedTreeCharCount: input.navigatorNormalizedTreeCharCount,
    navigatorObservationCharCount: input.navigatorObservationCharCount,
    usedToonEncoding: input.usedToonEncoding,
    timestamp: new Date().toISOString()
  };
}

function shouldTriggerTier3Scroll(input: {
  action: NavigatorActionDecision;
  confidenceThreshold: number;
  noProgressStreak: number;
  escalationReason: NavigatorEscalationReason | null;
}): boolean {
  if (input.action.action === "SCROLL" || input.action.action === "FAILED") {
    return true;
  }

  if (input.action.confidence < input.confidenceThreshold) {
    return true;
  }

  // If Tier 2 keeps returning confident clicks but the page is stagnant, force Tier 3 exploration.
  if (input.escalationReason === "NO_PROGRESS" && input.noProgressStreak >= 2) {
    return true;
  }

  return false;
}

function createInitialTierUsageMetrics(): TierUsageMetrics {
  return {
    tier1Calls: 0,
    tier2Calls: 0,
    tier3Scrolls: 0,
    axDeficientDetections: 0,
    lowConfidenceEscalations: 0,
    noProgressEscalations: 0,
    unsafeActionEscalations: 0,
    resolvedAtTier1: 0,
    resolvedAtTier2: 0,
    estimatedCostUsd: 0
  };
}

function createEscalationEvent(input: {
  step: number;
  reason: NavigatorEscalationReason;
  fromTier: NavigatorInferenceTier;
  toTier: EscalationTargetTier;
  urlAtEscalation: string;
  triggerConfidence: number | null;
  confidenceThreshold: number;
  resolvedTier: ResolvedPerceptionTier;
  resolvedConfidence: number | null;
}): EscalationEvent {
  return {
    step: input.step,
    reason: input.reason,
    fromTier: input.fromTier,
    toTier: input.toTier,
    urlAtEscalation: input.urlAtEscalation,
    triggerConfidence: input.triggerConfidence,
    confidenceThreshold: input.confidenceThreshold,
    resolvedTier: input.resolvedTier,
    resolvedConfidence: input.resolvedConfidence,
    timestamp: new Date().toISOString()
  };
}

function isNoProgressStep(input: {
  urlAtPerception: string;
  urlAfterAction: string;
  execution: ActionExecutionResult;
}): boolean {
  if (input.execution.status !== "acted") {
    return false;
  }
  if (input.execution.navigationObserved || input.execution.domMutationObserved) {
    return false;
  }
  return input.urlAfterAction === input.urlAtPerception;
}

function assertTier1ConfidencePolicy(input: {
  step: number;
  url: string;
  resolvedTier: ResolvedPerceptionTier;
  action: NavigatorActionDecision;
  confidenceThreshold: number;
}): void {
  if (input.resolvedTier !== "TIER_1_AX") {
    return;
  }

  if (input.action.confidence >= input.confidenceThreshold) {
    return;
  }

  throw new Error(
    `[loop][step ${input.step}] Policy violation: refusing Tier 1 action below confidence threshold (${input.action.confidence.toFixed(2)} < ${input.confidenceThreshold.toFixed(2)}) at ${input.url}`
  );
}

function finalizeTierUsageMetrics(metrics: TierUsageMetrics): TierUsageMetrics {
  return {
    ...metrics,
    estimatedCostUsd: round6(
      metrics.tier1Calls * ESTIMATED_TIER1_CALL_COST_USD +
        metrics.tier2Calls * ESTIMATED_TIER2_CALL_COST_USD
    )
  };
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function createPerceptionActionLoop(options: PerceptionActionLoopOptions): PerceptionActionLoop {
  return new PerceptionActionLoop(options);
}
