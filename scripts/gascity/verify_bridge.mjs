/**
 * Confirms both org members can list the existing apps and that every app
 * branch is main. Runs inside the Gas City container, which already has
 * CLERK_SECRET_KEY. Does not create an app and does not print tokens.
 */

const users = [
  ["project-manager", "user_3Jo9AXjywP5QJtRbqTWJTn5sdxN"],
  ["developer", "user_3K8MPlxQ4zAaoXEcZzyIkJ8l9Za"],
];

const requiredApps = new Map([
  [3, "sparkling-platypus-soar"],
  [4, "hopping-quokka-buzz"],
]);

function unwrap(result) {
  if (
    !result ||
    result.__dyadIpcEnvelope !== "dyad-ipc-envelope-v1" ||
    typeof result.ok !== "boolean"
  ) {
    return result;
  }
  if (result.ok) return result.value;
  const message = (result.error && result.error.message) || "IPC failed";
  throw new Error(message);
}

async function messageText(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
      "utf8",
    );
  }
  if (data && typeof data.text === "function") return data.text();
  return String(data);
}

let nextId = 0;

function invoke(socket, channel, args) {
  const id = ++nextId;
  const payload = JSON.stringify({ id, type: "invoke", channel, args });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error(`timeout ${channel}`));
    }, 30000);
    async function onMessage(event) {
      let message;
      try {
        message = JSON.parse(await messageText(event.data));
      } catch {
        return;
      }
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      if (message.type === "error") {
        reject(new Error(message.message || "bridge error"));
        return;
      }
      try {
        resolve(unwrap(message.result));
      } catch (error) {
        reject(error);
      }
    }
    socket.addEventListener("message", onMessage);
    socket.send(payload);
  });
}

async function clerk(path, body) {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret)
    throw new Error("CLERK_SECRET_KEY is empty inside the container");
  const response = await fetch(`https://api.clerk.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Clerk ${path} failed: ${response.status}`);
  }
  return response.json();
}

function openSocket() {
  const socket = new WebSocket("ws://127.0.0.1:8373/dyad-browser-ipc");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("websocket timeout")),
      10000,
    );
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("websocket error"));
    });
  });
}

async function verifyUser(label, userId) {
  const session = await clerk("/v1/sessions", { user_id: userId });
  const sessionId = session.id;
  if (!sessionId) throw new Error(`${label}: session response had no id`);
  try {
    const tokenResponse = await clerk(`/v1/sessions/${sessionId}/tokens`, {});
    const jwt = tokenResponse.jwt || tokenResponse.token;
    if (!jwt) throw new Error(`${label}: session token response had no jwt`);
    const socket = await openSocket();
    try {
      await invoke(socket, "clerk:set-session-token", [
        { token: jwt, bridge: true },
      ]);
      const listed = await invoke(socket, "list-apps", []);
      const apps = listed && listed.apps;
      if (!Array.isArray(apps) || apps.length === 0) {
        throw new Error(`${label}: list-apps returned no apps`);
      }
      const byId = new Map(apps.map((app) => [app.id, app.name]));
      for (const [id, name] of requiredApps) {
        if (byId.get(id) !== name) {
          throw new Error(`${label}: missing app ${id}`);
        }
      }
      const described = [];
      for (const app of apps) {
        const branch = await invoke(socket, "get-current-branch", [
          { appId: app.id },
        ]);
        if (!branch || branch.branch !== "main") {
          throw new Error(`${label}: app ${app.id} branch is not main`);
        }
        described.push(`${app.id}:${app.name}:main`);
      }
      console.log(`${label}: ${described.join(" ")}`);
    } finally {
      socket.close();
    }
  } finally {
    await clerk(`/v1/sessions/${sessionId}/revoke`, {});
  }
}

if (!process.env.CLERK_SECRET_KEY) {
  console.error("CLERK_SECRET_KEY is empty inside the container");
  process.exit(1);
}

let failed = false;
for (const [label, userId] of users) {
  try {
    await verifyUser(label, userId);
  } catch (error) {
    console.error(
      `${label}: ${error instanceof Error ? error.message : "verify failed"}`,
    );
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("VERIFY_OK");
