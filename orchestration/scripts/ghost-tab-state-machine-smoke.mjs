import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MILESTONE = "3.3";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase3", "phase3-3.3");
const artifactPath = path.join(artifactDirectory, "ghost-tab-state-machine-result.json");

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createFakeCdpClient(options = {}) {
  let currentUrl = "about:blank";
  const failNavigate = options.failNavigate === true;

  return {
    async navigate(url) {
      if (failNavigate) {
        throw new Error(`CDP Page.navigate failed for ${url}: simulated navigate error`);
      }
      currentUrl = url;
    },
    async extractNormalizedAXTree() {
      return {
        nodes: [
          {
            nodeId: "node-1",
            role: "textbox",
            name: "Search",
            value: null,
            description: null,
            states: [],
            boundingBox: {
              x: 100,
              y: 120,
              width: 180,
              height: 40
            }
          }
        ],
        json: "[]",
        rawNodeCount: 1,
        normalizedNodeCount: 1,
        interactiveNodeCount: 1,
        normalizedCharCount: 2,
        normalizationDurationMs: 1,
        exceededCharBudget: false,
        exceededNormalizationTimeBudget: false,
        truncated: false
      };
    },
    async extractInteractiveElementIndex() {
      const normalizedAXTree = await this.extractNormalizedAXTree();
      return {
        elements: [
          {
            nodeId: "node-1",
            role: "textbox",
            name: "Search",
            value: null,
            boundingBox: {
              x: 100,
              y: 120,
              width: 180,
              height: 40
            }
          }
        ],
        json: "[]",
        elementCount: 1,
        normalizedNodeCount: 1,
        normalizedCharCount: 2,
        indexCharCount: 2,
        sizeRatio: 1,
        normalizedAXTree
      };
    },
    async extractDomInteractiveElements() {
      return {
        elements: [],
        elementCount: 0,
        json: "[]",
        jsonCharCount: 2
      };
    },
    async getAXDeficiencySignals() {
      return {
        readyState: "complete",
        isLoadComplete: true,
        hasSignificantVisualContent: true,
        visibleElementCount: 10,
        textCharCount: 64,
        mediaElementCount: 0,
        domInteractiveCandidateCount: 1
      };
    },
    async getScrollPositionSnapshot() {
      return {
        scrollY: 0,
        viewportHeight: 900,
        documentHeight: 900,
        maxScrollY: 0,
        remainingScrollPx: 0,
        atTop: true,
        atBottom: true
      };
    },
    async executeAction(action) {
      if (action.action === "FAILED") {
        return {
          status: "failed",
          action: action.action,
          currentUrl,
          navigationObserved: false,
          domMutationObserved: false,
          significantDomMutationObserved: false,
          domMutationSummary: null,
          extractedData: null,
          message: "simulated failed action"
        };
      }

      if (action.action === "DONE") {
        return {
          status: "done",
          action: action.action,
          currentUrl,
          navigationObserved: false,
          domMutationObserved: false,
          significantDomMutationObserved: false,
          domMutationSummary: null,
          extractedData: null,
          message: null
        };
      }

      return {
        status: "acted",
        action: action.action,
        currentUrl,
        navigationObserved: false,
        domMutationObserved: false,
        significantDomMutationObserved: false,
        domMutationSummary: null,
        extractedData: null,
        message: null
      };
    },
    async getCurrentUrl() {
      return currentUrl;
    },
    async captureScreenshot() {
      return {
        base64: "",
        mimeType: "image/jpeg",
        width: 1280,
        height: 900,
        mode: "viewport",
        scrollSteps: 0,
        capturedSegments: 1,
        truncated: false,
        documentHeight: 900,
        viewportHeight: 900
      };
    },
    async captureJpegBase64() {
      return "";
    },
    getViewport() {
      return {
        width: 1280,
        height: 900,
        deviceScaleFactor: 1
      };
    },
    async closeTarget() {},
    async close() {}
  };
}

function createDoneNavigator() {
  return {
    async decideNextAction() {
      return {
        action: "DONE",
        target: null,
        text: null,
        confidence: 1,
        reasoning: "Task complete."
      };
    }
  };
}

async function runHappyPath(indexModule) {
  const stateFeedEvents = [];
  const cleanupCalls = [];
  const loop = indexModule.createPerceptionActionLoop({
    cdpClient: createFakeCdpClient(),
    navigatorEngine: createDoneNavigator(),
    taskId: "task-happy-path",
    contextId: "ctx-happy",
    onStateTransition: (event) => stateFeedEvents.push(event),
    onTaskCleanup: async (context) => {
      cleanupCalls.push(context);
    },
    logger: () => {}
  });

  const result = await loop.runTask({
    intent: "complete immediately",
    startUrl: "https://example.com/",
    taskId: "task-happy-path",
    contextId: "ctx-happy",
    maxSteps: 1
  });

  assertCondition(result.status === "DONE", `Expected DONE status. Received: ${result.status}`);
  const transitions = result.stateTransitions.map((event) => `${event.from}->${event.to}`);
  const expectedTransitions = [
    "IDLE->LOADING",
    "LOADING->PERCEIVING",
    "PERCEIVING->INFERRING",
    "INFERRING->ACTING",
    "ACTING->COMPLETE",
    "COMPLETE->IDLE"
  ];
  assertCondition(
    transitions.join("|") === expectedTransitions.join("|"),
    `Unexpected happy-path transitions: ${transitions.join(" | ")}`
  );
  assertCondition(
    cleanupCalls.length === 1,
    `Expected exactly one cleanup callback on happy path. Received: ${cleanupCalls.length}`
  );
  assertCondition(
    stateFeedEvents.length === expectedTransitions.length,
    `Expected ${expectedTransitions.length} state feed events. Received: ${stateFeedEvents.length}`
  );

  return {
    status: result.status,
    stepsTaken: result.stepsTaken,
    transitions,
    cleanupCallCount: cleanupCalls.length
  };
}

async function runFailurePath(indexModule) {
  const stateFeedEvents = [];
  const loop = indexModule.createPerceptionActionLoop({
    cdpClient: createFakeCdpClient({
      failNavigate: true
    }),
    navigatorEngine: createDoneNavigator(),
    taskId: "task-failure-path",
    contextId: "ctx-failure",
    onStateTransition: (event) => stateFeedEvents.push(event),
    logger: () => {}
  });

  const result = await loop.runTask({
    intent: "fail during navigate",
    startUrl: "https://example.com/fail",
    taskId: "task-failure-path",
    contextId: "ctx-failure",
    maxSteps: 1
  });

  assertCondition(result.status === "FAILED", `Expected FAILED status. Received: ${result.status}`);
  assertCondition(result.errorDetail !== null, "FAILED result must include errorDetail.");
  assertCondition(
    typeof result.errorDetail?.message === "string" && result.errorDetail.message.length > 0,
    "FAILED errorDetail.message must be non-empty."
  );
  assertCondition(
    typeof result.errorDetail?.retryable === "boolean",
    "FAILED errorDetail.retryable must be boolean."
  );

  const transitions = result.stateTransitions.map((event) => `${event.from}->${event.to}`);
  assertCondition(
    transitions.includes("LOADING->FAILED"),
    `Expected LOADING->FAILED transition. Received: ${transitions.join(" | ")}`
  );
  assertCondition(
    transitions[transitions.length - 1] === "FAILED->IDLE",
    `Expected final FAILED->IDLE transition. Received: ${transitions[transitions.length - 1]}`
  );
  assertCondition(stateFeedEvents.length >= 3, "Expected state feed to receive failure transitions.");

  return {
    status: result.status,
    errorDetail: result.errorDetail,
    transitions,
    stateFeedEventCount: stateFeedEvents.length
  };
}

function validateInvalidTransition(indexModule) {
  const machine = indexModule.createGhostTabTaskStateMachine({
    taskId: "task-invalid-transition",
    contextId: "ctx-invalid"
  });
  machine.transition("LOADING");
  machine.transition("PERCEIVING");
  machine.transition("INFERRING");
  machine.transition("ACTING");

  let rejected = false;
  let message = null;
  try {
    machine.transition("IDLE");
  } catch (error) {
    rejected = error instanceof indexModule.InvalidGhostTabStateTransitionError;
    message = error instanceof Error ? error.message : String(error);
  }

  assertCondition(rejected, "Expected ACTING->IDLE transition to be rejected.");

  return {
    rejected,
    message
  };
}

async function main() {
  const indexModule = await import("../dist/index.js");

  const happyPath = await runHappyPath(indexModule);
  const failurePath = await runFailurePath(indexModule);
  const invalidTransition = validateInvalidTransition(indexModule);

  const artifactPayload = {
    ok: true,
    phase: MILESTONE,
    happyPath,
    failurePath,
    invalidTransition,
    statusFeed: {
      happyPathEventCount: happyPath.transitions.length,
      failurePathEventCount: failurePath.stateFeedEventCount
    }
  };

  await mkdir(artifactDirectory, {
    recursive: true
  });
  await writeFile(artifactPath, JSON.stringify(artifactPayload, null, 2));

  console.log(
    JSON.stringify(
      {
        ok: true,
        phase: MILESTONE,
        artifact: artifactPath,
        happyPathTransitions: happyPath.transitions.length,
        failurePathStatus: failurePath.status
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        phase: MILESTONE,
        error: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )
  );
  process.exit(1);
});
