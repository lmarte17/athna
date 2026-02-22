import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MILESTONE = "3.4";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase3", "phase3-3.4");
const artifactPath = path.join(artifactDirectory, "ipc-message-schema-result.json");

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createFakeCdpClient(options = {}) {
  const calls = [];
  let currentUrl = "about:blank";

  return {
    calls,
    async navigate(url, timeoutMs) {
      calls.push({
        method: "navigate",
        url,
        timeoutMs: timeoutMs ?? null
      });
      if (options.failNavigate) {
        throw new Error(`simulated navigate failure for ${url}`);
      }
      currentUrl = url;
    },
    async captureScreenshot(screenshotOptions = {}) {
      calls.push({
        method: "captureScreenshot",
        screenshotOptions
      });
      return {
        base64: "",
        mimeType: "image/jpeg",
        mode: screenshotOptions.mode ?? "viewport",
        width: 1280,
        height: 900,
        scrollSteps: 0,
        capturedSegments: 1,
        truncated: false,
        documentHeight: 900,
        viewportHeight: 900
      };
    },
    async extractInteractiveElementIndex(indexOptions = {}) {
      calls.push({
        method: "extractInteractiveElementIndex",
        indexOptions
      });
      return {
        elements: [
          {
            nodeId: "node-1",
            role: "button",
            name: "Submit",
            value: null,
            boundingBox: {
              x: 100,
              y: 200,
              width: 80,
              height: 30
            }
          }
        ],
        json: "[]",
        elementCount: 1,
        normalizedNodeCount: 1,
        normalizedCharCount: 2,
        indexCharCount: 2,
        sizeRatio: 1,
        normalizedAXTree: {
          nodes: [],
          json: "[]",
          rawNodeCount: 1,
          normalizedNodeCount: 1,
          interactiveNodeCount: 1,
          normalizedCharCount: 2,
          normalizationDurationMs: 1,
          exceededCharBudget: false,
          exceededNormalizationTimeBudget: false,
          truncated: false
        }
      };
    },
    async executeAction(action) {
      calls.push({
        method: "executeAction",
        action
      });

      if (options.failInputEvent && action.action !== "EXTRACT") {
        return {
          status: "failed",
          action: action.action,
          currentUrl,
          navigationObserved: false,
          domMutationObserved: false,
          significantDomMutationObserved: false,
          domMutationSummary: null,
          extractedData: null,
          message: "simulated input event failure"
        };
      }

      if (action.action === "EXTRACT") {
        return {
          status: "acted",
          action: action.action,
          currentUrl,
          navigationObserved: false,
          domMutationObserved: false,
          significantDomMutationObserved: false,
          domMutationSummary: null,
          extractedData: {
            expressionEcho: action.text
          },
          message: null
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
        domMutationObserved: true,
        significantDomMutationObserved: false,
        domMutationSummary: {
          addedOrRemovedNodeCount: 1,
          interactiveRoleMutationCount: 0,
          childListMutationCount: 1,
          attributeMutationCount: 0
        },
        extractedData: null,
        message: null
      };
    },
    async getCurrentUrl() {
      calls.push({
        method: "getCurrentUrl"
      });
      return currentUrl;
    },
    async extractNormalizedAXTree() {
      throw new Error("extractNormalizedAXTree should not be called by IPC schema smoke");
    },
    async extractDomInteractiveElements() {
      throw new Error("extractDomInteractiveElements should not be called by IPC schema smoke");
    },
    async getAXDeficiencySignals() {
      throw new Error("getAXDeficiencySignals should not be called by IPC schema smoke");
    },
    async getScrollPositionSnapshot() {
      throw new Error("getScrollPositionSnapshot should not be called by IPC schema smoke");
    },
    async captureJpegBase64() {
      throw new Error("captureJpegBase64 should not be called by IPC schema smoke");
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

function buildRequestFixtures(indexModule) {
  const taskId = "task-ipc-schema";
  const contextId = "ctx-1";
  return [
    indexModule.createGhostTabIpcMessage({
      type: "NAVIGATE",
      taskId,
      contextId,
      payload: {
        url: "https://example.com/",
        timeoutMs: 10_000
      }
    }),
    indexModule.createGhostTabIpcMessage({
      type: "SCREENSHOT",
      taskId,
      contextId,
      payload: {
        mode: "viewport",
        quality: 80,
        fromSurface: true
      }
    }),
    indexModule.createGhostTabIpcMessage({
      type: "AX_TREE",
      taskId,
      contextId,
      payload: {
        includeBoundingBoxes: true,
        charBudget: 8_000
      }
    }),
    indexModule.createGhostTabIpcMessage({
      type: "INJECT_JS",
      taskId,
      contextId,
      payload: {
        expression: "(() => document.title)()",
        awaitPromise: true,
        returnByValue: true
      }
    }),
    indexModule.createGhostTabIpcMessage({
      type: "INPUT_EVENT",
      taskId,
      contextId,
      payload: {
        action: "CLICK",
        target: {
          x: 120,
          y: 210
        },
        text: null,
        confidence: 0.95,
        reasoning: "Click the primary button."
      }
    })
  ];
}

async function main() {
  const indexModule = await import("../dist/index.js");

  const requestFixtures = buildRequestFixtures(indexModule);
  const responseFixtures = [
    indexModule.createGhostTabIpcMessage({
      type: "TASK_RESULT",
      taskId: "task-ipc-schema",
      contextId: "ctx-1",
      payload: {
        operation: "NAVIGATE",
        data: {
          currentUrl: "https://example.com/"
        }
      }
    }),
    indexModule.createGhostTabIpcMessage({
      type: "TASK_ERROR",
      taskId: "task-ipc-schema",
      contextId: "ctx-1",
      payload: {
        operation: "NAVIGATE",
        error: {
          type: "CDP",
          status: null,
          url: "https://example.com/",
          message: "Simulated error",
          retryable: true,
          step: 1
        }
      }
    })
  ];

  const allFixtures = [...requestFixtures, ...responseFixtures];
  const validationResults = allFixtures.map((fixture) => {
    const inbound = indexModule.validateInboundGhostTabIpcMessage(fixture);
    const outbound = indexModule.validateOutboundGhostTabIpcMessage(fixture);
    return {
      type: fixture.type,
      inboundOk: inbound.ok,
      outboundOk: outbound.ok
    };
  });
  assertCondition(
    validationResults.every((entry) => entry.inboundOk && entry.outboundOk),
    "Expected all valid fixtures to pass inbound and outbound validation."
  );

  const malformedNavigate = {
    ...requestFixtures[0],
    payload: {
      timeoutMs: 2500
    }
  };
  const malformedValidation = indexModule.validateInboundGhostTabIpcMessage(malformedNavigate);
  assertCondition(!malformedValidation.ok, "Malformed NAVIGATE message should be rejected.");
  assertCondition(
    malformedValidation.ok === false &&
      malformedValidation.error.details.some((detail) => detail.includes("payload.url")),
    "Malformed NAVIGATE rejection should include payload.url detail."
  );

  const fakeClient = createFakeCdpClient();
  const router = indexModule.createGhostTabIpcRouter({
    cdpClient: fakeClient,
    logger: () => {}
  });

  const routedResponses = [];
  for (const request of requestFixtures) {
    const response = await router.handleMessage(request);
    routedResponses.push(response);
    assertCondition(
      response.type === "TASK_RESULT",
      `Expected TASK_RESULT for ${request.type}. Received: ${response.type}`
    );
    assertCondition(
      response.payload.operation === request.type,
      `Expected operation=${request.type}. Received: ${response.payload.operation}`
    );
  }

  const failNavigateClient = createFakeCdpClient({
    failNavigate: true
  });
  const failingRouter = indexModule.createGhostTabIpcRouter({
    cdpClient: failNavigateClient,
    logger: () => {}
  });
  const navigateFailureResponse = await failingRouter.handleMessage(requestFixtures[0]);
  assertCondition(
    navigateFailureResponse.type === "TASK_ERROR",
    `Expected TASK_ERROR for failed NAVIGATE. Received: ${navigateFailureResponse.type}`
  );

  const malformedRawResponse = await router.handleRawMessage({
    schemaVersion: 999,
    type: "NAVIGATE"
  });
  assertCondition(
    malformedRawResponse.type === "TASK_ERROR",
    `Expected TASK_ERROR for malformed raw message. Received: ${malformedRawResponse.type}`
  );
  assertCondition(
    malformedRawResponse.payload.operation === "UNKNOWN",
    `Expected TASK_ERROR operation=UNKNOWN for malformed raw message. Received: ${malformedRawResponse.payload.operation}`
  );

  const artifactPayload = {
    ok: true,
    phase: MILESTONE,
    schemaValidation: {
      requiredTypes: [
        ...indexModule.GHOST_TAB_IPC_REQUEST_TYPES,
        ...indexModule.GHOST_TAB_IPC_RESPONSE_TYPES
      ],
      validatedFixtureCount: validationResults.length,
      results: validationResults
    },
    malformedRejection: {
      rejected: true,
      details: malformedValidation.ok ? [] : malformedValidation.error.details
    },
    routing: {
      routingMode: "typed-switch-by-message-type",
      requestCount: requestFixtures.length,
      taskResultCount: routedResponses.length,
      operations: routedResponses.map((response) => response.payload.operation),
      fakeCdpCalls: fakeClient.calls
    },
    errorHandling: {
      failedNavigateMappedToTaskError: navigateFailureResponse.type === "TASK_ERROR",
      malformedRawMappedToTaskError: malformedRawResponse.type === "TASK_ERROR",
      malformedRawOperation: malformedRawResponse.payload.operation
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
        validatedFixtureCount: validationResults.length,
        routedRequestCount: requestFixtures.length
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
