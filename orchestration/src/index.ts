export {
  type AXDeficiencySignals,
  type ActionExecutionResult,
  type AgentActionInput,
  type AgentActionTarget,
  type AgentActionType,
  buildInteractiveElementIndex,
  connectToGhostTabCdp,
  type BoundingBox,
  type CaptureScreenshotOptions,
  type CaptureScreenshotResult,
  type CaptureJpegOptions,
  type ConnectToGhostTabCdpOptions,
  type DomInteractiveElement,
  type DomMutationSummary,
  type ExecuteActionOptions,
  type ExtractDomInteractiveElementsOptions,
  type ExtractDomInteractiveElementsResult,
  type ExtractInteractiveElementIndexOptions,
  type ExtractInteractiveElementIndexResult,
  type ExtractNormalizedAXTreeOptions,
  type ExtractNormalizedAXTreeResult,
  type GhostTabCrashEvent,
  type HttpCachePolicy,
  type HttpCachePolicyMode,
  type HttpCachePolicyState,
  type GhostViewportSettings,
  type GhostTabResourceMetrics,
  type InteractiveElementIndexEntry,
  type InteractiveElementIndexResult,
  type NavigationOutcome,
  type NetworkErrorType,
  type NetworkConnectionTrace,
  type NetworkConnectionTraceEntry,
  type NormalizedAXNode,
  type PrefetchOptions,
  type PrefetchResult,
  type RequestClassification,
  type RequestInterceptionMetrics,
  type RequestInterceptionMetricsSnapshot,
  type RequestInterceptionMode,
  type RequestInterceptionSettings,
  type ScrollPositionSnapshot,
  type ScreenshotClipRegion,
  type ScreenshotMode,
  type GhostTabCdpClient
} from "./cdp/client.js";

export {
  createNavigatorEngine,
  estimateNavigatorPromptBudget,
  resolveNavigatorModelFromEnv,
  resolveNavigatorProModelFromEnv,
  type NavigatorActionDecision,
  type NavigatorActionTarget,
  type NavigatorActionType,
  type NavigatorActiveSubtask,
  type NavigatorCheckpointState,
  type NavigatorDecisionRequest,
  type NavigatorEngineOptions,
  type NavigatorEngine,
  type NavigatorEscalationReason,
  type NavigatorInferenceTier,
  type NavigatorObservationSubtask,
  type NavigatorObservationContextStats,
  type NavigatorStructuredError,
  type NavigatorStructuredErrorType,
  type NavigatorObservationInput,
  type NavigatorPromptBudgetEstimate
} from "./navigator/engine.js";

export {
  decomposeTaskIntent,
  type DecomposeTaskIntentInput,
  type TaskDecompositionPlan,
  type TaskDecompositionSubtask,
  type TaskSubtaskStatus,
  type TaskSubtaskVerification,
  type TaskSubtaskVerificationType
} from "./navigator/decomposition.js";

export {
  createNavigatorContextWindowManager,
  resolvePromptTokenAlertThresholdFromEnv,
  type NavigatorContextHistoryPair,
  type NavigatorContextSnapshot,
  type NavigatorContextWindowManager,
  type NavigatorContextWindowManagerOptions,
  type NavigatorContextWindowMetrics,
  type NavigatorPromptBudgetSample,
  type NavigatorPromptTokenAlert
} from "./navigator/context-window.js";

export {
  createNavigatorObservationCacheManager,
  createObservationDecisionCacheKey,
  DEFAULT_NAVIGATOR_OBSERVATION_CACHE_TTL_MS,
  type CachedDecisionLookupResult,
  type CachedPerceptionData,
  type CachedPerceptionLookupResult,
  type CachedScreenshotLookupResult,
  type NavigatorObservationCacheManager,
  type NavigatorObservationCacheMetrics,
  type NavigatorObservationCacheOptions
} from "./navigator/observation-cache.js";

export {
  type AXDeficientPageLog,
  createPerceptionActionLoop,
  type EscalationEvent,
  type LoopState,
  type LoopStepRecord,
  type PrefetchEvent,
  type PerceptionActionLoopOptions,
  type PerceptionActionTaskCleanupContext,
  type TaskCheckpointArtifact,
  type TaskCheckpointState,
  type PerceptionActionTaskInput,
  type PerceptionActionTaskResult,
  type RuntimeTaskSubtask,
  type ResolvedPerceptionTier,
  type StructuredErrorEvent,
  type SubtaskStatusEvent,
  type TierUsageMetrics
} from "./loop/orchestrator.js";

export {
  ALLOWED_GHOST_TAB_STATE_TRANSITIONS,
  createGhostTabTaskErrorDetail,
  createGhostTabTaskStateMachine,
  classifyTaskErrorType,
  InvalidGhostTabStateTransitionError,
  type GhostTabStateTransitionContext,
  type GhostTabStateTransitionEvent,
  type GhostTabTaskErrorDetail,
  type GhostTabTaskErrorType,
  type GhostTabTaskState,
  GhostTabTaskStateMachine,
  type GhostTabTaskStateMachineOptions
} from "./task/state-machine.js";

export {
  createGhostTabIpcMessage,
  GHOST_TAB_IPC_REQUEST_TYPES,
  GHOST_TAB_IPC_RESPONSE_TYPES,
  GHOST_TAB_IPC_SCHEMA_VERSION,
  GhostTabIpcValidationError,
  validateInboundGhostTabIpcMessage,
  validateOutboundGhostTabIpcMessage,
  assertValidGhostTabIpcMessage,
  type AxTreeIpcPayload,
  type GhostTabIpcAxTreeMessage,
  type GhostTabIpcInputEventMessage,
  type GhostTabIpcInjectJsMessage,
  type GhostTabIpcMessage,
  type GhostTabIpcMessageBase,
  type GhostTabIpcMessageByType,
  type GhostTabIpcMessageType,
  type GhostTabIpcNavigateMessage,
  type GhostTabIpcPayloadByType,
  type GhostTabIpcRequestMessage,
  type GhostTabIpcRequestType,
  type GhostTabIpcResponseMessage,
  type GhostTabIpcResponseType,
  type GhostTabIpcScreenshotMessage,
  type GhostTabIpcTaskErrorMessage,
  type GhostTabIpcTaskResultMessage,
  type GhostTabIpcTaskStatusMessage,
  type GhostTabIpcValidationResult,
  type InjectJsIpcPayload,
  type InputEventIpcPayload,
  type NavigateIpcPayload,
  type QueueTaskStatusIpcPayload,
  type SchedulerTaskStatusIpcPayload,
  type ScreenshotIpcPayload,
  type StateTaskStatusIpcPayload,
  type SubtaskTaskStatusIpcPayload,
  type TaskErrorIpcPayload,
  type TaskResultIpcPayload,
  type TaskStatusIpcPayload
} from "./ipc/schema.js";

export {
  createGhostTabIpcRouter,
  GhostTabIpcRouter,
  type GhostTabIpcRouterOptions
} from "./ipc/router.js";

export {
  createGhostTabPoolManager,
  type AcquireGhostTabOptions,
  type GhostTabLease,
  type GhostTabPoolManagerOptions,
  type GhostTabQueueStatusEvent,
  type GhostTabQueueStatusEventType,
  type GhostTabPoolSnapshot,
  type GhostTabTaskPriority
} from "./pool/manager.js";

export {
  createParallelTaskScheduler,
  ParallelTaskExecutionError,
  ParallelTaskScheduler,
  type ParallelTaskAttemptResult,
  type ParallelTaskCrashRecoveryOptions,
  type ParallelTaskResourceBudgetOptions,
  type ParallelTaskRunResult,
  type ParallelTaskRunnerInput,
  type ParallelTaskSchedulerOptions,
  type SubmitParallelTaskInput
} from "./scheduler/parallel-task-scheduler.js";
