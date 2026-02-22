import {
  GoogleGenAI,
  createPartFromBase64,
  createPartFromText,
  createUserContent
} from "@google/genai";

import type { InteractiveElementIndexEntry } from "../cdp/client.js";

const DEFAULT_FLASH_MODEL = "gemini-2.5-flash";
const DEFAULT_PRO_MODEL = "gemini-2.5-pro";
const MAX_MALFORMED_RETRIES = 1;
const ACTION_TYPES = ["CLICK", "TYPE", "SCROLL", "WAIT", "EXTRACT", "DONE", "FAILED"] as const;

export type NavigatorActionType = (typeof ACTION_TYPES)[number];

export interface NavigatorActionTarget {
  x: number;
  y: number;
}

export interface NavigatorActionDecision {
  action: NavigatorActionType;
  target: NavigatorActionTarget | null;
  text: string | null;
  confidence: number;
  reasoning: string;
}

export type NavigatorInferenceTier = "TIER_1_AX" | "TIER_2_VISION";
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
  previousActions?: NavigatorActionDecision[];
  previousObservations?: string[];
  screenshot?: NavigatorScreenshotInput | null;
}

export interface NavigatorDecisionRequest {
  intent: string;
  observation: NavigatorObservationInput;
  tier?: NavigatorInferenceTier;
  escalationReason?: NavigatorEscalationReason | null;
}

export interface NavigatorEngine {
  decideNextAction(input: NavigatorDecisionRequest): Promise<NavigatorActionDecision>;
}

export interface NavigatorEngineOptions {
  flashModel?: string;
  proModel?: string;
}

interface GeminiClientContext {
  ai: GoogleGenAI;
  authMode: "gemini-api-key" | "vertex-ai";
}

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
    if (tier === "TIER_2_VISION" && !input.observation.screenshot) {
      throw new Error("Tier 2 vision inference requires a screenshot payload.");
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
    previousActions,
    previousObservations: input.observation.previousObservations ?? []
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
    '{"action":"CLICK|TYPE|SCROLL|WAIT|EXTRACT|DONE|FAILED","target":{"x":number,"y":number}|null,"text":string|null,"confidence":number,"reasoning":string}',
    "Rules:",
    "- action must be uppercase and one of the allowed values.",
    "- confidence must be between 0.0 and 1.0.",
    "- For CLICK, target must be non-null and point to the best matching interactive element.",
    "- For TYPE, text must be non-empty; target may be null if typing into focused input.",
    "- If isInitialStep=true for a search intent, the first action MUST be CLICK on the best input/search field before any TYPE action.",
    "- normalizedAXTree may be raw normalized nodes OR a compact encoded array where index 0 is a legend string. Use the legend to decode.",
    "- When tier is TIER_2_VISION, use the screenshot as visual ground truth for coordinates.",
    "- If no actionable target is present in current viewport, return SCROLL with text=\"800\".",
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

  return {
    action,
    target,
    text,
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
    process.env.GEMINI_VISION_MODEL ??
    process.env.GEMINI_PRO_MODEL ??
    DEFAULT_PRO_MODEL
  );
}
