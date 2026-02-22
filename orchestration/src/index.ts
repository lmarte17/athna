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
  type PerceptionActionTaskInput,
  type PerceptionActionTaskResult,
  type ResolvedPerceptionTier,
  type TierUsageMetrics
} from "./loop/orchestrator.js";
