import { randomUUID } from "node:crypto";

import type { AgentActionInput, CaptureScreenshotOptions } from "../cdp/client.js";
import type {
  GhostTabTaskErrorDetail,
  GhostTabTaskErrorType,
  GhostTabTaskState
} from "../task/state-machine.js";

export const GHOST_TAB_IPC_SCHEMA_VERSION = 1 as const;

export const GHOST_TAB_IPC_REQUEST_TYPES = [
  "NAVIGATE",
  "SCREENSHOT",
  "AX_TREE",
  "INJECT_JS",
  "INPUT_EVENT"
] as const;

export const GHOST_TAB_IPC_RESPONSE_TYPES = ["TASK_RESULT", "TASK_ERROR", "TASK_STATUS"] as const;

const INPUT_EVENT_ACTION_TYPES = ["CLICK", "TYPE", "SCROLL", "WAIT", "EXTRACT", "DONE", "FAILED"];
const GHOST_TAB_TASK_PRIORITIES = ["FOREGROUND", "BACKGROUND"] as const;
const TASK_STATUS_KINDS = ["QUEUE", "STATE", "SCHEDULER", "SUBTASK"] as const;
const TASK_STATUS_QUEUE_EVENTS = ["ENQUEUED", "DISPATCHED", "RELEASED"] as const;
const TASK_STATUS_SCHEDULER_EVENTS = [
  "STARTED",
  "SUCCEEDED",
  "FAILED",
  "CRASH_DETECTED",
  "RETRYING",
  "RESOURCE_BUDGET_EXCEEDED",
  "RESOURCE_BUDGET_KILLED"
] as const;
const TASK_STATUS_SUBTASK_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETE", "FAILED"] as const;
const GHOST_TAB_TASK_STATES: readonly GhostTabTaskState[] = [
  "IDLE",
  "LOADING",
  "PERCEIVING",
  "INFERRING",
  "ACTING",
  "COMPLETE",
  "FAILED"
];
const GHOST_TAB_TASK_ERROR_TYPES: readonly GhostTabTaskErrorType[] = [
  "NETWORK",
  "RUNTIME",
  "CDP",
  "TIMEOUT",
  "VALIDATION",
  "STATE",
  "UNKNOWN"
];

export type GhostTabIpcRequestType = (typeof GHOST_TAB_IPC_REQUEST_TYPES)[number];
export type GhostTabIpcResponseType = (typeof GHOST_TAB_IPC_RESPONSE_TYPES)[number];
export type GhostTabIpcMessageType = GhostTabIpcRequestType | GhostTabIpcResponseType;

export interface NavigateIpcPayload {
  url: string;
  timeoutMs?: number;
}

export type ScreenshotIpcPayload = CaptureScreenshotOptions;

export interface AxTreeIpcPayload {
  includeBoundingBoxes?: boolean;
  charBudget?: number;
}

export interface InjectJsIpcPayload {
  expression: string;
  awaitPromise?: boolean;
  returnByValue?: boolean;
}

export type InputEventIpcPayload = AgentActionInput;

export interface TaskResultIpcPayload {
  operation: GhostTabIpcRequestType;
  data: unknown;
}

export interface TaskErrorIpcPayload {
  operation: GhostTabIpcRequestType | "UNKNOWN";
  error: GhostTabTaskErrorDetail;
}

type GhostTabTaskPriority = (typeof GHOST_TAB_TASK_PRIORITIES)[number];
type TaskStatusKind = (typeof TASK_STATUS_KINDS)[number];
type TaskStatusQueueEvent = (typeof TASK_STATUS_QUEUE_EVENTS)[number];
type TaskStatusSchedulerEvent = (typeof TASK_STATUS_SCHEDULER_EVENTS)[number];
type TaskStatusSubtaskStatus = (typeof TASK_STATUS_SUBTASK_STATUSES)[number];

export interface QueueTaskStatusIpcPayload {
  kind: "QUEUE";
  event: TaskStatusQueueEvent;
  priority: GhostTabTaskPriority;
  queueDepth: number;
  available: number;
  inUse: number;
  contextId: string | null;
  waitMs: number | null;
  wasQueued: boolean;
}

export interface StateTaskStatusIpcPayload {
  kind: "STATE";
  from: GhostTabTaskState;
  to: GhostTabTaskState;
  step: number | null;
  url: string | null;
  reason: string | null;
}

export interface SchedulerTaskStatusIpcPayload {
  kind: "SCHEDULER";
  event: TaskStatusSchedulerEvent;
  priority: GhostTabTaskPriority;
  contextId: string | null;
  assignmentWaitMs: number;
  durationMs: number | null;
  error: GhostTabTaskErrorDetail | null;
}

export interface SubtaskTaskStatusIpcPayload {
  kind: "SUBTASK";
  subtaskId: string;
  subtaskIntent: string;
  status: TaskStatusSubtaskStatus;
  verificationType: string;
  verificationCondition: string;
  currentSubtaskIndex: number;
  totalSubtasks: number;
  attempt: number;
  checkpointLastCompletedSubtaskIndex: number;
  reason: string | null;
}

export type TaskStatusIpcPayload =
  | QueueTaskStatusIpcPayload
  | StateTaskStatusIpcPayload
  | SchedulerTaskStatusIpcPayload
  | SubtaskTaskStatusIpcPayload;

export interface GhostTabIpcPayloadByType {
  NAVIGATE: NavigateIpcPayload;
  SCREENSHOT: ScreenshotIpcPayload;
  AX_TREE: AxTreeIpcPayload;
  INJECT_JS: InjectJsIpcPayload;
  INPUT_EVENT: InputEventIpcPayload;
  TASK_RESULT: TaskResultIpcPayload;
  TASK_ERROR: TaskErrorIpcPayload;
  TASK_STATUS: TaskStatusIpcPayload;
}

export interface GhostTabIpcMessageBase<
  Type extends GhostTabIpcMessageType,
  Payload extends GhostTabIpcPayloadByType[Type]
> {
  schemaVersion: typeof GHOST_TAB_IPC_SCHEMA_VERSION;
  messageId: string;
  taskId: string;
  contextId: string;
  timestamp: string;
  type: Type;
  payload: Payload;
}

export type GhostTabIpcMessageByType<Type extends GhostTabIpcMessageType> = GhostTabIpcMessageBase<
  Type,
  GhostTabIpcPayloadByType[Type]
>;

export type GhostTabIpcNavigateMessage = GhostTabIpcMessageByType<"NAVIGATE">;
export type GhostTabIpcScreenshotMessage = GhostTabIpcMessageByType<"SCREENSHOT">;
export type GhostTabIpcAxTreeMessage = GhostTabIpcMessageByType<"AX_TREE">;
export type GhostTabIpcInjectJsMessage = GhostTabIpcMessageByType<"INJECT_JS">;
export type GhostTabIpcInputEventMessage = GhostTabIpcMessageByType<"INPUT_EVENT">;
export type GhostTabIpcTaskResultMessage = GhostTabIpcMessageByType<"TASK_RESULT">;
export type GhostTabIpcTaskErrorMessage = GhostTabIpcMessageByType<"TASK_ERROR">;
export type GhostTabIpcTaskStatusMessage = GhostTabIpcMessageByType<"TASK_STATUS">;

export type GhostTabIpcRequestMessage =
  | GhostTabIpcNavigateMessage
  | GhostTabIpcScreenshotMessage
  | GhostTabIpcAxTreeMessage
  | GhostTabIpcInjectJsMessage
  | GhostTabIpcInputEventMessage;

export type GhostTabIpcResponseMessage =
  | GhostTabIpcTaskResultMessage
  | GhostTabIpcTaskErrorMessage
  | GhostTabIpcTaskStatusMessage;
export type GhostTabIpcMessage = GhostTabIpcRequestMessage | GhostTabIpcResponseMessage;

export class GhostTabIpcValidationError extends Error {
  constructor(
    public readonly boundary: "inbound" | "outbound",
    public readonly details: string[],
    public readonly raw: unknown
  ) {
    super(`Invalid ${boundary} Ghost Tab IPC message: ${details.join("; ")}`);
    this.name = "GhostTabIpcValidationError";
  }
}

export type GhostTabIpcValidationResult =
  | {
      ok: true;
      message: GhostTabIpcMessage;
    }
  | {
      ok: false;
      error: GhostTabIpcValidationError;
    };

export function createGhostTabIpcMessage<Type extends GhostTabIpcMessageType>(input: {
  type: Type;
  taskId: string;
  contextId: string;
  payload: GhostTabIpcPayloadByType[Type];
  messageId?: string;
  timestamp?: string;
}): GhostTabIpcMessageByType<Type> {
  const message: GhostTabIpcMessageByType<Type> = {
    schemaVersion: GHOST_TAB_IPC_SCHEMA_VERSION,
    messageId: resolveString(input.messageId) ?? randomUUID(),
    taskId: mustResolveNonEmptyString(input.taskId, "taskId"),
    contextId: mustResolveNonEmptyString(input.contextId, "contextId"),
    timestamp: input.timestamp ?? new Date().toISOString(),
    type: input.type,
    payload: input.payload
  };

  assertValidGhostTabIpcMessage(message, "outbound");
  return message;
}

export function assertValidGhostTabIpcMessage(
  raw: unknown,
  boundary: "inbound" | "outbound" = "inbound"
): GhostTabIpcMessage {
  const result =
    boundary === "inbound" ? validateInboundGhostTabIpcMessage(raw) : validateOutboundGhostTabIpcMessage(raw);
  if (!result.ok) {
    throw result.error;
  }
  return result.message;
}

export function validateInboundGhostTabIpcMessage(raw: unknown): GhostTabIpcValidationResult {
  return validateGhostTabIpcMessage(raw, "inbound");
}

export function validateOutboundGhostTabIpcMessage(raw: unknown): GhostTabIpcValidationResult {
  return validateGhostTabIpcMessage(raw, "outbound");
}

function validateGhostTabIpcMessage(
  raw: unknown,
  boundary: "inbound" | "outbound"
): GhostTabIpcValidationResult {
  const details: string[] = [];
  if (!isRecord(raw)) {
    details.push("message must be an object");
    return {
      ok: false,
      error: new GhostTabIpcValidationError(boundary, details, raw)
    };
  }

  const schemaVersion = raw.schemaVersion;
  if (schemaVersion !== GHOST_TAB_IPC_SCHEMA_VERSION) {
    details.push(`schemaVersion must equal ${GHOST_TAB_IPC_SCHEMA_VERSION}`);
  }

  const messageId = validateNonEmptyString(raw.messageId, "messageId", details);
  const taskId = validateNonEmptyString(raw.taskId, "taskId", details);
  const contextId = validateNonEmptyString(raw.contextId, "contextId", details);
  const timestamp = validateNonEmptyString(raw.timestamp, "timestamp", details);
  if (timestamp && Number.isNaN(Date.parse(timestamp))) {
    details.push("timestamp must be a valid ISO date string");
  }

  const type = raw.type;
  if (typeof type !== "string" || !isGhostTabIpcMessageType(type)) {
    details.push(`type must be one of: ${[...GHOST_TAB_IPC_REQUEST_TYPES, ...GHOST_TAB_IPC_RESPONSE_TYPES].join(", ")}`);
  }

  if (!("payload" in raw)) {
    details.push("payload is required");
  }

  if (details.length > 0 || typeof type !== "string" || !isGhostTabIpcMessageType(type)) {
    return {
      ok: false,
      error: new GhostTabIpcValidationError(boundary, details, raw)
    };
  }

  const payload = (raw as Record<string, unknown>).payload;
  validatePayloadByType(type, payload, details);

  if (details.length > 0) {
    return {
      ok: false,
      error: new GhostTabIpcValidationError(boundary, details, raw)
    };
  }

  return {
    ok: true,
    message: {
      schemaVersion: GHOST_TAB_IPC_SCHEMA_VERSION,
      messageId: messageId as string,
      taskId: taskId as string,
      contextId: contextId as string,
      timestamp: timestamp as string,
      type,
      payload
    } as GhostTabIpcMessage
  };
}

function validatePayloadByType(
  type: GhostTabIpcMessageType,
  payload: unknown,
  details: string[]
): void {
  if (!isRecord(payload)) {
    details.push("payload must be an object");
    return;
  }

  switch (type) {
    case "NAVIGATE": {
      validateNonEmptyString(payload.url, "payload.url", details);
      validateOptionalPositiveNumber(payload.timeoutMs, "payload.timeoutMs", details);
      return;
    }
    case "SCREENSHOT": {
      if (
        payload.mode !== undefined &&
        payload.mode !== "viewport" &&
        payload.mode !== "full-page"
      ) {
        details.push("payload.mode must be 'viewport' or 'full-page'");
      }
      validateOptionalQuality(payload.quality, "payload.quality", details);
      validateOptionalBoolean(payload.fromSurface, "payload.fromSurface", details);
      if (payload.clip !== undefined) {
        if (!isRecord(payload.clip)) {
          details.push("payload.clip must be an object when provided");
        } else {
          validateRequiredFiniteNumber(payload.clip.x, "payload.clip.x", details);
          validateRequiredFiniteNumber(payload.clip.y, "payload.clip.y", details);
          validateRequiredFiniteNumber(payload.clip.width, "payload.clip.width", details);
          validateRequiredFiniteNumber(payload.clip.height, "payload.clip.height", details);
          validateOptionalFiniteNumber(payload.clip.scale, "payload.clip.scale", details);
        }
      }
      validateOptionalPositiveNumber(payload.scrollStepPx, "payload.scrollStepPx", details);
      validateOptionalPositiveNumber(payload.maxScrollSteps, "payload.maxScrollSteps", details);
      validateOptionalPositiveNumber(payload.scrollSettleMs, "payload.scrollSettleMs", details);
      return;
    }
    case "AX_TREE": {
      validateOptionalBoolean(payload.includeBoundingBoxes, "payload.includeBoundingBoxes", details);
      validateOptionalPositiveNumber(payload.charBudget, "payload.charBudget", details);
      return;
    }
    case "INJECT_JS": {
      validateNonEmptyString(payload.expression, "payload.expression", details);
      validateOptionalBoolean(payload.awaitPromise, "payload.awaitPromise", details);
      validateOptionalBoolean(payload.returnByValue, "payload.returnByValue", details);
      return;
    }
    case "INPUT_EVENT": {
      validateNonEmptyString(payload.action, "payload.action", details);
      if (
        typeof payload.action === "string" &&
        !INPUT_EVENT_ACTION_TYPES.includes(payload.action)
      ) {
        details.push(`payload.action must be one of: ${INPUT_EVENT_ACTION_TYPES.join(", ")}`);
      }
      if (payload.target !== undefined && payload.target !== null) {
        if (!isRecord(payload.target)) {
          details.push("payload.target must be an object or null");
        } else {
          validateRequiredFiniteNumber(payload.target.x, "payload.target.x", details);
          validateRequiredFiniteNumber(payload.target.y, "payload.target.y", details);
        }
      }
      if (payload.text !== undefined && payload.text !== null && typeof payload.text !== "string") {
        details.push("payload.text must be a string or null");
      }
      if (payload.confidence !== undefined) {
        validateRequiredFiniteNumber(payload.confidence, "payload.confidence", details);
        if (typeof payload.confidence === "number" && (payload.confidence < 0 || payload.confidence > 1)) {
          details.push("payload.confidence must be between 0 and 1");
        }
      }
      if (
        payload.reasoning !== undefined &&
        payload.reasoning !== null &&
        typeof payload.reasoning !== "string"
      ) {
        details.push("payload.reasoning must be a string or null");
      }
      return;
    }
    case "TASK_RESULT": {
      validateNonEmptyString(payload.operation, "payload.operation", details);
      if (typeof payload.operation === "string" && !isGhostTabIpcRequestType(payload.operation)) {
        details.push(
          `payload.operation must be one of: ${GHOST_TAB_IPC_REQUEST_TYPES.join(", ")}`
        );
      }
      if (!("data" in payload)) {
        details.push("payload.data is required");
      }
      return;
    }
    case "TASK_ERROR": {
      validateNonEmptyString(payload.operation, "payload.operation", details);
      if (
        typeof payload.operation === "string" &&
        payload.operation !== "UNKNOWN" &&
        !isGhostTabIpcRequestType(payload.operation)
      ) {
        details.push(
          `payload.operation must be one of: ${GHOST_TAB_IPC_REQUEST_TYPES.join(", ")}, UNKNOWN`
        );
      }
      validateTaskErrorPayload(payload.error, "payload.error", details);
      return;
    }
    case "TASK_STATUS": {
      validateNonEmptyString(payload.kind, "payload.kind", details);
      if (typeof payload.kind !== "string" || !TASK_STATUS_KINDS.includes(payload.kind as TaskStatusKind)) {
        details.push(`payload.kind must be one of: ${TASK_STATUS_KINDS.join(", ")}`);
        return;
      }

      if (payload.kind === "QUEUE") {
        validateNonEmptyString(payload.event, "payload.event", details);
        if (
          typeof payload.event === "string" &&
          !TASK_STATUS_QUEUE_EVENTS.includes(payload.event as TaskStatusQueueEvent)
        ) {
          details.push(`payload.event must be one of: ${TASK_STATUS_QUEUE_EVENTS.join(", ")}`);
        }

        validateNonEmptyString(payload.priority, "payload.priority", details);
        if (
          typeof payload.priority === "string" &&
          !GHOST_TAB_TASK_PRIORITIES.includes(payload.priority as GhostTabTaskPriority)
        ) {
          details.push(`payload.priority must be one of: ${GHOST_TAB_TASK_PRIORITIES.join(", ")}`);
        }

        validateNonNegativeFiniteNumber(payload.queueDepth, "payload.queueDepth", details);
        validateNonNegativeFiniteNumber(payload.available, "payload.available", details);
        validateNonNegativeFiniteNumber(payload.inUse, "payload.inUse", details);
        validateNullableString(payload.contextId, "payload.contextId", details);
        validateNullableNonNegativeFiniteNumber(payload.waitMs, "payload.waitMs", details);
        validateOptionalBoolean(payload.wasQueued, "payload.wasQueued", details, false);
        return;
      }

      if (payload.kind === "STATE") {
        validateNonEmptyString(payload.from, "payload.from", details);
        if (typeof payload.from === "string" && !isGhostTabTaskState(payload.from)) {
          details.push(`payload.from must be one of: ${GHOST_TAB_TASK_STATES.join(", ")}`);
        }

        validateNonEmptyString(payload.to, "payload.to", details);
        if (typeof payload.to === "string" && !isGhostTabTaskState(payload.to)) {
          details.push(`payload.to must be one of: ${GHOST_TAB_TASK_STATES.join(", ")}`);
        }

        validateNullableFiniteNumber(payload.step, "payload.step", details);
        validateNullableString(payload.url, "payload.url", details);
        validateNullableString(payload.reason, "payload.reason", details);
        return;
      }

      if (payload.kind === "SUBTASK") {
        validateNonEmptyString(payload.subtaskId, "payload.subtaskId", details);
        validateNonEmptyString(payload.subtaskIntent, "payload.subtaskIntent", details);
        validateNonEmptyString(payload.status, "payload.status", details);
        if (
          typeof payload.status === "string" &&
          !TASK_STATUS_SUBTASK_STATUSES.includes(payload.status as TaskStatusSubtaskStatus)
        ) {
          details.push(
            `payload.status must be one of: ${TASK_STATUS_SUBTASK_STATUSES.join(", ")}`
          );
        }

        validateNonEmptyString(payload.verificationType, "payload.verificationType", details);
        validateNonEmptyString(payload.verificationCondition, "payload.verificationCondition", details);
        validateNonNegativeFiniteNumber(payload.currentSubtaskIndex, "payload.currentSubtaskIndex", details);
        validateNonNegativeFiniteNumber(payload.totalSubtasks, "payload.totalSubtasks", details);
        validateNonNegativeFiniteNumber(payload.attempt, "payload.attempt", details);
        validateRequiredFiniteNumber(
          payload.checkpointLastCompletedSubtaskIndex,
          "payload.checkpointLastCompletedSubtaskIndex",
          details
        );
        if (
          typeof payload.checkpointLastCompletedSubtaskIndex === "number" &&
          payload.checkpointLastCompletedSubtaskIndex < -1
        ) {
          details.push("payload.checkpointLastCompletedSubtaskIndex must be >= -1");
        }
        validateNullableString(payload.reason, "payload.reason", details);
        return;
      }

      validateNonEmptyString(payload.event, "payload.event", details);
      if (
        typeof payload.event === "string" &&
        !TASK_STATUS_SCHEDULER_EVENTS.includes(payload.event as TaskStatusSchedulerEvent)
      ) {
        details.push(
          `payload.event must be one of: ${TASK_STATUS_SCHEDULER_EVENTS.join(", ")}`
        );
      }

      validateNonEmptyString(payload.priority, "payload.priority", details);
      if (
        typeof payload.priority === "string" &&
        !GHOST_TAB_TASK_PRIORITIES.includes(payload.priority as GhostTabTaskPriority)
      ) {
        details.push(`payload.priority must be one of: ${GHOST_TAB_TASK_PRIORITIES.join(", ")}`);
      }

      validateNullableString(payload.contextId, "payload.contextId", details);
      validateNonNegativeFiniteNumber(payload.assignmentWaitMs, "payload.assignmentWaitMs", details);
      validateNullableNonNegativeFiniteNumber(payload.durationMs, "payload.durationMs", details);
      if (payload.error !== null && payload.error !== undefined) {
        validateTaskErrorPayload(payload.error, "payload.error", details);
      }
      return;
    }
    default: {
      details.push(`Unsupported message type: ${String(type)}`);
    }
  }
}

function validateNonEmptyString(value: unknown, field: string, details: string[]): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    details.push(`${field} must be a non-empty string`);
    return null;
  }
  return value.trim();
}

function validateOptionalBoolean(
  value: unknown,
  field: string,
  details: string[],
  allowUndefined = true
): void {
  if (value === undefined && allowUndefined) {
    return;
  }
  if (typeof value !== "boolean") {
    details.push(`${field} must be a boolean`);
  }
}

function validateOptionalPositiveNumber(value: unknown, field: string, details: string[]): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    details.push(`${field} must be a positive finite number`);
  }
}

function validateOptionalFiniteNumber(value: unknown, field: string, details: string[]): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    details.push(`${field} must be a finite number`);
  }
}

function validateNullableFiniteNumber(value: unknown, field: string, details: string[]): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    details.push(`${field} must be a finite number or null`);
  }
}

function validateNullableNonNegativeFiniteNumber(
  value: unknown,
  field: string,
  details: string[]
): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    details.push(`${field} must be a non-negative finite number or null`);
  }
}

function validateRequiredFiniteNumber(value: unknown, field: string, details: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    details.push(`${field} must be a finite number`);
  }
}

function validateNonNegativeFiniteNumber(value: unknown, field: string, details: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    details.push(`${field} must be a non-negative finite number`);
  }
}

function validateNullableString(value: unknown, field: string, details: string[]): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value !== "string") {
    details.push(`${field} must be a string or null`);
  }
}

function validateTaskErrorPayload(value: unknown, field: string, details: string[]): void {
  if (!isRecord(value)) {
    details.push(`${field} must be an object`);
    return;
  }
  validateNonEmptyString(value.type, `${field}.type`, details);
  if (
    typeof value.type === "string" &&
    !GHOST_TAB_TASK_ERROR_TYPES.includes(value.type as GhostTabTaskErrorType)
  ) {
    details.push(`${field}.type must be one of: ${GHOST_TAB_TASK_ERROR_TYPES.join(", ")}`);
  }
  validateNullableFiniteNumber(value.status, `${field}.status`, details);
  validateNullableString(value.url, `${field}.url`, details);
  validateNonEmptyString(value.message, `${field}.message`, details);
  validateOptionalBoolean(value.retryable, `${field}.retryable`, details, false);
  validateNullableString(value.errorType, `${field}.errorType`, details);
  validateNullableFiniteNumber(value.step, `${field}.step`, details);
}

function validateOptionalQuality(value: unknown, field: string, details: string[]): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    details.push(`${field} must be a finite number between 0 and 100`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isGhostTabIpcMessageType(value: string): value is GhostTabIpcMessageType {
  return [...GHOST_TAB_IPC_REQUEST_TYPES, ...GHOST_TAB_IPC_RESPONSE_TYPES].includes(
    value as GhostTabIpcMessageType
  );
}

function isGhostTabIpcRequestType(value: string): value is GhostTabIpcRequestType {
  return GHOST_TAB_IPC_REQUEST_TYPES.includes(value as GhostTabIpcRequestType);
}

function isGhostTabTaskState(value: string): value is GhostTabTaskState {
  return GHOST_TAB_TASK_STATES.includes(value as GhostTabTaskState);
}

function resolveString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mustResolveNonEmptyString(value: string, field: string): string {
  const resolved = resolveString(value);
  if (!resolved) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return resolved;
}
