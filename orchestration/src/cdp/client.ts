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
const DEFAULT_REQUEST_INTERCEPTION_ENABLED = true;
const DEFAULT_REQUEST_INTERCEPTION_BLOCK_STYLESHEETS = false;
const DEFAULT_VISUAL_RENDER_SETTLE_MS = 250;
const DEFAULT_HTTP_CACHE_POLICY_MODE = "RESPECT_HEADERS" as const;
const DEFAULT_HTTP_CACHE_TTL_MS = 60_000;
const DEFAULT_AGENT_FAST_BLOCKED_RESOURCE_TYPES = new Set(["Image", "Font", "Media"]);
const DEFAULT_PREFETCH_TIMEOUT_MS = 2_500;
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
const AGENT_ACTION_TYPES = ["CLICK", "TYPE", "PRESS_KEY", "SCROLL", "WAIT", "EXTRACT", "DONE", "FAILED"] as const;
const SPECIAL_KEYS = ["Enter", "Tab", "Escape"] as const;
const REQUEST_INTERCEPTION_MODES = ["AGENT_FAST", "VISUAL_RENDER", "DISABLED"] as const;
const HTTP_CACHE_POLICY_MODES = ["RESPECT_HEADERS", "FORCE_REFRESH", "OVERRIDE_TTL"] as const;
const REQUEST_CLASSIFICATIONS = ["DOCUMENT_HTML", "JSON_API", "STATIC_ASSET", "OTHER"] as const;
const BLOCKABLE_RESOURCE_TYPES = new Set(["Image", "Font", "Media", "Stylesheet"]);

export interface ConnectToGhostTabCdpOptions {
  endpointURL: string;
  connectTimeoutMs?: number;
  targetPageIndex?: number;
  targetUrlIncludes?: string;
  requestInterception?: RequestInterceptionSettings;
  httpCachePolicy?: HttpCachePolicy;
}

export type RequestInterceptionMode = (typeof REQUEST_INTERCEPTION_MODES)[number];
export type HttpCachePolicyMode = (typeof HTTP_CACHE_POLICY_MODES)[number];
export type RequestClassification = (typeof REQUEST_CLASSIFICATIONS)[number];
export type NetworkErrorType =
  | "DNS_FAILURE"
  | "CONNECTION_TIMEOUT"
  | "TLS_ERROR"
  | "CONNECTION_FAILED"
  | "HTTP_4XX"
  | "HTTP_5XX"
  | "ABORTED"
  | "UNKNOWN_NETWORK_ERROR";

export interface RequestInterceptionSettings {
  enabled?: boolean;
  initialMode?: RequestInterceptionMode;
  blockStylesheets?: boolean;
  blockedResourceTypes?: string[];
  visualRenderSettleMs?: number;
}

export interface HttpCachePolicy {
  mode?: HttpCachePolicyMode;
  ttlMs?: number;
}

export interface HttpCachePolicyState {
  mode: HttpCachePolicyMode;
  ttlMs: number | null;
}

export interface RequestInterceptionMetricsSnapshot {
  requestedUrl: string | null;
  startedAt: string;
  completedAt: string | null;
  totalRequests: number;
  continuedRequests: number;
  blockedRequests: number;
  resourceTypeCounts: Record<string, number>;
  blockedResourceTypeCounts: Record<string, number>;
  classificationCounts: Record<RequestClassification, number>;
}

export interface RequestInterceptionMetrics {
  enabled: boolean;
  mode: RequestInterceptionMode;
  blockedResourceTypes: string[];
  lifetime: RequestInterceptionMetricsSnapshot;
  currentNavigation: RequestInterceptionMetricsSnapshot | null;
  visualRenderPassCount: number;
}

export interface PrefetchOptions {
  timeoutMs?: number;
  awaitResponse?: boolean;
}

export interface PrefetchResult {
  requestedUrl: string;
  normalizedUrl: string | null;
  status: "PREFETCHED" | "SKIPPED" | "FAILED";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  reason: string | null;
  errorMessage: string | null;
}

export interface NetworkConnectionTraceEntry {
  url: string;
  resourceType: string | null;
  status: number | null;
  connectionId: string | null;
  remoteIPAddress: string | null;
  remotePort: number | null;
  protocol: string | null;
  timestamp: string;
}

export interface NetworkConnectionTrace {
  entries: NetworkConnectionTraceEntry[];
  uniqueConnectionIds: string[];
  uniqueRemoteEndpoints: string[];
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

export interface AXDeficiencySignals {
  readyState: string;
  isLoadComplete: boolean;
  hasSignificantVisualContent: boolean;
  visibleElementCount: number;
  textCharCount: number;
  mediaElementCount: number;
  domInteractiveCandidateCount: number;
}

export interface ScrollPositionSnapshot {
  scrollY: number;
  viewportHeight: number;
  documentHeight: number;
  maxScrollY: number;
  remainingScrollPx: number;
  atTop: boolean;
  atBottom: boolean;
}

export interface DomInteractiveElement {
  tag: string;
  role: string | null;
  type: string | null;
  text: string;
  href: string | null;
  inputValue: string | null;
  computedStyle: {
    display: string;
    visibility: string;
    opacity: number;
    pointerEvents: string;
    cursor: string;
  };
  boundingBox: BoundingBox;
  isVisible: boolean;
  isInteractive: boolean;
}

export interface ExtractDomInteractiveElementsOptions {
  maxElements?: number;
}

export interface ExtractDomInteractiveElementsResult {
  elements: DomInteractiveElement[];
  elementCount: number;
  json: string;
  jsonCharCount: number;
}

export type AgentActionType = (typeof AGENT_ACTION_TYPES)[number];
export type AgentSpecialKey = (typeof SPECIAL_KEYS)[number];

export interface AgentActionTarget {
  x: number;
  y: number;
}

export interface AgentActionInput {
  action: AgentActionType;
  target: AgentActionTarget | null;
  text: string | null;
  key?: AgentSpecialKey | null;
  confidence?: number;
  reasoning?: string;
}

export interface ExecuteActionOptions {
  settleTimeoutMs?: number;
}

export interface DomMutationSummary {
  mutationObserved: boolean;
  significantMutationObserved: boolean;
  addedOrRemovedNodeCount: number;
  interactiveRoleMutationCount: number;
  childListMutationCount: number;
  attributeMutationCount: number;
}

export interface ActionExecutionResult {
  status: "acted" | "done" | "failed";
  action: AgentActionType;
  currentUrl: string;
  navigationObserved: boolean;
  urlChanged: boolean;
  scrollChanged: boolean;
  focusChanged: boolean;
  inputValueChanged: boolean;
  domMutationObserved: boolean;
  significantDomMutationObserved: boolean;
  domMutationSummary: DomMutationSummary | null;
  extractedData: unknown;
  message: string | null;
}

export interface NavigationOutcome {
  requestedUrl: string;
  finalUrl: string | null;
  status: number | null;
  statusText: string | null;
  errorText: string | null;
  errorType: NetworkErrorType | null;
  timestamp: string;
}

export interface GhostTabResourceMetrics {
  source: "CDP_PERFORMANCE";
  timestamp: string;
  timestampMs: number;
  taskDurationSeconds: number | null;
  scriptDurationSeconds: number | null;
  jsHeapUsedBytes: number | null;
  jsHeapTotalBytes: number | null;
  nodeCount: number | null;
}

export interface GhostTabCrashEvent {
  source: "CDP_TARGET_CRASHED" | "PAGE_CRASH";
  timestamp: string;
  status: string | null;
  errorCode: number | null;
}

export interface GhostViewportSettings {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export interface GhostTabCdpClient {
  navigate(url: string, timeoutMs?: number): Promise<void>;
  getLastNavigationOutcome(): NavigationOutcome | null;
  setHttpCachePolicy(policy: HttpCachePolicy): Promise<void>;
  getHttpCachePolicy(): HttpCachePolicyState;
  resolveLinkUrlAtPoint(target: AgentActionTarget): Promise<string | null>;
  prefetch(url: string, options?: PrefetchOptions): Promise<PrefetchResult>;
  traceNetworkConnections<T>(
    operation: () => Promise<T>,
    settleMs?: number
  ): Promise<{ result: T; trace: NetworkConnectionTrace }>;
  setRequestInterceptionMode(mode: RequestInterceptionMode): Promise<void>;
  getRequestInterceptionMode(): RequestInterceptionMode;
  getRequestInterceptionMetrics(): RequestInterceptionMetrics;
  resetRequestInterceptionMetrics(): void;
  withVisualRenderPass<T>(operation: () => Promise<T>): Promise<T>;
  extractNormalizedAXTree(
    options?: ExtractNormalizedAXTreeOptions
  ): Promise<ExtractNormalizedAXTreeResult>;
  extractInteractiveElementIndex(
    options?: ExtractInteractiveElementIndexOptions
  ): Promise<ExtractInteractiveElementIndexResult>;
  extractDomInteractiveElements(
    options?: ExtractDomInteractiveElementsOptions
  ): Promise<ExtractDomInteractiveElementsResult>;
  getAXDeficiencySignals(): Promise<AXDeficiencySignals>;
  getScrollPositionSnapshot(): Promise<ScrollPositionSnapshot>;
  executeAction(action: AgentActionInput, options?: ExecuteActionOptions): Promise<ActionExecutionResult>;
  getCurrentUrl(): Promise<string>;
  captureScreenshot(options?: CaptureScreenshotOptions): Promise<CaptureScreenshotResult>;
  captureJpegBase64(options?: CaptureJpegOptions): Promise<string>;
  sampleResourceMetrics(): Promise<GhostTabResourceMetrics>;
  onTargetCrashed(listener: (event: GhostTabCrashEvent) => void): () => void;
  getLastCrashEvent(): GhostTabCrashEvent | null;
  crashRendererForTesting(): Promise<void>;
  getViewport(): GhostViewportSettings;
  closeTarget(): Promise<void>;
  close(): Promise<void>;
}

interface ActionEffectSnapshot {
  scrollY: number;
  focusToken: string | null;
  focusValue: string | null;
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

interface ResolvedExtractDomInteractiveElementsOptions {
  maxElements: number;
}

interface ResolvedRequestInterceptionSettings {
  enabled: boolean;
  initialMode: RequestInterceptionMode;
  blockedResourceTypes: Set<string>;
  visualRenderSettleMs: number;
}

interface ResolvedHttpCachePolicy {
  mode: HttpCachePolicyMode;
  ttlMs: number | null;
}

interface NormalizedRequestPausedEvent {
  requestId: string;
  resourceType: string | null;
  url: string;
  method: string;
  headers: Record<string, string>;
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
  private readonly crashListeners = new Set<(event: GhostTabCrashEvent) => void>();
  private readonly requestInterceptionSettings: ResolvedRequestInterceptionSettings;
  private readonly urlNavigationVisitsMs = new Map<string, number>();
  private readonly fetchRequestPausedListener: (event: unknown) => void;
  private requestInterceptionInitialized = false;
  private networkCacheDisabled = false;
  private requestInterceptionMode: RequestInterceptionMode;
  private httpCachePolicy: ResolvedHttpCachePolicy;
  private lifetimeRequestInterceptionMetrics = createRequestInterceptionMetricsSnapshot(null);
  private currentNavigationRequestInterceptionMetrics: RequestInterceptionMetricsSnapshot | null =
    null;
  private visualRenderPassCount = 0;
  private lastPrefetchResult: PrefetchResult | null = null;
  private lastCrashEvent: GhostTabCrashEvent | null = null;
  private lastNavigationOutcome: NavigationOutcome | null = null;

  constructor(
    private readonly browser: Browser,
    private readonly cdpSession: CDPSession,
    private readonly page: Page,
    requestInterceptionSettings: ResolvedRequestInterceptionSettings,
    httpCachePolicy: ResolvedHttpCachePolicy
  ) {
    this.requestInterceptionSettings = requestInterceptionSettings;
    this.requestInterceptionMode = requestInterceptionSettings.enabled
      ? requestInterceptionSettings.initialMode
      : "DISABLED";
    this.httpCachePolicy = httpCachePolicy;
    this.fetchRequestPausedListener = (event: unknown) => {
      void this.handleRequestPaused(event);
    };

    this.cdpSession.on("Target.targetCrashed", (event: unknown) => {
      this.emitCrashEvent(normalizeTargetCrashEvent(event));
    });
    this.page.on("crash", () => {
      this.emitCrashEvent({
        source: "PAGE_CRASH",
        timestamp: new Date().toISOString(),
        status: "Renderer process crashed.",
        errorCode: null
      });
    });
  }

  async initialize(): Promise<void> {
    await this.setNetworkCacheDisabled(false);
    await this.enableRequestInterception();
  }

  async navigate(url: string, timeoutMs = DEFAULT_NAVIGATION_TIMEOUT_MS): Promise<void> {
    this.beginNavigationRequestInterceptionMetrics(url);
    const navigationStartedAtMs = Date.now();
    const cacheDecision = this.resolveNavigationCacheDecision(url, navigationStartedAtMs);
    let responseTracker: MainDocumentResponseTracker | null = null;
    let navigationCompleted = false;

    try {
      await this.setNetworkCacheDisabled(cacheDecision.cacheDisabled);
      const mainFrameId = await getMainFrameId(this.cdpSession).catch(() => null);
      responseTracker = trackMainDocumentResponse(this.cdpSession, {
        timeoutMs,
        mainFrameId
      });

      const navigationResult = await this.cdpSession.send("Page.navigate", { url });
      if (navigationResult.errorText) {
        const response = await responseTracker.promise.catch(() => null);
        this.lastNavigationOutcome = {
          requestedUrl: url,
          finalUrl: await this.getCurrentUrl().catch(() => url),
          status: response?.status ?? null,
          statusText: response?.statusText ?? null,
          errorText: navigationResult.errorText,
          errorType:
            response?.errorType ?? classifyNetworkErrorTypeFromFailureText(navigationResult.errorText),
          timestamp: new Date().toISOString()
        };
        throw new Error(`CDP Page.navigate failed for ${url}: ${navigationResult.errorText}`);
      }

      await waitForLoadEvent(this.cdpSession, timeoutMs);
      const response = await responseTracker.promise.catch(() => null);
      const statusBasedErrorType = classifyHttpStatusErrorType(response?.status ?? null);
      this.lastNavigationOutcome = {
        requestedUrl: url,
        finalUrl: await this.getCurrentUrl().catch(() => url),
        status: response?.status ?? null,
        statusText: response?.statusText ?? null,
        errorText: response?.errorText ?? null,
        errorType: response?.errorType ?? statusBasedErrorType,
        timestamp: new Date().toISOString()
      };
      navigationCompleted = true;
    } finally {
      responseTracker?.cancel();
      if (navigationCompleted && cacheDecision.cacheKey) {
        this.recordNavigationVisit(cacheDecision.cacheKey, Date.now());
      }
      await this.setNetworkCacheDisabled(false).catch(() => {
        // Ignore teardown/detach races after navigation failures.
      });
      this.completeNavigationRequestInterceptionMetrics();
    }
  }

  getLastNavigationOutcome(): NavigationOutcome | null {
    return this.lastNavigationOutcome;
  }

  async setHttpCachePolicy(policy: HttpCachePolicy): Promise<void> {
    this.httpCachePolicy = resolveHttpCachePolicy(policy);
  }

  getHttpCachePolicy(): HttpCachePolicyState {
    return {
      mode: this.httpCachePolicy.mode,
      ttlMs: this.httpCachePolicy.ttlMs
    };
  }

  async resolveLinkUrlAtPoint(target: AgentActionTarget): Promise<string | null> {
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) {
      return null;
    }

    const result = await evaluateJsonExpression<{ href: string | null }>(
      this.cdpSession,
      `(() => {
        const targetX = ${target.x};
        const targetY = ${target.y};
        const scrollX = window.scrollX || window.pageXOffset || 0;
        const scrollY = window.scrollY || window.pageYOffset || 0;
        const viewportX = Math.round(targetX - scrollX);
        const viewportY = Math.round(targetY - scrollY);

        const candidatePoints = [
          [viewportX, viewportY],
          [Math.round(targetX), Math.round(targetY)]
        ];

        const findAnchor = (node) => {
          if (!(node instanceof Element)) {
            return null;
          }
          if (node.matches("a[href], area[href]")) {
            return node;
          }
          return node.closest("a[href], area[href]");
        };

        for (const [x, y] of candidatePoints) {
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            continue;
          }
          const element = document.elementFromPoint(x, y);
          const anchor = findAnchor(element);
          if (anchor instanceof HTMLAnchorElement || anchor instanceof HTMLAreaElement) {
            return { href: anchor.href || null };
          }
        }

        return { href: null };
      })();`
    );

    const href = typeof result?.href === "string" ? result.href.trim() : "";
    return href.length > 0 ? href : null;
  }

  async prefetch(url: string, options: PrefetchOptions = {}): Promise<PrefetchResult> {
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    const timeoutMs = Math.max(100, options.timeoutMs ?? DEFAULT_PREFETCH_TIMEOUT_MS);
    const awaitResponse = options.awaitResponse ?? true;

    let normalizedUrl: string | null = null;
    try {
      const baseUrl = await this.getCurrentUrl().catch(() => "about:blank");
      normalizedUrl = new URL(url, baseUrl).toString();
    } catch {
      normalizedUrl = null;
    }

    if (!normalizedUrl || !isHttpLikeUrl(normalizedUrl)) {
      const skipped = createPrefetchResult({
        requestedUrl: url,
        normalizedUrl,
        status: "SKIPPED",
        startedAt,
        startedAtMs,
        reason: "PREFETCH_URL_NOT_HTTP",
        errorMessage: null
      });
      this.lastPrefetchResult = skipped;
      return skipped;
    }

    try {
      const fetchResult = await evaluateJsonExpression<{
        status: "fulfilled" | "rejected" | "dispatched";
        reason: string | null;
      }>(
        this.cdpSession,
        `(() => (async () => {
          const targetUrl = ${JSON.stringify(normalizedUrl)};
          const timeoutMs = ${timeoutMs};
          const awaitResponse = ${awaitResponse ? "true" : "false"};
          let timeoutId = null;
          let aborted = false;
          const controller = typeof AbortController === "function" ? new AbortController() : null;
          const clearTimeoutIfNeeded = () => {
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
          };

          if (controller) {
            timeoutId = setTimeout(() => {
              aborted = true;
              controller.abort();
            }, timeoutMs);
          }

          const fetchPromise = fetch(targetUrl, {
            method: "HEAD",
            mode: "no-cors",
            credentials: "omit",
            cache: "no-store",
            keepalive: true,
            redirect: "follow",
            signal: controller ? controller.signal : undefined
          }).finally(() => {
            clearTimeoutIfNeeded();
          });

          if (!awaitResponse) {
            void fetchPromise.catch(() => {});
            return {
              status: "dispatched",
              reason: "PREFETCH_REQUEST_DISPATCHED"
            };
          }

          try {
            await fetchPromise;
            return {
              status: "fulfilled",
              reason: null
            };
          } catch (error) {
            const message =
              typeof error === "object" && error !== null && "message" in error
                ? String(error.message)
                : String(error);

            return {
              status: "rejected",
              reason: aborted ? "PREFETCH_ABORTED_TIMEOUT" : message
            };
          }
        })())();`
      );

      const status = fetchResult.status === "rejected" ? "FAILED" : "PREFETCHED";
      const prefetchResult = createPrefetchResult({
        requestedUrl: url,
        normalizedUrl,
        status,
        startedAt,
        startedAtMs,
        reason:
          fetchResult.status === "fulfilled"
            ? "PREFETCH_HEAD_REQUEST_COMPLETED"
            : fetchResult.status === "dispatched"
              ? fetchResult.reason ?? "PREFETCH_REQUEST_DISPATCHED"
              : fetchResult.reason ?? "PREFETCH_REQUEST_FAILED",
        errorMessage: fetchResult.status === "rejected" ? fetchResult.reason : null
      });
      this.lastPrefetchResult = prefetchResult;
      return prefetchResult;
    } catch (error) {
      const failed = createPrefetchResult({
        requestedUrl: url,
        normalizedUrl,
        status: "FAILED",
        startedAt,
        startedAtMs,
        reason: "PREFETCH_RUNTIME_EVALUATE_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      this.lastPrefetchResult = failed;
      return failed;
    }
  }

  async traceNetworkConnections<T>(
    operation: () => Promise<T>,
    settleMs = 100
  ): Promise<{ result: T; trace: NetworkConnectionTrace }> {
    const entries: NetworkConnectionTraceEntry[] = [];
    const onResponse = (event: unknown): void => {
      const entry = normalizeNetworkConnectionTraceEntry(event);
      if (entry) {
        entries.push(entry);
      }
    };

    this.cdpSession.on("Network.responseReceived", onResponse);
    try {
      const result = await operation();
      if (settleMs > 0) {
        await sleep(settleMs);
      }

      return {
        result,
        trace: summarizeNetworkConnectionTrace(entries)
      };
    } finally {
      this.cdpSession.off("Network.responseReceived", onResponse);
    }
  }

  async setRequestInterceptionMode(mode: RequestInterceptionMode): Promise<void> {
    if (!REQUEST_INTERCEPTION_MODES.includes(mode)) {
      throw new Error(`Unsupported request interception mode: ${String(mode)}`);
    }

    if (!this.requestInterceptionSettings.enabled) {
      this.requestInterceptionMode = "DISABLED";
      return;
    }

    this.requestInterceptionMode = mode;
  }

  getRequestInterceptionMode(): RequestInterceptionMode {
    return this.requestInterceptionMode;
  }

  getRequestInterceptionMetrics(): RequestInterceptionMetrics {
    return {
      enabled: this.requestInterceptionSettings.enabled,
      mode: this.requestInterceptionMode,
      blockedResourceTypes: [...this.requestInterceptionSettings.blockedResourceTypes].sort(),
      lifetime: cloneRequestInterceptionMetricsSnapshot(this.lifetimeRequestInterceptionMetrics),
      currentNavigation: this.currentNavigationRequestInterceptionMetrics
        ? cloneRequestInterceptionMetricsSnapshot(this.currentNavigationRequestInterceptionMetrics)
        : null,
      visualRenderPassCount: this.visualRenderPassCount
    };
  }

  resetRequestInterceptionMetrics(): void {
    this.lifetimeRequestInterceptionMetrics = createRequestInterceptionMetricsSnapshot(null);
    this.currentNavigationRequestInterceptionMetrics = null;
    this.visualRenderPassCount = 0;
  }

  async withVisualRenderPass<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.requestInterceptionSettings.enabled) {
      return operation();
    }

    const previousMode = this.requestInterceptionMode;
    this.visualRenderPassCount += 1;

    await this.setRequestInterceptionMode("VISUAL_RENDER");
    await this.refreshVisualAssetsForScreenshot();

    if (this.requestInterceptionSettings.visualRenderSettleMs > 0) {
      await sleep(this.requestInterceptionSettings.visualRenderSettleMs);
    }

    try {
      return await operation();
    } finally {
      await this.setRequestInterceptionMode(previousMode);
    }
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

  async extractDomInteractiveElements(
    options: ExtractDomInteractiveElementsOptions = {}
  ): Promise<ExtractDomInteractiveElementsResult> {
    const resolvedOptions = resolveExtractDomInteractiveElementsOptions(options);
    const elements = await evaluateJsonExpression<DomInteractiveElement[]>(
      this.cdpSession,
      `(() => {
        const maxElements = ${resolvedOptions.maxElements};
        const interactiveSelector = [
          "button",
          "a[href]",
          "input",
          "select",
          "textarea",
          "[role='button']",
          "[role='link']",
          "[role='textbox']",
          "[role='combobox']",
          "[role='checkbox']",
          "[role='radio']",
          "[role='menuitem']",
          "[role='tab']",
          "[role='searchbox']",
          "[role='spinbutton']",
          "[role='slider']",
          "[role='switch']",
          "[tabindex]"
        ].join(",");
        const matches = Array.from(document.querySelectorAll(interactiveSelector));
        const unique = [];
        const seen = new Set();

        const isVisible = (element) => {
          if (!(element instanceof Element)) return false;
          const style = window.getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") === 0) {
            return false;
          }
          const rect = element.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) return false;
          const vw = window.innerWidth || document.documentElement.clientWidth || 0;
          const vh = window.innerHeight || document.documentElement.clientHeight || 0;
          if (rect.bottom < 0 || rect.right < 0 || rect.top > vh || rect.left > vw) {
            return false;
          }
          return true;
        };

        const readText = (element) => {
          const direct = (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
          if (direct.length > 0) return direct.slice(0, 180);

          const aria = (
            element.getAttribute("aria-label") ||
            element.getAttribute("title") ||
            element.getAttribute("placeholder") ||
            element.getAttribute("name") ||
            ""
          ).replace(/\\s+/g, " ").trim();
          if (aria.length > 0) return aria.slice(0, 180);

          if (element instanceof HTMLInputElement) {
            return (element.value || "").replace(/\\s+/g, " ").trim().slice(0, 180);
          }
          return "";
        };

        const readInputValue = (element) => {
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
            return (element.value || "").replace(/\\s+/g, " ").trim().slice(0, 180);
          }
          return null;
        };

        for (const element of matches) {
          if (!(element instanceof HTMLElement)) {
            continue;
          }
          if (!isVisible(element)) {
            continue;
          }
          if (seen.has(element)) {
            continue;
          }
          seen.add(element);
          unique.push(element);
          if (unique.length >= maxElements) {
            break;
          }
        }

        return unique.map((element) => {
          const rect = element.getBoundingClientRect();
          const scrollX = window.scrollX || window.pageXOffset || 0;
          const scrollY = window.scrollY || window.pageYOffset || 0;
          const style = window.getComputedStyle(element);
          const opacity = Number.parseFloat(style.opacity || "1");
          return {
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute("role"),
            type: element instanceof HTMLInputElement ? element.type || null : null,
            text: readText(element),
            href: element instanceof HTMLAnchorElement ? element.href || null : null,
            inputValue: readInputValue(element),
            computedStyle: {
              display: style.display,
              visibility: style.visibility,
              opacity: Number.isFinite(opacity) ? opacity : 1,
              pointerEvents: style.pointerEvents,
              cursor: style.cursor
            },
            boundingBox: {
              x: Math.round((rect.left + scrollX) * 1000) / 1000,
              y: Math.round((rect.top + scrollY) * 1000) / 1000,
              width: Math.round(rect.width * 1000) / 1000,
              height: Math.round(rect.height * 1000) / 1000
            },
            isVisible: true,
            isInteractive: true
          };
        });
      })();`
    );
    const json = JSON.stringify(elements);

    return {
      elements,
      elementCount: elements.length,
      json,
      jsonCharCount: json.length
    };
  }

  async getAXDeficiencySignals(): Promise<AXDeficiencySignals> {
    return evaluateJsonExpression<AXDeficiencySignals>(
      this.cdpSession,
      `(() => {
        const root = document.body || document.documentElement;
        const readyState = document.readyState || "loading";
        const isLoadComplete = readyState === "complete";

        const text = root ? (root.innerText || root.textContent || "") : "";
        const textCharCount = text.replace(/\\s+/g, " ").trim().length;

        const mediaElementCount = document.querySelectorAll("img, canvas, svg, video, iframe").length;

        const domInteractiveCandidateCount = document.querySelectorAll(
          "button, a[href], input, select, textarea, [role='button'], [role='link'], [role='textbox'], [tabindex]"
        ).length;

        const candidates = root ? Array.from(root.querySelectorAll("*")).slice(0, 2000) : [];
        let visibleElementCount = 0;
        const viewportHeight = window.innerHeight || 0;
        const viewportWidth = window.innerWidth || 0;

        for (const element of candidates) {
          if (!(element instanceof Element)) {
            continue;
          }

          const style = window.getComputedStyle(element);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            Number(style.opacity || "1") === 0
          ) {
            continue;
          }

          const rect = element.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) {
            continue;
          }
          if (
            rect.bottom < 0 ||
            rect.right < 0 ||
            rect.top > viewportHeight ||
            rect.left > viewportWidth
          ) {
            continue;
          }

          visibleElementCount += 1;
        }

        const hasSignificantVisualContent =
          isLoadComplete &&
          (
            visibleElementCount >= 4 ||
            textCharCount >= 40 ||
            mediaElementCount >= 1 ||
            domInteractiveCandidateCount >= 6
          );

        return {
          readyState,
          isLoadComplete,
          hasSignificantVisualContent,
          visibleElementCount,
          textCharCount,
          mediaElementCount,
          domInteractiveCandidateCount
        };
      })();`
    );
  }

  async getScrollPositionSnapshot(): Promise<ScrollPositionSnapshot> {
    return evaluateJsonExpression<ScrollPositionSnapshot>(
      this.cdpSession,
      `(() => {
        const body = document.body;
        const html = document.documentElement;
        const viewportHeight = window.innerHeight || (html ? html.clientHeight : 0);
        const documentHeight = Math.max(
          viewportHeight,
          body ? body.scrollHeight : 0,
          body ? body.offsetHeight : 0,
          html ? html.scrollHeight : 0,
          html ? html.offsetHeight : 0
        );
        const scrollY = Math.max(0, window.scrollY || window.pageYOffset || 0);
        const maxScrollY = Math.max(0, documentHeight - viewportHeight);
        const remainingScrollPx = Math.max(0, maxScrollY - scrollY);
        const atBottom = remainingScrollPx <= 2;

        return {
          scrollY,
          viewportHeight,
          documentHeight,
          maxScrollY,
          remainingScrollPx,
          atTop: scrollY <= 2,
          atBottom
        };
      })();`
    );
  }

  async executeAction(
    actionInput: AgentActionInput,
    options: ExecuteActionOptions = {}
  ): Promise<ActionExecutionResult> {
    const action = validateAgentActionInput(actionInput);
    const settleTimeoutMs = options.settleTimeoutMs ?? DEFAULT_ACTION_SETTLE_TIMEOUT_MS;
    const beforeUrl = await this.getCurrentUrl().catch(() => "");
    const beforeSnapshot = await this.captureActionEffectSnapshot();

    const buildActedExecutionResult = async (params: {
      settle: Awaited<ReturnType<typeof waitForNavigationOrDomMutation>>;
      extractedData?: unknown;
      message?: string | null;
    }): Promise<ActionExecutionResult> => {
      const currentUrl = await this.getCurrentUrl();
      const afterSnapshot = await this.captureActionEffectSnapshot();
      const effects = computeActionEffectSignals({
        beforeUrl,
        afterUrl: currentUrl,
        beforeSnapshot,
        afterSnapshot
      });
      return {
        status: "acted",
        action: action.action,
        currentUrl,
        navigationObserved: params.settle.navigationObserved,
        urlChanged: effects.urlChanged,
        scrollChanged: effects.scrollChanged,
        focusChanged: effects.focusChanged,
        inputValueChanged: effects.inputValueChanged,
        domMutationObserved: params.settle.domMutationObserved,
        significantDomMutationObserved: params.settle.significantDomMutationObserved,
        domMutationSummary: params.settle.domMutationSummary,
        extractedData: params.extractedData ?? null,
        message: params.message ?? null
      };
    };

    switch (action.action) {
      case "CLICK": {
        if (!action.target) {
          throw new Error("CLICK action requires a target.");
        }

        await this.dispatchClick(action.target);
        const settle = await waitForNavigationOrDomMutation(this.cdpSession, settleTimeoutMs);
        return buildActedExecutionResult({ settle });
      }
      case "TYPE": {
        if (!action.text || action.text.length === 0) {
          throw new Error("TYPE action requires non-empty text.");
        }

        await this.dispatchTyping(action.text);
        const settle = await waitForNavigationOrDomMutation(this.cdpSession, settleTimeoutMs);
        return buildActedExecutionResult({ settle });
      }
      case "PRESS_KEY": {
        if (!action.key) {
          throw new Error("PRESS_KEY action requires a key.");
        }

        await this.dispatchSpecialKey(action.key);
        const settle = await waitForNavigationOrDomMutation(this.cdpSession, settleTimeoutMs);
        return buildActedExecutionResult({ settle });
      }
      case "SCROLL": {
        const deltaY = parseScrollDelta(action.text);
        await this.dispatchScroll(action.target, deltaY);
        const settle = await waitForNavigationOrDomMutation(this.cdpSession, settleTimeoutMs);
        return buildActedExecutionResult({ settle });
      }
      case "WAIT": {
        const waitMs = parseWaitDurationMs(action.text);
        await sleep(waitMs);
        const settle = await waitForNavigationOrDomMutation(this.cdpSession, Math.min(waitMs, settleTimeoutMs));
        return buildActedExecutionResult({
          settle,
          message: `Waited ${waitMs}ms`
        });
      }
      case "EXTRACT": {
        const extractionResult = await this.runExtraction(action.text);
        const settle = await waitForNavigationOrDomMutation(this.cdpSession, settleTimeoutMs);
        return buildActedExecutionResult({
          settle,
          extractedData: extractionResult
        });
      }
      case "DONE":
        return {
          status: "done",
          action: action.action,
          currentUrl: await this.getCurrentUrl(),
          navigationObserved: false,
          urlChanged: false,
          scrollChanged: false,
          focusChanged: false,
          inputValueChanged: false,
          domMutationObserved: false,
          significantDomMutationObserved: false,
          domMutationSummary: null,
          extractedData: null,
          message: action.text
        };
      case "FAILED":
        return {
          status: "failed",
          action: action.action,
          currentUrl: await this.getCurrentUrl(),
          navigationObserved: false,
          urlChanged: false,
          scrollChanged: false,
          focusChanged: false,
          inputValueChanged: false,
          domMutationObserved: false,
          significantDomMutationObserved: false,
          domMutationSummary: null,
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

  async sampleResourceMetrics(): Promise<GhostTabResourceMetrics> {
    const [performanceResult, heapUsageResult] = await Promise.allSettled([
      this.cdpSession.send("Performance.getMetrics") as Promise<{
        metrics?: Array<{ name?: string; value?: number }>;
      }>,
      this.cdpSession.send("Runtime.getHeapUsage") as Promise<{
        usedSize?: number;
        totalSize?: number;
      }>
    ]);

    const metricValues = new Map<string, number>();
    if (performanceResult.status === "fulfilled") {
      for (const metric of performanceResult.value.metrics ?? []) {
        if (typeof metric.name !== "string") {
          continue;
        }
        if (typeof metric.value !== "number" || !Number.isFinite(metric.value)) {
          continue;
        }
        metricValues.set(metric.name, metric.value);
      }
    }

    const heapUsage =
      heapUsageResult.status === "fulfilled"
        ? {
            usedSize: readOptionalNumber(heapUsageResult.value.usedSize),
            totalSize: readOptionalNumber(heapUsageResult.value.totalSize)
          }
        : { usedSize: null, totalSize: null };

    return {
      source: "CDP_PERFORMANCE",
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      taskDurationSeconds: readOptionalMetric(metricValues, "TaskDuration"),
      scriptDurationSeconds: readOptionalMetric(metricValues, "ScriptDuration"),
      jsHeapUsedBytes: readOptionalMetric(metricValues, "JSHeapUsedSize") ?? heapUsage.usedSize,
      jsHeapTotalBytes: readOptionalMetric(metricValues, "JSHeapTotalSize") ?? heapUsage.totalSize,
      nodeCount: readOptionalMetric(metricValues, "Nodes")
    };
  }

  onTargetCrashed(listener: (event: GhostTabCrashEvent) => void): () => void {
    this.crashListeners.add(listener);
    return () => {
      this.crashListeners.delete(listener);
    };
  }

  getLastCrashEvent(): GhostTabCrashEvent | null {
    return this.lastCrashEvent;
  }

  async crashRendererForTesting(): Promise<void> {
    await this.cdpSession.send("Page.crash");
  }

  getViewport(): GhostViewportSettings {
    return {
      width: DEFAULT_GHOST_VIEWPORT.width,
      height: DEFAULT_GHOST_VIEWPORT.height,
      deviceScaleFactor: DEFAULT_GHOST_VIEWPORT.deviceScaleFactor
    };
  }

  async close(): Promise<void> {
    await this.disableRequestInterception().catch(() => {
      // Ignore teardown races during shutdown.
    });
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

  private async captureActionEffectSnapshot(): Promise<ActionEffectSnapshot | null> {
    try {
      return await evaluateJsonExpression<ActionEffectSnapshot>(
        this.cdpSession,
        `(() => {
          const active = document.activeElement;
          const focusToken = active
            ? [
                String(active.tagName || "").toLowerCase(),
                active.id || "",
                active.getAttribute("name") || "",
                active.getAttribute("role") || "",
                active.getAttribute("type") || ""
              ].join("|")
            : null;
          let focusValue = null;
          if (
            active &&
            (active instanceof HTMLInputElement ||
              active instanceof HTMLTextAreaElement ||
              active instanceof HTMLSelectElement)
          ) {
            focusValue = active.value ?? null;
          }

          return {
            scrollY: Number(window.scrollY || window.pageYOffset || 0),
            focusToken,
            focusValue
          };
        })();`
      );
    } catch {
      return null;
    }
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

  private async dispatchSpecialKey(key: AgentSpecialKey): Promise<void> {
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

  async closeTarget(): Promise<void> {
    try {
      await this.cdpSession.send("Page.close");
      return;
    } catch {
      // Fallback for cases where Page.close is unavailable or the session already detached.
    }

    try {
      await this.page.close();
    } catch {
      // Ignore close races when the target is already gone.
    }
  }

  private resolveNavigationCacheDecision(
    navigationUrl: string,
    nowMs: number
  ): {
    cacheKey: string | null;
    cacheDisabled: boolean;
  } {
    const cacheKey = normalizeNavigationCacheKey(navigationUrl, this.page.url());

    if (this.httpCachePolicy.mode === "FORCE_REFRESH") {
      return {
        cacheKey,
        cacheDisabled: true
      };
    }

    if (this.httpCachePolicy.mode !== "OVERRIDE_TTL" || this.httpCachePolicy.ttlMs === null) {
      return {
        cacheKey,
        cacheDisabled: false
      };
    }

    if (!cacheKey) {
      return {
        cacheKey,
        cacheDisabled: false
      };
    }

    const lastVisitedAtMs = this.urlNavigationVisitsMs.get(cacheKey);
    if (typeof lastVisitedAtMs !== "number" || !Number.isFinite(lastVisitedAtMs)) {
      return {
        cacheKey,
        cacheDisabled: false
      };
    }

    return {
      cacheKey,
      cacheDisabled: nowMs - lastVisitedAtMs >= this.httpCachePolicy.ttlMs
    };
  }

  private recordNavigationVisit(cacheKey: string, visitedAtMs: number): void {
    if (this.urlNavigationVisitsMs.size >= 2_048 && !this.urlNavigationVisitsMs.has(cacheKey)) {
      const oldestKey = this.urlNavigationVisitsMs.keys().next().value;
      if (typeof oldestKey === "string") {
        this.urlNavigationVisitsMs.delete(oldestKey);
      }
    }

    this.urlNavigationVisitsMs.set(cacheKey, visitedAtMs);
  }

  private async setNetworkCacheDisabled(cacheDisabled: boolean): Promise<void> {
    if (this.networkCacheDisabled === cacheDisabled) {
      return;
    }

    await this.cdpSession.send("Network.setCacheDisabled", {
      cacheDisabled
    });
    this.networkCacheDisabled = cacheDisabled;
  }

  private async enableRequestInterception(): Promise<void> {
    if (!this.requestInterceptionSettings.enabled || this.requestInterceptionInitialized) {
      return;
    }

    await this.cdpSession.send("Fetch.enable", {
      patterns: [
        {
          urlPattern: "*",
          requestStage: "Request"
        }
      ]
    });
    this.cdpSession.on("Fetch.requestPaused", this.fetchRequestPausedListener);
    this.requestInterceptionInitialized = true;
  }

  private async disableRequestInterception(): Promise<void> {
    if (!this.requestInterceptionInitialized) {
      return;
    }

    this.cdpSession.off("Fetch.requestPaused", this.fetchRequestPausedListener);
    this.requestInterceptionInitialized = false;
    await this.cdpSession.send("Fetch.disable");
  }

  private beginNavigationRequestInterceptionMetrics(requestedUrl: string): void {
    if (!this.requestInterceptionSettings.enabled) {
      this.currentNavigationRequestInterceptionMetrics = null;
      return;
    }

    this.currentNavigationRequestInterceptionMetrics =
      createRequestInterceptionMetricsSnapshot(requestedUrl);
  }

  private completeNavigationRequestInterceptionMetrics(): void {
    if (!this.currentNavigationRequestInterceptionMetrics) {
      return;
    }

    if (!this.currentNavigationRequestInterceptionMetrics.completedAt) {
      this.currentNavigationRequestInterceptionMetrics.completedAt = new Date().toISOString();
    }
  }

  private async handleRequestPaused(rawEvent: unknown): Promise<void> {
    const event = normalizeRequestPausedEvent(rawEvent);
    if (!event) {
      return;
    }

    const resourceType = event.resourceType ?? "Other";
    const classification = classifyRequest(event, resourceType);
    const blocked = this.shouldBlockRequest({
      mode: this.requestInterceptionMode,
      resourceType,
      url: event.url
    });
    this.recordRequestInterceptionEvent({
      resourceType,
      classification,
      blocked
    });

    try {
      if (blocked) {
        await this.cdpSession.send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient"
        });
        return;
      }

      await this.cdpSession.send("Fetch.continueRequest", {
        requestId: event.requestId
      });
    } catch {
      // Ignore detach races; pending requests will be dropped with the session.
    }
  }

  private shouldBlockRequest(input: {
    mode: RequestInterceptionMode;
    resourceType: string;
    url: string;
  }): boolean {
    if (input.mode !== "AGENT_FAST") {
      return false;
    }

    if (input.url.startsWith("data:") || input.url.startsWith("blob:")) {
      return false;
    }

    return this.requestInterceptionSettings.blockedResourceTypes.has(input.resourceType);
  }

  private recordRequestInterceptionEvent(input: {
    resourceType: string;
    classification: RequestClassification;
    blocked: boolean;
  }): void {
    applyRequestInterceptionMetricEvent(this.lifetimeRequestInterceptionMetrics, input);
    if (this.currentNavigationRequestInterceptionMetrics) {
      applyRequestInterceptionMetricEvent(this.currentNavigationRequestInterceptionMetrics, input);
    }
  }

  private async refreshVisualAssetsForScreenshot(): Promise<void> {
    try {
      await evaluateJsonExpression<number>(
        this.cdpSession,
        `(() => {
          let retriggered = 0;
          const cacheBustValue = String(Date.now());
          const toVisualPassUrl = (src) => {
            if (typeof src !== "string" || src.length === 0) {
              return src;
            }
            if (src.startsWith("data:") || src.startsWith("blob:")) {
              return src;
            }
            const separator = src.includes("?") ? "&" : "?";
            return src + separator + "ghost_visual_pass=" + cacheBustValue;
          };

          for (const image of Array.from(document.images || [])) {
            if (!(image instanceof HTMLImageElement)) {
              continue;
            }
            const src = image.getAttribute("src");
            if (!src) {
              continue;
            }
            if (image.complete && image.naturalWidth > 0) {
              continue;
            }
            image.src = toVisualPassUrl(src);
            retriggered += 1;
          }

          for (const media of Array.from(document.querySelectorAll("video[src], audio[src]"))) {
            if (!(media instanceof HTMLMediaElement)) {
              continue;
            }
            const src = media.getAttribute("src");
            if (!src) {
              continue;
            }
            media.setAttribute("src", toVisualPassUrl(src));
            media.load();
            retriggered += 1;
          }

          return retriggered;
        })();`
      );
    } catch {
      // Best-effort only; screenshots should still proceed even if no asset retries occur.
    }
  }

  private emitCrashEvent(event: GhostTabCrashEvent): void {
    this.lastCrashEvent = event;
    for (const listener of this.crashListeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener failures to avoid disrupting task execution.
      }
    }
  }
}

function readOptionalMetric(metricValues: Map<string, number>, name: string): number | null {
  const value = metricValues.get(name);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function readOptionalNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function normalizeTargetCrashEvent(raw: unknown): GhostTabCrashEvent {
  let status: string | null = null;
  let errorCode: number | null = null;

  if (typeof raw === "object" && raw !== null) {
    const candidate = raw as Record<string, unknown>;
    if (typeof candidate.status === "string" && candidate.status.trim().length > 0) {
      status = candidate.status.trim();
    } else if (
      typeof candidate.errorReason === "string" &&
      candidate.errorReason.trim().length > 0
    ) {
      status = candidate.errorReason.trim();
    } else if (
      typeof candidate.reason === "string" &&
      candidate.reason.trim().length > 0
    ) {
      status = candidate.reason.trim();
    }

    if (typeof candidate.errorCode === "number" && Number.isFinite(candidate.errorCode)) {
      errorCode = candidate.errorCode;
    }
  }

  return {
    source: "CDP_TARGET_CRASHED",
    timestamp: new Date().toISOString(),
    status,
    errorCode
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function flattenPages(browser: Browser): Page[] {
  return browser.contexts().flatMap((context) => context.pages());
}

function pickTargetPage(
  pages: Page[],
  selector: {
    targetPageIndex: number;
    targetUrlIncludes: string | null;
  }
): Page | null {
  if (selector.targetUrlIncludes) {
    return pages.find((page) => page.url().includes(selector.targetUrlIncludes ?? "")) ?? null;
  }

  if (selector.targetPageIndex < 0) {
    return null;
  }

  return pages[selector.targetPageIndex] ?? null;
}

async function waitForTargetPage(
  browser: Browser,
  timeoutMs: number,
  selector: {
    targetPageIndex: number;
    targetUrlIncludes: string | null;
  }
): Promise<Page> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const pages = flattenPages(browser);
    const selected = pickTargetPage(pages, selector);
    if (selected) {
      return selected;
    }

    await sleep(100);
  }

  const selectorDescription = selector.targetUrlIncludes
    ? `url includes "${selector.targetUrlIncludes}"`
    : `index ${selector.targetPageIndex}`;
  throw new Error(
    `Timed out waiting ${timeoutMs}ms for a Ghost Tab target page (${selectorDescription}).`
  );
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

interface MainDocumentResponseEvent {
  requestId: string | null;
  frameId: string | null;
  url: string | null;
  status: number | null;
  statusText: string | null;
  errorText: string | null;
  errorType: NetworkErrorType | null;
  blockedReason: string | null;
  canceled: boolean | null;
}

interface MainDocumentLoadingFailedEvent {
  requestId: string | null;
  frameId: string | null;
  url: string | null;
  errorText: string;
  errorType: NetworkErrorType;
  blockedReason: string | null;
  canceled: boolean | null;
}

interface MainDocumentResponseTracker {
  promise: Promise<MainDocumentResponseEvent | null>;
  cancel: () => void;
}

function trackMainDocumentResponse(
  cdpSession: CDPSession,
  input: {
    timeoutMs: number;
    mainFrameId: string | null;
  }
): MainDocumentResponseTracker {
  let latestResponse: MainDocumentResponseEvent | null = null;
  let latestLoadingFailed: MainDocumentLoadingFailedEvent | null = null;
  let settled = false;
  let timeoutHandle: NodeJS.Timeout | null = null;
  let loadHandle: NodeJS.Timeout | null = null;
  let resolvePromise: ((value: MainDocumentResponseEvent | null) => void) | null = null;

  const onResponse = (event: unknown): void => {
    const normalized = normalizeMainDocumentResponseEvent(event);
    if (!normalized) {
      return;
    }
    if (input.mainFrameId && normalized.frameId && normalized.frameId !== input.mainFrameId) {
      return;
    }
    latestResponse = normalized;
  };

  const onLoadingFailed = (event: unknown): void => {
    const normalized = normalizeMainDocumentLoadingFailedEvent(event);
    if (!normalized) {
      return;
    }
    if (input.mainFrameId && normalized.frameId && normalized.frameId !== input.mainFrameId) {
      return;
    }
    latestLoadingFailed = normalized;
  };

  const cleanup = (): void => {
    cdpSession.off("Network.responseReceived", onResponse);
    cdpSession.off("Network.loadingFailed", onLoadingFailed);
    cdpSession.off("Page.loadEventFired", onLoadEvent);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    if (loadHandle) {
      clearTimeout(loadHandle);
      loadHandle = null;
    }
  };

  const finish = (): void => {
    if (settled) {
      return;
    }
    settled = true;
    cleanup();
    resolvePromise?.(mergeMainDocumentEvents(latestResponse, latestLoadingFailed));
  };

  const onLoadEvent = (): void => {
    if (settled) {
      return;
    }
    // Allow responseReceived to flush before resolving.
    loadHandle = setTimeout(() => {
      finish();
    }, 25);
  };

  const promise = new Promise<MainDocumentResponseEvent | null>((resolve) => {
    resolvePromise = resolve;
    cdpSession.on("Network.responseReceived", onResponse);
    cdpSession.on("Network.loadingFailed", onLoadingFailed);
    cdpSession.on("Page.loadEventFired", onLoadEvent);
    timeoutHandle = setTimeout(() => {
      finish();
    }, Math.max(250, input.timeoutMs));
  });

  return {
    promise,
    cancel: () => finish()
  };
}

function normalizeMainDocumentResponseEvent(event: unknown): MainDocumentResponseEvent | null {
  if (typeof event !== "object" || event === null) {
    return null;
  }

  const candidate = event as Record<string, unknown>;
  if (candidate.type !== "Document") {
    return null;
  }

  const response =
    typeof candidate.response === "object" && candidate.response !== null
      ? (candidate.response as Record<string, unknown>)
      : null;
  if (!response) {
    return null;
  }

  return {
    requestId: typeof candidate.requestId === "string" ? candidate.requestId : null,
    frameId: typeof candidate.frameId === "string" ? candidate.frameId : null,
    url: typeof response.url === "string" ? response.url : null,
    status:
      typeof response.status === "number" && Number.isFinite(response.status) ? response.status : null,
    statusText: typeof response.statusText === "string" ? response.statusText : null,
    errorText: null,
    errorType: null,
    blockedReason: null,
    canceled: null
  };
}

function normalizeMainDocumentLoadingFailedEvent(
  event: unknown
): MainDocumentLoadingFailedEvent | null {
  if (typeof event !== "object" || event === null) {
    return null;
  }

  const candidate = event as Record<string, unknown>;
  if (candidate.type !== "Document") {
    return null;
  }

  const errorText =
    typeof candidate.errorText === "string" && candidate.errorText.trim().length > 0
      ? candidate.errorText.trim()
      : null;
  if (!errorText) {
    return null;
  }

  const blockedReason =
    typeof candidate.blockedReason === "string" && candidate.blockedReason.trim().length > 0
      ? candidate.blockedReason.trim()
      : null;
  const canceled = typeof candidate.canceled === "boolean" ? candidate.canceled : null;

  return {
    requestId: typeof candidate.requestId === "string" ? candidate.requestId : null,
    frameId: typeof candidate.frameId === "string" ? candidate.frameId : null,
    url: typeof candidate.url === "string" ? candidate.url : null,
    errorText,
    errorType: classifyNetworkErrorTypeFromFailureText(errorText, {
      blockedReason,
      canceled
    }),
    blockedReason,
    canceled
  };
}

function mergeMainDocumentEvents(
  response: MainDocumentResponseEvent | null,
  loadingFailed: MainDocumentLoadingFailedEvent | null
): MainDocumentResponseEvent | null {
  if (!response && !loadingFailed) {
    return null;
  }

  if (!loadingFailed) {
    return response;
  }

  return {
    requestId: loadingFailed.requestId ?? response?.requestId ?? null,
    frameId: loadingFailed.frameId ?? response?.frameId ?? null,
    url: loadingFailed.url ?? response?.url ?? null,
    status: response?.status ?? null,
    statusText: response?.statusText ?? null,
    errorText: loadingFailed.errorText,
    errorType: loadingFailed.errorType,
    blockedReason: loadingFailed.blockedReason,
    canceled: loadingFailed.canceled
  };
}

function normalizeNetworkConnectionTraceEntry(event: unknown): NetworkConnectionTraceEntry | null {
  if (typeof event !== "object" || event === null) {
    return null;
  }

  const candidate = event as Record<string, unknown>;
  const response =
    typeof candidate.response === "object" && candidate.response !== null
      ? (candidate.response as Record<string, unknown>)
      : null;
  if (!response) {
    return null;
  }

  const connectionIdRaw = response.connectionId;
  let connectionId: string | null = null;
  if (typeof connectionIdRaw === "string" && connectionIdRaw.trim().length > 0) {
    connectionId = connectionIdRaw.trim();
  } else if (typeof connectionIdRaw === "number" && Number.isFinite(connectionIdRaw)) {
    connectionId = String(connectionIdRaw);
  }

  const remoteIPAddress =
    typeof response.remoteIPAddress === "string" && response.remoteIPAddress.trim().length > 0
      ? response.remoteIPAddress.trim()
      : null;
  const remotePort =
    typeof response.remotePort === "number" && Number.isFinite(response.remotePort)
      ? response.remotePort
      : null;

  return {
    url: typeof response.url === "string" ? response.url : "",
    resourceType: typeof candidate.type === "string" ? candidate.type : null,
    status:
      typeof response.status === "number" && Number.isFinite(response.status) ? response.status : null,
    connectionId,
    remoteIPAddress,
    remotePort,
    protocol: typeof response.protocol === "string" ? response.protocol : null,
    timestamp: new Date().toISOString()
  };
}

function summarizeNetworkConnectionTrace(entries: NetworkConnectionTraceEntry[]): NetworkConnectionTrace {
  const uniqueConnectionIds = new Set<string>();
  const uniqueRemoteEndpoints = new Set<string>();

  for (const entry of entries) {
    if (entry.connectionId) {
      uniqueConnectionIds.add(entry.connectionId);
    }

    if (entry.remoteIPAddress && entry.remotePort !== null) {
      uniqueRemoteEndpoints.add(`${entry.remoteIPAddress}:${String(entry.remotePort)}`);
    }
  }

  return {
    entries,
    uniqueConnectionIds: [...uniqueConnectionIds].sort(),
    uniqueRemoteEndpoints: [...uniqueRemoteEndpoints].sort()
  };
}

function classifyHttpStatusErrorType(status: number | null): NetworkErrorType | null {
  if (typeof status !== "number" || !Number.isFinite(status)) {
    return null;
  }

  if (status >= 500) {
    return "HTTP_5XX";
  }
  if (status >= 400) {
    return "HTTP_4XX";
  }

  return null;
}

function classifyNetworkErrorTypeFromFailureText(
  errorText: string,
  options: {
    blockedReason?: string | null;
    canceled?: boolean | null;
  } = {}
): NetworkErrorType {
  const normalized = errorText.trim().toUpperCase();
  if (options.canceled) {
    return "ABORTED";
  }

  if (options.blockedReason) {
    return "CONNECTION_FAILED";
  }

  if (
    normalized.includes("ERR_NAME_NOT_RESOLVED") ||
    normalized.includes("ERR_DNS") ||
    normalized.includes("NAME_NOT_RESOLVED")
  ) {
    return "DNS_FAILURE";
  }

  if (
    normalized.includes("ERR_TIMED_OUT") ||
    normalized.includes("ERR_CONNECTION_TIMED_OUT") ||
    normalized.includes("TIMED_OUT")
  ) {
    return "CONNECTION_TIMEOUT";
  }

  if (
    normalized.includes("ERR_SSL") ||
    normalized.includes("ERR_CERT") ||
    normalized.includes("ERR_TLS")
  ) {
    return "TLS_ERROR";
  }

  if (
    normalized.includes("ERR_CONNECTION") ||
    normalized.includes("ERR_ADDRESS_UNREACHABLE") ||
    normalized.includes("ERR_INTERNET_DISCONNECTED") ||
    normalized.includes("ERR_NETWORK_CHANGED")
  ) {
    return "CONNECTION_FAILED";
  }

  return "UNKNOWN_NETWORK_ERROR";
}

function isHttpLikeUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

function normalizeNavigationCacheKey(url: string, baseUrl: string): string | null {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return null;
  }

  try {
    const baseCandidate = baseUrl.trim();
    const hasValidBase =
      baseCandidate.length > 0 &&
      baseCandidate !== "about:blank" &&
      isHttpLikeUrl(baseCandidate);
    const resolved = hasValidBase ? new URL(trimmedUrl, baseCandidate) : new URL(trimmedUrl);
    resolved.hash = "";
    return resolved.toString();
  } catch {
    return trimmedUrl;
  }
}

function createPrefetchResult(input: {
  requestedUrl: string;
  normalizedUrl: string | null;
  status: PrefetchResult["status"];
  startedAt: string;
  startedAtMs: number;
  reason: string | null;
  errorMessage: string | null;
}): PrefetchResult {
  const finishedAtMs = Date.now();
  return {
    requestedUrl: input.requestedUrl,
    normalizedUrl: input.normalizedUrl,
    status: input.status,
    startedAt: input.startedAt,
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: Math.max(0, finishedAtMs - input.startedAtMs),
    reason: input.reason,
    errorMessage: input.errorMessage
  };
}

async function getMainFrameId(cdpSession: CDPSession): Promise<string | null> {
  const frameTree = (await cdpSession.send("Page.getFrameTree")) as {
    frameTree?: {
      frame?: {
        id?: unknown;
      };
    };
  };
  const frameId = frameTree?.frameTree?.frame?.id;
  return typeof frameId === "string" && frameId.trim().length > 0 ? frameId : null;
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

function resolveExtractDomInteractiveElementsOptions(
  options: ExtractDomInteractiveElementsOptions
): ResolvedExtractDomInteractiveElementsOptions {
  const maxElements = options.maxElements ?? 120;
  if (!Number.isFinite(maxElements) || maxElements <= 0) {
    throw new Error(`maxElements must be > 0. Received: ${String(options.maxElements)}`);
  }

  return {
    maxElements: Math.min(500, Math.floor(maxElements))
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

  const key = action.key ?? null;
  if (key !== null && !isSpecialKey(key)) {
    throw new Error(`Action key must be one of: ${SPECIAL_KEYS.join(", ")}.`);
  }
  if (action.action === "PRESS_KEY" && key === null) {
    throw new Error("PRESS_KEY action requires key.");
  }
  if (action.action !== "PRESS_KEY" && key !== null) {
    throw new Error("Action key is only valid for PRESS_KEY actions.");
  }

  return {
    action: action.action,
    target: action.target ?? null,
    text: action.text ?? null,
    key,
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

type TypingToken = { kind: "char"; value: string } | { kind: "special"; value: AgentSpecialKey };

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

function getSpecialKeyDetails(key: AgentSpecialKey): {
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

function isSpecialKey(value: string): value is AgentSpecialKey {
  return (SPECIAL_KEYS as readonly string[]).includes(value);
}

function computeActionEffectSignals(input: {
  beforeUrl: string;
  afterUrl: string;
  beforeSnapshot: ActionEffectSnapshot | null;
  afterSnapshot: ActionEffectSnapshot | null;
}): {
  urlChanged: boolean;
  scrollChanged: boolean;
  focusChanged: boolean;
  inputValueChanged: boolean;
} {
  const urlChanged = input.beforeUrl !== input.afterUrl;

  const scrollChanged =
    input.beforeSnapshot !== null &&
    input.afterSnapshot !== null &&
    Math.abs(input.afterSnapshot.scrollY - input.beforeSnapshot.scrollY) > 2;

  const focusChanged =
    input.beforeSnapshot !== null &&
    input.afterSnapshot !== null &&
    input.beforeSnapshot.focusToken !== input.afterSnapshot.focusToken;

  const inputValueChanged =
    input.beforeSnapshot !== null &&
    input.afterSnapshot !== null &&
    input.beforeSnapshot.focusValue !== input.afterSnapshot.focusValue;

  return {
    urlChanged,
    scrollChanged,
    focusChanged,
    inputValueChanged
  };
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
): Promise<{
  navigationObserved: boolean;
  domMutationObserved: boolean;
  significantDomMutationObserved: boolean;
  domMutationSummary: DomMutationSummary | null;
}> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: {
      navigationObserved: boolean;
      domMutationObserved: boolean;
      significantDomMutationObserved: boolean;
      domMutationSummary: DomMutationSummary | null;
    }): void => {
      if (settled) {
        return;
      }
      settled = true;
      cdpSession.off("Page.loadEventFired", onLoadEvent);
      resolve(result);
    };

    const onLoadEvent = (): void => {
      finish({
        navigationObserved: true,
        domMutationObserved: false,
        significantDomMutationObserved: false,
        domMutationSummary: null
      });
    };

    cdpSession.on("Page.loadEventFired", onLoadEvent);

    void waitForDomMutationSignal(cdpSession, timeoutMs)
      .then((mutationSummary) => {
        finish({
          navigationObserved: false,
          domMutationObserved: mutationSummary.mutationObserved,
          significantDomMutationObserved: mutationSummary.significantMutationObserved,
          domMutationSummary: mutationSummary
        });
      })
      .catch(() => {
        finish({
          navigationObserved: false,
          domMutationObserved: false,
          significantDomMutationObserved: false,
          domMutationSummary: null
        });
      });
  });
}

async function waitForDomMutationSignal(
  cdpSession: CDPSession,
  timeoutMs: number
): Promise<DomMutationSummary> {
  const mutationSummary = await evaluateJsonExpression<DomMutationSummary>(
    cdpSession,
    `(() => new Promise((resolve) => {
      const root = document.documentElement || document.body;
      if (!root) {
        resolve({
          mutationObserved: false,
          significantMutationObserved: false,
          addedOrRemovedNodeCount: 0,
          interactiveRoleMutationCount: 0,
          childListMutationCount: 0,
          attributeMutationCount: 0
        });
        return;
      }

      const interactiveSelector = [
        "button",
        "a[href]",
        "input",
        "select",
        "textarea",
        "[role='button']",
        "[role='link']",
        "[role='textbox']",
        "[role='combobox']",
        "[role='checkbox']",
        "[role='radio']",
        "[role='menuitem']",
        "[role='tab']",
        "[role='searchbox']",
        "[role='spinbutton']",
        "[role='slider']",
        "[role='switch']"
      ].join(",");

      let settled = false;
      let addedOrRemovedNodeCount = 0;
      let interactiveRoleMutationCount = 0;
      let childListMutationCount = 0;
      let attributeMutationCount = 0;

      const hasInteractiveRole = (node) => {
        if (!(node instanceof Element)) {
          return false;
        }
        return node.matches(interactiveSelector);
      };

      const nodeContainsInteractiveRole = (node) => {
        if (!(node instanceof Element)) {
          return false;
        }
        if (hasInteractiveRole(node)) {
          return true;
        }
        return Boolean(node.querySelector(interactiveSelector));
      };

      const isSignificant = () =>
        addedOrRemovedNodeCount >= 3 || interactiveRoleMutationCount > 0;

      const finish = () => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        resolve({
          mutationObserved:
            childListMutationCount > 0 || attributeMutationCount > 0,
          significantMutationObserved: isSignificant(),
          addedOrRemovedNodeCount,
          interactiveRoleMutationCount,
          childListMutationCount,
          attributeMutationCount
        });
      };

      const observer = new MutationObserver((mutations) => {
        if (!mutations || mutations.length === 0) {
          return;
        }

        for (const mutation of mutations) {
          if (mutation.type === "childList") {
            childListMutationCount += 1;
            addedOrRemovedNodeCount += mutation.addedNodes.length + mutation.removedNodes.length;

            if (nodeContainsInteractiveRole(mutation.target)) {
              interactiveRoleMutationCount += 1;
              continue;
            }

            const allNodes = [
              ...Array.from(mutation.addedNodes),
              ...Array.from(mutation.removedNodes)
            ];
            if (allNodes.some((node) => nodeContainsInteractiveRole(node))) {
              interactiveRoleMutationCount += 1;
            }
            continue;
          }

          if (mutation.type === "attributes") {
            attributeMutationCount += 1;
            const target = mutation.target;
            const attributeName = (mutation.attributeName || "").toLowerCase();
            const interactiveAttribute =
              attributeName === "role" ||
              attributeName === "tabindex" ||
              attributeName === "href" ||
              attributeName.startsWith("aria-") ||
              attributeName === "disabled";
            if (interactiveAttribute || hasInteractiveRole(target)) {
              interactiveRoleMutationCount += 1;
            }
          }
        }

        if (isSignificant()) {
          finish();
        }
      });

      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          "role",
          "tabindex",
          "href",
          "disabled",
          "aria-label",
          "aria-labelledby",
          "aria-describedby",
          "aria-hidden",
          "aria-expanded",
          "aria-controls",
          "aria-selected",
          "aria-checked"
        ]
      });

      setTimeout(() => finish(), ${Math.max(1, timeoutMs)});
    }))();`
  );

  return mutationSummary;
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

function resolveRequestInterceptionSettings(
  settings: RequestInterceptionSettings | undefined
): ResolvedRequestInterceptionSettings {
  const enabled = settings?.enabled ?? readBooleanLikeEnv("GHOST_REQUEST_INTERCEPTION_ENABLED", DEFAULT_REQUEST_INTERCEPTION_ENABLED);
  const initialMode =
    settings?.initialMode ??
    readRequestInterceptionModeEnv("GHOST_REQUEST_INTERCEPTION_INITIAL_MODE", "AGENT_FAST");
  const blockStylesheets =
    settings?.blockStylesheets ??
    readBooleanLikeEnv(
      "GHOST_REQUEST_INTERCEPTION_BLOCK_STYLESHEETS",
      DEFAULT_REQUEST_INTERCEPTION_BLOCK_STYLESHEETS
    );
  const visualRenderSettleMs = Math.max(
    0,
    settings?.visualRenderSettleMs ??
      readNonNegativeIntegerEnv(
        "GHOST_REQUEST_INTERCEPTION_VISUAL_SETTLE_MS",
        DEFAULT_VISUAL_RENDER_SETTLE_MS
      )
  );
  const blockedResourceTypes = new Set<string>([...DEFAULT_AGENT_FAST_BLOCKED_RESOURCE_TYPES]);
  if (blockStylesheets) {
    blockedResourceTypes.add("Stylesheet");
  }

  const envBlockList = readBlockedResourceTypeListEnv("GHOST_REQUEST_INTERCEPTION_BLOCKLIST");
  for (const resourceType of envBlockList) {
    blockedResourceTypes.add(resourceType);
  }

  for (const resourceType of settings?.blockedResourceTypes ?? []) {
    if (BLOCKABLE_RESOURCE_TYPES.has(resourceType)) {
      blockedResourceTypes.add(resourceType);
    }
  }

  return {
    enabled,
    initialMode: enabled ? initialMode : "DISABLED",
    blockedResourceTypes,
    visualRenderSettleMs
  };
}

function resolveHttpCachePolicy(policy: HttpCachePolicy | undefined): ResolvedHttpCachePolicy {
  const mode =
    policy?.mode ??
    (policy && policy.ttlMs !== undefined ? "OVERRIDE_TTL" : null) ??
    readHttpCachePolicyModeEnv("GHOST_HTTP_CACHE_MODE", DEFAULT_HTTP_CACHE_POLICY_MODE);

  if (mode !== "OVERRIDE_TTL") {
    return {
      mode,
      ttlMs: null
    };
  }

  const configuredTtlMs =
    policy?.ttlMs ??
    readNonNegativeIntegerEnv("GHOST_HTTP_CACHE_TTL_MS", DEFAULT_HTTP_CACHE_TTL_MS);
  if (!Number.isFinite(configuredTtlMs) || configuredTtlMs <= 0) {
    throw new Error(
      `httpCachePolicy.ttlMs must be > 0 when mode=OVERRIDE_TTL. Received: ${String(policy?.ttlMs)}`
    );
  }

  return {
    mode,
    ttlMs: Math.floor(configuredTtlMs)
  };
}

function createRequestInterceptionMetricsSnapshot(
  requestedUrl: string | null
): RequestInterceptionMetricsSnapshot {
  return {
    requestedUrl,
    startedAt: new Date().toISOString(),
    completedAt: null,
    totalRequests: 0,
    continuedRequests: 0,
    blockedRequests: 0,
    resourceTypeCounts: {},
    blockedResourceTypeCounts: {},
    classificationCounts: createRequestClassificationCountMap()
  };
}

function createRequestClassificationCountMap(): Record<RequestClassification, number> {
  const counts = {} as Record<RequestClassification, number>;
  for (const classification of REQUEST_CLASSIFICATIONS) {
    counts[classification] = 0;
  }

  return counts;
}

function cloneRequestInterceptionMetricsSnapshot(
  snapshot: RequestInterceptionMetricsSnapshot
): RequestInterceptionMetricsSnapshot {
  return {
    requestedUrl: snapshot.requestedUrl,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
    totalRequests: snapshot.totalRequests,
    continuedRequests: snapshot.continuedRequests,
    blockedRequests: snapshot.blockedRequests,
    resourceTypeCounts: { ...snapshot.resourceTypeCounts },
    blockedResourceTypeCounts: { ...snapshot.blockedResourceTypeCounts },
    classificationCounts: { ...snapshot.classificationCounts }
  };
}

function applyRequestInterceptionMetricEvent(
  snapshot: RequestInterceptionMetricsSnapshot,
  event: {
    resourceType: string;
    classification: RequestClassification;
    blocked: boolean;
  }
): void {
  snapshot.totalRequests += 1;
  snapshot.resourceTypeCounts[event.resourceType] =
    (snapshot.resourceTypeCounts[event.resourceType] ?? 0) + 1;
  snapshot.classificationCounts[event.classification] += 1;

  if (event.blocked) {
    snapshot.blockedRequests += 1;
    snapshot.blockedResourceTypeCounts[event.resourceType] =
      (snapshot.blockedResourceTypeCounts[event.resourceType] ?? 0) + 1;
    return;
  }

  snapshot.continuedRequests += 1;
}

function normalizeRequestPausedEvent(event: unknown): NormalizedRequestPausedEvent | null {
  if (typeof event !== "object" || event === null) {
    return null;
  }

  const candidate = event as Record<string, unknown>;
  const requestId = typeof candidate.requestId === "string" ? candidate.requestId : null;
  if (!requestId) {
    return null;
  }

  const request =
    typeof candidate.request === "object" && candidate.request !== null
      ? (candidate.request as Record<string, unknown>)
      : null;
  if (!request) {
    return null;
  }

  const url = typeof request.url === "string" ? request.url : "";
  const method = typeof request.method === "string" ? request.method : "GET";
  const resourceType = typeof candidate.resourceType === "string" ? candidate.resourceType : null;
  const headers =
    typeof request.headers === "object" && request.headers !== null
      ? (request.headers as Record<string, unknown>)
      : {};
  const normalizedHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      normalizedHeaders[name.toLowerCase()] = value;
      continue;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      normalizedHeaders[name.toLowerCase()] = String(value);
    }
  }

  return {
    requestId,
    resourceType,
    url,
    method,
    headers: normalizedHeaders
  };
}

function classifyRequest(
  event: NormalizedRequestPausedEvent,
  resourceType: string
): RequestClassification {
  if (resourceType === "Document") {
    return "DOCUMENT_HTML";
  }

  if (resourceType === "XHR" || resourceType === "Fetch") {
    return "JSON_API";
  }

  if (resourceType === "Other") {
    if (isLikelyJsonApiUrl(event.url, event.headers)) {
      return "JSON_API";
    }
    return "OTHER";
  }

  if (BLOCKABLE_RESOURCE_TYPES.has(resourceType)) {
    return "STATIC_ASSET";
  }

  return "OTHER";
}

function isLikelyJsonApiUrl(url: string, headers: Record<string, string>): boolean {
  const acceptHeader = headers["accept"] ?? "";
  if (acceptHeader.includes("application/json") || acceptHeader.includes("+json")) {
    return true;
  }

  const lowered = url.toLowerCase();
  if (lowered.includes("/api/")) {
    return true;
  }

  return lowered.endsWith(".json") || lowered.includes(".json?");
}

function readBlockedResourceTypeListEnv(name: string): string[] {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    return [];
  }

  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const normalized = new Set<string>();
  for (const part of parts) {
    if (BLOCKABLE_RESOURCE_TYPES.has(part)) {
      normalized.add(part);
    }
  }

  return [...normalized];
}

function readBooleanLikeEnv(name: string, defaultValue: boolean): boolean {
  const rawValue = process.env[name];
  if (!rawValue || !rawValue.trim()) {
    return defaultValue;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function readNonNegativeIntegerEnv(name: string, defaultValue: number): number {
  const rawValue = process.env[name];
  if (!rawValue || !rawValue.trim()) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return defaultValue;
  }

  return parsed;
}

function readRequestInterceptionModeEnv(
  name: string,
  defaultValue: RequestInterceptionMode
): RequestInterceptionMode {
  const rawValue = process.env[name];
  if (!rawValue || !rawValue.trim()) {
    return defaultValue;
  }

  const normalized = rawValue.trim().toUpperCase();
  if (REQUEST_INTERCEPTION_MODES.includes(normalized as RequestInterceptionMode)) {
    return normalized as RequestInterceptionMode;
  }

  return defaultValue;
}

function readHttpCachePolicyModeEnv(
  name: string,
  defaultValue: HttpCachePolicyMode
): HttpCachePolicyMode {
  const rawValue = process.env[name];
  if (!rawValue || !rawValue.trim()) {
    return defaultValue;
  }

  const normalized = rawValue.trim().toUpperCase();
  if (HTTP_CACHE_POLICY_MODES.includes(normalized as HttpCachePolicyMode)) {
    return normalized as HttpCachePolicyMode;
  }

  return defaultValue;
}

export async function connectToGhostTabCdp(
  options: ConnectToGhostTabCdpOptions
): Promise<GhostTabCdpClient> {
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const targetPageIndex = options.targetPageIndex ?? 0;
  const targetUrlIncludes = options.targetUrlIncludes ?? null;
  const requestInterceptionSettings = resolveRequestInterceptionSettings(
    options.requestInterception
  );
  const httpCachePolicy = resolveHttpCachePolicy(options.httpCachePolicy);
  const browser = await chromium.connectOverCDP(options.endpointURL, {
    timeout: connectTimeoutMs
  });

  const page = await waitForTargetPage(browser, connectTimeoutMs, {
    targetPageIndex,
    targetUrlIncludes
  });
  const cdpSession = await page.context().newCDPSession(page);
  await cdpSession.send("Page.enable");
  await cdpSession.send("Network.enable");
  await cdpSession.send("Runtime.enable");
  await cdpSession.send("DOM.enable");
  await cdpSession.send("Accessibility.enable");
  await cdpSession.send("Performance.enable");
  await configureDefaultViewport(cdpSession);

  const client = new PlaywrightGhostTabCdpClient(
    browser,
    cdpSession,
    page,
    requestInterceptionSettings,
    httpCachePolicy
  );

  try {
    await client.initialize();
    return client;
  } catch (error) {
    await browser.close().catch(() => {
      // Best-effort cleanup on initialization failure.
    });
    throw error;
  }
}
