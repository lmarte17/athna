import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  type FunctionDeclaration,
  Type,
  createPartFromBase64,
  createPartFromText,
  createUserContent
} from "@google/genai";

import type { InteractiveElementIndexEntry } from "../cdp/client.js";
import { resolvePromptTokenAlertThresholdFromEnv } from "./context-window.js";

const DEFAULT_FLASH_MODEL = "gemini-2.5-flash";
const DEFAULT_PRO_MODEL = "gemini-2.5-pro";
const MAX_MALFORMED_RETRIES = 1;
const ACTION_TYPES = ["CLICK", "TYPE", "PRESS_KEY", "SCROLL", "WAIT", "EXTRACT", "DONE", "FAILED"] as const;
const SPECIAL_KEYS = ["Enter", "Tab", "Escape"] as const;
const COMPUTER_USE_FUNCTION_NAMES = [
  "click_at",
  "type_text_at",
  "key_combination",
  "scroll_document",
  "wait_5_seconds",
  "answer_from_screen",
  "mark_failed"
] as const;
const COMPUTER_USE_MIN_CONFIDENCE = 0.55;
const COMPUTER_USE_DEFAULT_CONFIDENCE = 0.8;
const COMPUTER_USE_DEFAULT_SCROLL_PX = 800;
const COMPUTER_USE_DEFAULT_WAIT_MS = 5_000;

const COMPUTER_USE_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "click_at",
    description: "Click at explicit screen coordinates when the target is visible.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        x: { type: Type.NUMBER },
        y: { type: Type.NUMBER },
        confidence: { type: Type.NUMBER },
        reasoning: { type: Type.STRING }
      },
      required: ["x", "y"]
    }
  },
  {
    name: "type_text_at",
    description:
      "Type text into an input. Optionally provide x/y to focus first; omit x/y to type into current focus.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        text: { type: Type.STRING },
        x: { type: Type.NUMBER },
        y: { type: Type.NUMBER },
        confidence: { type: Type.NUMBER },
        reasoning: { type: Type.STRING }
      },
      required: ["text"]
    }
  },
  {
    name: "key_combination",
    description: "Press a special key for submit or navigation.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        key: { type: Type.STRING, enum: ["Enter", "Tab", "Escape"] },
        confidence: { type: Type.NUMBER },
        reasoning: { type: Type.STRING }
      },
      required: ["key"]
    }
  },
  {
    name: "scroll_document",
    description: "Scroll the document to reveal additional content.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        direction: { type: Type.STRING, enum: ["up", "down"] },
        amount: { type: Type.INTEGER },
        confidence: { type: Type.NUMBER },
        reasoning: { type: Type.STRING }
      }
    }
  },
  {
    name: "wait_5_seconds",
    description: "Wait briefly for async UI updates before the next action.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        milliseconds: { type: Type.INTEGER },
        confidence: { type: Type.NUMBER },
        reasoning: { type: Type.STRING }
      }
    }
  },
  {
    name: "answer_from_screen",
    description: "Complete the task when the answer is visible on the current page.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        answer: { type: Type.STRING },
        confidence: { type: Type.NUMBER },
        reasoning: { type: Type.STRING }
      },
      required: ["answer"]
    }
  },
  {
    name: "mark_failed",
    description: "Fail only when no safe or plausible action remains.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: { type: Type.STRING },
        confidence: { type: Type.NUMBER }
      },
      required: ["reason"]
    }
  }
];

export type NavigatorActionType = (typeof ACTION_TYPES)[number];
export type NavigatorSpecialKey = (typeof SPECIAL_KEYS)[number];

export interface NavigatorActionTarget {
  x: number;
  y: number;
}

export interface NavigatorActionDecision {
  action: NavigatorActionType;
  target: NavigatorActionTarget | null;
  text: string | null;
  key: NavigatorSpecialKey | null;
  confidence: number;
  reasoning: string;
}

export type NavigatorInferenceTier = "TIER_1_AX" | "TIER_2_VISION";
export type NavigatorDecisionMode = "STANDARD" | "READ_SCREEN" | "COMPUTER_USE";
export type NavigatorEscalationReason =
  | "LOW_CONFIDENCE"
  | "AX_DEFICIENT"
  | "RETRY_AFTER_SCROLL"
  | "NO_PROGRESS"
  | "UNSAFE_ACTION";

export interface NavigatorScreenshotInput {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  mode?: string;
}

export interface NavigatorObservationInput {
  currentUrl?: string;
  interactiveElementIndex?: InteractiveElementIndexEntry[];
  normalizedAXTree?: unknown[];
  noProgressStreak?: number;
  disallowedActionFingerprints?: string[];
  previousActions?: NavigatorActionDecision[];
  previousObservations?: string[];
  historySummary?: string | null;
  contextWindowStats?: NavigatorObservationContextStats | null;
  taskSubtasks?: NavigatorObservationSubtask[] | null;
  activeSubtask?: NavigatorActiveSubtask | null;
  checkpointState?: NavigatorCheckpointState | null;
  structuredError?: NavigatorStructuredError | null;
  screenshot?: NavigatorScreenshotInput | null;
}

export interface NavigatorObservationContextStats {
  recentPairCount: number;
  summarizedPairCount: number;
  totalPairCount: number;
  summaryCharCount: number;
}

export interface NavigatorObservationSubtask {
  id: string;
  intent: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETE" | "FAILED";
  verification: {
    type: string;
    condition: string;
  };
}

export interface NavigatorActiveSubtask {
  id: string;
  intent: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETE" | "FAILED";
  verification: {
    type: string;
    condition: string;
  };
  currentSubtaskIndex: number;
  totalSubtasks: number;
  attempt: number;
}

export interface NavigatorCheckpointState {
  lastCompletedSubtaskIndex: number;
  currentSubtaskAttempt: number;
}

export type NavigatorStructuredErrorType = "NETWORK" | "RUNTIME" | "CDP" | "TIMEOUT";

export interface NavigatorStructuredError {
  type: NavigatorStructuredErrorType;
  status: number | null;
  url: string;
  message: string;
  retryable: boolean;
  errorType?: string | null;
}

export interface NavigatorDecisionRequest {
  intent: string;
  observation: NavigatorObservationInput;
  tier?: NavigatorInferenceTier;
  decisionMode?: NavigatorDecisionMode;
  escalationReason?: NavigatorEscalationReason | null;
}

export interface NavigatorEngine {
  decideNextAction(input: NavigatorDecisionRequest): Promise<NavigatorActionDecision>;
}

export interface NavigatorEngineOptions {
  flashModel?: string;
  proModel?: string;
}

export interface NavigatorPromptBudgetEstimate {
  promptCharCount: number;
  estimatedPromptTokens: number;
  alertThreshold: number;
  exceedsAlertThreshold: boolean;
}

interface GeminiClientContext {
  ai: GoogleGenAI;
  authMode: "gemini-api-key" | "vertex-ai";
}

type ComputerUseFunctionCall = {
  name?: string;
  arguments?: unknown;
  args?: unknown;
};

class GeminiTieredNavigatorEngine implements NavigatorEngine {
  constructor(
    private readonly flashModel: string,
    private readonly proModel: string,
    private readonly clientContext: GeminiClientContext
  ) {}

  async decideNextAction(input: NavigatorDecisionRequest): Promise<NavigatorActionDecision> {
    if (!input.intent || !input.intent.trim()) {
      throw new Error("Navigator intent is required.");
    }

    const tier = input.tier ?? "TIER_1_AX";
    const decisionMode = input.decisionMode ?? "STANDARD";
    if (tier === "TIER_2_VISION" && !input.observation.screenshot) {
      throw new Error("Tier 2 vision inference requires a screenshot payload.");
    }
    if (decisionMode === "COMPUTER_USE" && !input.observation.screenshot) {
      throw new Error("Computer-use inference requires a screenshot payload.");
    }
    if (decisionMode === "COMPUTER_USE") {
      return this.decideComputerUseAction(input, tier);
    }
    const challengeMode = shouldUseChallengeMode(input);

    const userPayload = buildNavigatorUserPayload(input, tier);
    let previousRawResponse: string | null = null;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_MALFORMED_RETRIES; attempt += 1) {
      const response = await this.clientContext.ai.models.generateContent({
        model: tier === "TIER_2_VISION" ? this.proModel : this.flashModel,
        contents: buildNavigatorContents(
          buildNavigatorPrompt(userPayload, previousRawResponse, attempt, challengeMode),
          input.observation.screenshot
        ),
        config: {
          responseMimeType: "application/json"
        }
      });

      const rawText = response.text ?? "";

      try {
        return parseAndValidateNavigatorAction(rawText);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        previousRawResponse = rawText;

        if (attempt === MAX_MALFORMED_RETRIES) {
          break;
        }
      }
    }

    throw new Error(
      `Navigator response parsing failed after ${MAX_MALFORMED_RETRIES + 1} attempt(s): ${lastError?.message ?? "unknown error"}`
    );
  }

  private async decideComputerUseAction(
    input: NavigatorDecisionRequest,
    tier: NavigatorInferenceTier
  ): Promise<NavigatorActionDecision> {
    const userPayload = buildNavigatorUserPayload(input, tier);
    let previousRawResponse: string | null = null;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_MALFORMED_RETRIES; attempt += 1) {
      const response = await this.clientContext.ai.models.generateContent({
        model: this.proModel,
        contents: buildNavigatorContents(
          buildComputerUsePrompt(userPayload, previousRawResponse, attempt),
          input.observation.screenshot
        ),
        config: {
          tools: [
            {
              functionDeclarations: [...COMPUTER_USE_FUNCTION_DECLARATIONS]
            }
          ],
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.ANY,
              allowedFunctionNames: [...COMPUTER_USE_FUNCTION_NAMES]
            }
          }
        }
      });

      const rawText = response.text ?? "";
      try {
        return parseComputerUseNavigatorAction(response.functionCalls, rawText);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        previousRawResponse = rawText;
        if (attempt === MAX_MALFORMED_RETRIES) {
          break;
        }
      }
    }

    throw new Error(
      `Computer-use response parsing failed after ${MAX_MALFORMED_RETRIES + 1} attempt(s): ${lastError?.message ?? "unknown error"}`
    );
  }
}

function buildNavigatorContents(
  prompt: string,
  screenshot: NavigatorScreenshotInput | null | undefined
) {
  if (!screenshot) {
    return createUserContent(createPartFromText(prompt));
  }

  return createUserContent([
    createPartFromText(prompt),
    createPartFromBase64(screenshot.base64, screenshot.mimeType)
  ]);
}

function buildNavigatorUserPayload(
  input: NavigatorDecisionRequest,
  tier: NavigatorInferenceTier
): Record<string, unknown> {
  const previousActions = input.observation.previousActions ?? [];
  const observation: Record<string, unknown> = {
    currentUrl: input.observation.currentUrl ?? null,
    noProgressStreak: input.observation.noProgressStreak ?? 0,
    disallowedActionFingerprints: input.observation.disallowedActionFingerprints ?? [],
    previousActions,
    previousObservations: input.observation.previousObservations ?? [],
    historySummary: input.observation.historySummary ?? null,
    contextWindowStats: input.observation.contextWindowStats ?? null,
    taskSubtasks: input.observation.taskSubtasks ?? [],
    activeSubtask: input.observation.activeSubtask ?? null,
    checkpointState: input.observation.checkpointState ?? null,
    structuredError: input.observation.structuredError ?? null
  };

  if (input.observation.interactiveElementIndex && input.observation.interactiveElementIndex.length > 0) {
    observation.interactiveElementIndex = input.observation.interactiveElementIndex;
  } else {
    observation.interactiveElementIndex = [];
  }

  if (input.observation.normalizedAXTree && input.observation.normalizedAXTree.length > 0) {
    observation.normalizedAXTree = input.observation.normalizedAXTree;
  } else {
    observation.normalizedAXTree = [];
  }

  if (input.observation.screenshot) {
    observation.screenshot = {
      mimeType: input.observation.screenshot.mimeType,
      width: input.observation.screenshot.width,
      height: input.observation.screenshot.height,
      mode: input.observation.screenshot.mode ?? null
    };
  } else {
    observation.screenshot = null;
  }

  return {
    intent: input.intent.trim(),
    tier,
    decisionMode: input.decisionMode ?? "STANDARD",
    escalationReason: input.escalationReason ?? null,
    isInitialStep: previousActions.length === 0,
    observation
  };
}

function buildNavigatorPrompt(
  payload: Record<string, unknown>,
  previousRawResponse: string | null,
  attempt: number,
  challengeMode: boolean
): string {
  const correctionSection =
    attempt === 0
      ? ""
      : [
          "Your previous response was invalid JSON for the required schema.",
          "Previous response:",
          previousRawResponse ?? "(empty)",
          "Return ONLY valid JSON now."
        ].join("\n");

  return [
    "You are the Ghost Browser Navigator Engine.",
    "Decide exactly one next action for the current web page based on the user's intent and page context.",
    "Use this exact JSON schema and no extra keys:",
    '{"action":"CLICK|TYPE|PRESS_KEY|SCROLL|WAIT|EXTRACT|DONE|FAILED","target":{"x":number,"y":number}|null,"text":string|null,"key":"Enter|Tab|Escape"|null,"confidence":number,"reasoning":string}',
    "Rules:",
    "- action must be uppercase and one of the allowed values.",
    "- confidence must be between 0.0 and 1.0.",
    "- For CLICK, target must be non-null and point to the best matching interactive element.",
    "- For TYPE, text must be non-empty; target may be null if typing into focused input.",
    "- For PRESS_KEY, key must be one of Enter, Tab, Escape and target must be null.",
    "- If isInitialStep=true for a search intent, the first action MUST be CLICK on the best input/search field before any TYPE action.",
    "- normalizedAXTree may be raw normalized nodes OR a compact encoded array where index 0 is a legend string. Use the legend to decode.",
    "- previousActions/previousObservations contain only the most recent context window.",
    "- historySummary compresses older steps; use it to preserve continuity without repeating stale actions.",
    "- Prioritize recent context-window entries when they conflict with older historySummary details.",
    "- taskSubtasks contains ordered subtasks and their statuses for checkpoint-aware execution.",
    "- activeSubtask is the current objective; prioritize actions that satisfy its verification condition.",
    "- checkpointState tracks completed subtasks and current retry attempt.",
    "- structuredError, when present, is an orchestration-caught failure object: {type,status,url,message,retryable,errorType?}.",
    "- For NETWORK structuredError, errorType can be DNS_FAILURE, CONNECTION_TIMEOUT, TLS_ERROR, HTTP_4XX, HTTP_5XX, CONNECTION_FAILED, or UNKNOWN_NETWORK_ERROR.",
    "- If structuredError.retryable=true, prefer a concrete retry/recovery action before FAILED when plausible.",
    "- If structuredError.retryable=false and no alternative route is clear, return FAILED with concise reasoning.",
    "- When tier is TIER_2_VISION, use the screenshot as visual ground truth for coordinates.",
    "- If no actionable target is present in current viewport, return SCROLL with text=\"800\".",
    "- If decisionMode=READ_SCREEN and the requested answer is clearly visible, return DONE with text containing the concise answer.",
    "- In decisionMode=READ_SCREEN, avoid clicks/typing unless the answer is not visible and cannot be inferred safely.",
    "- If decisionMode=COMPUTER_USE, emit a normal JSON action (not function calls) only when tool mode is unavailable.",
    "- If noProgressStreak > 0, do not repeat the same action/target/text combination.",
    "- disallowedActionFingerprints lists action fingerprints to avoid on this step.",
    "- Keep reasoning concise.",
    "- Return valid JSON only, no markdown.",
    challengeMode
      ? "Challenge-mode constraints: expect decoy popups/buttons; follow explicit step instructions; avoid fake navigation."
      : "",
    challengeMode
      ? "Treat popups and marketing banners as decoys by default; attempt at most one dismissal per popup, then move on."
      : "",
    challengeMode
      ? "When a page requests a code, prioritize revealing/retrieving the code and submitting it before using any next-step navigation."
      : "",
    challengeMode
      ? "Avoid repeating the same click on an unchanged page; switch strategy (close blocker, reveal code, focus code input, submit)."
      : "",
    challengeMode
      ? "If popup-close attempts do not change state, ignore popups and directly target instruction-linked controls (Reveal Code, code input, Submit)."
      : "",
    correctionSection,
    "Context payload:",
    JSON.stringify(payload)
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function buildComputerUsePrompt(
  payload: Record<string, unknown>,
  previousRawResponse: string | null,
  attempt: number
): string {
  const correctionSection =
    attempt === 0
      ? ""
      : [
          "Your previous response did not contain a valid function call.",
          "Previous raw response:",
          previousRawResponse ?? "(empty)",
          "Call exactly one function now."
        ].join("\n");

  return [
    "You are the Ghost Browser Navigator in COMPUTER_USE mode.",
    "Choose exactly one function call to progress the task safely.",
    "Use the screenshot as ground truth for coordinates.",
    "Never repeat disallowed action fingerprints in the payload.",
    "If text was typed and submit is needed, prefer key_combination with Enter.",
    "Use answer_from_screen only when the requested answer is clearly visible.",
    "Use mark_failed only when no safe route is plausible.",
    "Do not output markdown or plain JSON text. Emit exactly one function call.",
    correctionSection,
    "Context payload:",
    JSON.stringify(payload)
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function shouldUseChallengeMode(input: NavigatorDecisionRequest): boolean {
  if (!isChallengeModeEnabledByEnv()) {
    return false;
  }

  const intent = input.intent.toLowerCase();
  const currentUrl = String(input.observation.currentUrl ?? "").toLowerCase();
  return (
    intent.includes("challenge") ||
    currentUrl.includes("serene-frangipane-7fd25b.netlify.app")
  );
}

function isChallengeModeEnabledByEnv(): boolean {
  const raw = process.env.NAVIGATOR_CHALLENGE_MODE;
  if (!raw) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function parseAndValidateNavigatorAction(rawText: string): NavigatorActionDecision {
  const parsed = parseJson(rawText);
  return validateNavigatorAction(parsed);
}

function parseJson(rawText: string): unknown {
  if (!rawText || !rawText.trim()) {
    throw new Error("Model returned an empty response.");
  }

  const trimmed = rawText.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (!fenceMatch) {
      throw new Error("Response was not valid JSON.");
    }
    return JSON.parse(fenceMatch[1]);
  }
}

function validateNavigatorAction(value: unknown): NavigatorActionDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Navigator response must be an object.");
  }

  const candidate = value as Record<string, unknown>;
  const action = String(candidate.action ?? "").toUpperCase() as NavigatorActionType;
  if (!ACTION_TYPES.includes(action)) {
    throw new Error(`Invalid action: ${String(candidate.action)}`);
  }

  const target = validateTarget(candidate.target);
  const text = validateText(candidate.text);
  const key = validateKey(candidate.key);
  const confidence = Number(candidate.confidence);
  const reasoning = typeof candidate.reasoning === "string" ? candidate.reasoning.trim() : "";

  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`Invalid confidence: ${String(candidate.confidence)}`);
  }

  if (!reasoning) {
    throw new Error("reasoning is required.");
  }

  if (action === "CLICK" && target === null) {
    throw new Error("CLICK action requires a target.");
  }

  if (action === "TYPE" && (!text || text.trim().length === 0)) {
    throw new Error("TYPE action requires non-empty text.");
  }

  if (action === "PRESS_KEY" && key === null) {
    throw new Error("PRESS_KEY action requires a non-null key.");
  }

  if (action === "PRESS_KEY" && target !== null) {
    throw new Error("PRESS_KEY action requires target=null.");
  }

  return {
    action,
    target,
    text,
    key,
    confidence,
    reasoning
  };
}

function validateTarget(target: unknown): NavigatorActionTarget | null {
  if (target === null || target === undefined) {
    return null;
  }

  if (typeof target !== "object" || Array.isArray(target)) {
    throw new Error("target must be an object or null.");
  }

  const candidate = target as Record<string, unknown>;
  const x = Number(candidate.x);
  const y = Number(candidate.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("target must include numeric x and y.");
  }

  return { x, y };
}

function validateText(text: unknown): string | null {
  if (text === null || text === undefined) {
    return null;
  }

  if (typeof text !== "string") {
    throw new Error("text must be a string or null.");
  }

  return text;
}

function validateKey(key: unknown): NavigatorSpecialKey | null {
  if (key === null || key === undefined) {
    return null;
  }

  if (typeof key !== "string") {
    throw new Error("key must be a string or null.");
  }

  if (!(SPECIAL_KEYS as readonly string[]).includes(key)) {
    throw new Error(`Invalid key: ${String(key)}`);
  }

  return key as NavigatorSpecialKey;
}

function parseComputerUseNavigatorAction(
  functionCalls: ComputerUseFunctionCall[] | undefined,
  rawText: string
): NavigatorActionDecision {
  if (Array.isArray(functionCalls) && functionCalls.length > 0) {
    return mapComputerUseFunctionCallToAction(functionCalls[0]);
  }

  // Graceful fallback when the model returns JSON instead of a function call.
  return parseAndValidateNavigatorAction(rawText);
}

function mapComputerUseFunctionCallToAction(functionCall: ComputerUseFunctionCall): NavigatorActionDecision {
  const functionName = String(functionCall.name ?? "")
    .trim()
    .toLowerCase();
  if (!functionName) {
    throw new Error("Computer-use response is missing function name.");
  }

  const args = normalizeFunctionCallArgs(functionCall);
  switch (functionName) {
    case "click_at":
      return createClickDecisionFromFunctionArgs(args);
    case "type_text_at":
      return createTypeDecisionFromFunctionArgs(args);
    case "key_combination":
      return createPressKeyDecisionFromFunctionArgs(args);
    case "scroll_document":
      return createScrollDecisionFromFunctionArgs(args);
    case "wait_5_seconds":
      return createWaitDecisionFromFunctionArgs(args);
    case "answer_from_screen":
      return createDoneDecisionFromFunctionArgs(args);
    case "mark_failed":
      return createFailedDecisionFromFunctionArgs(args);
    default:
      throw new Error(`Unsupported computer-use function call: ${functionName}`);
  }
}

function normalizeFunctionCallArgs(functionCall: ComputerUseFunctionCall): Record<string, unknown> {
  const rawArgs = functionCall.arguments ?? functionCall.args ?? {};
  if (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    return {};
  }
  return rawArgs as Record<string, unknown>;
}

function createClickDecisionFromFunctionArgs(args: Record<string, unknown>): NavigatorActionDecision {
  const x = parseRequiredNumber(args.x, "click_at.x");
  const y = parseRequiredNumber(args.y, "click_at.y");
  return {
    action: "CLICK",
    target: { x, y },
    text: null,
    key: null,
    confidence: resolveComputerUseConfidence(args.confidence, 0.9),
    reasoning:
      resolveOptionalString(args.reasoning) ??
      "Computer-use fallback selected a visible clickable target."
  };
}

function createTypeDecisionFromFunctionArgs(args: Record<string, unknown>): NavigatorActionDecision {
  const text = parseRequiredString(args.text, "type_text_at.text");
  const x = parseOptionalNumber(args.x);
  const y = parseOptionalNumber(args.y);
  return {
    action: "TYPE",
    target: Number.isFinite(x) && Number.isFinite(y) ? { x: Number(x), y: Number(y) } : null,
    text,
    key: null,
    confidence: resolveComputerUseConfidence(args.confidence, 0.85),
    reasoning:
      resolveOptionalString(args.reasoning) ??
      "Computer-use fallback selected text entry for the active task."
  };
}

function createPressKeyDecisionFromFunctionArgs(args: Record<string, unknown>): NavigatorActionDecision {
  const keyRaw =
    resolveOptionalString(args.key) ??
    resolveOptionalString(args.keyName) ??
    resolveOptionalString(args.key_name);
  const key = normalizeSpecialKey(keyRaw);
  if (!key) {
    throw new Error("key_combination.key must be Enter, Tab, or Escape.");
  }
  return {
    action: "PRESS_KEY",
    target: null,
    text: null,
    key,
    confidence: resolveComputerUseConfidence(args.confidence, 0.85),
    reasoning:
      resolveOptionalString(args.reasoning) ??
      "Computer-use fallback selected a deterministic keyboard action."
  };
}

function createScrollDecisionFromFunctionArgs(args: Record<string, unknown>): NavigatorActionDecision {
  const direction = resolveOptionalString(args.direction)?.toLowerCase() ?? "down";
  const amount = Math.max(
    100,
    Math.round(parseOptionalNumber(args.amount) ?? COMPUTER_USE_DEFAULT_SCROLL_PX)
  );
  const signedAmount = direction === "up" ? -Math.abs(amount) : Math.abs(amount);
  return {
    action: "SCROLL",
    target: null,
    text: String(signedAmount),
    key: null,
    confidence: resolveComputerUseConfidence(args.confidence, 0.8),
    reasoning:
      resolveOptionalString(args.reasoning) ??
      "Computer-use fallback scrolled to expose additional actionable content."
  };
}

function createWaitDecisionFromFunctionArgs(args: Record<string, unknown>): NavigatorActionDecision {
  const waitMs = Math.max(
    250,
    Math.round(parseOptionalNumber(args.milliseconds) ?? COMPUTER_USE_DEFAULT_WAIT_MS)
  );
  return {
    action: "WAIT",
    target: null,
    text: String(waitMs),
    key: null,
    confidence: resolveComputerUseConfidence(args.confidence, 0.75),
    reasoning:
      resolveOptionalString(args.reasoning) ??
      "Computer-use fallback waited for a short UI/network settle interval."
  };
}

function createDoneDecisionFromFunctionArgs(args: Record<string, unknown>): NavigatorActionDecision {
  const answer = parseRequiredString(args.answer, "answer_from_screen.answer");
  return {
    action: "DONE",
    target: null,
    text: answer,
    key: null,
    confidence: resolveComputerUseConfidence(args.confidence, 0.92),
    reasoning:
      resolveOptionalString(args.reasoning) ??
      "Computer-use fallback completed because the answer is visible on screen."
  };
}

function createFailedDecisionFromFunctionArgs(args: Record<string, unknown>): NavigatorActionDecision {
  const reason = parseRequiredString(args.reason, "mark_failed.reason");
  return {
    action: "FAILED",
    target: null,
    text: reason,
    key: null,
    confidence: resolveComputerUseConfidence(args.confidence, COMPUTER_USE_MIN_CONFIDENCE),
    reasoning: "Computer-use fallback could not identify a safe path to complete the task."
  };
}

function parseRequiredNumber(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return parsed;
}

function parseOptionalNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function parseRequiredString(value: unknown, label: string): string {
  const parsed = resolveOptionalString(value);
  if (!parsed) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return parsed;
}

function resolveComputerUseConfidence(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return clampConfidence(fallback);
  }
  return clampConfidence(parsed);
}

function clampConfidence(value: number): number {
  const bounded = Math.max(COMPUTER_USE_MIN_CONFIDENCE, Math.min(1, value));
  if (!Number.isFinite(bounded)) {
    return COMPUTER_USE_DEFAULT_CONFIDENCE;
  }
  return bounded;
}

function normalizeSpecialKey(value: string | null): NavigatorSpecialKey | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "enter") {
    return "Enter";
  }
  if (normalized === "tab") {
    return "Tab";
  }
  if (normalized === "escape" || normalized === "esc") {
    return "Escape";
  }
  return null;
}

function resolveOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function canUseVertex(projectId: string | undefined, region: string | undefined): boolean {
  return Boolean(projectId && region);
}

function createGeminiClientFromEnv(): GeminiClientContext {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  const projectId = process.env.PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
  const region = process.env.REGION ?? process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";
  const forceVertex =
    process.env.GEMINI_USE_VERTEX === "true" || process.env.GOOGLE_GENAI_USE_VERTEXAI === "true";

  if (apiKey && !forceVertex) {
    return {
      ai: new GoogleGenAI({ apiKey }),
      authMode: "gemini-api-key"
    };
  }

  if (canUseVertex(projectId, region)) {
    return {
      ai: new GoogleGenAI({
        vertexai: true,
        project: projectId,
        location: region
      }),
      authMode: "vertex-ai"
    };
  }

  throw new Error(
    "Navigator engine auth is not configured. Set GEMINI_API_KEY or PROJECT_ID/REGION with Vertex auth."
  );
}

export function createNavigatorEngine(
  options: NavigatorEngineOptions | string = {}
): NavigatorEngine {
  const resolvedOptions =
    typeof options === "string"
      ? {
          flashModel: options,
          proModel: resolveNavigatorProModelFromEnv()
        }
      : {
          flashModel: options.flashModel ?? resolveNavigatorModelFromEnv(),
          proModel: options.proModel ?? resolveNavigatorProModelFromEnv()
        };

  const clientContext = createGeminiClientFromEnv();
  return new GeminiTieredNavigatorEngine(
    resolvedOptions.flashModel,
    resolvedOptions.proModel,
    clientContext
  );
}

export function resolveNavigatorModelFromEnv(): string {
  return (
    process.env.GEMINI_NAVIGATOR_FLASH_MODEL ??
    process.env.GEMINI_NAVIGATOR_MODEL ??
    process.env.GEMINI_TEXT_MODEL ??
    DEFAULT_FLASH_MODEL
  );
}

export function resolveNavigatorProModelFromEnv(): string {
  return (
    process.env.GEMINI_NAVIGATOR_PRO_MODEL ??
    process.env.GEMINI_PRO_MODEL ??
    process.env.GEMINI_VISION_MODEL ??
    DEFAULT_PRO_MODEL
  );
}

export function estimateNavigatorPromptBudget(
  input: NavigatorDecisionRequest
): NavigatorPromptBudgetEstimate {
  const tier = input.tier ?? "TIER_1_AX";
  const payload = buildNavigatorUserPayload(input, tier);
  const challengeMode = shouldUseChallengeMode(input);
  const decisionMode = input.decisionMode ?? "STANDARD";
  const prompt =
    decisionMode === "COMPUTER_USE"
      ? buildComputerUsePrompt(payload, null, 0)
      : buildNavigatorPrompt(payload, null, 0, challengeMode);
  const promptCharCount = prompt.length;
  const estimatedPromptTokens = estimateTokensFromChars(promptCharCount);
  const alertThreshold = resolvePromptTokenAlertThresholdFromEnv();

  return {
    promptCharCount,
    estimatedPromptTokens,
    alertThreshold,
    exceedsAlertThreshold: estimatedPromptTokens > alertThreshold
  };
}

function estimateTokensFromChars(charCount: number): number {
  if (!Number.isFinite(charCount) || charCount <= 0) {
    return 0;
  }

  // Coarse fallback estimate: ~4 characters per token for mixed JSON+English payloads.
  return Math.ceil(charCount / 4);
}
