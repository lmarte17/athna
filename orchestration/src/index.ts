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
  type GhostViewportSettings,
  type InteractiveElementIndexEntry,
  type InteractiveElementIndexResult,
  type NormalizedAXNode,
  type ScrollPositionSnapshot,
  type ScreenshotClipRegion,
  type ScreenshotMode,
  type GhostTabCdpClient
} from "./cdp/client.js";

export {
  createNavigatorEngine,
  resolveNavigatorModelFromEnv,
  resolveNavigatorProModelFromEnv,
  type NavigatorActionDecision,
  type NavigatorActionTarget,
  type NavigatorActionType,
  type NavigatorDecisionRequest,
  type NavigatorEngineOptions,
  type NavigatorEngine,
  type NavigatorEscalationReason,
  type NavigatorInferenceTier,
  type NavigatorObservationInput
} from "./navigator/engine.js";

export {
  type AXDeficientPageLog,
  createPerceptionActionLoop,
  type EscalationEvent,
  type LoopState,
  type LoopStepRecord,
  type PerceptionActionLoopOptions,
  type PerceptionActionTaskCleanupContext,
  type PerceptionActionTaskInput,
  type PerceptionActionTaskResult,
  type ResolvedPerceptionTier,
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
  type GhostTabIpcValidationResult,
  type InjectJsIpcPayload,
  type InputEventIpcPayload,
  type NavigateIpcPayload,
  type ScreenshotIpcPayload,
  type TaskErrorIpcPayload,
  type TaskResultIpcPayload
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
  type GhostTabPoolSnapshot,
  type GhostTabTaskPriority
} from "./pool/manager.js";
