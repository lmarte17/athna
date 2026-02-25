import type {
  AXDeficiencySignals,
  ExtractInteractiveElementIndexResult,
  ScrollPositionSnapshot
} from "../cdp/client.js";
import type { ToonEncodingResult } from "../ax-tree/toon-runtime.js";
import type {
  NavigatorActionDecision,
  NavigatorEscalationReason,
  NavigatorInferenceTier,
  NavigatorScreenshotInput
} from "./engine.js";

export const DEFAULT_NAVIGATOR_OBSERVATION_CACHE_TTL_MS = 60_000;

export interface NavigatorObservationCacheOptions {
  ttlMs?: number;
}

export interface CachedPerceptionData {
  indexResult: ExtractInteractiveElementIndexResult;
  treeEncoding: ToonEncodingResult;
  axDeficiencySignals: AXDeficiencySignals;
  scrollPosition: ScrollPositionSnapshot;
  axTreeHash: string;
}

export interface CachedPerceptionLookupResult extends CachedPerceptionData {
  ageMs: number;
  cachedAtMs: number;
}

export interface CachedDecisionLookupResult {
  decision: NavigatorActionDecision;
  ageMs: number;
  cachedAtMs: number;
}

export interface CachedScreenshotLookupResult {
  screenshot: NavigatorScreenshotInput;
  ageMs: number;
  cachedAtMs: number;
}

export interface NavigatorObservationCacheMetrics {
  ttlMs: number;
  perceptionHits: number;
  perceptionMisses: number;
  decisionHits: number;
  decisionMisses: number;
  screenshotHits: number;
  screenshotMisses: number;
  entriesWritten: number;
  expiredEntries: number;
  invalidations: number;
  finalEntryCount: number;
}

interface ObservationDecisionCacheEntry {
  key: string;
  decision: NavigatorActionDecision;
  cachedAtMs: number;
}

interface ObservationScreenshotCacheEntry {
  screenshot: NavigatorScreenshotInput;
  cachedAtMs: number;
}

interface ObservationCacheEntry {
  url: string;
  cachedAtMs: number;
  expiresAtMs: number;
  perception: CachedPerceptionData;
  decisions: Map<string, ObservationDecisionCacheEntry>;
  tier2Screenshot: ObservationScreenshotCacheEntry | null;
}

export interface NavigatorObservationCacheManager {
  getPerception(url: string, nowMs?: number): CachedPerceptionLookupResult | null;
  setPerception(url: string, data: CachedPerceptionData, nowMs?: number): void;
  getDecision(url: string, key: string, nowMs?: number): CachedDecisionLookupResult | null;
  setDecision(url: string, key: string, decision: NavigatorActionDecision, nowMs?: number): void;
  invalidateDecision(url: string, key: string): void;
  getTier2Screenshot(url: string, nowMs?: number): CachedScreenshotLookupResult | null;
  setTier2Screenshot(url: string, screenshot: NavigatorScreenshotInput, nowMs?: number): void;
  invalidate(url: string): void;
  pruneExpired(nowMs?: number): number;
  getMetrics(): NavigatorObservationCacheMetrics;
}

export function createObservationDecisionCacheKey(input: {
  tier: NavigatorInferenceTier;
  escalationReason: NavigatorEscalationReason | null;
}): string {
  return `${input.tier}|${input.escalationReason ?? "NONE"}`;
}

class InMemoryNavigatorObservationCacheManager implements NavigatorObservationCacheManager {
  private readonly entries = new Map<string, ObservationCacheEntry>();
  private readonly metrics: Omit<NavigatorObservationCacheMetrics, "ttlMs" | "finalEntryCount"> = {
    perceptionHits: 0,
    perceptionMisses: 0,
    decisionHits: 0,
    decisionMisses: 0,
    screenshotHits: 0,
    screenshotMisses: 0,
    entriesWritten: 0,
    expiredEntries: 0,
    invalidations: 0
  };

  constructor(private readonly ttlMs: number) {}

  getPerception(url: string, nowMs = Date.now()): CachedPerceptionLookupResult | null {
    const entry = this.readLiveEntry(url, nowMs);
    if (!entry) {
      this.metrics.perceptionMisses += 1;
      return null;
    }
    this.metrics.perceptionHits += 1;
    return {
      ...entry.perception,
      ageMs: Math.max(0, nowMs - entry.cachedAtMs),
      cachedAtMs: entry.cachedAtMs
    };
  }

  setPerception(url: string, data: CachedPerceptionData, nowMs = Date.now()): void {
    const normalizedUrl = normalizeUrl(url);
    const existing = this.readLiveEntry(normalizedUrl, nowMs);
    const entry: ObservationCacheEntry = {
      url: normalizedUrl,
      cachedAtMs: nowMs,
      expiresAtMs: nowMs + this.ttlMs,
      perception: data,
      decisions: existing?.decisions ?? new Map(),
      tier2Screenshot: existing?.tier2Screenshot ?? null
    };
    this.entries.set(normalizedUrl, entry);
    this.metrics.entriesWritten += 1;
  }

  getDecision(url: string, key: string, nowMs = Date.now()): CachedDecisionLookupResult | null {
    const entry = this.readLiveEntry(url, nowMs);
    if (!entry) {
      this.metrics.decisionMisses += 1;
      return null;
    }
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      this.metrics.decisionMisses += 1;
      return null;
    }
    const decisionEntry = entry.decisions.get(normalizedKey);
    if (!decisionEntry) {
      this.metrics.decisionMisses += 1;
      return null;
    }
    this.metrics.decisionHits += 1;
    return {
      decision: decisionEntry.decision,
      ageMs: Math.max(0, nowMs - decisionEntry.cachedAtMs),
      cachedAtMs: decisionEntry.cachedAtMs
    };
  }

  setDecision(
    url: string,
    key: string,
    decision: NavigatorActionDecision,
    nowMs = Date.now()
  ): void {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return;
    }
    const entry = this.readLiveEntry(url, nowMs);
    if (!entry) {
      return;
    }
    entry.decisions.set(normalizedKey, {
      key: normalizedKey,
      decision,
      cachedAtMs: nowMs
    });
  }

  invalidateDecision(url: string, key: string): void {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return;
    }

    const entry = this.readLiveEntry(url, Date.now());
    if (!entry) {
      return;
    }

    if (entry.decisions.delete(normalizedKey)) {
      this.metrics.invalidations += 1;
    }
  }

  getTier2Screenshot(url: string, nowMs = Date.now()): CachedScreenshotLookupResult | null {
    const entry = this.readLiveEntry(url, nowMs);
    if (!entry) {
      this.metrics.screenshotMisses += 1;
      return null;
    }
    if (!entry.tier2Screenshot) {
      this.metrics.screenshotMisses += 1;
      return null;
    }
    this.metrics.screenshotHits += 1;
    return {
      screenshot: entry.tier2Screenshot.screenshot,
      ageMs: Math.max(0, nowMs - entry.tier2Screenshot.cachedAtMs),
      cachedAtMs: entry.tier2Screenshot.cachedAtMs
    };
  }

  setTier2Screenshot(url: string, screenshot: NavigatorScreenshotInput, nowMs = Date.now()): void {
    const entry = this.readLiveEntry(url, nowMs);
    if (!entry) {
      return;
    }
    entry.tier2Screenshot = {
      screenshot,
      cachedAtMs: nowMs
    };
  }

  invalidate(url: string): void {
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) {
      return;
    }
    if (this.entries.delete(normalizedUrl)) {
      this.metrics.invalidations += 1;
    }
  }

  pruneExpired(nowMs = Date.now()): number {
    let removed = 0;
    for (const [url, entry] of this.entries.entries()) {
      if (entry.expiresAtMs <= nowMs) {
        this.entries.delete(url);
        removed += 1;
      }
    }
    this.metrics.expiredEntries += removed;
    return removed;
  }

  getMetrics(): NavigatorObservationCacheMetrics {
    return {
      ttlMs: this.ttlMs,
      ...this.metrics,
      finalEntryCount: this.entries.size
    };
  }

  private readLiveEntry(url: string, nowMs: number): ObservationCacheEntry | null {
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) {
      return null;
    }
    const entry = this.entries.get(normalizedUrl);
    if (!entry) {
      return null;
    }
    if (entry.expiresAtMs <= nowMs) {
      this.entries.delete(normalizedUrl);
      this.metrics.expiredEntries += 1;
      return null;
    }
    return entry;
  }
}

function normalizeUrl(url: string): string {
  return url.trim();
}

export function createNavigatorObservationCacheManager(
  options: NavigatorObservationCacheOptions = {}
): NavigatorObservationCacheManager {
  const ttlMs = options.ttlMs ?? DEFAULT_NAVIGATOR_OBSERVATION_CACHE_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error(`observationCache.ttlMs must be > 0. Received: ${String(options.ttlMs)}`);
  }

  return new InMemoryNavigatorObservationCacheManager(Math.floor(ttlMs));
}
