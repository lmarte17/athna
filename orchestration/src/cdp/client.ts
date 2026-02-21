import sharp from "sharp";
import { chromium, type Browser, type CDPSession, type Page } from "playwright-core";

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
const DEFAULT_GHOST_VIEWPORT = {
  width: 1280,
  height: 900,
  deviceScaleFactor: 1
} as const;
const DEFAULT_SCREENSHOT_SETTINGS = {
  quality: 80,
  fromSurface: true
} as const;
const DEFAULT_SCROLL_STEP_PX = 800;
const DEFAULT_MAX_SCROLL_STEPS = 8;
const DEFAULT_SCROLL_SETTLE_MS = 150;
const DEFAULT_SCREENSHOT_MODE = "viewport" as const;
const DEFAULT_ACTION_SETTLE_TIMEOUT_MS = 2_500;
const DEFAULT_WAIT_ACTION_TIMEOUT_MS = 5_000;
const DEFAULT_AX_CHAR_BUDGET = 8_000;
const DEFAULT_AX_NORMALIZATION_TIME_BUDGET_MS = 15;
const DEFAULT_AX_BBOX_CONCURRENCY = 8;
const PRUNED_AX_ROLES = new Set(["generic", "none", "presentation", "inlinetextbox"]);
const INTERACTIVE_AX_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "menuitem",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox"
]);
const AGENT_ACTION_TYPES = ["CLICK", "TYPE", "SCROLL", "WAIT", "EXTRACT", "DONE", "FAILED"] as const;

export interface ConnectToGhostTabCdpOptions {
  endpointURL: string;
  connectTimeoutMs?: number;
}

export interface CaptureJpegOptions {
  quality?: number;
  fromSurface?: boolean;
}

export type ScreenshotMode = "viewport" | "full-page";

export interface ScreenshotClipRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  scale?: number;
}

export interface CaptureScreenshotOptions {
  mode?: ScreenshotMode;
  quality?: number;
  fromSurface?: boolean;
  clip?: ScreenshotClipRegion;
  scrollStepPx?: number;
  maxScrollSteps?: number;
  scrollSettleMs?: number;
}

export interface CaptureScreenshotResult {
  base64: string;
  mimeType: "image/jpeg";
  mode: ScreenshotMode;
  width: number;
  height: number;
  scrollSteps: number;
  capturedSegments: number;
  truncated: boolean;
  documentHeight: number;
  viewportHeight: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NormalizedAXNode {
  nodeId: string;
  role: string;
  name: string | null;
  value: string | null;
  description: string | null;
  states: string[];
  boundingBox: BoundingBox | null;
}

export interface ExtractNormalizedAXTreeOptions {
  charBudget?: number;
  normalizationTimeBudgetMs?: number;
  includeBoundingBoxes?: boolean;
}

export interface ExtractNormalizedAXTreeResult {
  nodes: NormalizedAXNode[];
  json: string;
  rawNodeCount: number;
  normalizedNodeCount: number;
  interactiveNodeCount: number;
  normalizedCharCount: number;
  normalizationDurationMs: number;
  exceededCharBudget: boolean;
  exceededNormalizationTimeBudget: boolean;
  truncated: boolean;
}

export interface InteractiveElementIndexEntry {
  nodeId: string;
  role: string;
  name: string | null;
  value: string | null;
  boundingBox: BoundingBox | null;
}

export interface InteractiveElementIndexResult {
  elements: InteractiveElementIndexEntry[];
  json: string;
  elementCount: number;
  normalizedNodeCount: number;
  normalizedCharCount: number;
  indexCharCount: number;
  sizeRatio: number;
}

export type ExtractInteractiveElementIndexOptions = ExtractNormalizedAXTreeOptions;

export interface ExtractInteractiveElementIndexResult extends InteractiveElementIndexResult {
  normalizedAXTree: ExtractNormalizedAXTreeResult;
}

export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number];

export interface AgentActionTarget {
  x: number;
  y: number;
}

export interface AgentActionInput {
  action: AgentActionType;
  target: AgentActionTarget | null;
  text: string | null;
  confidence?: number;
  reasoning?: string;
}

export interface ExecuteActionOptions {
  settleTimeoutMs?: number;
}

export interface ActionExecutionResult {
  status: "acted" | "done" | "failed";
  action: AgentActionType;
  currentUrl: string;
  navigationObserved: boolean;
  domMutationObserved: boolean;
  extractedData: unknown;
  message: string | null;
}

export interface GhostViewportSettings {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export interface GhostTabCdpClient {
  navigate(url: string, timeoutMs?: number): Promise<void>;
  extractNormalizedAXTree(
    options?: ExtractNormalizedAXTreeOptions
  ): Promise<ExtractNormalizedAXTreeResult>;
  extractInteractiveElementIndex(
    options?: ExtractInteractiveElementIndexOptions
  ): Promise<ExtractInteractiveElementIndexResult>;
  executeAction(action: AgentActionInput, options?: ExecuteActionOptions): Promise<ActionExecutionResult>;
  getCurrentUrl(): Promise<string>;
  captureScreenshot(options?: CaptureScreenshotOptions): Promise<CaptureScreenshotResult>;
  captureJpegBase64(options?: CaptureJpegOptions): Promise<string>;
  getViewport(): GhostViewportSettings;
  close(): Promise<void>;
}

interface ResolvedExtractNormalizedAXTreeOptions {
  charBudget: number;
  normalizationTimeBudgetMs: number;
  includeBoundingBoxes: boolean;
}

interface ResolvedCaptureScreenshotOptions {
  mode: ScreenshotMode;
  quality: number;
  fromSurface: boolean;
  clip?: ScreenshotClipRegion;
  scrollStepPx: number;
  maxScrollSteps: number;
  scrollSettleMs: number;
}

interface DocumentMetrics {
  scrollY: number;
  viewportHeight: number;
  viewportWidth: number;
  documentHeight: number;
}

interface CapturedSegment {
  scrollY: number;
  imageBase64: string;
}

interface RawAXValue {
  value?: string | number | boolean | null;
}

interface RawAXProperty {
  name?: string;
  value?: RawAXValue;
}

interface RawAXNode {
  nodeId: string;
  role?: RawAXValue;
  name?: RawAXValue;
  value?: RawAXValue;
  description?: RawAXValue;
  properties?: RawAXProperty[];
  backendDOMNodeId?: number;
  ignored?: boolean;
}

class PlaywrightGhostTabCdpClient implements GhostTabCdpClient {
  constructor(
    private readonly browser: Browser,
    private readonly cdpSession: CDPSession
  ) {}

  async navigate(url: string, timeoutMs = DEFAULT_NAVIGATION_TIMEOUT_MS): Promise<void> {
    const navigationResult = await this.cdpSession.send("Page.navigate", { url });
    if (navigationResult.errorText) {
      throw new Error(`CDP Page.navigate failed for ${url}: ${navigationResult.errorText}`);
    }

    await waitForLoadEvent(this.cdpSession, timeoutMs);
  }

  async extractNormalizedAXTree(
    options: ExtractNormalizedAXTreeOptions = {}
  ): Promise<ExtractNormalizedAXTreeResult> {
    const resolvedOptions = resolveExtractNormalizedAXTreeOptions(options);

    await waitForDOMContentLoaded(this.cdpSession);

    const start = Date.now();
    const rawTree = await this.cdpSession.send("Accessibility.getFullAXTree");
    const rawNodes = ((rawTree.nodes ?? []) as RawAXNode[]).filter((node) => !node.ignored);
    const normalizedNodes = await normalizeAXNodes(this.cdpSession, rawNodes, {
      includeBoundingBoxes: resolvedOptions.includeBoundingBoxes
    });
    const preBudgetCharCount = JSON.stringify(normalizedNodes).length;
    const budgetedNodes = trimAXNodesToCharBudget(normalizedNodes, resolvedOptions.charBudget);
    const normalizedJson = JSON.stringify(budgetedNodes.nodes);
    const normalizationDurationMs = Date.now() - start;
    const interactiveNodeCount = budgetedNodes.nodes.filter((node) =>
      INTERACTIVE_AX_ROLES.has(node.role)
    ).length;

    return {
      nodes: budgetedNodes.nodes,
      json: normalizedJson,
      rawNodeCount: rawNodes.length,
      normalizedNodeCount: budgetedNodes.nodes.length,
      interactiveNodeCount,
      normalizedCharCount: normalizedJson.length,
      normalizationDurationMs,
      exceededCharBudget: preBudgetCharCount > resolvedOptions.charBudget,
      exceededNormalizationTimeBudget:
        normalizationDurationMs > resolvedOptions.normalizationTimeBudgetMs,
      truncated: budgetedNodes.truncated
    };
  }

  async extractInteractiveElementIndex(
    options: ExtractInteractiveElementIndexOptions = {}
  ): Promise<ExtractInteractiveElementIndexResult> {
    const normalizedAXTree = await this.extractNormalizedAXTree(options);
    const index = buildInteractiveElementIndex(normalizedAXTree.nodes);

    return {
      ...index,
      normalizedAXTree
    };
  }

  async executeAction(
    actionInput: AgentActionInput,
    options: ExecuteActionOptions = {}
  ): Promise<ActionExecutionResult> {
    const action = validateAgentActionInput(actionInput);
    const settleTimeoutMs = options.settleTimeoutMs ?? DEFAULT_ACTION_SETTLE_TIMEOUT_MS;

    switch (action.action) {
      case "CLICK": {
        if (!action.target) {
          throw new Error("CLICK action requires a target.");
        }

        await this.dispatchClick(action.target);
        const settle = await waitForNavigationOrDomMutation(this.cdpSession, settleTimeoutMs);
        return {
          status: "acted",
          action: action.action,
          currentUrl: await this.getCurrentUrl(),
          navigationObserved: settle.navigationObserved,
          domMutationObserved: settle.domMutationObserved,
          extractedData: null,
          message: null
        };
      }
      case "TYPE": {
        if (!action.text || action.text.length === 0) {
          throw new Error("TYPE action requires non-empty text.");
        }

        await this.dispatchTyping(action.text);
        const settle = await waitForNavigationOrDomMutation(this.cdpSession, settleTimeoutMs);
        return {
          status: "acted",
          action: action.action,
          currentUrl: await this.getCurrentUrl(),
          navigationObserved: settle.navigationObserved,
          domMutationObserved: settle.domMutationObserved,
          extractedData: null,
          message: null
        };
      }
      case "SCROLL": {
        const deltaY = parseScrollDelta(action.text);
        await this.dispatchScroll(action.target, deltaY);
        const settle = await waitForNavigationOrDomMutation(this.cdpSession, settleTimeoutMs);
        return {
          status: "acted",
          action: action.action,
          currentUrl: await this.getCurrentUrl(),
          navigationObserved: settle.navigationObserved,
          domMutationObserved: settle.domMutationObserved,
          extractedData: null,
          message: null
        };
      }
      case "WAIT": {
        const waitMs = parseWaitDurationMs(action.text);
        await sleep(waitMs);
        const settle = await waitForNavigationOrDomMutation(this.cdpSession, Math.min(waitMs, settleTimeoutMs));
        return {
          status: "acted",
          action: action.action,
          currentUrl: await this.getCurrentUrl(),
          navigationObserved: settle.navigationObserved,
          domMutationObserved: settle.domMutationObserved,
          extractedData: null,
          message: `Waited ${waitMs}ms`
        };
      }
      case "EXTRACT": {
        const extractionResult = await this.runExtraction(action.text);
        const settle = await waitForNavigationOrDomMutation(this.cdpSession, settleTimeoutMs);
        return {
          status: "acted",
          action: action.action,
          currentUrl: await this.getCurrentUrl(),
          navigationObserved: settle.navigationObserved,
          domMutationObserved: settle.domMutationObserved,
          extractedData: extractionResult,
          message: null
        };
      }
      case "DONE":
        return {
          status: "done",
          action: action.action,
          currentUrl: await this.getCurrentUrl(),
          navigationObserved: false,
          domMutationObserved: false,
          extractedData: null,
          message: action.text
        };
      case "FAILED":
        return {
          status: "failed",
          action: action.action,
          currentUrl: await this.getCurrentUrl(),
          navigationObserved: false,
          domMutationObserved: false,
          extractedData: null,
          message: action.text
        };
      default:
        throw new Error(`Unsupported action: ${String(action.action)}`);
    }
  }

  async captureScreenshot(
    options: CaptureScreenshotOptions = {}
  ): Promise<CaptureScreenshotResult> {
    const resolvedOptions = resolveCaptureScreenshotOptions(options);

    if (resolvedOptions.mode === "viewport") {
      return this.captureViewportScreenshot(resolvedOptions);
    }

    return this.captureFullPageScreenshot(resolvedOptions);
  }

  async captureJpegBase64(options: CaptureJpegOptions = {}): Promise<string> {
    const screenshot = await this.captureScreenshot({
      mode: "viewport",
      quality: options.quality,
      fromSurface: options.fromSurface
    });
    return screenshot.base64;
  }

  getViewport(): GhostViewportSettings {
    return {
      width: DEFAULT_GHOST_VIEWPORT.width,
      height: DEFAULT_GHOST_VIEWPORT.height,
      deviceScaleFactor: DEFAULT_GHOST_VIEWPORT.deviceScaleFactor
    };
  }

  async close(): Promise<void> {
    await this.browser.close();
  }

  private async captureViewportScreenshot(
    options: ResolvedCaptureScreenshotOptions
  ): Promise<CaptureScreenshotResult> {
    if (options.mode !== "viewport") {
      throw new Error("captureViewportScreenshot only accepts viewport mode.");
    }

    const metrics = await this.getDocumentMetrics();
    const imageBase64 = await this.captureRawScreenshotBase64(options);
    const imageDimensions = await readBase64ImageDimensions(imageBase64);

    return {
      base64: imageBase64,
      mimeType: "image/jpeg",
      mode: "viewport",
      width: imageDimensions.width,
      height: imageDimensions.height,
      scrollSteps: 0,
      capturedSegments: 1,
      truncated: false,
      documentHeight: metrics.documentHeight,
      viewportHeight: metrics.viewportHeight
    };
  }

  private async captureFullPageScreenshot(
    options: ResolvedCaptureScreenshotOptions
  ): Promise<CaptureScreenshotResult> {
    if (options.mode !== "full-page") {
      throw new Error("captureFullPageScreenshot only accepts full-page mode.");
    }

    if (options.clip) {
      throw new Error("clip is only supported for viewport screenshots.");
    }

    const initialMetrics = await this.getDocumentMetrics();
    const baseScrollY = Math.max(0, Math.floor(initialMetrics.scrollY));
    const maxScrollTop = Math.max(
      baseScrollY,
      Math.floor(initialMetrics.documentHeight - initialMetrics.viewportHeight)
    );
    const segments: CapturedSegment[] = [];
    let currentScrollY = baseScrollY;
    let scrollSteps = 0;
    let truncated = false;

    segments.push({
      scrollY: currentScrollY,
      imageBase64: await this.captureRawScreenshotBase64(options)
    });

    while (currentScrollY < maxScrollTop - 1) {
      if (scrollSteps >= options.maxScrollSteps) {
        truncated = true;
        break;
      }

      const requestedScrollTop = Math.min(currentScrollY + options.scrollStepPx, maxScrollTop);
      await this.scrollToY(requestedScrollTop, options.scrollSettleMs);

      const currentMetrics = await this.getDocumentMetrics();
      const observedScrollTop = Math.max(baseScrollY, Math.floor(currentMetrics.scrollY));

      if (observedScrollTop <= currentScrollY) {
        truncated = observedScrollTop < maxScrollTop - 1;
        break;
      }

      currentScrollY = observedScrollTop;
      segments.push({
        scrollY: currentScrollY,
        imageBase64: await this.captureRawScreenshotBase64(options)
      });
      scrollSteps += 1;
    }

    await this.scrollToY(baseScrollY, options.scrollSettleMs);

    const stitched = await stitchCapturedSegments(segments, {
      quality: options.quality,
      baseScrollY
    });

    return {
      base64: stitched.imageBase64,
      mimeType: "image/jpeg",
      mode: "full-page",
      width: stitched.width,
      height: stitched.height,
      scrollSteps,
      capturedSegments: segments.length,
      truncated,
      documentHeight: initialMetrics.documentHeight,
      viewportHeight: initialMetrics.viewportHeight
    };
  }

  private async captureRawScreenshotBase64(
    options: Pick<ResolvedCaptureScreenshotOptions, "quality" | "fromSurface" | "clip">
  ): Promise<string> {
    const screenshot = await this.cdpSession.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: options.quality,
      fromSurface: options.fromSurface,
      ...(options.clip
        ? {
            clip: {
              x: options.clip.x,
              y: options.clip.y,
              width: options.clip.width,
              height: options.clip.height,
              scale: options.clip.scale ?? 1
            }
          }
        : {})
    });

    if (!screenshot.data || screenshot.data.length === 0) {
      throw new Error("CDP Page.captureScreenshot returned an empty payload.");
    }

    return screenshot.data;
  }

  private async getDocumentMetrics(): Promise<DocumentMetrics> {
    return evaluateJsonExpression<DocumentMetrics>(
      this.cdpSession,
      `(() => {
        const body = document.body;
        const html = document.documentElement;
        const viewportHeight = window.innerHeight || (html ? html.clientHeight : 0);
        const viewportWidth = window.innerWidth || (html ? html.clientWidth : 0);
        const documentHeight = Math.max(
          viewportHeight,
          body ? body.scrollHeight : 0,
          body ? body.offsetHeight : 0,
          html ? html.scrollHeight : 0,
          html ? html.offsetHeight : 0
        );
        const scrollY = window.scrollY || window.pageYOffset || 0;
        return {
          scrollY,
          viewportHeight,
          viewportWidth,
          documentHeight
        };
      })();`
    );
  }

  private async scrollToY(y: number, settleMs: number): Promise<void> {
    const targetY = Math.max(0, Math.floor(y));
    await this.cdpSession.send("Runtime.evaluate", {
      expression: `window.scrollTo(0, ${targetY});`,
      awaitPromise: false,
      returnByValue: false
    });

    if (settleMs > 0) {
      await sleep(settleMs);
    }
  }

  private async dispatchClick(target: AgentActionTarget): Promise<void> {
    await this.cdpSession.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: target.x,
      y: target.y
    });
    await this.cdpSession.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: target.x,
      y: target.y,
      button: "left",
      clickCount: 1
    });
    await this.cdpSession.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: target.x,
      y: target.y,
      button: "left",
      clickCount: 1
    });
  }

  private async dispatchTyping(text: string): Promise<void> {
    const tokens = parseTypingTokens(text);
    for (const token of tokens) {
      if (token.kind === "char") {
        await this.cdpSession.send("Input.dispatchKeyEvent", {
          type: "char",
          text: token.value,
          unmodifiedText: token.value
        });
        continue;
      }

      await this.dispatchSpecialKey(token.value);
    }
  }

  private async dispatchSpecialKey(key: "Enter" | "Tab" | "Escape"): Promise<void> {
    const keyDetails = getSpecialKeyDetails(key);
    await this.cdpSession.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: keyDetails.key,
      code: keyDetails.code,
      windowsVirtualKeyCode: keyDetails.windowsVirtualKeyCode,
      nativeVirtualKeyCode: keyDetails.windowsVirtualKeyCode
    });
    await this.cdpSession.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: keyDetails.key,
      code: keyDetails.code,
      windowsVirtualKeyCode: keyDetails.windowsVirtualKeyCode,
      nativeVirtualKeyCode: keyDetails.windowsVirtualKeyCode
    });
  }

  private async dispatchScroll(target: AgentActionTarget | null, deltaY: number): Promise<void> {
    const viewport = this.getViewport();
    const x = target?.x ?? viewport.width / 2;
    const y = target?.y ?? viewport.height / 2;

    await this.cdpSession.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      deltaX: 0,
      deltaY
    });

    await this.cdpSession.send("Runtime.evaluate", {
      expression: `window.scrollBy(0, ${Math.round(deltaY)});`,
      awaitPromise: false,
      returnByValue: false
    });
  }

  private async runExtraction(expression: string | null): Promise<unknown> {
    const extractionExpression =
      expression && expression.trim().length > 0
        ? expression
        : `(() => ({
            url: window.location.href,
            title: document.title,
            activeElement: document.activeElement
              ? {
                  tagName: document.activeElement.tagName,
                  id: document.activeElement.id || null,
                  name: document.activeElement.getAttribute("name")
                }
              : null
          }))();`;

    const result = await this.cdpSession.send("Runtime.evaluate", {
      expression: extractionExpression,
      awaitPromise: true,
      returnByValue: true
    });

    if (result.exceptionDetails) {
      throw new Error(`EXTRACT action failed: ${result.exceptionDetails.text}`);
    }

    return result.result.value;
  }

  async getCurrentUrl(): Promise<string> {
    const value = await evaluateJsonExpression<string>(this.cdpSession, "window.location.href");
    return value;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForFirstPage(browser: Browser, timeoutMs: number): Promise<Page> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    for (const context of browser.contexts()) {
      const pages = context.pages();
      if (pages.length > 0) {
        return pages[0];
      }
    }

    await sleep(100);
  }

  throw new Error(`Timed out waiting ${timeoutMs}ms for a Ghost Tab target page.`);
}

function waitForLoadEvent(cdpSession: CDPSession, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting ${timeoutMs}ms for CDP Page.loadEventFired.`));
    }, timeoutMs);

    cdpSession.once("Page.loadEventFired", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function resolveCaptureScreenshotOptions(
  options: CaptureScreenshotOptions
): ResolvedCaptureScreenshotOptions {
  const mode = options.mode ?? DEFAULT_SCREENSHOT_MODE;
  const quality = options.quality ?? DEFAULT_SCREENSHOT_SETTINGS.quality;
  const fromSurface = options.fromSurface ?? DEFAULT_SCREENSHOT_SETTINGS.fromSurface;
  const scrollStepPx = options.scrollStepPx ?? DEFAULT_SCROLL_STEP_PX;
  const maxScrollSteps = options.maxScrollSteps ?? DEFAULT_MAX_SCROLL_STEPS;
  const scrollSettleMs = options.scrollSettleMs ?? DEFAULT_SCROLL_SETTLE_MS;

  if (quality < 0 || quality > 100) {
    throw new Error(`quality must be between 0 and 100. Received: ${quality}`);
  }

  if (scrollStepPx <= 0) {
    throw new Error(`scrollStepPx must be > 0. Received: ${scrollStepPx}`);
  }

  if (maxScrollSteps < 0) {
    throw new Error(`maxScrollSteps must be >= 0. Received: ${maxScrollSteps}`);
  }

  if (scrollSettleMs < 0) {
    throw new Error(`scrollSettleMs must be >= 0. Received: ${scrollSettleMs}`);
  }

  return {
    mode,
    quality,
    fromSurface,
    clip: options.clip,
    scrollStepPx,
    maxScrollSteps,
    scrollSettleMs
  };
}

function resolveExtractNormalizedAXTreeOptions(
  options: ExtractNormalizedAXTreeOptions
): ResolvedExtractNormalizedAXTreeOptions {
  const charBudget = options.charBudget ?? DEFAULT_AX_CHAR_BUDGET;
  const normalizationTimeBudgetMs =
    options.normalizationTimeBudgetMs ?? DEFAULT_AX_NORMALIZATION_TIME_BUDGET_MS;
  const includeBoundingBoxes = options.includeBoundingBoxes ?? true;

  if (charBudget <= 0) {
    throw new Error(`charBudget must be > 0. Received: ${charBudget}`);
  }

  if (normalizationTimeBudgetMs < 0) {
    throw new Error(
      `normalizationTimeBudgetMs must be >= 0. Received: ${normalizationTimeBudgetMs}`
    );
  }

  return {
    charBudget,
    normalizationTimeBudgetMs,
    includeBoundingBoxes
  };
}

function validateAgentActionInput(action: AgentActionInput): AgentActionInput {
  if (!AGENT_ACTION_TYPES.includes(action.action)) {
    throw new Error(`Unsupported action type: ${String(action.action)}`);
  }

  if (action.target !== null && action.target !== undefined) {
    if (
      typeof action.target !== "object" ||
      !Number.isFinite(action.target.x) ||
      !Number.isFinite(action.target.y)
    ) {
      throw new Error("Action target must include numeric x/y coordinates or be null.");
    }
  }

  if (action.text !== null && action.text !== undefined && typeof action.text !== "string") {
    throw new Error("Action text must be a string or null.");
  }

  return {
    action: action.action,
    target: action.target ?? null,
    text: action.text ?? null,
    confidence: action.confidence,
    reasoning: action.reasoning
  };
}

function parseScrollDelta(text: string | null): number {
  if (!text) {
    return DEFAULT_SCROLL_STEP_PX;
  }

  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed === 0) {
    return DEFAULT_SCROLL_STEP_PX;
  }

  return parsed;
}

function parseWaitDurationMs(text: string | null): number {
  if (!text) {
    return 1_000;
  }

  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 1_000;
  }

  return Math.min(parsed, DEFAULT_WAIT_ACTION_TIMEOUT_MS);
}

type TypingToken = { kind: "char"; value: string } | { kind: "special"; value: "Enter" | "Tab" | "Escape" };

function parseTypingTokens(text: string): TypingToken[] {
  const tokens: TypingToken[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const remaining = text.slice(cursor);
    if (remaining.startsWith("[Enter]")) {
      tokens.push({ kind: "special", value: "Enter" });
      cursor += "[Enter]".length;
      continue;
    }
    if (remaining.startsWith("[Tab]")) {
      tokens.push({ kind: "special", value: "Tab" });
      cursor += "[Tab]".length;
      continue;
    }
    if (remaining.startsWith("[Escape]")) {
      tokens.push({ kind: "special", value: "Escape" });
      cursor += "[Escape]".length;
      continue;
    }

    const char = text[cursor];
    if (char === "\n") {
      tokens.push({ kind: "special", value: "Enter" });
    } else if (char === "\t") {
      tokens.push({ kind: "special", value: "Tab" });
    } else if (char === "\u001b") {
      tokens.push({ kind: "special", value: "Escape" });
    } else {
      tokens.push({ kind: "char", value: char });
    }

    cursor += 1;
  }

  return tokens;
}

function getSpecialKeyDetails(key: "Enter" | "Tab" | "Escape"): {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
} {
  switch (key) {
    case "Enter":
      return { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 };
    case "Tab":
      return { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 };
    case "Escape":
      return { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 };
  }
}

async function evaluateJsonExpression<T>(
  cdpSession: CDPSession,
  expression: string
): Promise<T> {
  const result = await cdpSession.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });

  if (result.exceptionDetails) {
    throw new Error(`Runtime.evaluate failed: ${result.exceptionDetails.text}`);
  }

  return result.result.value as T;
}

async function waitForDOMContentLoaded(cdpSession: CDPSession, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const readyState = await evaluateJsonExpression<string>(cdpSession, "document.readyState");
    if (readyState === "interactive" || readyState === "complete") {
      return;
    }

    await sleep(50);
  }

  throw new Error(`Timed out waiting ${timeoutMs}ms for DOMContentLoaded.`);
}

async function waitForNavigationOrDomMutation(
  cdpSession: CDPSession,
  timeoutMs: number
): Promise<{ navigationObserved: boolean; domMutationObserved: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: { navigationObserved: boolean; domMutationObserved: boolean }): void => {
      if (settled) {
        return;
      }
      settled = true;
      cdpSession.off("Page.loadEventFired", onLoadEvent);
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve(result);
    };

    const onLoadEvent = (): void => {
      finish({
        navigationObserved: true,
        domMutationObserved: false
      });
    };

    cdpSession.on("Page.loadEventFired", onLoadEvent);

    void waitForDomMutationSignal(cdpSession, timeoutMs)
      .then((mutationObserved) => {
        finish({
          navigationObserved: false,
          domMutationObserved: mutationObserved
        });
      })
      .catch(() => {
        finish({
          navigationObserved: false,
          domMutationObserved: false
        });
      });

    timeout = setTimeout(() => {
      finish({
        navigationObserved: false,
        domMutationObserved: false
      });
    }, timeoutMs + 25);
  });
}

async function waitForDomMutationSignal(
  cdpSession: CDPSession,
  timeoutMs: number
): Promise<boolean> {
  const signal = await evaluateJsonExpression<string>(
    cdpSession,
    `(() => new Promise((resolve) => {
      const root = document.documentElement || document.body;
      if (!root) {
        resolve("no-root");
        return;
      }

      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        resolve(value);
      };

      const observer = new MutationObserver((mutations) => {
        if (mutations && mutations.length > 0) {
          finish("dom-mutation");
        }
      });

      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true
      });

      setTimeout(() => finish("timeout"), ${Math.max(1, timeoutMs)});
    }))();`
  );

  return signal === "dom-mutation";
}

async function normalizeAXNodes(
  cdpSession: CDPSession,
  rawNodes: RawAXNode[],
  options: { includeBoundingBoxes: boolean }
): Promise<NormalizedAXNode[]> {
  const transformedNodes: Array<{ raw: RawAXNode; normalized: NormalizedAXNode }> = [];
  for (const node of rawNodes) {
    const role = readAXRole(node.role);
    if (!role || PRUNED_AX_ROLES.has(role)) {
      continue;
    }

    transformedNodes.push({
      raw: node,
      normalized: {
        nodeId: node.nodeId,
        role,
        name: readAXTextValue(node.name),
        value: readAXTextValue(node.value),
        description: readAXTextValue(node.description),
        states: readAXStates(node.properties),
        boundingBox: null
      }
    });
  }

  if (!options.includeBoundingBoxes) {
    return transformedNodes.map((entry) => entry.normalized);
  }

  const withBoundingBoxes = await mapWithConcurrency(
    transformedNodes,
    DEFAULT_AX_BBOX_CONCURRENCY,
    async (entry) => {
      const boundingBox = await resolveBoundingBox(cdpSession, entry.raw.backendDOMNodeId);
      return {
        ...entry.normalized,
        boundingBox
      };
    }
  );

  return withBoundingBoxes;
}

function trimAXNodesToCharBudget(
  nodes: NormalizedAXNode[],
  charBudget: number
): { nodes: NormalizedAXNode[]; truncated: boolean } {
  if (JSON.stringify(nodes).length <= charBudget) {
    return { nodes, truncated: false };
  }

  const interactiveNodes = nodes.filter((node) => INTERACTIVE_AX_ROLES.has(node.role));
  if (interactiveNodes.length > 0 && JSON.stringify(interactiveNodes).length <= charBudget) {
    return { nodes: interactiveNodes, truncated: true };
  }

  const compactNodes = nodes.map((node) => ({
    ...node,
    description: null
  }));
  if (JSON.stringify(compactNodes).length <= charBudget) {
    return { nodes: compactNodes, truncated: true };
  }

  const compactInteractiveNodes = compactNodes.filter((node) => INTERACTIVE_AX_ROLES.has(node.role));
  if (
    compactInteractiveNodes.length > 0 &&
    JSON.stringify(compactInteractiveNodes).length <= charBudget
  ) {
    return { nodes: compactInteractiveNodes, truncated: true };
  }

  const hardLimitedNodes: NormalizedAXNode[] = [];
  for (const node of compactInteractiveNodes.length > 0 ? compactInteractiveNodes : compactNodes) {
    hardLimitedNodes.push(node);
    if (JSON.stringify(hardLimitedNodes).length > charBudget) {
      hardLimitedNodes.pop();
      break;
    }
  }

  return {
    nodes: hardLimitedNodes,
    truncated: true
  };
}

export function buildInteractiveElementIndex(
  normalizedNodes: NormalizedAXNode[]
): InteractiveElementIndexResult {
  const elements = normalizedNodes
    .filter((node) => INTERACTIVE_AX_ROLES.has(node.role))
    .map((node) => ({
      nodeId: node.nodeId,
      role: node.role,
      name: node.name,
      value: node.value,
      boundingBox: node.boundingBox
    }));

  const normalizedJson = JSON.stringify(normalizedNodes);
  const indexJson = JSON.stringify(elements);
  const normalizedCharCount = normalizedJson.length;
  const indexCharCount = indexJson.length;

  return {
    elements,
    json: indexJson,
    elementCount: elements.length,
    normalizedNodeCount: normalizedNodes.length,
    normalizedCharCount,
    indexCharCount,
    sizeRatio: normalizedCharCount === 0 ? 0 : indexCharCount / normalizedCharCount
  };
}

async function resolveBoundingBox(
  cdpSession: CDPSession,
  backendDOMNodeId?: number
): Promise<BoundingBox | null> {
  if (!backendDOMNodeId) {
    return null;
  }

  try {
    const boxModel = await cdpSession.send("DOM.getBoxModel", {
      backendNodeId: backendDOMNodeId
    });
    const content = boxModel.model?.content;

    if (!Array.isArray(content) || content.length < 8) {
      return null;
    }

    const xs = [content[0], content[2], content[4], content[6]];
    const ys = [content[1], content[3], content[5], content[7]];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(...xs) - x;
    const height = Math.max(...ys) - y;

    if (width <= 0 || height <= 0) {
      return null;
    }

    return {
      x: round2(x),
      y: round2(y),
      width: round2(width),
      height: round2(height)
    };
  } catch {
    return null;
  }
}

function readAXRole(value?: RawAXValue): string | null {
  const role = readAXTextValue(value);
  return role ? role.toLowerCase() : null;
}

function readAXTextValue(value?: RawAXValue): string | null {
  if (!value || value.value === undefined || value.value === null) {
    return null;
  }

  const text = String(value.value).trim();
  if (!text) {
    return null;
  }

  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function readAXStates(properties?: RawAXProperty[]): string[] {
  if (!properties || properties.length === 0) {
    return [];
  }

  const states = new Set<string>();
  for (const property of properties) {
    const name = property.name?.trim();
    if (!name) {
      continue;
    }

    const rawValue = property.value?.value;
    if (rawValue === true) {
      states.add(name);
      continue;
    }

    if (typeof rawValue === "string" && rawValue.trim() && rawValue !== "false") {
      states.add(`${name}:${rawValue}`);
    }
  }

  return [...states];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

async function readBase64ImageDimensions(
  imageBase64: string
): Promise<{ width: number; height: number }> {
  const metadata = await sharp(Buffer.from(imageBase64, "base64")).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Unable to determine screenshot dimensions.");
  }

  return {
    width: metadata.width,
    height: metadata.height
  };
}

async function stitchCapturedSegments(
  segments: CapturedSegment[],
  options: { quality: number; baseScrollY: number }
): Promise<{ imageBase64: string; width: number; height: number }> {
  if (segments.length === 0) {
    throw new Error("Cannot stitch screenshots: no segments were captured.");
  }

  const segmentBuffers = segments.map((segment) => Buffer.from(segment.imageBase64, "base64"));
  const firstMetadata = await sharp(segmentBuffers[0]).metadata();

  if (!firstMetadata.width || !firstMetadata.height) {
    throw new Error("Unable to determine captured segment dimensions.");
  }

  const width = firstMetadata.width;
  const segmentHeight = firstMetadata.height;
  const composites = segmentBuffers.map((buffer, index) => {
    const top = Math.max(0, Math.round(segments[index].scrollY - options.baseScrollY));
    return {
      input: buffer,
      left: 0,
      top
    };
  });

  const height = Math.max(...composites.map((entry) => entry.top + segmentHeight));
  const stitched = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }
    }
  })
    .composite(composites)
    .jpeg({ quality: options.quality })
    .toBuffer();

  return {
    imageBase64: stitched.toString("base64"),
    width,
    height
  };
}

async function configureDefaultViewport(cdpSession: CDPSession): Promise<void> {
  await cdpSession.send("Emulation.setDeviceMetricsOverride", {
    width: DEFAULT_GHOST_VIEWPORT.width,
    height: DEFAULT_GHOST_VIEWPORT.height,
    deviceScaleFactor: DEFAULT_GHOST_VIEWPORT.deviceScaleFactor,
    mobile: false,
    screenWidth: DEFAULT_GHOST_VIEWPORT.width,
    screenHeight: DEFAULT_GHOST_VIEWPORT.height
  });
}

export async function connectToGhostTabCdp(
  options: ConnectToGhostTabCdpOptions
): Promise<GhostTabCdpClient> {
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const browser = await chromium.connectOverCDP(options.endpointURL, {
    timeout: connectTimeoutMs
  });

  const page = await waitForFirstPage(browser, connectTimeoutMs);
  const cdpSession = await page.context().newCDPSession(page);
  await cdpSession.send("Page.enable");
  await cdpSession.send("Runtime.enable");
  await cdpSession.send("DOM.enable");
  await cdpSession.send("Accessibility.enable");
  await configureDefaultViewport(cdpSession);

  return new PlaywrightGhostTabCdpClient(browser, cdpSession);
}
