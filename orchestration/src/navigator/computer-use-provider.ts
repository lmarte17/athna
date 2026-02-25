import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  type FunctionDeclaration,
  Type,
  createPartFromBase64,
  createPartFromText,
  createUserContent
} from "@google/genai";

import type {
  NavigatorActionDecision,
  NavigatorEscalationReason,
  NavigatorObservationInput,
  NavigatorSpecialKey
} from "./engine.js";

const DEFAULT_COMPUTER_USE_MODEL = "gemini-2.5-pro";
const DEFAULT_MAX_MALFORMED_RETRIES = 1;
const DEFAULT_MAX_ACTIONS_PER_PLAN = 3;
const MIN_CONFIDENCE = 0.55;

type GeminiClientContext = {
  ai: GoogleGenAI;
};

type ComputerUseFunctionCall = {
  name?: string;
  arguments?: unknown;
  args?: unknown;
};

const EXECUTABLE_FUNCTION_NAMES = [
  "click_at",
  "type_text_at",
  "key_combination",
  "scroll_document",
  "scroll_at",
  "wait_5_seconds",
  "answer_from_screen",
  "mark_failed",
  "safety_decision"
] as const;

export type ComputerUseSafetyDecision = "ALLOW" | "REQUIRE_CONFIRMATION";

export interface ComputerUsePlannedAction {
  sourceFunction: string;
  decision: NavigatorActionDecision;
}

export interface ComputerUseActionPlan {
  actions: ComputerUsePlannedAction[];
  safetyDecision: ComputerUseSafetyDecision;
  safetyReason: string | null;
  rawFunctionCallCount: number;
}

export interface ComputerUseProviderInput {
  intent: string;
  observation: NavigatorObservationInput;
  escalationReason: NavigatorEscalationReason | null;
  maxActions?: number;
}

export interface ComputerUseProvider {
  planActions(input: ComputerUseProviderInput): Promise<ComputerUseActionPlan>;
}

export interface ComputerUseProviderOptions {
  model?: string;
  maxMalformedRetries?: number;
}

class GeminiComputerUseProvider implements ComputerUseProvider {
  constructor(
    private readonly model: string,
    private readonly maxMalformedRetries: number,
    private readonly clientContext: GeminiClientContext
  ) {}

  async planActions(input: ComputerUseProviderInput): Promise<ComputerUseActionPlan> {
    if (!input.observation.screenshot) {
      throw new Error("Computer-use plan requires screenshot observation.");
    }

    const maxActions = Math.max(1, Math.round(input.maxActions ?? DEFAULT_MAX_ACTIONS_PER_PLAN));
    const payload = buildPromptPayload(input);
    let previousRawResponse: string | null = null;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxMalformedRetries; attempt += 1) {
      const response = await this.clientContext.ai.models.generateContent({
        model: this.model,
        contents: buildPromptContents(
          buildComputerUsePrompt(payload, previousRawResponse, attempt, maxActions),
          input.observation
        ),
        config: {
          tools: [
            {
              functionDeclarations: buildFunctionDeclarations()
            }
          ],
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.ANY,
              allowedFunctionNames: [...EXECUTABLE_FUNCTION_NAMES]
            }
          }
        }
      });

      try {
        return parsePlanFromFunctionCalls(response.functionCalls, response.text ?? "", maxActions);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        previousRawResponse = response.text ?? "";
        if (attempt === this.maxMalformedRetries) {
          break;
        }
      }
    }

    throw new Error(
      `Computer-use plan parsing failed after ${this.maxMalformedRetries + 1} attempt(s): ${
        lastError?.message ?? "unknown error"
      }`
    );
  }
}

function buildPromptContents(prompt: string, observation: NavigatorObservationInput) {
  const screenshot = observation.screenshot;
  if (!screenshot) {
    return createUserContent(createPartFromText(prompt));
  }

  return createUserContent([
    createPartFromText(prompt),
    createPartFromBase64(screenshot.base64, screenshot.mimeType)
  ]);
}

function buildPromptPayload(input: ComputerUseProviderInput): Record<string, unknown> {
  return {
    intent: input.intent,
    escalationReason: input.escalationReason,
    observation: {
      currentUrl: input.observation.currentUrl ?? null,
      noProgressStreak: input.observation.noProgressStreak ?? 0,
      disallowedActionFingerprints: input.observation.disallowedActionFingerprints ?? [],
      previousActions: input.observation.previousActions ?? [],
      previousObservations: input.observation.previousObservations ?? [],
      historySummary: input.observation.historySummary ?? null,
      contextWindowStats: input.observation.contextWindowStats ?? null,
      interactiveElementIndex: input.observation.interactiveElementIndex ?? [],
      screenshot: input.observation.screenshot
        ? {
            mimeType: input.observation.screenshot.mimeType,
            width: input.observation.screenshot.width,
            height: input.observation.screenshot.height,
            mode: input.observation.screenshot.mode ?? null
          }
        : null,
      structuredError: input.observation.structuredError ?? null
    }
  };
}

function buildComputerUsePrompt(
  payload: Record<string, unknown>,
  previousRawResponse: string | null,
  attempt: number,
  maxActions: number
): string {
  const correctionSection =
    attempt === 0
      ? ""
      : [
          "Previous response was invalid for plan parsing.",
          "Previous raw response:",
          previousRawResponse ?? "(empty)",
          "Return one or more valid function calls now."
        ].join("\n");

  return [
    "You are a browser computer-use planner for Ghost Browser.",
    "Use screenshot and context payload to output function calls only.",
    `You may return up to ${maxActions} executable actions in order.`,
    "Always emit safety_decision first when user confirmation is required for risky actions.",
    "If confirmation is not needed, omit safety_decision and emit executable actions only.",
    "Avoid any action fingerprint listed in disallowedActionFingerprints.",
    "Prefer deterministic progress and avoid repeating stalled actions.",
    correctionSection,
    "Context payload:",
    JSON.stringify(payload)
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function parsePlanFromFunctionCalls(
  functionCalls: ComputerUseFunctionCall[] | undefined,
  rawText: string,
  maxActions: number
): ComputerUseActionPlan {
  if (!Array.isArray(functionCalls) || functionCalls.length === 0) {
    throw new Error(
      `Computer-use response did not include function calls. Raw response: ${rawText.slice(0, 200)}`
    );
  }

  const actions: ComputerUsePlannedAction[] = [];
  let safetyDecision: ComputerUseSafetyDecision = "ALLOW";
  let safetyReason: string | null = null;

  for (const call of functionCalls) {
    const functionName = normalizeFunctionName(call.name);
    const args = normalizeCallArgs(call);
    if (functionName === "safety_decision") {
      const parsedSafety = parseSafetyDecision(args);
      safetyDecision = parsedSafety.decision;
      safetyReason = parsedSafety.reason;
      continue;
    }

    if (actions.length >= maxActions) {
      break;
    }

    const decision = mapFunctionCallToDecision(functionName, args);
    actions.push({
      sourceFunction: functionName,
      decision
    });
  }

  return {
    actions,
    safetyDecision,
    safetyReason,
    rawFunctionCallCount: functionCalls.length
  };
}

function mapFunctionCallToDecision(
  functionName: string,
  args: Record<string, unknown>
): NavigatorActionDecision {
  switch (functionName) {
    case "click_at": {
      return {
        action: "CLICK",
        target: {
          x: parseRequiredNumber(args.x, "click_at.x"),
          y: parseRequiredNumber(args.y, "click_at.y")
        },
        text: null,
        key: null,
        confidence: resolveConfidence(args.confidence, 0.9),
        reasoning:
          resolveOptionalString(args.reasoning) ??
          "Computer-use provider selected a visual click target."
      };
    }
    case "type_text_at": {
      return {
        action: "TYPE",
        target: null,
        text: parseRequiredString(args.text, "type_text_at.text"),
        key: null,
        confidence: resolveConfidence(args.confidence, 0.85),
        reasoning:
          resolveOptionalString(args.reasoning) ??
          "Computer-use provider selected text entry."
      };
    }
    case "key_combination": {
      const key = normalizeSpecialKey(
        resolveOptionalString(args.key) ??
          resolveOptionalString(args.key_name) ??
          resolveOptionalString(args.keyName)
      );
      if (!key) {
        throw new Error("key_combination requires key Enter|Tab|Escape.");
      }
      return {
        action: "PRESS_KEY",
        target: null,
        text: null,
        key,
        confidence: resolveConfidence(args.confidence, 0.85),
        reasoning:
          resolveOptionalString(args.reasoning) ??
          "Computer-use provider selected a keyboard action."
      };
    }
    case "scroll_document": {
      const direction = resolveOptionalString(args.direction)?.toLowerCase() ?? "down";
      const amount = Math.max(120, Math.round(parseOptionalNumber(args.amount) ?? 800));
      const signedAmount = direction === "up" ? -Math.abs(amount) : Math.abs(amount);
      return {
        action: "SCROLL",
        target: null,
        text: String(signedAmount),
        key: null,
        confidence: resolveConfidence(args.confidence, 0.8),
        reasoning:
          resolveOptionalString(args.reasoning) ??
          "Computer-use provider selected a document scroll action."
      };
    }
    case "scroll_at": {
      const amount = Math.max(120, Math.round(parseOptionalNumber(args.amount) ?? 800));
      const direction = resolveOptionalString(args.direction)?.toLowerCase() ?? "down";
      const signedAmount = direction === "up" ? -Math.abs(amount) : Math.abs(amount);
      const x = parseOptionalNumber(args.x);
      const y = parseOptionalNumber(args.y);
      return {
        action: "SCROLL",
        target:
          Number.isFinite(x) && Number.isFinite(y)
            ? {
                x: Number(x),
                y: Number(y)
              }
            : null,
        text: String(signedAmount),
        key: null,
        confidence: resolveConfidence(args.confidence, 0.8),
        reasoning:
          resolveOptionalString(args.reasoning) ??
          "Computer-use provider selected a targeted scroll action."
      };
    }
    case "wait_5_seconds": {
      const durationMs = Math.max(250, Math.round(parseOptionalNumber(args.milliseconds) ?? 5_000));
      return {
        action: "WAIT",
        target: null,
        text: String(durationMs),
        key: null,
        confidence: resolveConfidence(args.confidence, 0.75),
        reasoning:
          resolveOptionalString(args.reasoning) ??
          "Computer-use provider selected a short wait for stabilization."
      };
    }
    case "answer_from_screen": {
      return {
        action: "DONE",
        target: null,
        text: parseRequiredString(args.answer, "answer_from_screen.answer"),
        key: null,
        confidence: resolveConfidence(args.confidence, 0.92),
        reasoning:
          resolveOptionalString(args.reasoning) ??
          "Computer-use provider completed with visible on-screen answer."
      };
    }
    case "mark_failed": {
      return {
        action: "FAILED",
        target: null,
        text: parseRequiredString(args.reason, "mark_failed.reason"),
        key: null,
        confidence: resolveConfidence(args.confidence, 0.7),
        reasoning: "Computer-use provider could not find a safe next action."
      };
    }
    default:
      throw new Error(`Unsupported computer-use function call: ${functionName}`);
  }
}

function parseSafetyDecision(args: Record<string, unknown>): {
  decision: ComputerUseSafetyDecision;
  reason: string | null;
} {
  const decisionRaw =
    resolveOptionalString(args.decision) ??
    resolveOptionalString(args.safety_decision) ??
    resolveOptionalString(args.safetyDecision);
  const requireConfirmationRaw = args.require_confirmation ?? args.requireConfirmation;
  const requireConfirmationBoolean =
    typeof requireConfirmationRaw === "boolean" ? requireConfirmationRaw : false;
  const decision =
    requireConfirmationBoolean ||
    (decisionRaw !== null && decisionRaw.trim().toLowerCase() === "require_confirmation")
      ? "REQUIRE_CONFIRMATION"
      : "ALLOW";
  return {
    decision,
    reason: resolveOptionalString(args.reason)
  };
}

function buildFunctionDeclarations(): FunctionDeclaration[] {
  return [
    {
      name: "safety_decision",
      description:
        "Safety gate for actions that might be destructive, sensitive, or require user approval.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          decision: { type: Type.STRING, enum: ["allow", "require_confirmation"] },
          reason: { type: Type.STRING },
          require_confirmation: { type: Type.BOOLEAN }
        },
        required: ["decision"]
      }
    },
    {
      name: "click_at",
      description: "Click at viewport coordinates.",
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
      description: "Type text into the active input or focused field.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
          reasoning: { type: Type.STRING }
        },
        required: ["text"]
      }
    },
    {
      name: "key_combination",
      description: "Press a keyboard key (Enter, Tab, Escape).",
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
      description: "Scroll document up or down.",
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
      name: "scroll_at",
      description: "Scroll at specific viewport coordinates.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          x: { type: Type.NUMBER },
          y: { type: Type.NUMBER },
          direction: { type: Type.STRING, enum: ["up", "down"] },
          amount: { type: Type.INTEGER },
          confidence: { type: Type.NUMBER },
          reasoning: { type: Type.STRING }
        }
      }
    },
    {
      name: "wait_5_seconds",
      description: "Pause briefly for UI stabilization.",
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
      description: "Return final answer visible on screen.",
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
      description: "Stop when there is no safe progress path.",
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
}

function normalizeFunctionName(value: unknown): string {
  const name = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!name) {
    throw new Error("Function call name is required.");
  }
  return name;
}

function normalizeCallArgs(call: ComputerUseFunctionCall): Record<string, unknown> {
  const value = call.arguments ?? call.args ?? {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseRequiredString(value: unknown, label: string): string {
  const parsed = resolveOptionalString(value);
  if (!parsed) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return parsed;
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

function resolveOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveConfidence(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return clampConfidence(fallback);
  }
  return clampConfidence(parsed);
}

function clampConfidence(value: number): number {
  return Math.max(MIN_CONFIDENCE, Math.min(1, value));
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

function createGeminiClientFromEnv(): GeminiClientContext {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  const projectId = process.env.PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
  const region = process.env.REGION ?? process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";
  const forceVertex =
    process.env.GEMINI_USE_VERTEX === "true" || process.env.GOOGLE_GENAI_USE_VERTEXAI === "true";

  if (apiKey && !forceVertex) {
    return {
      ai: new GoogleGenAI({ apiKey })
    };
  }

  if (projectId && region) {
    return {
      ai: new GoogleGenAI({
        vertexai: true,
        project: projectId,
        location: region
      })
    };
  }

  throw new Error(
    "Computer-use provider auth is not configured. Set GEMINI_API_KEY or PROJECT_ID/REGION with Vertex auth."
  );
}

export function createComputerUseProvider(
  options: ComputerUseProviderOptions = {}
): ComputerUseProvider {
  const model = options.model ?? process.env.GEMINI_COMPUTER_USE_MODEL ?? DEFAULT_COMPUTER_USE_MODEL;
  const maxMalformedRetries = Math.max(
    0,
    Math.round(options.maxMalformedRetries ?? DEFAULT_MAX_MALFORMED_RETRIES)
  );
  const clientContext = createGeminiClientFromEnv();
  return new GeminiComputerUseProvider(model, maxMalformedRetries, clientContext);
}
