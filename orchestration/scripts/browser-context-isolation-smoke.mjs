import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9333;
const DEFAULT_CONTEXT_COUNT = 2;
const POLL_INTERVAL_MS = 100;
const STARTUP_TIMEOUT_MS = 20_000;
const MILESTONE = "3.1";
const STORAGE_VALUE_A = "A";
const STORAGE_VALUE_B = "B";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const artifactDirectory = path.join(repositoryRoot, "docs", "artifacts", "phase3", "phase3-3.1");
const artifactPath = path.join(artifactDirectory, "browsercontext-isolation-result.json");

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseIntegerEnv(name, defaultValue) {
  const rawValue = process.env[name];
  if (!rawValue || !rawValue.trim()) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer. Received: ${rawValue}`);
  }

  return parsed;
}

function parseRemoteDebuggingPort() {
  return parseIntegerEnv("GHOST_REMOTE_DEBUGGING_PORT", DEFAULT_REMOTE_DEBUGGING_PORT);
}

async function waitForWebSocketEndpoint(versionEndpoint, timeoutMs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(versionEndpoint);
      if (response.ok) {
        const payload = await response.json();
        if (typeof payload.webSocketDebuggerUrl === "string") {
          return payload.webSocketDebuggerUrl;
        }
      }
    } catch {}

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for Electron CDP host at ${versionEndpoint}`);
}

function startElectronCdpHost(remoteDebuggingPort, contextCount) {
  const runHeadfulGhostTab = process.env.GHOST_HEADFUL === "true";
  const scriptName = runHeadfulGhostTab ? "cdp:host:headful" : "cdp:host";

  return spawn("npm", ["run", scriptName, "-w", "@ghost-browser/electron"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      GHOST_REMOTE_DEBUGGING_PORT: String(remoteDebuggingPort),
      GHOST_CONTEXT_COUNT: String(contextCount),
      GHOST_CONTEXT_AUTO_REPLENISH: "true"
    },
    stdio: "inherit"
  });
}

function waitForExit(processHandle) {
  return new Promise((resolve, reject) => {
    processHandle.once("exit", (code, signal) => {
      if (code === 0 || signal === "SIGTERM") {
        resolve();
        return;
      }

      reject(new Error(`Process exited unexpectedly with code=${String(code)} signal=${String(signal)}`));
    });
  });
}

async function stopElectronCdpHost(processHandle) {
  if (processHandle.exitCode !== null) {
    return;
  }

  processHandle.kill("SIGTERM");

  try {
    await Promise.race([waitForExit(processHandle), sleep(5_000)]);
  } finally {
    if (processHandle.exitCode === null) {
      processHandle.kill("SIGKILL");
    }
  }
}

async function startHarnessServer() {
  const state = {
    cacheableScriptHits: 0,
    cacheableScriptRequests: []
  };

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname;
    const query = requestUrl.search;

    if (pathname === "/storage-harness") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(
        [
          "<!doctype html>",
          "<html>",
          "<head><title>Phase 3.1 Storage Harness</title></head>",
          "<body>",
          "<h1>Storage Harness</h1>",
          "<p>Used for BrowserContext storage isolation validation.</p>",
          "</body>",
          "</html>"
        ].join("")
      );
      return;
    }

    if (pathname === "/cache-harness") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(
        [
          "<!doctype html>",
          "<html>",
          "<head><title>Phase 3.1 Cache Harness</title></head>",
          "<body>",
          "<h1>Cache Harness</h1>",
          `<script src="/assets/cacheable.js"></script>`,
          "</body>",
          "</html>"
        ].join("")
      );
      return;
    }

    if (pathname === "/assets/cacheable.js") {
      state.cacheableScriptHits += 1;
      state.cacheableScriptRequests.push({
        hit: state.cacheableScriptHits,
        query,
        timestamp: new Date().toISOString()
      });
      response.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=600, immutable"
      });
      response.end(
        `window.__PHASE3_CACHEABLE_HIT__ = ${state.cacheableScriptHits}; console.log("phase3-cacheable-hit", ${state.cacheableScriptHits});`
      );
      return;
    }

    if (pathname === "/favicon.ico") {
      response.writeHead(204);
      response.end();
      return;
    }

    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8"
    });
    response.end("not-found");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve harness server address.");
  }

  const origin = `http://127.0.0.1:${address.port}`;
  return {
    server,
    origin,
    state
  };
}

async function stopHarnessServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function evaluateExpression(cdpClient, expression) {
  const execution = await cdpClient.executeAction({
    action: "EXTRACT",
    target: null,
    text: expression
  });

  if (execution.status !== "acted") {
    throw new Error(`Expected EXTRACT execution status=acted, received ${execution.status}`);
  }

  return execution.extractedData;
}

function buildStorageSeedExpression(value) {
  return `(() => (async () => {
    const storageValue = ${JSON.stringify(value)};
    const cookieKey = "phase3_cookie";
    const localStorageKey = "phase3_local";
    const sessionStorageKey = "phase3_session";
    const indexedDbName = "phase3-context-db";
    const indexedDbStore = "kv";
    const indexedDbRecordKey = "phase3";

    document.cookie = cookieKey + "=" + storageValue + "; path=/; max-age=600";
    localStorage.setItem(localStorageKey, storageValue);
    sessionStorage.setItem(sessionStorageKey, storageValue);

    await new Promise((resolve, reject) => {
      const openRequest = indexedDB.open(indexedDbName, 1);
      openRequest.onerror = () => reject(openRequest.error);
      openRequest.onupgradeneeded = () => {
        const db = openRequest.result;
        if (!db.objectStoreNames.contains(indexedDbStore)) {
          db.createObjectStore(indexedDbStore);
        }
      };
      openRequest.onsuccess = () => {
        const db = openRequest.result;
        const tx = db.transaction(indexedDbStore, "readwrite");
        tx.objectStore(indexedDbStore).put(storageValue, indexedDbRecordKey);
        tx.onerror = () => {
          const error = tx.error;
          db.close();
          reject(error);
        };
        tx.oncomplete = () => {
          db.close();
          resolve(null);
        };
      };
    });

    const readIndexedDbValue = await new Promise((resolve, reject) => {
      const openRequest = indexedDB.open(indexedDbName, 1);
      openRequest.onerror = () => reject(openRequest.error);
      openRequest.onsuccess = () => {
        const db = openRequest.result;
        if (!db.objectStoreNames.contains(indexedDbStore)) {
          db.close();
          resolve(null);
          return;
        }

        const tx = db.transaction(indexedDbStore, "readonly");
        const getRequest = tx.objectStore(indexedDbStore).get(indexedDbRecordKey);
        getRequest.onerror = () => {
          const error = getRequest.error;
          db.close();
          reject(error);
        };
        getRequest.onsuccess = () => {
          const value = getRequest.result ?? null;
          db.close();
          resolve(value);
        };
      };
    });

    const cookieEntries = document.cookie
      .split(";")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => {
        const [rawKey, ...rawValueParts] = entry.split("=");
        return [rawKey, rawValueParts.join("=")];
      });
    const cookieMap = Object.fromEntries(cookieEntries);

    return {
      cookie: cookieMap[cookieKey] ?? null,
      localStorage: localStorage.getItem(localStorageKey),
      sessionStorage: sessionStorage.getItem(sessionStorageKey),
      indexedDb: readIndexedDbValue
    };
  })())();`;
}

function buildStorageReadExpression() {
  return `(() => (async () => {
    const cookieKey = "phase3_cookie";
    const localStorageKey = "phase3_local";
    const sessionStorageKey = "phase3_session";
    const indexedDbName = "phase3-context-db";
    const indexedDbStore = "kv";
    const indexedDbRecordKey = "phase3";

    const cookieEntries = document.cookie
      .split(";")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => {
        const [rawKey, ...rawValueParts] = entry.split("=");
        return [rawKey, rawValueParts.join("=")];
      });
    const cookieMap = Object.fromEntries(cookieEntries);

    let indexedDbValue = null;
    if (typeof indexedDB.databases === "function") {
      const databases = await indexedDB.databases();
      const hasDb = Array.isArray(databases)
        ? databases.some((entry) => entry && entry.name === indexedDbName)
        : false;
      if (hasDb) {
        indexedDbValue = await new Promise((resolve, reject) => {
          const openRequest = indexedDB.open(indexedDbName, 1);
          openRequest.onerror = () => reject(openRequest.error);
          openRequest.onsuccess = () => {
            const db = openRequest.result;
            if (!db.objectStoreNames.contains(indexedDbStore)) {
              db.close();
              resolve(null);
              return;
            }
            const tx = db.transaction(indexedDbStore, "readonly");
            const getRequest = tx.objectStore(indexedDbStore).get(indexedDbRecordKey);
            getRequest.onerror = () => {
              const error = getRequest.error;
              db.close();
              reject(error);
            };
            getRequest.onsuccess = () => {
              const value = getRequest.result ?? null;
              db.close();
              resolve(value);
            };
          };
        });
      }
    }

    return {
      cookie: cookieMap[cookieKey] ?? null,
      localStorage: localStorage.getItem(localStorageKey),
      sessionStorage: sessionStorage.getItem(sessionStorageKey),
      indexedDb: indexedDbValue
    };
  })())();`;
}

function assertStorageSnapshot(snapshot, expectedValue, label) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error(`[${label}] storage snapshot is missing.`);
  }

  if (snapshot.cookie !== expectedValue) {
    throw new Error(`[${label}] cookie mismatch. expected=${expectedValue} actual=${snapshot.cookie}`);
  }

  if (snapshot.localStorage !== expectedValue) {
    throw new Error(
      `[${label}] localStorage mismatch. expected=${expectedValue} actual=${snapshot.localStorage}`
    );
  }

  if (snapshot.sessionStorage !== expectedValue) {
    throw new Error(
      `[${label}] sessionStorage mismatch. expected=${expectedValue} actual=${snapshot.sessionStorage}`
    );
  }

  if (snapshot.indexedDb !== expectedValue) {
    throw new Error(
      `[${label}] indexedDb mismatch. expected=${expectedValue} actual=${snapshot.indexedDb}`
    );
  }
}

function assertStorageCleared(snapshot, label) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error(`[${label}] cleared storage snapshot is missing.`);
  }

  const hasResidualData =
    snapshot.cookie !== null ||
    snapshot.localStorage !== null ||
    snapshot.sessionStorage !== null ||
    snapshot.indexedDb !== null;

  if (hasResidualData) {
    throw new Error(
      `[${label}] expected cleared storage, received cookie=${snapshot.cookie} localStorage=${snapshot.localStorage} sessionStorage=${snapshot.sessionStorage} indexedDb=${snapshot.indexedDb}`
    );
  }
}

async function waitForCacheHitCount(state, expectedHitCount, timeoutMs = 4_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (state.cacheableScriptHits >= expectedHitCount) {
      return;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for cacheable script hit count ${expectedHitCount}. actual=${state.cacheableScriptHits}`
  );
}

async function main() {
  const contextCount = parseIntegerEnv("PHASE3_CONTEXT_COUNT", DEFAULT_CONTEXT_COUNT);
  if (contextCount < 2) {
    throw new Error(`PHASE3_CONTEXT_COUNT must be >= 2 for isolation checks. Received: ${contextCount}`);
  }

  const remoteDebuggingPort = parseRemoteDebuggingPort();
  const versionEndpoint = `http://127.0.0.1:${remoteDebuggingPort}/json/version`;
  const harness = await startHarnessServer();
  const electronHost = startElectronCdpHost(remoteDebuggingPort, contextCount);

  let contextOneClient = null;
  let contextTwoClient = null;
  let recreatedContextOneClient = null;

  try {
    const wsEndpoint = await waitForWebSocketEndpoint(versionEndpoint, STARTUP_TIMEOUT_MS);
    const { connectToGhostTabCdp } = await import("../dist/index.js");

    contextOneClient = await connectToGhostTabCdp({
      endpointURL: wsEndpoint,
      targetUrlIncludes: "#ghost-context=ctx-1",
      connectTimeoutMs: STARTUP_TIMEOUT_MS
    });
    contextTwoClient = await connectToGhostTabCdp({
      endpointURL: wsEndpoint,
      targetUrlIncludes: "#ghost-context=ctx-2",
      connectTimeoutMs: STARTUP_TIMEOUT_MS
    });

    const storageHarnessUrl = `${harness.origin}/storage-harness`;
    await contextOneClient.navigate(storageHarnessUrl);
    await contextTwoClient.navigate(storageHarnessUrl);

    const seededContextOneSnapshot = await evaluateExpression(
      contextOneClient,
      buildStorageSeedExpression(STORAGE_VALUE_A)
    );
    const seededContextTwoSnapshot = await evaluateExpression(
      contextTwoClient,
      buildStorageSeedExpression(STORAGE_VALUE_B)
    );
    assertStorageSnapshot(seededContextOneSnapshot, STORAGE_VALUE_A, "ctx-1 seeded");
    assertStorageSnapshot(seededContextTwoSnapshot, STORAGE_VALUE_B, "ctx-2 seeded");

    const observedContextOneSnapshot = await evaluateExpression(
      contextOneClient,
      buildStorageReadExpression()
    );
    const observedContextTwoSnapshot = await evaluateExpression(
      contextTwoClient,
      buildStorageReadExpression()
    );
    assertStorageSnapshot(observedContextOneSnapshot, STORAGE_VALUE_A, "ctx-1 observed");
    assertStorageSnapshot(observedContextTwoSnapshot, STORAGE_VALUE_B, "ctx-2 observed");

    const cacheHarnessBaseUrl = `${harness.origin}/cache-harness`;
    await contextOneClient.navigate(`${cacheHarnessBaseUrl}?ctx=ctx-1&nav=1`);
    await waitForCacheHitCount(harness.state, 1);

    const hitCountAfterContextOneFirstNav = harness.state.cacheableScriptHits;
    await contextOneClient.navigate(`${cacheHarnessBaseUrl}?ctx=ctx-1&nav=2`);
    await sleep(750);
    const hitCountAfterContextOneSecondNav = harness.state.cacheableScriptHits;
    if (hitCountAfterContextOneSecondNav !== hitCountAfterContextOneFirstNav) {
      throw new Error(
        `Expected ctx-1 to reuse its own HTTP cache. hitsBefore=${hitCountAfterContextOneFirstNav} hitsAfter=${hitCountAfterContextOneSecondNav}`
      );
    }

    await contextTwoClient.navigate(`${cacheHarnessBaseUrl}?ctx=ctx-2&nav=1`);
    await waitForCacheHitCount(harness.state, hitCountAfterContextOneSecondNav + 1);
    const hitCountAfterContextTwoFirstNav = harness.state.cacheableScriptHits;
    if (hitCountAfterContextTwoFirstNav !== hitCountAfterContextOneSecondNav + 1) {
      throw new Error(
        `Expected ctx-2 first navigation to miss ctx-1 cache. ctx-1 hits=${hitCountAfterContextOneSecondNav} ctx-2 hits=${hitCountAfterContextTwoFirstNav}`
      );
    }

    await contextOneClient.closeTarget();

    recreatedContextOneClient = await connectToGhostTabCdp({
      endpointURL: wsEndpoint,
      targetUrlIncludes: "#ghost-context=ctx-1",
      connectTimeoutMs: STARTUP_TIMEOUT_MS
    });
    await recreatedContextOneClient.navigate(storageHarnessUrl);

    const recreatedContextOneSnapshot = await evaluateExpression(
      recreatedContextOneClient,
      buildStorageReadExpression()
    );
    assertStorageCleared(recreatedContextOneSnapshot, "ctx-1 recreated");

    const contextTwoPostDestroySnapshot = await evaluateExpression(
      contextTwoClient,
      buildStorageReadExpression()
    );
    assertStorageSnapshot(
      contextTwoPostDestroySnapshot,
      STORAGE_VALUE_B,
      "ctx-2 after ctx-1 destruction"
    );

    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(
      artifactPath,
      JSON.stringify(
        {
          ok: true,
          phase: MILESTONE,
          runConfig: {
            contextCount
          },
          harness: {
            origin: harness.origin,
            cacheableScriptHits: harness.state.cacheableScriptHits,
            cacheableScriptRequests: harness.state.cacheableScriptRequests
          },
          storageIsolation: {
            seededContextOneSnapshot,
            seededContextTwoSnapshot,
            observedContextOneSnapshot,
            observedContextTwoSnapshot,
            recreatedContextOneSnapshot,
            contextTwoPostDestroySnapshot
          },
          httpCacheIsolation: {
            hitCountAfterContextOneFirstNav,
            hitCountAfterContextOneSecondNav,
            hitCountAfterContextTwoFirstNav
          }
        },
        null,
        2
      )
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          phase: MILESTONE,
          artifact: artifactPath,
          storageIsolationVerified: true,
          cacheIsolationVerified: true
        },
        null,
        2
      )
    );
  } finally {
    const closers = [recreatedContextOneClient, contextTwoClient, contextOneClient]
      .filter(Boolean)
      .map((client) =>
        client
          .close()
          .catch(() => {})
      );
    await Promise.allSettled(closers);
    await stopElectronCdpHost(electronHost);
    await stopHarnessServer(harness.server);
  }
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
