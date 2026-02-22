import { createHash } from "node:crypto";

import type {
  AXDeficiencySignals,
  ActionExecutionResult,
  AgentActionInput,
  DomMutationSummary,
  ExtractDomInteractiveElementsResult,
  GhostTabCdpClient,
  InteractiveElementIndexResult,
  NavigationOutcome,
  ScrollPositionSnapshot
} from "../cdp/client.js";
import { encodeNormalizedAXTreeForNavigator } from "../ax-tree/toon-runtime.js";
import type { ToonEncodingResult } from "../ax-tree/toon-runtime.js";
import {
  estimateNavigatorPromptBudget,
  type NavigatorActionDecision,
  type NavigatorActiveSubtask,
  type NavigatorEngine,
  type NavigatorObservationSubtask,
  type NavigatorStructuredError,
  type NavigatorStructuredErrorType,
  type NavigatorEscalationReason,
  type NavigatorInferenceTier
} from "../navigator/engine.js";
import {
  decomposeTaskIntent,
  type TaskDecompositionPlan,
  type TaskDecompositionSubtask,
  type TaskSubtaskStatus,
  type TaskSubtaskVerificationType
} from "../navigator/decomposition.js";
import {
  createNavigatorContextWindowManager,
  type NavigatorContextSnapshot,
  type NavigatorContextWindowMetrics
} from "../navigator/context-window.js";
import {
  createNavigatorObservationCacheManager,
  createObservationDecisionCacheKey,
  DEFAULT_NAVIGATOR_OBSERVATION_CACHE_TTL_MS,
  type NavigatorObservationCacheMetrics
} from "../navigator/observation-cache.js";
import {
  createGhostTabTaskErrorDetail,
  createGhostTabTaskStateMachine,
  type GhostTabStateTransitionEvent,
  type GhostTabTaskErrorDetail,
  type GhostTabTaskState,
  type GhostTabTaskStateMachine
} from "../task/state-machine.js";

const DEFAULT_MAX_STEPS = 20;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;
const DEFAULT_AX_DEFICIENT_INTERACTIVE_THRESHOLD = 5;
const DEFAULT_SCROLL_STEP_PX = 800;
const DEFAULT_MAX_SCROLL_STEPS = 8;
const DEFAULT_MAX_NO_PROGRESS_STEPS = 6;
const DEFAULT_MAX_SUBTASK_RETRIES = 2;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
const DEFAULT_OBSERVATION_CACHE_TTL_MS = DEFAULT_NAVIGATOR_OBSERVATION_CACHE_TTL_MS;
const DEFAULT_BELOW_FOLD_MARGIN_RATIO = 0.11;
const ESTIMATED_TIER1_CALL_COST_USD = 0.00015;
const ESTIMATED_TIER2_CALL_COST_USD = 0.003;
const DOM_BYPASS_MIN_SCORE = 2;
const DOM_BYPASS_MIN_SCORE_GAP = 1;
const INTENT_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "from",
  "if",
  "in",
  "into",
  "is",
  "of",
  "on",
  "or",
  "please",
  "the",
  "to",
  "with"
]);

export type LoopState = Exclude<GhostTabTaskState, "IDLE">;
export type ResolvedPerceptionTier = NavigatorInferenceTier | "TIER_3_SCROLL";
type EscalationTargetTier = NavigatorInferenceTier | "TIER_3_SCROLL";
type AXTreeRefetchReason =
  | "INITIAL"
  | "URL_CHANGED"
  | "NAVIGATION"
  | "SIGNIFICANT_DOM_MUTATION"
  | "SCROLL_ACTION"
  | "NONE";

export interface PerceptionActionTaskInput {
  intent: string;
  startUrl: string;
  taskId?: string;
  contextId?: string;
  maxSteps?: number;
  confidenceThreshold?: number;
  axDeficientInteractiveThreshold?: number;
  scrollStepPx?: number;
  maxScrollSteps?: number;
  maxNoProgressSteps?: number;
  maxSubtaskRetries?: number;
  navigationTimeoutMs?: number;
  observationCacheTtlMs?: number;
}

export interface TaskCheckpointArtifact {
  subtaskId: string;
  step: number;
  completionUrl: string;
  resolvedTier: ResolvedPerceptionTier;
  action: NavigatorActionDecision["action"];
  timestamp: string;
}

export interface TaskCheckpointState {
  lastCompletedSubtaskIndex: number;
  currentSubtaskAttempt: number;
  subtaskArtifacts: TaskCheckpointArtifact[];
}

export interface RuntimeTaskSubtask extends TaskDecompositionSubtask {
  attemptCount: number;
  completedStep: number | null;
  failedStep: number | null;
  lastUpdatedAt: string;
}

export interface SubtaskStatusEvent {
  taskId: string;
  contextId: string | null;
  subtaskId: string;
  subtaskIntent: string;
  status: TaskSubtaskStatus;
  verificationType: TaskSubtaskVerificationType;
  verificationCondition: string;
  currentSubtaskIndex: number;
  totalSubtasks: number;
  attempt: number;
  checkpointLastCompletedSubtaskIndex: number;
  reason: string;
  timestamp: string;
}

export interface StructuredErrorEvent {
  taskId: string;
  contextId: string | null;
  step: number;
  source: "NAVIGATION" | "PERCEPTION" | "ACTION" | "UNHANDLED_EXCEPTION";
  reason: string;
  error: NavigatorStructuredError;
  navigatorDecision: NavigatorActionDecision | null;
  decisionSource: "NAVIGATOR" | "POLICY_FALLBACK";
  timestamp: string;
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
  axDeficiencySignals: AXDeficiencySignals;
  axTreeRefetched: boolean;
  axTreeRefetchReason: AXTreeRefetchReason;
  scrollPosition: ScrollPositionSnapshot;
  targetMightBeBelowFold: boolean;
  scrollCount: number;
  noProgressStreak: number;
  postActionSignificantDomMutationObserved: boolean;
  postActionMutationSummary: DomMutationSummary | null;
  domExtractionAttempted: boolean;
  domExtractionElementCount: number;
  domBypassUsed: boolean;
  domBypassMatchedText: string | null;
  interactiveElementCount: number;
  normalizedNodeCount: number;
  normalizedCharCount: number;
  navigatorNormalizedTreeCharCount: number;
  navigatorObservationCharCount: number;
  tier1PromptCharCount: number;
  tier1EstimatedPromptTokens: number;
  tier2PromptCharCount: number;
  tier2EstimatedPromptTokens: number;
  decompositionUsed: boolean;
  decompositionImpliedStepCount: number;
  activeSubtaskId: string | null;
  activeSubtaskIntent: string | null;
  activeSubtaskStatus: TaskSubtaskStatus | null;
  activeSubtaskAttempt: number;
  activeSubtaskIndex: number;
  totalSubtasks: number;
  checkpointLastCompletedSubtaskIndex: number;
  checkpointCurrentSubtaskAttempt: number;
  contextRecentPairCount: number;
  contextSummarizedPairCount: number;
  contextTotalPairCount: number;
  contextSummaryIncluded: boolean;
  contextSummaryCharCount: number;
  observationCachePerceptionHit: boolean;
  observationCachePerceptionAgeMs: number | null;
  observationCacheDecisionHit: boolean;
  observationCacheDecisionKey: string | null;
  observationCacheScreenshotHit: boolean;
  promptTokenAlertTriggered: boolean;
  usedToonEncoding: boolean;
  timestamp: string;
}

export interface AXDeficientPageLog {
  step: number;
  urlAtPerception: string;
  interactiveElementCount: number;
  threshold: number;
  readyState: string;
  isLoadComplete: boolean;
  hasSignificantVisualContent: boolean;
  visibleElementCount: number;
  textCharCount: number;
  mediaElementCount: number;
  domInteractiveCandidateCount: number;
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
  domBypassResolutions: number;
  resolvedAtTier1: number;
  resolvedAtTier2: number;
  estimatedCostUsd: number;
  estimatedVisionCostAvoidedUsd: number;
}

export interface PerceptionActionTaskResult {
  taskId: string;
  contextId: string | null;
  status: "DONE" | "FAILED" | "MAX_STEPS";
  intent: string;
  startUrl: string;
  finalUrl: string;
  stepsTaken: number;
  history: LoopStepRecord[];
  decomposition: {
    isDecomposed: boolean;
    impliedStepCount: number;
    generatedBy: TaskDecompositionPlan["generatedBy"];
    generatedAt: string;
  };
  subtasks: RuntimeTaskSubtask[];
  checkpoint: TaskCheckpointState;
  subtaskStatusTimeline: SubtaskStatusEvent[];
  structuredErrors: StructuredErrorEvent[];
  escalations: EscalationEvent[];
  axDeficientPages: AXDeficientPageLog[];
  tierUsage: TierUsageMetrics;
  contextWindow: NavigatorContextWindowMetrics;
  observationCache: NavigatorObservationCacheMetrics;
  finalAction: NavigatorActionDecision | null;
  finalExecution: ActionExecutionResult | null;
  errorDetail: GhostTabTaskErrorDetail | null;
  stateTransitions: GhostTabStateTransitionEvent[];
}

export interface PerceptionActionTaskCleanupContext {
  taskId: string;
  contextId: string | null;
  finalState: "COMPLETE" | "FAILED";
  resultStatus: PerceptionActionTaskResult["status"];
  finalUrl: string;
  stepsTaken: number;
  errorDetail: GhostTabTaskErrorDetail | null;
}

export interface PerceptionActionLoopOptions {
  cdpClient: GhostTabCdpClient;
  navigatorEngine: NavigatorEngine;
  taskId?: string;
  contextId?: string;
  stateMachine?: GhostTabTaskStateMachine;
  maxSteps?: number;
  confidenceThreshold?: number;
  axDeficientInteractiveThreshold?: number;
  scrollStepPx?: number;
  maxScrollSteps?: number;
  maxNoProgressSteps?: number;
  maxSubtaskRetries?: number;
  navigationTimeoutMs?: number;
  observationCacheTtlMs?: number;
  onStateTransition?: (event: GhostTabStateTransitionEvent) => void;
  onSubtaskStatus?: (event: SubtaskStatusEvent) => void;
  onStructuredError?: (event: StructuredErrorEvent) => void;
  onTaskCleanup?: (context: PerceptionActionTaskCleanupContext) => Promise<void> | void;
  logger?: (line: string) => void;
}

class PerceptionActionLoop {
  private readonly maxSteps: number;
  private readonly confidenceThreshold: number;
  private readonly axDeficientInteractiveThreshold: number;
  private readonly scrollStepPx: number;
  private readonly maxScrollSteps: number;
  private readonly maxNoProgressSteps: number;
  private readonly maxSubtaskRetries: number;
  private readonly navigationTimeoutMs: number;
  private readonly observationCacheTtlMs: number;
  private readonly logger: (line: string) => void;

  constructor(private readonly options: PerceptionActionLoopOptions) {
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.confidenceThreshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    this.axDeficientInteractiveThreshold =
      options.axDeficientInteractiveThreshold ?? DEFAULT_AX_DEFICIENT_INTERACTIVE_THRESHOLD;
    this.scrollStepPx = options.scrollStepPx ?? DEFAULT_SCROLL_STEP_PX;
    this.maxScrollSteps = options.maxScrollSteps ?? DEFAULT_MAX_SCROLL_STEPS;
    this.maxNoProgressSteps = options.maxNoProgressSteps ?? DEFAULT_MAX_NO_PROGRESS_STEPS;
    this.maxSubtaskRetries = options.maxSubtaskRetries ?? DEFAULT_MAX_SUBTASK_RETRIES;
    this.navigationTimeoutMs = options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS;
    this.observationCacheTtlMs = options.observationCacheTtlMs ?? DEFAULT_OBSERVATION_CACHE_TTL_MS;
    this.logger = options.logger ?? ((line: string) => console.info(line));
  }

  async runTask(input: PerceptionActionTaskInput): Promise<PerceptionActionTaskResult> {
    if (!input.intent || !input.intent.trim()) {
      throw new Error("Task intent is required.");
    }

    if (!input.startUrl || !input.startUrl.trim()) {
      throw new Error("Task startUrl is required.");
    }

    const taskId =
      resolveOptionalString(input.taskId) ??
      resolveOptionalString(this.options.taskId) ??
      `task-${Date.now()}`;
    const contextId =
      resolveOptionalString(input.contextId) ?? resolveOptionalString(this.options.contextId) ?? null;
    const maxSteps = input.maxSteps ?? this.maxSteps;
    const confidenceThreshold = input.confidenceThreshold ?? this.confidenceThreshold;
    const axDeficientInteractiveThreshold =
      input.axDeficientInteractiveThreshold ?? this.axDeficientInteractiveThreshold;
    const scrollStepPx = input.scrollStepPx ?? this.scrollStepPx;
    const maxScrollSteps = input.maxScrollSteps ?? this.maxScrollSteps;
    const maxNoProgressSteps = input.maxNoProgressSteps ?? this.maxNoProgressSteps;
    const maxSubtaskRetries = input.maxSubtaskRetries ?? this.maxSubtaskRetries;
    const navigationTimeoutMs = input.navigationTimeoutMs ?? this.navigationTimeoutMs;
    const observationCacheTtlMs = input.observationCacheTtlMs ?? this.observationCacheTtlMs;

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
    if (!Number.isFinite(maxSubtaskRetries) || maxSubtaskRetries < 0) {
      throw new Error("maxSubtaskRetries must be zero or greater.");
    }
    if (!Number.isFinite(navigationTimeoutMs) || navigationTimeoutMs <= 0) {
      throw new Error("navigationTimeoutMs must be greater than zero.");
    }
    if (!Number.isFinite(observationCacheTtlMs) || observationCacheTtlMs <= 0) {
      throw new Error("observationCacheTtlMs must be greater than zero.");
    }

    const stateMachine =
      this.options.stateMachine ??
      createGhostTabTaskStateMachine({
        taskId,
        contextId
      });
    if (stateMachine.getState() !== "IDLE") {
      throw new Error(
        `Task ${taskId} requires initial state IDLE. Current state: ${stateMachine.getState()}`
      );
    }

    const transitionState = (
      to: GhostTabTaskState,
      context: {
        step?: number;
        url?: string;
        reason?: string;
        errorDetail?: GhostTabTaskErrorDetail;
      } = {}
    ): void => {
      const event = stateMachine.transition(to, context);
      this.options.onStateTransition?.(event);
    };

    const history: LoopStepRecord[] = [];
    const decomposition = decomposeTaskIntent({
      intent: input.intent,
      startUrl: input.startUrl
    });
    const subtasks = initializeRuntimeSubtasks(decomposition.subtasks);
    const checkpoint: TaskCheckpointState = {
      lastCompletedSubtaskIndex: -1,
      currentSubtaskAttempt: 0,
      subtaskArtifacts: []
    };
    const subtaskStatusTimeline: SubtaskStatusEvent[] = [];
    const structuredErrors: StructuredErrorEvent[] = [];
    const escalations: EscalationEvent[] = [];
    const axDeficientPages: AXDeficientPageLog[] = [];
    const contextWindow = createNavigatorContextWindowManager();
    const observationCache = createNavigatorObservationCacheManager({
      ttlMs: observationCacheTtlMs
    });
    const tierUsage = createInitialTierUsageMetrics();
    let scrollCount = 0;
    let noProgressStreak = 0;
    let pendingAXTreeRefetchReason: AXTreeRefetchReason = "INITIAL";
    let lastPerceptionUrl: string | null = null;
    let currentUrl = input.startUrl;
    let finalAction: NavigatorActionDecision | null = null;
    let finalExecution: ActionExecutionResult | null = null;

    const getActiveSubtaskIndex = (): number =>
      subtasks.findIndex((subtask) => subtask.status === "IN_PROGRESS");

    const getActiveSubtask = (): RuntimeTaskSubtask | null => {
      const index = getActiveSubtaskIndex();
      return index >= 0 ? subtasks[index] : null;
    };

    const emitSubtaskStatus = (subtaskIndex: number, reason: string): void => {
      const subtask = subtasks[subtaskIndex];
      if (!subtask) {
        return;
      }
      const event: SubtaskStatusEvent = {
        taskId,
        contextId,
        subtaskId: subtask.id,
        subtaskIntent: subtask.intent,
        status: subtask.status,
        verificationType: subtask.verification.type,
        verificationCondition: subtask.verification.condition,
        currentSubtaskIndex: subtaskIndex + 1,
        totalSubtasks: subtasks.length,
        attempt: subtask.attemptCount,
        checkpointLastCompletedSubtaskIndex: checkpoint.lastCompletedSubtaskIndex,
        reason,
        timestamp: new Date().toISOString()
      };
      subtaskStatusTimeline.push(event);
      this.options.onSubtaskStatus?.(event);
    };

    const transitionStateIfPossible = (
      to: GhostTabTaskState,
      context: {
        step?: number;
        url?: string;
        reason?: string;
        errorDetail?: GhostTabTaskErrorDetail;
      } = {}
    ): void => {
      if (stateMachine.getState() === to) {
        return;
      }
      if (!stateMachine.canTransition(to)) {
        return;
      }
      transitionState(to, context);
    };

    const toNavigatorStructuredErrorType = (
      type: GhostTabTaskErrorDetail["type"]
    ): NavigatorStructuredErrorType => {
      switch (type) {
        case "NETWORK":
        case "RUNTIME":
        case "CDP":
        case "TIMEOUT":
          return type;
        default:
          return "CDP";
      }
    };

    const toNavigatorStructuredError = (
      errorDetail: GhostTabTaskErrorDetail,
      fallbackUrl: string
    ): NavigatorStructuredError => {
      return {
        type: toNavigatorStructuredErrorType(errorDetail.type),
        status: errorDetail.status,
        url: errorDetail.url ?? fallbackUrl,
        message: errorDetail.message,
        retryable: errorDetail.retryable
      };
    };

    const resolveStructuredErrorDecision = async (params: {
      step: number;
      source: StructuredErrorEvent["source"];
      reason: string;
      errorDetail: GhostTabTaskErrorDetail;
      url: string;
    }): Promise<NavigatorActionDecision | null> => {
      const structuredError = toNavigatorStructuredError(params.errorDetail, params.url);
      const contextSnapshot = contextWindow.buildSnapshot();
      const activeSubtaskIndex = getActiveSubtaskIndex();
      const activeSubtask = activeSubtaskIndex >= 0 ? subtasks[activeSubtaskIndex] : null;
      const taskSubtasksForNavigator: NavigatorObservationSubtask[] =
        subtasks.map(toNavigatorObservationSubtask);
      const activeSubtaskForNavigator: NavigatorActiveSubtask | null = activeSubtask
        ? toNavigatorActiveSubtask({
            subtask: activeSubtask,
            index: activeSubtaskIndex,
            totalSubtasks: subtasks.length
          })
        : null;

      transitionStateIfPossible("PERCEIVING", {
        step: params.step > 0 ? params.step : 1,
        url: params.url,
        reason: `${params.reason}:STRUCTURED_ERROR_CONTEXT`
      });
      transitionStateIfPossible("INFERRING", {
        step: params.step > 0 ? params.step : 1,
        url: params.url,
        reason: `${params.reason}:STRUCTURED_ERROR_DECISION`
      });

      let decision: NavigatorActionDecision | null = null;
      try {
        decision = await this.options.navigatorEngine.decideNextAction({
          intent: input.intent,
          tier: "TIER_1_AX",
          observation: {
            currentUrl: params.url,
            interactiveElementIndex: [],
            normalizedAXTree: [],
            previousActions: contextSnapshot.previousActions,
            previousObservations: contextSnapshot.previousObservations,
            historySummary: contextSnapshot.historySummary,
            contextWindowStats: {
              recentPairCount: contextSnapshot.recentPairCount,
              summarizedPairCount: contextSnapshot.summarizedPairCount,
              totalPairCount: contextSnapshot.totalPairCount,
              summaryCharCount: contextSnapshot.summaryCharCount
            },
            taskSubtasks: taskSubtasksForNavigator,
            activeSubtask: activeSubtaskForNavigator,
            checkpointState: {
              lastCompletedSubtaskIndex: checkpoint.lastCompletedSubtaskIndex,
              currentSubtaskAttempt: checkpoint.currentSubtaskAttempt
            },
            structuredError
          }
        });
      } catch (error) {
        this.logger(
          `[loop][step ${params.step}] structured-error decision-failed source=${params.source} reason=${params.reason} error=${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      let decisionSource: StructuredErrorEvent["decisionSource"] = "NAVIGATOR";
      if (decision === null && structuredError.retryable) {
        decisionSource = "POLICY_FALLBACK";
        decision = {
          action: "WAIT",
          target: null,
          text: "1000",
          confidence: 0.5,
          reasoning:
            "Retryable structured error fallback: issue a short wait/retry instead of immediate failure."
        };
      } else if (decision && structuredError.retryable && decision.action === "FAILED") {
        decisionSource = "POLICY_FALLBACK";
        decision = {
          action: "WAIT",
          target: null,
          text: "1000",
          confidence: Math.max(0.5, Math.min(1, decision.confidence)),
          reasoning: `Retryable structured error fallback: ${decision.reasoning}`
        };
      }

      if (decision) {
        finalAction = decision;
        contextWindow.appendPair({
          step: params.step > 0 ? params.step : 1,
          action: decision,
          observation: `structured-error source=${params.source} type=${structuredError.type} retryable=${structuredError.retryable} status=${structuredError.status ?? "none"} reason=${params.reason}`,
          url: params.url,
          resolvedTier: "TIER_1_AX"
        });
      }

      const event: StructuredErrorEvent = {
        taskId,
        contextId,
        step: params.step,
        source: params.source,
        reason: params.reason,
        error: structuredError,
        navigatorDecision: decision,
        decisionSource,
        timestamp: new Date().toISOString()
      };
      structuredErrors.push(event);
      this.options.onStructuredError?.(event);
      return decision;
    };

    const activateSubtask = (subtaskIndex: number, reason: string): void => {
      const subtask = subtasks[subtaskIndex];
      if (!subtask) {
        return;
      }
      subtask.status = "IN_PROGRESS";
      subtask.attemptCount = Math.max(1, subtask.attemptCount);
      subtask.lastUpdatedAt = new Date().toISOString();
      checkpoint.currentSubtaskAttempt = subtask.attemptCount;
      emitSubtaskStatus(subtaskIndex, reason);
    };

    const completeActiveSubtask = (params: {
      step: number;
      url: string;
      resolvedTier: ResolvedPerceptionTier;
      action: NavigatorActionDecision;
      reason: string;
    }): boolean => {
      const activeSubtaskIndex = getActiveSubtaskIndex();
      if (activeSubtaskIndex < 0) {
        return false;
      }

      const activeSubtask = subtasks[activeSubtaskIndex];
      activeSubtask.status = "COMPLETE";
      activeSubtask.completedStep = params.step;
      activeSubtask.failedStep = null;
      activeSubtask.lastUpdatedAt = new Date().toISOString();

      checkpoint.lastCompletedSubtaskIndex = Math.max(
        checkpoint.lastCompletedSubtaskIndex,
        activeSubtaskIndex
      );
      checkpoint.currentSubtaskAttempt = 0;
      checkpoint.subtaskArtifacts.push({
        subtaskId: activeSubtask.id,
        step: params.step,
        completionUrl: params.url,
        resolvedTier: params.resolvedTier,
        action: params.action.action,
        timestamp: new Date().toISOString()
      });

      emitSubtaskStatus(activeSubtaskIndex, params.reason);

      const nextSubtaskIndex = subtasks.findIndex(
        (subtask, index) => index > activeSubtaskIndex && subtask.status === "PENDING"
      );
      if (nextSubtaskIndex >= 0) {
        activateSubtask(nextSubtaskIndex, "CHECKPOINT_ADVANCE");
      }
      return true;
    };

    const retryActiveSubtaskFromCheckpoint = (params: {
      step: number;
      reason: string;
    }): boolean => {
      const activeSubtaskIndex = getActiveSubtaskIndex();
      if (activeSubtaskIndex < 0) {
        return false;
      }

      const activeSubtask = subtasks[activeSubtaskIndex];
      activeSubtask.status = "FAILED";
      activeSubtask.failedStep = params.step;
      activeSubtask.lastUpdatedAt = new Date().toISOString();
      emitSubtaskStatus(activeSubtaskIndex, `${params.reason}:FAILED`);

      const retriesUsed = Math.max(0, activeSubtask.attemptCount - 1);
      if (retriesUsed >= maxSubtaskRetries) {
        return false;
      }

      activeSubtask.attemptCount += 1;
      activeSubtask.status = "IN_PROGRESS";
      activeSubtask.lastUpdatedAt = new Date().toISOString();
      checkpoint.currentSubtaskAttempt = activeSubtask.attemptCount;
      emitSubtaskStatus(activeSubtaskIndex, `${params.reason}:RETRY_FROM_CHECKPOINT`);
      return true;
    };

    const completeRemainingSubtasksForDone = (params: {
      step: number;
      url: string;
      resolvedTier: ResolvedPerceptionTier;
      action: NavigatorActionDecision["action"];
    }): void => {
      for (let index = 0; index < subtasks.length; index += 1) {
        const subtask = subtasks[index];
        if (subtask.status === "COMPLETE") {
          continue;
        }
        subtask.status = "COMPLETE";
        subtask.completedStep = params.step;
        subtask.failedStep = null;
        subtask.lastUpdatedAt = new Date().toISOString();
        checkpoint.lastCompletedSubtaskIndex = Math.max(checkpoint.lastCompletedSubtaskIndex, index);
        emitSubtaskStatus(index, "TASK_DONE_FINALIZATION");
        checkpoint.subtaskArtifacts.push({
          subtaskId: subtask.id,
          step: params.step,
          completionUrl: params.url,
          resolvedTier: params.resolvedTier,
          action: params.action,
          timestamp: new Date().toISOString()
        });
      }
      checkpoint.currentSubtaskAttempt = 0;
    };

    for (let index = 0; index < subtasks.length; index += 1) {
      const subtask = subtasks[index];
      if (subtask.status === "IN_PROGRESS") {
        subtask.attemptCount = Math.max(1, subtask.attemptCount);
        checkpoint.currentSubtaskAttempt = subtask.attemptCount;
      }
      emitSubtaskStatus(index, "DECOMPOSITION_INITIALIZED");
    }

    const buildTaskResult = (params: {
      status: PerceptionActionTaskResult["status"];
      finalUrl: string;
      stepsTaken: number;
      finalAction: NavigatorActionDecision | null;
      finalExecution: ActionExecutionResult | null;
      errorDetail: GhostTabTaskErrorDetail | null;
    }): PerceptionActionTaskResult => {
      return {
        taskId,
        contextId,
        status: params.status,
        intent: input.intent,
        startUrl: input.startUrl,
        finalUrl: params.finalUrl,
        stepsTaken: params.stepsTaken,
        history,
        decomposition: {
          isDecomposed: decomposition.isDecomposed,
          impliedStepCount: decomposition.impliedStepCount,
          generatedBy: decomposition.generatedBy,
          generatedAt: decomposition.generatedAt
        },
        subtasks,
        checkpoint,
        subtaskStatusTimeline,
        structuredErrors,
        escalations,
        axDeficientPages,
        tierUsage: finalizeTierUsageMetrics(tierUsage),
        contextWindow: contextWindow.getMetrics(),
        observationCache: observationCache.getMetrics(),
        finalAction: params.finalAction,
        finalExecution: params.finalExecution,
        errorDetail: params.errorDetail,
        stateTransitions: stateMachine.getTransitionHistory()
      };
    };

    const runCleanup = async (params: {
      finalState: "COMPLETE" | "FAILED";
      resultStatus: PerceptionActionTaskResult["status"];
      finalUrl: string;
      stepsTaken: number;
      errorDetail: GhostTabTaskErrorDetail | null;
    }): Promise<void> => {
      if (!this.options.onTaskCleanup) {
        return;
      }

      try {
        await this.options.onTaskCleanup({
          taskId,
          contextId,
          finalState: params.finalState,
          resultStatus: params.resultStatus,
          finalUrl: params.finalUrl,
          stepsTaken: params.stepsTaken,
          errorDetail: params.errorDetail
        });
      } catch (error) {
        this.logger(
          `[loop] cleanup-failed taskId=${taskId} contextId=${contextId ?? "none"} error=${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    };

    const transitionToIdle = (step: number | null, url: string): void => {
      if (stateMachine.getState() === "IDLE") {
        return;
      }
      transitionState("IDLE", {
        step: step ?? undefined,
        url,
        reason: "TASK_CONTEXT_CLEANUP"
      });
    };

    let lastStep = 0;

    try {
      transitionState("LOADING", {
        step: 0,
        url: input.startUrl,
        reason: "TASK_ASSIGNED"
      });
      this.logger(`[loop] state=LOADING intent="${input.intent}" startUrl=${input.startUrl}`);
      await this.options.cdpClient.navigate(input.startUrl, navigationTimeoutMs);

      currentUrl = await this.options.cdpClient.getCurrentUrl();
      const navigationOutcome = this.options.cdpClient.getLastNavigationOutcome();
      const navigationErrorDetail = buildNavigationStructuredErrorDetail({
        outcome: navigationOutcome,
        fallbackUrl: currentUrl || input.startUrl
      });
      if (navigationErrorDetail) {
        const activeSubtaskAtNavigationError = getActiveSubtaskIndex();
        if (activeSubtaskAtNavigationError >= 0) {
          const subtask = subtasks[activeSubtaskAtNavigationError];
          subtask.status = "FAILED";
          subtask.failedStep = 0;
          subtask.lastUpdatedAt = new Date().toISOString();
          emitSubtaskStatus(activeSubtaskAtNavigationError, "NAVIGATION_STRUCTURED_ERROR");
        }

        await resolveStructuredErrorDecision({
          step: 0,
          source: "NAVIGATION",
          reason: "NAVIGATION_STRUCTURED_ERROR",
          errorDetail: navigationErrorDetail,
          url: currentUrl || input.startUrl
        });

        transitionStateIfPossible("FAILED", {
          step: 0,
          url: currentUrl || input.startUrl,
          reason: "NAVIGATION_STRUCTURED_ERROR",
          errorDetail: navigationErrorDetail
        });
        this.logger(
          `[loop] state=FAILED reason=NAVIGATION_STRUCTURED_ERROR status=${String(
            navigationErrorDetail.status
          )} retryable=${navigationErrorDetail.retryable} url=${currentUrl || input.startUrl}`
        );
        await runCleanup({
          finalState: "FAILED",
          resultStatus: "FAILED",
          finalUrl: currentUrl || input.startUrl,
          stepsTaken: 0,
          errorDetail: navigationErrorDetail
        });
        transitionToIdle(0, currentUrl || input.startUrl);
        return buildTaskResult({
          status: "FAILED",
          finalUrl: currentUrl || input.startUrl,
          stepsTaken: 0,
          finalAction,
          finalExecution,
          errorDetail: navigationErrorDetail
        });
      }

      transitionState("PERCEIVING", {
        step: 1,
        url: currentUrl,
        reason: "NAVIGATION_COMPLETE"
      });

      for (let step = 1; step <= maxSteps; step += 1) {
        lastStep = step;
        const urlAtPerception = currentUrl;
        this.logger(`[loop][step ${step}] state=PERCEIVING url=${urlAtPerception}`);
        const perceptionLookupNowMs = Date.now();
        observationCache.pruneExpired(perceptionLookupNowMs);
        const urlChangedSinceLastPerception =
          lastPerceptionUrl !== null && lastPerceptionUrl !== urlAtPerception;
        let axTreeRefetchReason = pendingAXTreeRefetchReason;
        if (axTreeRefetchReason === "NONE" && urlChangedSinceLastPerception) {
          axTreeRefetchReason = "URL_CHANGED";
        }
        const cachedPerceptionData =
          axTreeRefetchReason === "NONE"
            ? observationCache.getPerception(urlAtPerception, perceptionLookupNowMs)
            : null;
        const shouldRefetchAXTree = cachedPerceptionData === null;
        let observationCachePerceptionHit = false;
        let observationCachePerceptionAgeMs: number | null = null;
        let observationCacheDecisionHit = false;
        let observationCacheDecisionKey: string | null = null;
        let observationCacheScreenshotHit = false;

        let indexResult: Awaited<ReturnType<GhostTabCdpClient["extractInteractiveElementIndex"]>>;
        let treeEncoding: ToonEncodingResult;
        let axDeficiencySignals: AXDeficiencySignals;
        let scrollPosition: ScrollPositionSnapshot;
        try {
          if (!shouldRefetchAXTree && cachedPerceptionData) {
            indexResult = cachedPerceptionData.indexResult;
            treeEncoding = cachedPerceptionData.treeEncoding;
            axDeficiencySignals = cachedPerceptionData.axDeficiencySignals;
            scrollPosition = cachedPerceptionData.scrollPosition;
            observationCachePerceptionHit = true;
            observationCachePerceptionAgeMs = cachedPerceptionData.ageMs;
          } else {
            indexResult = await this.options.cdpClient.extractInteractiveElementIndex({
              includeBoundingBoxes: true,
              charBudget: 8_000
            });
            treeEncoding = await encodeNormalizedAXTreeForNavigator(indexResult.normalizedAXTree.nodes);
            axDeficiencySignals = await this.options.cdpClient.getAXDeficiencySignals();
            scrollPosition = await this.options.cdpClient.getScrollPositionSnapshot();
            observationCache.setPerception(
              urlAtPerception,
              {
                indexResult,
                treeEncoding,
                axDeficiencySignals,
                scrollPosition,
                axTreeHash: computeAXTreeHash(indexResult.normalizedAXTree.json)
              },
              perceptionLookupNowMs
            );
            pendingAXTreeRefetchReason = "NONE";
          }
          lastPerceptionUrl = urlAtPerception;
        } catch (error) {
          const perceptionErrorDetail = createGhostTabTaskErrorDetail({
            error,
            url: urlAtPerception,
            step
          });
          const activeSubtaskOnPerceptionError = getActiveSubtaskIndex();
          if (activeSubtaskOnPerceptionError >= 0) {
            const subtask = subtasks[activeSubtaskOnPerceptionError];
            subtask.status = "FAILED";
            subtask.failedStep = step;
            subtask.lastUpdatedAt = new Date().toISOString();
            emitSubtaskStatus(activeSubtaskOnPerceptionError, "PERCEPTION_STRUCTURED_ERROR");
          }

          await resolveStructuredErrorDecision({
            step,
            source: "PERCEPTION",
            reason: "PERCEPTION_STRUCTURED_ERROR",
            errorDetail: perceptionErrorDetail,
            url: urlAtPerception
          });
          transitionStateIfPossible("FAILED", {
            step,
            url: urlAtPerception,
            reason: "PERCEPTION_STRUCTURED_ERROR",
            errorDetail: perceptionErrorDetail
          });
          this.logger(
            `[loop] state=FAILED reason=PERCEPTION_STRUCTURED_ERROR steps=${step} type=${perceptionErrorDetail.type} retryable=${perceptionErrorDetail.retryable} url=${urlAtPerception}`
          );
          await runCleanup({
            finalState: "FAILED",
            resultStatus: "FAILED",
            finalUrl: urlAtPerception,
            stepsTaken: step,
            errorDetail: perceptionErrorDetail
          });
          transitionToIdle(step, urlAtPerception);
          return buildTaskResult({
            status: "FAILED",
            finalUrl: urlAtPerception,
            stepsTaken: step,
            finalAction,
            finalExecution,
            errorDetail: perceptionErrorDetail
          });
        }

        const belowFoldMarginPx = Math.max(24, Math.round(scrollStepPx * DEFAULT_BELOW_FOLD_MARGIN_RATIO));
        const targetMightBeBelowFold = isTargetLikelyBelowFold(scrollPosition, belowFoldMarginPx);
        const axDeficiencyEvaluation = evaluateAXDeficiency({
          interactiveElementCount: indexResult.elementCount,
          threshold: axDeficientInteractiveThreshold,
          signals: axDeficiencySignals
        });
        const contextSnapshot = contextWindow.buildSnapshot();
        const activeSubtaskIndex = getActiveSubtaskIndex();
        const activeSubtask = activeSubtaskIndex >= 0 ? subtasks[activeSubtaskIndex] : null;
        const taskSubtasksForNavigator: NavigatorObservationSubtask[] =
          subtasks.map(toNavigatorObservationSubtask);
        const activeSubtaskForNavigator: NavigatorActiveSubtask | null = activeSubtask
          ? toNavigatorActiveSubtask({
              subtask: activeSubtask,
              index: activeSubtaskIndex,
              totalSubtasks: subtasks.length
            })
          : null;
        const observation = {
          currentUrl: urlAtPerception,
          interactiveElementIndex: indexResult.elements,
          normalizedAXTree: treeEncoding.payload,
          previousActions: contextSnapshot.previousActions,
          previousObservations: contextSnapshot.previousObservations,
          historySummary: contextSnapshot.historySummary,
          contextWindowStats: {
            recentPairCount: contextSnapshot.recentPairCount,
            summarizedPairCount: contextSnapshot.summarizedPairCount,
            totalPairCount: contextSnapshot.totalPairCount,
            summaryCharCount: contextSnapshot.summaryCharCount
          },
          taskSubtasks: taskSubtasksForNavigator,
          activeSubtask: activeSubtaskForNavigator,
          checkpointState: {
            lastCompletedSubtaskIndex: checkpoint.lastCompletedSubtaskIndex,
            currentSubtaskAttempt: checkpoint.currentSubtaskAttempt
          }
        };
        const tier1ObservationCharCount = JSON.stringify(observation).length;
        const tiersAttempted: NavigatorInferenceTier[] = [];
        const axDeficientDetected = axDeficiencyEvaluation.detected;
        const shouldBypassTier1ForNoProgress = noProgressStreak > 0 && !axDeficientDetected;
        let escalationReason: NavigatorEscalationReason | null = null;
        let inferredAction: NavigatorActionDecision | null = null;
        let tier2ObservationCharCount = 0;
        let resolvedTier: ResolvedPerceptionTier = "TIER_1_AX";
        let tier2EscalationEvent: EscalationEvent | null = null;
        let domExtractionAttempted = false;
        let domExtractionElementCount = 0;
        let domBypassUsed = false;
        let domBypassMatchedText: string | null = null;
        let tier1PromptCharCount = 0;
        let tier1EstimatedPromptTokens = 0;
        let tier2PromptCharCount = 0;
        let tier2EstimatedPromptTokens = 0;
        let promptTokenAlertTriggered = false;

        transitionState("INFERRING", {
          step,
          url: urlAtPerception
        });

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
          const tier1DecisionCacheKey = createObservationDecisionCacheKey({
            tier: "TIER_1_AX",
            escalationReason: null
          });
          observationCacheDecisionKey = tier1DecisionCacheKey;
          const tier1CachedDecision = observationCache.getDecision(
            urlAtPerception,
            tier1DecisionCacheKey,
            Date.now()
          );
          observationCacheDecisionHit = tier1CachedDecision !== null;
          this.logger(
            `[loop][step ${step}] state=INFERRING tier=TIER_1_AX url=${urlAtPerception} elements=${indexResult.elementCount} normalizedChars=${indexResult.normalizedCharCount} navigatorTreeChars=${treeEncoding.encodedCharCount} observationChars=${tier1ObservationCharCount} toon=${treeEncoding.usedToonEncoding} scrollY=${scrollPosition.scrollY} viewportH=${scrollPosition.viewportHeight} docH=${scrollPosition.documentHeight} belowFold=${targetMightBeBelowFold} axRefetch=${shouldRefetchAXTree} refetchReason=${axTreeRefetchReason} cacheHit=${observationCacheDecisionHit}`
          );
          let tier1Action: NavigatorActionDecision;
          if (tier1CachedDecision) {
            tier1Action = tier1CachedDecision.decision;
          } else {
            tierUsage.tier1Calls += 1;
            const tier1PromptBudget = estimateNavigatorPromptBudget({
              intent: input.intent,
              observation,
              tier: "TIER_1_AX"
            });
            tier1PromptCharCount = tier1PromptBudget.promptCharCount;
            tier1EstimatedPromptTokens = tier1PromptBudget.estimatedPromptTokens;
            const tier1TokenAlert = contextWindow.recordPromptBudget({
              step,
              tier: "TIER_1_AX",
              promptCharCount: tier1PromptBudget.promptCharCount,
              estimatedPromptTokens: tier1PromptBudget.estimatedPromptTokens,
              threshold: tier1PromptBudget.alertThreshold
            });
            if (tier1TokenAlert) {
              promptTokenAlertTriggered = true;
              this.logger(
                `[loop][step ${step}] context-window-alert tier=TIER_1_AX promptTokens=${tier1PromptBudget.estimatedPromptTokens} threshold=${tier1PromptBudget.alertThreshold} url=${urlAtPerception}`
              );
            }
            tier1Action = await this.options.navigatorEngine.decideNextAction({
              intent: input.intent,
              observation,
              tier: "TIER_1_AX"
            });
          }
          const isUnsafeTier1Action = tier1Action.action === "FAILED";

          if (!isUnsafeTier1Action && tier1Action.confidence >= confidenceThreshold) {
            inferredAction = tier1Action;
            resolvedTier = "TIER_1_AX";
            tierUsage.resolvedAtTier1 += 1;
            if (!tier1CachedDecision) {
              observationCache.setDecision(
                urlAtPerception,
                tier1DecisionCacheKey,
                tier1Action,
                Date.now()
              );
            }
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
          axDeficientPages.push(
            createAXDeficientPageLog({
              step,
              urlAtPerception,
              interactiveElementCount: indexResult.elementCount,
              threshold: axDeficientInteractiveThreshold,
              signals: axDeficiencySignals
            })
          );
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
            `[loop][step ${step}] escalation=AX_DEFICIENT elements=${indexResult.elementCount} threshold=${axDeficientInteractiveThreshold} loadComplete=${axDeficiencySignals.isLoadComplete} significantVisual=${axDeficiencySignals.hasSignificantVisualContent} url=${urlAtPerception}`
          );
        }

        if (!axDeficientDetected && axDeficiencyEvaluation.lowInteractiveCount) {
          this.logger(
            `[loop][step ${step}] ax-deficient-check=SKIPPED reason=${axDeficiencyEvaluation.skipReason} elements=${indexResult.elementCount} threshold=${axDeficientInteractiveThreshold} loadComplete=${axDeficiencySignals.isLoadComplete} significantVisual=${axDeficiencySignals.hasSignificantVisualContent} url=${urlAtPerception}`
          );
        }

        if (!inferredAction) {
          const shouldAbortNoProgressViewportRecapture =
            escalationReason === "NO_PROGRESS" &&
            noProgressStreak >= 2 &&
            !targetMightBeBelowFold;
          if (shouldAbortNoProgressViewportRecapture) {
            inferredAction = {
              action: "FAILED",
              target: null,
              text: `Stopped after ${noProgressStreak} no-progress steps at scrollY=${Math.round(scrollPosition.scrollY)} on ${urlAtPerception}.`,
              confidence: 1,
              reasoning:
                "Above-the-fold heuristic: no additional below-fold content is available, so another viewport screenshot is unlikely to find a new target."
            };
            resolvedTier = "TIER_2_VISION";
            if (tier2EscalationEvent) {
              tier2EscalationEvent.resolvedTier = "TIER_2_VISION";
              tier2EscalationEvent.resolvedConfidence = inferredAction.confidence;
            }
            this.logger(
              `[loop][step ${step}] state=FAILED reason=NO_BELOW_FOLD_CONTENT url=${urlAtPerception} scrollY=${scrollPosition.scrollY} viewportH=${scrollPosition.viewportHeight} docH=${scrollPosition.documentHeight}`
            );
          }
        }

        if (!inferredAction) {
          domExtractionAttempted = true;
          const domExtractionResult = await this.options.cdpClient.extractDomInteractiveElements({
            maxElements: 140
          });
          domExtractionElementCount = domExtractionResult.elementCount;
          const domBypassCandidate = resolveDomBypassAction({
            intent: input.intent,
            domExtraction: domExtractionResult
          });

          if (domBypassCandidate) {
            inferredAction = domBypassCandidate.action;
            domBypassUsed = true;
            domBypassMatchedText = domBypassCandidate.matchedText;
            resolvedTier = "TIER_1_AX";
            tierUsage.domBypassResolutions += 1;
            tierUsage.resolvedAtTier1 += 1;
            if (tier2EscalationEvent) {
              tier2EscalationEvent.resolvedTier = "TIER_1_AX";
              tier2EscalationEvent.resolvedConfidence = domBypassCandidate.action.confidence;
            }
            this.logger(
              `[loop][step ${step}] state=INFERRING tier=DOM_BYPASS url=${urlAtPerception} domElements=${domExtractionResult.elementCount} matched="${domBypassCandidate.matchedText}" score=${domBypassCandidate.score}`
            );
          }
        }

        if (!inferredAction) {
          tiersAttempted.push("TIER_2_VISION");
          const tier2DecisionCacheKey = createObservationDecisionCacheKey({
            tier: "TIER_2_VISION",
            escalationReason
          });
          observationCacheDecisionKey = tier2DecisionCacheKey;
          const tier2CachedDecision = observationCache.getDecision(
            urlAtPerception,
            tier2DecisionCacheKey,
            Date.now()
          );
          observationCacheDecisionHit = tier2CachedDecision !== null;
          if (tier2CachedDecision) {
            inferredAction = tier2CachedDecision.decision;
            this.logger(
              `[loop][step ${step}] state=INFERRING tier=TIER_2_VISION url=${urlAtPerception} cacheHit=true reason=${escalationReason ?? "NONE"} scrollY=${scrollPosition.scrollY} viewportH=${scrollPosition.viewportHeight} docH=${scrollPosition.documentHeight} belowFold=${targetMightBeBelowFold} axRefetch=${shouldRefetchAXTree} refetchReason=${axTreeRefetchReason}`
            );
          } else {
            tierUsage.tier2Calls += 1;
            const cachedScreenshot = observationCache.getTier2Screenshot(urlAtPerception, Date.now());
            observationCacheScreenshotHit = cachedScreenshot !== null;
            let screenshotPayload: {
              base64: string;
              mimeType: string;
              width: number;
              height: number;
              mode?: string;
            };
            if (cachedScreenshot) {
              screenshotPayload = cachedScreenshot.screenshot;
            } else {
              const screenshot = await this.options.cdpClient.withVisualRenderPass(async () => {
                return this.options.cdpClient.captureScreenshot({
                  mode: "viewport"
                });
              });
              screenshotPayload = {
                base64: screenshot.base64,
                mimeType: screenshot.mimeType,
                width: screenshot.width,
                height: screenshot.height,
                mode: screenshot.mode
              };
              observationCache.setTier2Screenshot(urlAtPerception, screenshotPayload, Date.now());
            }
            const tier2Observation = {
              ...observation,
              screenshot: screenshotPayload
            };
            tier2ObservationCharCount = JSON.stringify({
              ...observation,
              screenshot: {
                mimeType: screenshotPayload.mimeType,
                width: screenshotPayload.width,
                height: screenshotPayload.height,
                mode: screenshotPayload.mode
              }
            }).length;

            this.logger(
              `[loop][step ${step}] state=INFERRING tier=TIER_2_VISION url=${urlAtPerception} observationChars=${tier2ObservationCharCount} reason=${escalationReason ?? "NONE"} scrollY=${scrollPosition.scrollY} viewportH=${scrollPosition.viewportHeight} docH=${scrollPosition.documentHeight} belowFold=${targetMightBeBelowFold} axRefetch=${shouldRefetchAXTree} refetchReason=${axTreeRefetchReason} screenshotCacheHit=${observationCacheScreenshotHit}`
            );
            const tier2PromptBudget = estimateNavigatorPromptBudget({
              intent: input.intent,
              observation: tier2Observation,
              tier: "TIER_2_VISION",
              escalationReason
            });
            tier2PromptCharCount = tier2PromptBudget.promptCharCount;
            tier2EstimatedPromptTokens = tier2PromptBudget.estimatedPromptTokens;
            const tier2TokenAlert = contextWindow.recordPromptBudget({
              step,
              tier: "TIER_2_VISION",
              promptCharCount: tier2PromptBudget.promptCharCount,
              estimatedPromptTokens: tier2PromptBudget.estimatedPromptTokens,
              threshold: tier2PromptBudget.alertThreshold
            });
            if (tier2TokenAlert) {
              promptTokenAlertTriggered = true;
              this.logger(
                `[loop][step ${step}] context-window-alert tier=TIER_2_VISION promptTokens=${tier2PromptBudget.estimatedPromptTokens} threshold=${tier2PromptBudget.alertThreshold} url=${urlAtPerception}`
              );
            }
            inferredAction = await this.options.navigatorEngine.decideNextAction({
              intent: input.intent,
              observation: tier2Observation,
              tier: "TIER_2_VISION",
              escalationReason
            });
            if (inferredAction) {
              observationCache.setDecision(
                urlAtPerception,
                tier2DecisionCacheKey,
                inferredAction,
                Date.now()
              );
            }
          }
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
            escalationReason,
            targetMightBeBelowFold
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

        transitionState("ACTING", {
          step,
          url: urlAtPerception,
          reason: `ACTION_${actionToExecute.action}`
        });
        this.logger(
          `[loop][step ${step}] state=ACTING tier=${resolvedTier} action=${actionToExecute.action} confidence=${actionToExecute.confidence.toFixed(2)} url=${urlAtPerception}`
        );
        let execution: ActionExecutionResult;
        try {
          execution = await this.options.cdpClient.executeAction(this.toAgentAction(actionToExecute));
        } catch (error) {
          const actionErrorDetail = createGhostTabTaskErrorDetail({
            error,
            url: urlAtPerception,
            step
          });
          const activeSubtaskOnActionError = getActiveSubtaskIndex();
          if (activeSubtaskOnActionError >= 0) {
            const subtask = subtasks[activeSubtaskOnActionError];
            subtask.status = "FAILED";
            subtask.failedStep = step;
            subtask.lastUpdatedAt = new Date().toISOString();
            emitSubtaskStatus(activeSubtaskOnActionError, "ACTION_STRUCTURED_ERROR");
          }

          await resolveStructuredErrorDecision({
            step,
            source: "ACTION",
            reason: "ACTION_STRUCTURED_ERROR",
            errorDetail: actionErrorDetail,
            url: urlAtPerception
          });
          transitionStateIfPossible("FAILED", {
            step,
            url: urlAtPerception,
            reason: "ACTION_STRUCTURED_ERROR",
            errorDetail: actionErrorDetail
          });
          this.logger(
            `[loop] state=FAILED reason=ACTION_STRUCTURED_ERROR steps=${step} type=${actionErrorDetail.type} retryable=${actionErrorDetail.retryable} url=${urlAtPerception}`
          );
          await runCleanup({
            finalState: "FAILED",
            resultStatus: "FAILED",
            finalUrl: urlAtPerception,
            stepsTaken: step,
            errorDetail: actionErrorDetail
          });
          transitionToIdle(step, urlAtPerception);
          return buildTaskResult({
            status: "FAILED",
            finalUrl: urlAtPerception,
            stepsTaken: step,
            finalAction: actionToExecute,
            finalExecution,
            errorDetail: actionErrorDetail
          });
        }
        finalExecution = execution;
        currentUrl = execution.currentUrl;
        noProgressStreak = isNoProgressStep({
          urlAtPerception,
          urlAfterAction: currentUrl,
          execution
        })
          ? noProgressStreak + 1
          : 0;
        const nextAXTreeRefetchReason = determineAXTreeRefetchReason({
          action: actionToExecute,
          execution,
          urlAtPerception,
          urlAfterAction: currentUrl
        });
        pendingAXTreeRefetchReason = nextAXTreeRefetchReason;
        if (nextAXTreeRefetchReason !== "NONE") {
          observationCache.invalidate(urlAtPerception);
          if (currentUrl !== urlAtPerception) {
            observationCache.invalidate(currentUrl);
          }
        }

        if (activeSubtask) {
          const subtaskVerification = evaluateSubtaskVerification({
            subtask: activeSubtask,
            execution,
            action: actionToExecute,
            currentUrl,
            indexResult
          });
          if (subtaskVerification.satisfied) {
            completeActiveSubtask({
              step,
              url: currentUrl,
              resolvedTier,
              action: actionToExecute,
              reason: `VERIFIED:${subtaskVerification.reason}`
            });
          }
        }

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
            axDeficiencySignals,
            axTreeRefetched: shouldRefetchAXTree,
            axTreeRefetchReason,
            scrollPosition,
            targetMightBeBelowFold,
            scrollCount,
            noProgressStreak,
            postActionSignificantDomMutationObserved: execution.significantDomMutationObserved,
            postActionMutationSummary: execution.domMutationSummary,
            domExtractionAttempted,
            domExtractionElementCount,
            domBypassUsed,
            domBypassMatchedText,
            indexResult,
            navigatorNormalizedTreeCharCount: treeEncoding.encodedCharCount,
            navigatorObservationCharCount: observationCharCount,
            tier1PromptCharCount,
            tier1EstimatedPromptTokens,
            tier2PromptCharCount,
            tier2EstimatedPromptTokens,
            decompositionUsed: decomposition.isDecomposed,
            decompositionImpliedStepCount: decomposition.impliedStepCount,
            activeSubtask: activeSubtaskForNavigator,
            totalSubtasks: subtasks.length,
            checkpoint,
            contextSnapshot,
            observationCachePerceptionHit,
            observationCachePerceptionAgeMs,
            observationCacheDecisionHit,
            observationCacheDecisionKey,
            observationCacheScreenshotHit,
            promptTokenAlertTriggered,
            usedToonEncoding: treeEncoding.usedToonEncoding
          })
        );

        contextWindow.appendPair({
          step,
          action: actionToExecute,
          observation: `step=${step} tier=${resolvedTier} action=${actionToExecute.action} confidence=${actionToExecute.confidence.toFixed(2)} nav=${execution.navigationObserved} dom=${execution.domMutationObserved} sigDom=${execution.significantDomMutationObserved} url=${currentUrl}`,
          url: currentUrl,
          resolvedTier
        });

        if (actionToExecute.action === "DONE" || execution.status === "done") {
          completeRemainingSubtasksForDone({
            step,
            url: currentUrl,
            resolvedTier,
            action: actionToExecute.action
          });
          transitionState("COMPLETE", {
            step,
            url: currentUrl,
            reason: "TASK_DONE"
          });
          this.logger(`[loop] state=COMPLETE status=DONE steps=${step} finalUrl=${currentUrl}`);
          await runCleanup({
            finalState: "COMPLETE",
            resultStatus: "DONE",
            finalUrl: currentUrl,
            stepsTaken: step,
            errorDetail: null
          });
          transitionToIdle(step, currentUrl);
          return buildTaskResult({
            status: "DONE",
            finalUrl: currentUrl,
            stepsTaken: step,
            finalAction: actionToExecute,
            finalExecution: execution,
            errorDetail: null
          });
        }

        if (actionToExecute.action === "FAILED" || execution.status === "failed") {
          const retriedFromCheckpoint = retryActiveSubtaskFromCheckpoint({
            step,
            reason: "TASK_FAILED"
          });
          if (retriedFromCheckpoint) {
            this.logger(
              `[loop][step ${step}] subtask-retry status=IN_PROGRESS active=${getActiveSubtask()?.id ?? "none"} attempt=${checkpoint.currentSubtaskAttempt} lastComplete=${checkpoint.lastCompletedSubtaskIndex}`
            );
            noProgressStreak = 0;
            pendingAXTreeRefetchReason = "SIGNIFICANT_DOM_MUTATION";
            observationCache.invalidate(urlAtPerception);
            observationCache.invalidate(currentUrl);
            transitionState("PERCEIVING", {
              step: step + 1,
              url: currentUrl,
              reason: "SUBTASK_RETRY"
            });
            continue;
          }

          const errorDetail = createGhostTabTaskErrorDetail({
            error: new Error(execution.message ?? `Execution failed for action ${actionToExecute.action}.`),
            url: currentUrl,
            step
          });
          transitionState("FAILED", {
            step,
            url: currentUrl,
            reason: "TASK_FAILED",
            errorDetail
          });
          this.logger(`[loop] state=FAILED status=FAILED steps=${step} finalUrl=${currentUrl}`);
          await runCleanup({
            finalState: "FAILED",
            resultStatus: "FAILED",
            finalUrl: currentUrl,
            stepsTaken: step,
            errorDetail
          });
          transitionToIdle(step, currentUrl);
          return buildTaskResult({
            status: "FAILED",
            finalUrl: currentUrl,
            stepsTaken: step,
            finalAction: actionToExecute,
            finalExecution: execution,
            errorDetail
          });
        }

        if (noProgressStreak >= maxNoProgressSteps) {
          const retriedFromCheckpoint = retryActiveSubtaskFromCheckpoint({
            step,
            reason: "NO_PROGRESS_LOOP_GUARD"
          });
          if (retriedFromCheckpoint) {
            this.logger(
              `[loop][step ${step}] subtask-retry reason=NO_PROGRESS active=${getActiveSubtask()?.id ?? "none"} attempt=${checkpoint.currentSubtaskAttempt} lastComplete=${checkpoint.lastCompletedSubtaskIndex}`
            );
            noProgressStreak = 0;
            pendingAXTreeRefetchReason = "SIGNIFICANT_DOM_MUTATION";
            observationCache.invalidate(urlAtPerception);
            observationCache.invalidate(currentUrl);
            transitionState("PERCEIVING", {
              step: step + 1,
              url: currentUrl,
              reason: "SUBTASK_RETRY"
            });
            continue;
          }

          const loopGuardFailure: NavigatorActionDecision = {
            action: "FAILED",
            target: null,
            text: `Aborted after ${noProgressStreak} no-progress steps at ${currentUrl}.`,
            confidence: actionToExecute.confidence,
            reasoning:
              "Loop guard triggered because actions produced no navigation, DOM mutation, or URL change."
          };
          finalAction = loopGuardFailure;
          const errorDetail = createGhostTabTaskErrorDetail({
            error: new Error(loopGuardFailure.text ?? "No-progress loop guard triggered."),
            url: currentUrl,
            step,
            retryable: true
          });
          transitionState("FAILED", {
            step,
            url: currentUrl,
            reason: "NO_PROGRESS_LOOP_GUARD",
            errorDetail
          });
          this.logger(
            `[loop] state=FAILED reason=NO_PROGRESS_LOOP steps=${step} streak=${noProgressStreak}/${maxNoProgressSteps} finalUrl=${currentUrl}`
          );
          await runCleanup({
            finalState: "FAILED",
            resultStatus: "FAILED",
            finalUrl: currentUrl,
            stepsTaken: step,
            errorDetail
          });
          transitionToIdle(step, currentUrl);
          return buildTaskResult({
            status: "FAILED",
            finalUrl: currentUrl,
            stepsTaken: step,
            finalAction: loopGuardFailure,
            finalExecution: execution,
            errorDetail
          });
        }

        transitionState("PERCEIVING", {
          step: step + 1,
          url: currentUrl,
          reason: "NEXT_STEP"
        });
      }

      const activeSubtaskAtMaxSteps = getActiveSubtaskIndex();
      if (activeSubtaskAtMaxSteps >= 0) {
        const subtask = subtasks[activeSubtaskAtMaxSteps];
        subtask.status = "FAILED";
        subtask.failedStep = maxSteps;
        subtask.lastUpdatedAt = new Date().toISOString();
        emitSubtaskStatus(activeSubtaskAtMaxSteps, "MAX_STEPS_REACHED");
      }

      const maxStepErrorDetail = createGhostTabTaskErrorDetail({
        error: new Error(`Reached max steps (${maxSteps}) without terminal completion.`),
        url: currentUrl,
        step: maxSteps,
        retryable: true
      });
      transitionState("FAILED", {
        step: maxSteps,
        url: currentUrl,
        reason: "MAX_STEPS_REACHED",
        errorDetail: maxStepErrorDetail
      });
      this.logger(`[loop] state=FAILED status=MAX_STEPS steps=${maxSteps} finalUrl=${currentUrl}`);
      await runCleanup({
        finalState: "FAILED",
        resultStatus: "MAX_STEPS",
        finalUrl: currentUrl,
        stepsTaken: maxSteps,
        errorDetail: maxStepErrorDetail
      });
      transitionToIdle(maxSteps, currentUrl);
      return buildTaskResult({
        status: "MAX_STEPS",
        finalUrl: currentUrl,
        stepsTaken: maxSteps,
        finalAction,
        finalExecution,
        errorDetail: maxStepErrorDetail
      });
    } catch (error) {
      const activeSubtaskOnException = getActiveSubtaskIndex();
      if (activeSubtaskOnException >= 0) {
        const subtask = subtasks[activeSubtaskOnException];
        subtask.status = "FAILED";
        subtask.lastUpdatedAt = new Date().toISOString();
        emitSubtaskStatus(activeSubtaskOnException, "UNHANDLED_EXCEPTION");
      }

      const errorDetail = createGhostTabTaskErrorDetail({
        error,
        url: currentUrl,
        step: lastStep > 0 ? lastStep : null
      });
      if (stateMachine.getState() === "IDLE") {
        transitionStateIfPossible("LOADING", {
          step: 0,
          url: currentUrl,
          reason: "TASK_RECOVERY"
        });
      }
      await resolveStructuredErrorDecision({
        step: lastStep > 0 ? lastStep : 0,
        source: "UNHANDLED_EXCEPTION",
        reason: "UNHANDLED_EXCEPTION",
        errorDetail,
        url: currentUrl
      });
      transitionStateIfPossible("FAILED", {
        step: lastStep > 0 ? lastStep : undefined,
        url: currentUrl,
        reason: "UNHANDLED_EXCEPTION",
        errorDetail
      });

      await runCleanup({
        finalState: "FAILED",
        resultStatus: "FAILED",
        finalUrl: currentUrl,
        stepsTaken: lastStep,
        errorDetail
      });
      transitionToIdle(lastStep > 0 ? lastStep : null, currentUrl);
      this.logger(
        `[loop] state=FAILED reason=UNHANDLED_EXCEPTION steps=${lastStep} finalUrl=${currentUrl} error=${errorDetail.message}`
      );
      return buildTaskResult({
        status: "FAILED",
        finalUrl: currentUrl,
        stepsTaken: lastStep,
        finalAction,
        finalExecution,
        errorDetail
      });
    }
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
  axDeficiencySignals: AXDeficiencySignals;
  axTreeRefetched: boolean;
  axTreeRefetchReason: AXTreeRefetchReason;
  scrollPosition: ScrollPositionSnapshot;
  targetMightBeBelowFold: boolean;
  scrollCount: number;
  noProgressStreak: number;
  postActionSignificantDomMutationObserved: boolean;
  postActionMutationSummary: DomMutationSummary | null;
  domExtractionAttempted: boolean;
  domExtractionElementCount: number;
  domBypassUsed: boolean;
  domBypassMatchedText: string | null;
  indexResult: InteractiveElementIndexResult;
  navigatorNormalizedTreeCharCount: number;
  navigatorObservationCharCount: number;
  tier1PromptCharCount: number;
  tier1EstimatedPromptTokens: number;
  tier2PromptCharCount: number;
  tier2EstimatedPromptTokens: number;
  decompositionUsed: boolean;
  decompositionImpliedStepCount: number;
  activeSubtask: NavigatorActiveSubtask | null;
  totalSubtasks: number;
  checkpoint: TaskCheckpointState;
  contextSnapshot: NavigatorContextSnapshot;
  observationCachePerceptionHit: boolean;
  observationCachePerceptionAgeMs: number | null;
  observationCacheDecisionHit: boolean;
  observationCacheDecisionKey: string | null;
  observationCacheScreenshotHit: boolean;
  promptTokenAlertTriggered: boolean;
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
    axDeficiencySignals: input.axDeficiencySignals,
    axTreeRefetched: input.axTreeRefetched,
    axTreeRefetchReason: input.axTreeRefetchReason,
    scrollPosition: input.scrollPosition,
    targetMightBeBelowFold: input.targetMightBeBelowFold,
    scrollCount: input.scrollCount,
    noProgressStreak: input.noProgressStreak,
    postActionSignificantDomMutationObserved: input.postActionSignificantDomMutationObserved,
    postActionMutationSummary: input.postActionMutationSummary,
    domExtractionAttempted: input.domExtractionAttempted,
    domExtractionElementCount: input.domExtractionElementCount,
    domBypassUsed: input.domBypassUsed,
    domBypassMatchedText: input.domBypassMatchedText,
    interactiveElementCount: input.indexResult.elementCount,
    normalizedNodeCount: input.indexResult.normalizedNodeCount,
    normalizedCharCount: input.indexResult.normalizedCharCount,
    navigatorNormalizedTreeCharCount: input.navigatorNormalizedTreeCharCount,
    navigatorObservationCharCount: input.navigatorObservationCharCount,
    tier1PromptCharCount: input.tier1PromptCharCount,
    tier1EstimatedPromptTokens: input.tier1EstimatedPromptTokens,
    tier2PromptCharCount: input.tier2PromptCharCount,
    tier2EstimatedPromptTokens: input.tier2EstimatedPromptTokens,
    decompositionUsed: input.decompositionUsed,
    decompositionImpliedStepCount: input.decompositionImpliedStepCount,
    activeSubtaskId: input.activeSubtask?.id ?? null,
    activeSubtaskIntent: input.activeSubtask?.intent ?? null,
    activeSubtaskStatus: input.activeSubtask?.status ?? null,
    activeSubtaskAttempt: input.activeSubtask?.attempt ?? 0,
    activeSubtaskIndex: input.activeSubtask?.currentSubtaskIndex ?? 0,
    totalSubtasks: input.totalSubtasks,
    checkpointLastCompletedSubtaskIndex: input.checkpoint.lastCompletedSubtaskIndex,
    checkpointCurrentSubtaskAttempt: input.checkpoint.currentSubtaskAttempt,
    contextRecentPairCount: input.contextSnapshot.recentPairCount,
    contextSummarizedPairCount: input.contextSnapshot.summarizedPairCount,
    contextTotalPairCount: input.contextSnapshot.totalPairCount,
    contextSummaryIncluded: input.contextSnapshot.historySummary !== null,
    contextSummaryCharCount: input.contextSnapshot.summaryCharCount,
    observationCachePerceptionHit: input.observationCachePerceptionHit,
    observationCachePerceptionAgeMs: input.observationCachePerceptionAgeMs,
    observationCacheDecisionHit: input.observationCacheDecisionHit,
    observationCacheDecisionKey: input.observationCacheDecisionKey,
    observationCacheScreenshotHit: input.observationCacheScreenshotHit,
    promptTokenAlertTriggered: input.promptTokenAlertTriggered,
    usedToonEncoding: input.usedToonEncoding,
    timestamp: new Date().toISOString()
  };
}

function initializeRuntimeSubtasks(subtasks: TaskDecompositionSubtask[]): RuntimeTaskSubtask[] {
  return subtasks.map((subtask) => ({
    ...subtask,
    attemptCount: subtask.status === "IN_PROGRESS" ? 1 : 0,
    completedStep: null,
    failedStep: null,
    lastUpdatedAt: new Date().toISOString()
  }));
}

function toNavigatorObservationSubtask(subtask: RuntimeTaskSubtask): NavigatorObservationSubtask {
  return {
    id: subtask.id,
    intent: subtask.intent,
    status: subtask.status,
    verification: {
      type: subtask.verification.type,
      condition: subtask.verification.condition
    }
  };
}

function toNavigatorActiveSubtask(input: {
  subtask: RuntimeTaskSubtask;
  index: number;
  totalSubtasks: number;
}): NavigatorActiveSubtask {
  return {
    id: input.subtask.id,
    intent: input.subtask.intent,
    status: input.subtask.status,
    verification: {
      type: input.subtask.verification.type,
      condition: input.subtask.verification.condition
    },
    currentSubtaskIndex: input.index + 1,
    totalSubtasks: input.totalSubtasks,
    attempt: input.subtask.attemptCount
  };
}

function evaluateSubtaskVerification(input: {
  subtask: RuntimeTaskSubtask;
  action: NavigatorActionDecision;
  execution: ActionExecutionResult;
  currentUrl: string;
  indexResult: InteractiveElementIndexResult;
}): { satisfied: boolean; reason: string } {
  if (input.action.action === "FAILED" || input.execution.status === "failed") {
    return {
      satisfied: false,
      reason: "action_or_execution_failed"
    };
  }

  if (input.action.action === "DONE" || input.execution.status === "done") {
    return {
      satisfied: true,
      reason: "task_done_action"
    };
  }

  const verification = input.subtask.verification;
  switch (verification.type) {
    case "url_matches": {
      const condition = normalizeForComparison(verification.condition);
      const url = normalizeForComparison(input.currentUrl);
      const matched = condition.length > 0 && url.includes(condition);
      return {
        satisfied: matched || input.execution.navigationObserved,
        reason: matched ? "url_matches_condition" : "navigation_observed"
      };
    }
    case "element_present": {
      const conditionTokens = tokenizeCondition(verification.condition);
      const hasTokenMatch =
        conditionTokens.length > 0 &&
        input.indexResult.elements.some((element) => {
          const label = normalizeForComparison(
            `${element.name ?? ""} ${element.role ?? ""} ${element.value ?? ""}`
          );
          return conditionTokens.every((token) => label.includes(token));
        });
      return {
        satisfied: hasTokenMatch || input.execution.domMutationObserved,
        reason: hasTokenMatch ? "element_condition_matched" : "dom_mutation_observed"
      };
    }
    case "data_extracted": {
      const hasExtractedData = hasStructuredData(input.execution.extractedData);
      return {
        satisfied: hasExtractedData || input.action.action === "EXTRACT",
        reason: hasExtractedData ? "data_extracted" : "extract_action_executed"
      };
    }
    case "human_review":
      return {
        satisfied: false,
        reason: "human_review_required"
      };
    case "action_confirmed":
    default: {
      const confirmed =
        input.execution.navigationObserved ||
        input.execution.domMutationObserved ||
        input.action.action !== "WAIT";
      return {
        satisfied: confirmed,
        reason: confirmed ? "meaningful_action_confirmed" : "no_meaningful_action"
      };
    }
  }
}

function computeAXTreeHash(json: string): string {
  return createHash("sha256").update(json).digest("hex");
}

function buildNavigationStructuredErrorDetail(input: {
  outcome: NavigationOutcome | null;
  fallbackUrl: string;
}): GhostTabTaskErrorDetail | null {
  if (!input.outcome) {
    return null;
  }

  const status = input.outcome.status;
  const finalUrl = input.outcome.finalUrl ?? input.fallbackUrl;
  const hasStatusError = typeof status === "number" && Number.isFinite(status) && status >= 400;
  const hasCdpError = typeof input.outcome.errorText === "string" && input.outcome.errorText.length > 0;
  if (!hasStatusError && !hasCdpError) {
    return null;
  }

  if (hasCdpError) {
    return createGhostTabTaskErrorDetail({
      error: new Error(
        `Navigation failed for ${input.outcome.requestedUrl}: ${input.outcome.errorText ?? "unknown error"}`
      ),
      type: "NETWORK",
      status,
      url: finalUrl,
      step: 0,
      retryable: true
    });
  }

  const retryable = Boolean(status !== null && status >= 500);
  return createGhostTabTaskErrorDetail({
    error: new Error(
      `Navigation returned HTTP ${String(status)}${
        input.outcome.statusText ? ` ${input.outcome.statusText}` : ""
      } for ${finalUrl}.`
    ),
    type: "NETWORK",
    status,
    url: finalUrl,
    step: 0,
    retryable
  });
}

function tokenizeCondition(condition: string): string[] {
  const normalized = normalizeForComparison(condition);
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !INTENT_STOP_WORDS.has(token));
}

function normalizeForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\//g, " ")
    .replace(/[^a-z0-9/.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasStructuredData(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
}

function evaluateAXDeficiency(input: {
  interactiveElementCount: number;
  threshold: number;
  signals: AXDeficiencySignals;
}): {
  detected: boolean;
  lowInteractiveCount: boolean;
  skipReason: "INTERACTIVE_COUNT_OK" | "LOAD_NOT_COMPLETE" | "INSUFFICIENT_VISUAL_CONTENT" | null;
} {
  const lowInteractiveCount = input.interactiveElementCount < input.threshold;
  if (!lowInteractiveCount) {
    return {
      detected: false,
      lowInteractiveCount: false,
      skipReason: "INTERACTIVE_COUNT_OK"
    };
  }

  if (!input.signals.isLoadComplete) {
    return {
      detected: false,
      lowInteractiveCount: true,
      skipReason: "LOAD_NOT_COMPLETE"
    };
  }

  if (!input.signals.hasSignificantVisualContent) {
    return {
      detected: false,
      lowInteractiveCount: true,
      skipReason: "INSUFFICIENT_VISUAL_CONTENT"
    };
  }

  return {
    detected: true,
    lowInteractiveCount: true,
    skipReason: null
  };
}

function createAXDeficientPageLog(input: {
  step: number;
  urlAtPerception: string;
  interactiveElementCount: number;
  threshold: number;
  signals: AXDeficiencySignals;
}): AXDeficientPageLog {
  return {
    step: input.step,
    urlAtPerception: input.urlAtPerception,
    interactiveElementCount: input.interactiveElementCount,
    threshold: input.threshold,
    readyState: input.signals.readyState,
    isLoadComplete: input.signals.isLoadComplete,
    hasSignificantVisualContent: input.signals.hasSignificantVisualContent,
    visibleElementCount: input.signals.visibleElementCount,
    textCharCount: input.signals.textCharCount,
    mediaElementCount: input.signals.mediaElementCount,
    domInteractiveCandidateCount: input.signals.domInteractiveCandidateCount,
    timestamp: new Date().toISOString()
  };
}

function isTargetLikelyBelowFold(
  scrollPosition: ScrollPositionSnapshot,
  belowFoldMarginPx: number
): boolean {
  return scrollPosition.remainingScrollPx > Math.max(0, Math.round(belowFoldMarginPx));
}

function resolveDomBypassAction(input: {
  intent: string;
  domExtraction: ExtractDomInteractiveElementsResult;
}): { action: NavigatorActionDecision; matchedText: string; score: number } | null {
  const intentTokens = tokenizeIntent(input.intent);
  if (intentTokens.length === 0 || input.domExtraction.elements.length === 0) {
    return null;
  }

  const scored = input.domExtraction.elements
    .map((element) => {
      const text = normalizeText(element.text);
      const roleHint = normalizeText(element.role ?? "");
      const hrefHint = normalizeText(element.href ?? "");
      const combined = `${text} ${roleHint} ${hrefHint}`.trim();
      const tokenMatches = intentTokens.filter((token) => combined.includes(token)).length;
      let score = tokenMatches;

      if ((element.tag === "a" || element.role === "link") && intentTokens.includes("link")) {
        score += 1;
      }
      if (
        (element.tag === "input" || element.tag === "textarea" || element.role === "textbox") &&
        intentTokens.some((token) => token === "search" || token === "find")
      ) {
        score += 1;
      }

      return {
        element,
        score
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    return null;
  }

  const best = scored[0];
  const second = scored[1];
  if (best.score < DOM_BYPASS_MIN_SCORE) {
    return null;
  }
  if (second && best.score - second.score < DOM_BYPASS_MIN_SCORE_GAP) {
    return null;
  }

  const box = best.element.boundingBox;
  if (!box || box.width <= 0 || box.height <= 0) {
    return null;
  }

  return {
    action: {
      action: "CLICK",
      target: {
        x: round3(box.x + box.width / 2),
        y: round3(box.y + box.height / 2)
      },
      text: null,
      confidence: 0.9,
      reasoning:
        "DOM extraction bypass selected a single high-confidence interactive target without requiring a screenshot."
    },
    matchedText: best.element.text || best.element.href || best.element.tag,
    score: best.score
  };
}

function tokenizeIntent(intent: string): string[] {
  return normalizeText(intent)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !INTENT_STOP_WORDS.has(token));
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function determineAXTreeRefetchReason(input: {
  action: NavigatorActionDecision;
  execution: ActionExecutionResult;
  urlAtPerception: string;
  urlAfterAction: string;
}): AXTreeRefetchReason {
  if (input.execution.navigationObserved || input.urlAfterAction !== input.urlAtPerception) {
    return "NAVIGATION";
  }

  if (input.action.action === "SCROLL") {
    return "SCROLL_ACTION";
  }

  if (input.execution.significantDomMutationObserved) {
    return "SIGNIFICANT_DOM_MUTATION";
  }

  return "NONE";
}

function shouldTriggerTier3Scroll(input: {
  action: NavigatorActionDecision;
  confidenceThreshold: number;
  noProgressStreak: number;
  escalationReason: NavigatorEscalationReason | null;
  targetMightBeBelowFold: boolean;
}): boolean {
  if (!input.targetMightBeBelowFold) {
    return false;
  }

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
    domBypassResolutions: 0,
    resolvedAtTier1: 0,
    resolvedAtTier2: 0,
    estimatedCostUsd: 0,
    estimatedVisionCostAvoidedUsd: 0
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
    ),
    estimatedVisionCostAvoidedUsd: round6(metrics.domBypassResolutions * ESTIMATED_TIER2_CALL_COST_USD)
  };
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function resolveOptionalString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function createPerceptionActionLoop(options: PerceptionActionLoopOptions): PerceptionActionLoop {
  return new PerceptionActionLoop(options);
}
