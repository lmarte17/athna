import type { ActionExecutionResult } from "../cdp/client.js";
import type { NavigatorActionDecision, NavigatorEscalationReason } from "../navigator/engine.js";

const FINGERPRINT_TARGET_BUCKET_PX = 24;
const MAX_FINGERPRINT_TEXT_LENGTH = 64;

export type DeadlockTrigger =
  | "REPEATED_NO_PROGRESS"
  | "REPEATED_LOW_CONFIDENCE"
  | "REPEATED_BLOCKED_ACTION"
  | "SAME_URL_SUBTASK_STALL";

export interface CachePolicyInput {
  noProgressStreak: number;
  escalationReason: NavigatorEscalationReason | null;
}

export interface ActionFingerprintInput {
  action: NavigatorActionDecision;
  url: string;
}

export interface RegisterActionFingerprintOutcomeInput {
  fingerprint: string;
  producedProgress: boolean;
  step: number;
  noProgressFingerprintCounts: Map<string, number>;
  bannedFingerprints: Map<string, number>;
}

export interface RegisterActionFingerprintOutcomeResult {
  noProgressCount: number;
  newlyBanned: boolean;
  bannedUntilStep: number | null;
}

export interface BuildDisallowedActionFingerprintsInput {
  bannedFingerprints: Map<string, number>;
  step: number;
}

export interface DeadlockEvaluationInput {
  noProgressStreak: number;
  lowConfidenceStreak: number;
  blockedActionStreak: number;
  sameUrlSubtaskNoProgressStreak: number;
  maxNoProgressSteps: number;
}

export interface DeadlockEvaluationResult {
  triggers: DeadlockTrigger[];
  shouldReplanSubtask: boolean;
}

export function createActionFingerprint(input: ActionFingerprintInput): string {
  const urlPart = normalizeUrlForFingerprint(input.url);
  const targetPart = normalizeTargetForFingerprint(input.action.target);
  const textPart = normalizeTextForFingerprint(input.action.text);
  const keyPart = normalizeKeyForFingerprint(input.action.key ?? null);
  return [urlPart, input.action.action, targetPart, keyPart, textPart].join("|");
}

export function shouldReadDecisionCache(input: CachePolicyInput): boolean {
  if (input.noProgressStreak > 0) {
    return false;
  }
  return true;
}

export function shouldWriteDecisionCache(input: CachePolicyInput): boolean {
  if (input.noProgressStreak > 0) {
    return false;
  }
  if (input.escalationReason === "NO_PROGRESS" || input.escalationReason === "AX_DEFICIENT") {
    return false;
  }
  return true;
}

export function buildDisallowedActionFingerprints(
  input: BuildDisallowedActionFingerprintsInput
): string[] {
  const disallowed: string[] = [];
  for (const [fingerprint, bannedUntilStep] of input.bannedFingerprints.entries()) {
    if (bannedUntilStep >= input.step) {
      disallowed.push(fingerprint);
    } else {
      input.bannedFingerprints.delete(fingerprint);
    }
  }
  return disallowed;
}

export function registerActionFingerprintOutcome(
  input: RegisterActionFingerprintOutcomeInput
): RegisterActionFingerprintOutcomeResult {
  if (input.producedProgress) {
    input.noProgressFingerprintCounts.delete(input.fingerprint);
    input.bannedFingerprints.delete(input.fingerprint);
    return {
      noProgressCount: 0,
      newlyBanned: false,
      bannedUntilStep: null
    };
  }

  const count = (input.noProgressFingerprintCounts.get(input.fingerprint) ?? 0) + 1;
  input.noProgressFingerprintCounts.set(input.fingerprint, count);

  if (count >= 2) {
    const bannedUntilStep = input.step + 1;
    input.bannedFingerprints.set(input.fingerprint, bannedUntilStep);
    return {
      noProgressCount: count,
      newlyBanned: true,
      bannedUntilStep
    };
  }

  return {
    noProgressCount: count,
    newlyBanned: false,
    bannedUntilStep: null
  };
}

export function isNoProgressStep(input: {
  action: NavigatorActionDecision;
  urlAtPerception: string;
  urlAfterAction: string;
  execution: ActionExecutionResult;
}): boolean {
  if (input.execution.status !== "acted") {
    return false;
  }

  if (
    input.execution.navigationObserved ||
    input.execution.domMutationObserved ||
    input.execution.urlChanged
  ) {
    return false;
  }

  switch (input.action.action) {
    case "TYPE":
      return !(input.execution.inputValueChanged || input.execution.focusChanged);
    case "SCROLL":
      return !input.execution.scrollChanged;
    case "PRESS_KEY":
      return !(
        input.execution.focusChanged ||
        input.execution.inputValueChanged ||
        input.execution.scrollChanged
      );
    default:
      if (
        input.execution.focusChanged ||
        input.execution.inputValueChanged ||
        input.execution.scrollChanged
      ) {
        return false;
      }
      return input.urlAfterAction === input.urlAtPerception;
  }
}

export function shouldScheduleSubmitFallback(input: {
  action: NavigatorActionDecision;
  execution: ActionExecutionResult;
}): boolean {
  if (input.action.action !== "TYPE") {
    return false;
  }

  if (!input.execution.inputValueChanged && !input.execution.focusChanged) {
    return false;
  }

  if (input.execution.navigationObserved || input.execution.urlChanged) {
    return false;
  }

  const text = input.action.text ?? "";
  if (/\[enter\]|\n/i.test(text)) {
    return false;
  }

  return true;
}

export function createSubmitFallbackAction(reasoning?: string): NavigatorActionDecision {
  return {
    action: "PRESS_KEY",
    target: null,
    text: null,
    key: "Enter",
    confidence: 0.9,
    reasoning:
      reasoning ??
      "Deterministic submit fallback after successful typing: press Enter before escalating tiers."
  };
}

export function createDiversificationFallbackAction(input: {
  previousAction: NavigatorActionDecision;
  reason?: string;
}): NavigatorActionDecision {
  const reasonPrefix = input.reason ? `${input.reason}. ` : "";
  switch (input.previousAction.action) {
    case "TYPE":
      return {
        action: "PRESS_KEY",
        target: null,
        text: null,
        key: "Enter",
        confidence: Math.max(0.6, input.previousAction.confidence - 0.1),
        reasoning:
          `${reasonPrefix}Diversification fallback: submit via Enter after repeated no-progress typing.`
      };
    case "PRESS_KEY":
      return {
        action: "SCROLL",
        target: null,
        text: "400",
        key: null,
        confidence: Math.max(0.6, input.previousAction.confidence - 0.1),
        reasoning:
          `${reasonPrefix}Diversification fallback: perform a small scroll to expose a new interaction surface.`
      };
    case "SCROLL":
      return {
        action: "WAIT",
        target: null,
        text: "500",
        key: null,
        confidence: Math.max(0.6, input.previousAction.confidence - 0.1),
        reasoning:
          `${reasonPrefix}Diversification fallback: short wait before retrying with updated perception.`
      };
    case "CLICK":
    default:
      return {
        action: "WAIT",
        target: null,
        text: "500",
        key: null,
        confidence: Math.max(0.6, input.previousAction.confidence - 0.1),
        reasoning:
          `${reasonPrefix}Diversification fallback: avoid repeating the same click on an unchanged page state.`
      };
  }
}

export function evaluateDeadlockTriggers(
  input: DeadlockEvaluationInput
): DeadlockEvaluationResult {
  const triggers: DeadlockTrigger[] = [];
  if (input.noProgressStreak >= 2) {
    triggers.push("REPEATED_NO_PROGRESS");
  }
  if (input.lowConfidenceStreak >= 2) {
    triggers.push("REPEATED_LOW_CONFIDENCE");
  }
  if (input.blockedActionStreak >= 2) {
    triggers.push("REPEATED_BLOCKED_ACTION");
  }
  if (input.sameUrlSubtaskNoProgressStreak >= 3) {
    triggers.push("SAME_URL_SUBTASK_STALL");
  }

  const shouldReplanSubtask =
    input.sameUrlSubtaskNoProgressStreak >= 3 || input.noProgressStreak >= input.maxNoProgressSteps;

  return {
    triggers,
    shouldReplanSubtask
  };
}

function normalizeUrlForFingerprint(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return "unknown-url";
  }

  try {
    const parsed = new URL(trimmed);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return trimmed;
  }
}

function normalizeTargetForFingerprint(
  target: NavigatorActionDecision["target"]
): string {
  if (!target) {
    return "none";
  }

  const bucketX = Math.round(target.x / FINGERPRINT_TARGET_BUCKET_PX);
  const bucketY = Math.round(target.y / FINGERPRINT_TARGET_BUCKET_PX);
  return `${bucketX},${bucketY}`;
}

function normalizeTextForFingerprint(text: string | null): string {
  if (!text) {
    return "none";
  }

  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "none";
  }

  return normalized.slice(0, MAX_FINGERPRINT_TEXT_LENGTH);
}

function normalizeKeyForFingerprint(key: NavigatorActionDecision["key"]): string {
  if (!key) {
    return "none";
  }

  return key.toLowerCase();
}
