const MAX_INFERRED_STEPS = 8;
const MIN_COMPLEX_STEP_THRESHOLD = 3;

const STEP_VERB_PATTERNS = [
  /\bopen\b/g,
  /\bnavigate\b/g,
  /\bgo\b/g,
  /\bvisit\b/g,
  /\bsearch\b/g,
  /\bfind\b/g,
  /\bfilter\b/g,
  /\bsort\b/g,
  /\bselect\b/g,
  /\bchoose\b/g,
  /\bfill\b/g,
  /\benter\b/g,
  /\btype\b/g,
  /\bsubmit\b/g,
  /\bextract\b/g,
  /\bcompare\b/g,
  /\badd\b/g,
  /\bbook\b/g,
  /\bcheckout\b/g
];

const CONNECTOR_PATTERNS = [/\bthen\b/g, /\bafter that\b/g, /\bnext\b/g, /\bfinally\b/g];

export type TaskSubtaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETE" | "FAILED";

export type TaskSubtaskVerificationType =
  | "element_present"
  | "url_matches"
  | "data_extracted"
  | "action_confirmed"
  | "human_review";

export interface TaskSubtaskVerification {
  type: TaskSubtaskVerificationType;
  condition: string;
}

export interface TaskDecompositionSubtask {
  id: string;
  intent: string;
  startUrl: string | null;
  verification: TaskSubtaskVerification;
  status: TaskSubtaskStatus;
}

export interface TaskDecompositionPlan {
  intent: string;
  startUrl: string | null;
  isDecomposed: boolean;
  impliedStepCount: number;
  generatedBy: "HEURISTIC_V1";
  generatedAt: string;
  subtasks: TaskDecompositionSubtask[];
}

export interface DecomposeTaskIntentInput {
  intent: string;
  startUrl?: string | null;
}

export function decomposeTaskIntent(input: DecomposeTaskIntentInput): TaskDecompositionPlan {
  const intent = input.intent.trim();
  const startUrl = normalizeOptionalString(input.startUrl);
  const impliedStepCount = estimateImpliedStepCount(intent);
  const isDecomposed = impliedStepCount >= MIN_COMPLEX_STEP_THRESHOLD;
  const subtasks = buildSubtasks({
    intent,
    startUrl,
    impliedStepCount,
    isDecomposed
  });

  if (subtasks.length === 0) {
    throw new Error("Decomposition produced no subtasks.");
  }

  const initialized: TaskDecompositionSubtask[] = subtasks.map((subtask, index) => ({
    ...subtask,
    status: (index === 0 ? "IN_PROGRESS" : "PENDING") as TaskSubtaskStatus
  }));

  return {
    intent,
    startUrl,
    isDecomposed,
    impliedStepCount,
    generatedBy: "HEURISTIC_V1",
    generatedAt: new Date().toISOString(),
    subtasks: initialized
  };
}

function buildSubtasks(input: {
  intent: string;
  startUrl: string | null;
  impliedStepCount: number;
  isDecomposed: boolean;
}): Omit<TaskDecompositionSubtask, "status">[] {
  if (isFlightIntent(input.intent)) {
    return buildFlightSubtasks(input.startUrl);
  }

  const clauses = splitIntentIntoClauses(input.intent);
  if (input.isDecomposed && clauses.length >= 3) {
    return clauses.slice(0, MAX_INFERRED_STEPS).map((clause, index) =>
      createSubtaskFromClause({
        id: index + 1,
        clause,
        startUrl: index === 0 ? input.startUrl : null
      })
    );
  }

  if (!input.isDecomposed) {
    return [
      {
        id: "subtask-1",
        intent: input.intent,
        startUrl: input.startUrl,
        verification: {
          type: "action_confirmed",
          condition: "At least one meaningful action completed for the intent."
        }
      }
    ];
  }

  const templateCount = Math.max(3, Math.min(5, input.impliedStepCount));
  const templates: Array<{
    intent: string;
    verification: TaskSubtaskVerification;
  }> = [
    {
      intent: "Reach the target page for this task.",
      verification: {
        type: "url_matches",
        condition: "Browser URL indicates the target workflow page is loaded."
      }
    },
    {
      intent: "Locate and interact with the primary controls needed for the task.",
      verification: {
        type: "action_confirmed",
        condition: "A meaningful page interaction was executed."
      }
    },
    {
      intent: "Apply any requested constraints, filters, or date/option selections.",
      verification: {
        type: "action_confirmed",
        condition: "Constraint or filter interaction has been executed."
      }
    },
    {
      intent: "Collect the result required by the user.",
      verification: {
        type: "data_extracted",
        condition: "Requested data is present in extracted output."
      }
    },
    {
      intent: "Finalize the workflow and confirm completion.",
      verification: {
        type: "action_confirmed",
        condition: "Final confirmation action has executed successfully."
      }
    }
  ];

  return templates.slice(0, templateCount).map((template, index) => ({
    id: `subtask-${index + 1}`,
    intent: template.intent,
    startUrl: index === 0 ? input.startUrl : null,
    verification: template.verification
  }));
}

function createSubtaskFromClause(input: {
  id: number;
  clause: string;
  startUrl: string | null;
}): Omit<TaskDecompositionSubtask, "status"> {
  const clause = input.clause.trim().replace(/\.$/, "");
  const lowerClause = clause.toLowerCase();

  let type: TaskSubtaskVerificationType = "action_confirmed";
  let condition = "Meaningful interaction for the clause has executed.";

  if (/\bextract|collect|capture|return|summarize\b/.test(lowerClause)) {
    type = "data_extracted";
    condition = "Requested data for this clause has been extracted.";
  } else if (/\bopen|navigate|visit|go to\b/.test(lowerClause)) {
    type = "url_matches";
    condition = "URL changed to the destination implied by this clause.";
  } else if (/\bclick|select|choose\b/.test(lowerClause)) {
    type = "element_present";
    condition = clause;
  }

  return {
    id: `subtask-${input.id}`,
    intent: clause,
    startUrl: input.startUrl,
    verification: {
      type,
      condition
    }
  };
}

function buildFlightSubtasks(
  startUrl: string | null
): Omit<TaskDecompositionSubtask, "status">[] {
  return [
    {
      id: "subtask-1",
      intent: "Open the flight-search experience.",
      startUrl,
      verification: {
        type: "url_matches",
        condition: "Flight-search page is loaded."
      }
    },
    {
      id: "subtask-2",
      intent: "Populate departure and destination locations.",
      startUrl: null,
      verification: {
        type: "action_confirmed",
        condition: "Origin and destination fields have been interacted with."
      }
    },
    {
      id: "subtask-3",
      intent: "Set the requested travel dates and options.",
      startUrl: null,
      verification: {
        type: "action_confirmed",
        condition: "Date selection controls have been updated."
      }
    },
    {
      id: "subtask-4",
      intent: "Run search and refine toward lowest fare options.",
      startUrl: null,
      verification: {
        type: "action_confirmed",
        condition: "Search or filtering action has executed."
      }
    },
    {
      id: "subtask-5",
      intent: "Extract the cheapest itinerary details.",
      startUrl: null,
      verification: {
        type: "data_extracted",
        condition: "Cheapest itinerary data has been extracted."
      }
    }
  ];
}

function estimateImpliedStepCount(intent: string): number {
  const normalized = intent.toLowerCase();

  let score = 0;
  for (const pattern of STEP_VERB_PATTERNS) {
    score += countMatches(normalized, pattern);
  }
  for (const pattern of CONNECTOR_PATTERNS) {
    score += countMatches(normalized, pattern);
  }

  if (/\bcompare\b/.test(normalized)) {
    score += 2;
  }
  if (/\bcheapest|lowest|best|top\b/.test(normalized)) {
    score += 1;
  }
  if (isFlightIntent(intent)) {
    score += 4;
  }
  if (/\bfrom\b.+\bto\b/.test(normalized)) {
    score += 1;
  }
  if (/\b(today|tomorrow|next|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4})\b/.test(normalized)) {
    score += 1;
  }

  const clauses = splitIntentIntoClauses(intent).length;
  const inferred = Math.max(1, score, clauses);
  return Math.min(MAX_INFERRED_STEPS, inferred);
}

function splitIntentIntoClauses(intent: string): string[] {
  const normalized = intent
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\band then\b/gi, " then ")
    .replace(/\bafter that\b/gi, " then ")
    .replace(/\bnext\b/gi, " then ")
    .replace(/\bfinally\b/gi, " then ");

  const clauses = normalized
    .split(/\bthen\b|;/gi)
    .flatMap((segment) => segment.split(/\s+and\s+/gi))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (clauses.length > 0) {
    return clauses;
  }

  return [normalized];
}

function isFlightIntent(intent: string): boolean {
  return /\bflight|flights|airfare|itinerary|google flights|departure|arrival\b/i.test(intent);
}

function countMatches(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
