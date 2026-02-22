import type { NavigatorActionDecision, NavigatorInferenceTier } from "./engine.js";

const DEFAULT_RECENT_PAIR_LIMIT = 5;
const DEFAULT_SUMMARY_CHAR_BUDGET = 420;
const DEFAULT_PROMPT_TOKEN_ALERT_THRESHOLD = 12_000;
const MAX_RECORDED_TOKEN_ALERTS = 64;

export interface NavigatorContextHistoryPair {
  step: number;
  action: NavigatorActionDecision;
  observation: string;
  url: string;
  resolvedTier: string;
  timestamp: string;
}

export interface NavigatorContextSnapshot {
  previousActions: NavigatorActionDecision[];
  previousObservations: string[];
  historySummary: string | null;
  recentPairCount: number;
  summarizedPairCount: number;
  totalPairCount: number;
  summaryCharCount: number;
}

export interface NavigatorPromptBudgetSample {
  step: number;
  tier: NavigatorInferenceTier;
  promptCharCount: number;
  estimatedPromptTokens: number;
  threshold: number;
}

export interface NavigatorPromptTokenAlert extends NavigatorPromptBudgetSample {
  timestamp: string;
}

export interface NavigatorContextWindowMetrics {
  maxRecentPairCount: number;
  maxSummarizedPairCount: number;
  summaryRefreshCount: number;
  latestSummary: string | null;
  summaryCharCount: number;
  maxPromptCharCount: number;
  maxEstimatedPromptTokens: number;
  promptTokenAlertThreshold: number;
  tokenAlertCount: number;
  tokenAlerts: NavigatorPromptTokenAlert[];
}

export interface NavigatorContextWindowManagerOptions {
  recentPairLimit?: number;
  summaryCharBudget?: number;
  promptTokenAlertThreshold?: number;
}

export interface NavigatorContextWindowManager {
  appendPair(input: Omit<NavigatorContextHistoryPair, "timestamp">): void;
  buildSnapshot(): NavigatorContextSnapshot;
  recordPromptBudget(input: NavigatorPromptBudgetSample): boolean;
  getMetrics(): NavigatorContextWindowMetrics;
}

class DefaultNavigatorContextWindowManager implements NavigatorContextWindowManager {
  private readonly history: NavigatorContextHistoryPair[] = [];
  private readonly recentPairLimit: number;
  private readonly summaryCharBudget: number;
  private readonly promptTokenAlertThreshold: number;
  private summaryRefreshCount = 0;
  private latestSummary: string | null = null;
  private latestSummarySourceCount = 0;
  private maxRecentPairCount = 0;
  private maxSummarizedPairCount = 0;
  private maxPromptCharCount = 0;
  private maxEstimatedPromptTokens = 0;
  private readonly tokenAlerts: NavigatorPromptTokenAlert[] = [];

  constructor(options: NavigatorContextWindowManagerOptions) {
    this.recentPairLimit = Math.max(1, options.recentPairLimit ?? DEFAULT_RECENT_PAIR_LIMIT);
    this.summaryCharBudget = Math.max(180, options.summaryCharBudget ?? DEFAULT_SUMMARY_CHAR_BUDGET);
    this.promptTokenAlertThreshold = Math.max(
      1,
      options.promptTokenAlertThreshold ?? resolvePromptTokenAlertThresholdFromEnv()
    );
  }

  appendPair(input: Omit<NavigatorContextHistoryPair, "timestamp">): void {
    this.history.push({
      ...input,
      observation: normalizeObservation(input.observation),
      timestamp: new Date().toISOString()
    });
  }

  buildSnapshot(): NavigatorContextSnapshot {
    const recentPairs = this.history.slice(-this.recentPairLimit);
    const summarizedPairs = this.history.slice(0, Math.max(0, this.history.length - this.recentPairLimit));
    const summary =
      summarizedPairs.length > 0 ? summarizeArchivedPairs(summarizedPairs, this.summaryCharBudget) : null;

    if (summarizedPairs.length > 0) {
      const summaryChanged =
        summarizedPairs.length !== this.latestSummarySourceCount || this.latestSummary !== summary;
      if (summaryChanged) {
        this.summaryRefreshCount += 1;
        this.latestSummarySourceCount = summarizedPairs.length;
      }
    } else {
      this.latestSummarySourceCount = 0;
    }
    this.latestSummary = summary;

    this.maxRecentPairCount = Math.max(this.maxRecentPairCount, recentPairs.length);
    this.maxSummarizedPairCount = Math.max(this.maxSummarizedPairCount, summarizedPairs.length);

    return {
      previousActions: recentPairs.map((pair) => pair.action),
      previousObservations: recentPairs.map((pair) => pair.observation),
      historySummary: summary,
      recentPairCount: recentPairs.length,
      summarizedPairCount: summarizedPairs.length,
      totalPairCount: this.history.length,
      summaryCharCount: summary?.length ?? 0
    };
  }

  recordPromptBudget(input: NavigatorPromptBudgetSample): boolean {
    this.maxPromptCharCount = Math.max(this.maxPromptCharCount, input.promptCharCount);
    this.maxEstimatedPromptTokens = Math.max(
      this.maxEstimatedPromptTokens,
      input.estimatedPromptTokens
    );

    if (input.estimatedPromptTokens <= input.threshold) {
      return false;
    }

    this.tokenAlerts.push({
      ...input,
      timestamp: new Date().toISOString()
    });
    if (this.tokenAlerts.length > MAX_RECORDED_TOKEN_ALERTS) {
      this.tokenAlerts.shift();
    }
    return true;
  }

  getMetrics(): NavigatorContextWindowMetrics {
    return {
      maxRecentPairCount: this.maxRecentPairCount,
      maxSummarizedPairCount: this.maxSummarizedPairCount,
      summaryRefreshCount: this.summaryRefreshCount,
      latestSummary: this.latestSummary,
      summaryCharCount: this.latestSummary?.length ?? 0,
      maxPromptCharCount: this.maxPromptCharCount,
      maxEstimatedPromptTokens: this.maxEstimatedPromptTokens,
      promptTokenAlertThreshold: this.promptTokenAlertThreshold,
      tokenAlertCount: this.tokenAlerts.length,
      tokenAlerts: [...this.tokenAlerts]
    };
  }
}

export function createNavigatorContextWindowManager(
  options: NavigatorContextWindowManagerOptions = {}
): NavigatorContextWindowManager {
  return new DefaultNavigatorContextWindowManager(options);
}

export function resolvePromptTokenAlertThresholdFromEnv(): number {
  const raw = process.env.NAVIGATOR_CONTEXT_TOKEN_ALERT_THRESHOLD;
  if (!raw || !raw.trim()) {
    return DEFAULT_PROMPT_TOKEN_ALERT_THRESHOLD;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `NAVIGATOR_CONTEXT_TOKEN_ALERT_THRESHOLD must be a positive integer. Received: ${raw}`
    );
  }

  return parsed;
}

function summarizeArchivedPairs(pairs: NavigatorContextHistoryPair[], charBudget: number): string {
  const first = pairs[0];
  const last = pairs[pairs.length - 1];
  const actionCounts = countActions(pairs);
  const actionSummary = formatActionSummary(actionCounts);
  const visitedHosts = summarizeHosts(pairs);
  const lastObservation = shortenText(last.observation, 160);
  const lastActionDetail = `${last.action.action} on ${shortUrl(last.url)} (confidence ${last.action.confidence.toFixed(2)})`;

  const sentences = [
    `Archived steps ${first.step}-${last.step} covered ${visitedHosts}.`,
    `Action mix: ${actionSummary}.`,
    `Latest archived state: ${lastObservation || lastActionDetail}.`
  ];

  const combined = sentences.join(" ");
  return shortenText(combined, charBudget);
}

function countActions(pairs: NavigatorContextHistoryPair[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pair of pairs) {
    counts.set(pair.action.action, (counts.get(pair.action.action) ?? 0) + 1);
  }
  return counts;
}

function formatActionSummary(actionCounts: Map<string, number>): string {
  const sorted = [...actionCounts.entries()].sort((left, right) => right[1] - left[1]);
  if (sorted.length === 0) {
    return "no actions recorded";
  }

  return sorted.map(([action, count]) => `${count} ${action}`).join(", ");
}

function summarizeHosts(pairs: NavigatorContextHistoryPair[]): string {
  const hosts: string[] = [];
  for (const pair of pairs) {
    const host = resolveHost(pair.url);
    if (!hosts.includes(host)) {
      hosts.push(host);
    }
  }

  if (hosts.length === 0) {
    return "an unknown page flow";
  }
  if (hosts.length === 1) {
    return hosts[0];
  }
  if (hosts.length === 2) {
    return `${hosts[0]} and ${hosts[1]}`;
  }
  return `${hosts.slice(0, 2).join(", ")}, and ${hosts.length - 2} more hosts`;
}

function resolveHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return "unknown-host";
  }
}

function shortUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return rawUrl;
  }
}

function normalizeObservation(observation: string): string {
  return observation.replace(/\s+/g, " ").trim();
}

function shortenText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`;
}
