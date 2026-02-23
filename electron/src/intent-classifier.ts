import type {
  CommandClassification,
  CommandExecutionPlan,
  CommandIntent,
  CommandMode
} from "./workspace-types.js";

const TRANSACT_STRONG_KEYWORDS = [
  /\bcheckout\b/i,
  /\bcontact form\b/i,
  /\bfill(?:\s+out)?\b/i,
  /\bsubmit\b/i,
  /\blog[ -]?in\b/i,
  /\bsign[ -]?up\b/i,
  /\bregister\b/i
];

const TRANSACT_WEAK_KEYWORDS = [
  /\bpurchase\b/i,
  /\bbuy\s+(?:this|that|it|the|a|an)\b/i,
  /\bbook\b/i,
  /\breserve\b/i,
  /\bapply\b/i,
  /\bcomplete\b.*\b(form|checkout|order)\b/i
];

const GENERATE_KEYWORDS = [
  /\bcomparison chart\b/i,
  /\bchart\b/i,
  /\bgraph\b/i,
  /\bdashboard\b/i,
  /\bvisuali[sz]e\b/i,
  /\btable\b/i,
  /\bsummar(?:ize|ise)\b.*\b(table|chart|graph)\b/i,
  /\bapplet\b/i
];

const RESEARCH_KEYWORDS = [
  /\bcompare\b/i,
  /\bbest\b/i,
  /\btop\b/i,
  /\brated\b/i,
  /\bresearch\b/i,
  /\bacross\b/i,
  /\bversus\b/i,
  /\bvs\.?\b/i,
  /\bcheapest\b/i,
  /\bprice\b/i,
  /\breviews?\b/i,
  /\bfind me\b/i
];

const MULTI_SITE_HINTS = [
  /\bamazon\b/i,
  /\bbest buy\b/i,
  /\bwalmart\b/i,
  /\btarget\b/i,
  /\bebay\b/i,
  /\bkayak\b/i,
  /\bexpedia\b/i,
  /\bgoogle flights\b/i
];

const MODE_OVERRIDE_TO_INTENT: Record<Exclude<CommandMode, "AUTO">, CommandIntent> = {
  BROWSE: "RESEARCH",
  DO: "TRANSACT",
  MAKE: "GENERATE",
  RESEARCH: "RESEARCH"
};

interface ClassifyCommandIntentInput {
  text: string;
  modeOverride: Exclude<CommandMode, "AUTO"> | null;
}

export interface ClassifyCommandIntentResult {
  classification: CommandClassification;
  normalizedUrl: string | null;
}

export function classifyCommandIntent(input: ClassifyCommandIntentInput): ClassifyCommandIntentResult {
  const normalizedText = input.text.trim();
  const normalizedUrl = resolveNavigableUrl(normalizedText);

  if (input.modeOverride) {
    const intent = MODE_OVERRIDE_TO_INTENT[input.modeOverride];
    return {
      normalizedUrl,
      classification: {
        intent,
        source: "MODE_OVERRIDE",
        confidence: 1,
        reason: `Mode override (${input.modeOverride}) forced ${intent}.`
      }
    };
  }

  if (normalizedUrl) {
    return {
      normalizedUrl,
      classification: {
        intent: "NAVIGATE",
        source: "AUTO_RULES",
        confidence: 0.99,
        reason: "Input matched URL navigation rules."
      }
    };
  }

  if (matchesAny(normalizedText, GENERATE_KEYWORDS)) {
    return {
      normalizedUrl,
      classification: {
        intent: "GENERATE",
        source: "AUTO_RULES",
        confidence: 0.86,
        reason: "Detected visualization/generation language."
      }
    };
  }

  if (matchesAny(normalizedText, TRANSACT_STRONG_KEYWORDS)) {
    return {
      normalizedUrl,
      classification: {
        intent: "TRANSACT",
        source: "AUTO_RULES",
        confidence: 0.84,
        reason: "Detected form/checkout workflow language."
      }
    };
  }

  const mentionsResearchKeywords = matchesAny(normalizedText, RESEARCH_KEYWORDS);
  const mentionsMultiSite = MULTI_SITE_HINTS.filter((pattern) => pattern.test(normalizedText)).length >= 2;
  if (mentionsResearchKeywords || mentionsMultiSite) {
    return {
      normalizedUrl,
      classification: {
        intent: "RESEARCH",
        source: "AUTO_RULES",
        confidence: mentionsMultiSite ? 0.9 : 0.78,
        reason: mentionsMultiSite
          ? "Detected multi-site comparison language."
          : "Detected research/comparison language."
      }
    };
  }

  if (matchesAny(normalizedText, TRANSACT_WEAK_KEYWORDS)) {
    return {
      normalizedUrl,
      classification: {
        intent: "TRANSACT",
        source: "AUTO_RULES",
        confidence: 0.72,
        reason: "Detected transactional workflow language."
      }
    };
  }

  return {
    normalizedUrl,
    classification: {
      intent: "RESEARCH",
      source: "AUTO_RULES",
      confidence: 0.62,
      reason: "Defaulted to RESEARCH for natural-language command."
    }
  };
}

export function buildExecutionPlan(intent: CommandIntent): CommandExecutionPlan {
  switch (intent) {
    case "NAVIGATE":
      return {
        route: "FOREGROUND_NAVIGATION",
        runInTopTab: true,
        spawnGhostTabs: false,
        primaryEngine: "NAVIGATOR"
      };
    case "RESEARCH":
      return {
        route: "GHOST_RESEARCH",
        runInTopTab: false,
        spawnGhostTabs: true,
        primaryEngine: "NAVIGATOR"
      };
    case "TRANSACT":
      return {
        route: "GHOST_TRANSACT",
        runInTopTab: false,
        spawnGhostTabs: true,
        primaryEngine: "NAVIGATOR"
      };
    case "GENERATE":
      return {
        route: "MAKER_GENERATE",
        runInTopTab: false,
        spawnGhostTabs: false,
        primaryEngine: "MAKER"
      };
    default: {
      const unreachableIntent: never = intent;
      throw new Error(`Unhandled command intent: ${String(unreachableIntent)}`);
    }
  }
}

function matchesAny(input: string, patterns: RegExp[]): boolean {
  for (const pattern of patterns) {
    if (pattern.test(input)) {
      return true;
    }
  }
  return false;
}

function resolveNavigableUrl(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }

  if (trimmed.startsWith("about:")) {
    return trimmed;
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    return normalizeHttpUrl(trimmed);
  }

  if (isLocalHostLike(trimmed) || isIpv4Like(trimmed)) {
    return normalizeHttpUrl(`http://${trimmed}`);
  }

  if (isDomainLike(trimmed)) {
    return normalizeHttpUrl(`https://${trimmed}`);
  }

  return null;
}

function normalizeHttpUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function isLocalHostLike(candidate: string): boolean {
  return /^localhost(?::\d{1,5})?(?:\/.*)?$/i.test(candidate);
}

function isIpv4Like(candidate: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:\/.*)?$/.test(candidate);
}

function isDomainLike(candidate: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:\/.*)?$/i.test(
    candidate
  );
}
