export {
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
  type ExecuteActionOptions,
  type ExtractInteractiveElementIndexOptions,
  type ExtractInteractiveElementIndexResult,
  type ExtractNormalizedAXTreeOptions,
  type ExtractNormalizedAXTreeResult,
  type GhostViewportSettings,
  type InteractiveElementIndexEntry,
  type InteractiveElementIndexResult,
  type NormalizedAXNode,
  type ScreenshotClipRegion,
  type ScreenshotMode,
  type GhostTabCdpClient
} from "./cdp/client.js";

export {
  createNavigatorEngine,
  resolveNavigatorModelFromEnv,
  type NavigatorActionDecision,
  type NavigatorActionTarget,
  type NavigatorActionType,
  type NavigatorDecisionRequest,
  type NavigatorEngine,
  type NavigatorObservationInput
} from "./navigator/engine.js";

export {
  createPerceptionActionLoop,
  type LoopState,
  type LoopStepRecord,
  type PerceptionActionLoopOptions,
  type PerceptionActionTaskInput,
  type PerceptionActionTaskResult
} from "./loop/orchestrator.js";
