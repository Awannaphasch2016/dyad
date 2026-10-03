import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  dnsRecord,
  ensurePreviewTunnel,
  ingressConfig,
  previewHostname,
  tunnelName,
} from "./preview-tunnel.mjs";

const digest =
  "ghcr.io/awannaphasch2016/dyad@sha256:8e5be8469cd4a7caaa1611e41e9906b4f5a8ddb7b87bf6a9b0dcad101296789a";

test("preview hostname and tunnel name come from the PR number", () => {
  assert.equal(previewHostname(20), "pr-20.anakwannaphaschaiyong.com");
  assert.equal(tunnelName("20"), "preview-pr-20");
  assert.throws(() => previewHostname("20;rm"), /digits/);
});

test("ingress stays on the Dyad network namespace and DNS points at the tunnel", () => {
  assert.deepEqual(ingressConfig("pr-20.anakwannaphaschaiyong.com"), {
    config: {
      ingress: [
        {
          hostname: "pr-20.anakwannaphaschaiyong.com",
          service: "http://127.0.0.1:8373",
        },
        { service: "http_status:404" },
      ],
    },
  });
  assert.equal(
    dnsRecord("pr-20.anakwannaphaschaiyong.com", "tunnel-id").content,
    "tunnel-id.cfargotunnel.com",
  );
});

test("tunnel setup writes the token to a file and does not return it", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body });
    const path = new URL(url).pathname;
    let result = [];
    if (path.endsWith("/cfd_tunnel") && (init.method ?? "GET") === "GET") {
      result = [];
    } else if (path.endsWith("/cfd_tunnel") && init.method === "POST") {
      result = { id: "tunnel-id", name: "preview-pr-20" };
    } else if (path.endsWith("/configurations")) {
      result = {};
    } else if (path.endsWith("/token")) {
      result = "secret-tunnel-token";
    } else if (
      path.endsWith("/dns_records") &&
      (init.method ?? "GET") === "GET"
    ) {
      result = [];
    } else if (path.endsWith("/dns_records") && init.method === "POST") {
      result = { id: "dns-id" };
    }
    return {
      ok: true,
      statusText: "OK",
      json: async () => ({ success: true, result }),
    };
  };
  let written = "";
  const result = await ensurePreviewTunnel({
    fetch: fetchImpl,
    accountId: "account",
    zoneId: "zone",
    apiToken: "api-token",
    pr: 20,
    writeToken: async (token) => {
      written = token;
    },
  });
  assert.equal(written, "secret-tunnel-token");
  assert.equal(result.hostname, "pr-20.anakwannaphaschaiyong.com");
  assert.equal(Object.hasOwn(result, "token"), false);
  assert.equal(JSON.stringify(result).includes("secret-tunnel-token"), false);
  assert.equal(
    calls.some(
      (call) => call.method === "POST" && call.url.includes("/cfd_tunnel"),
    ),
    true,
  );
  const dns = calls.find(
    (call) => call.method === "POST" && call.url.includes("/dns_records"),
  );
  assert.equal(JSON.parse(dns.body).proxied, true);
  assert.equal(
    calls.some((call) =>
      String(call.body ?? "").includes("http://127.0.0.1:8373"),
    ),
    true,
  );
});

test("an existing tunnel is reused", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(init.method ?? "GET");
    const path = new URL(url).pathname;
    let result = [];
    if (path.endsWith("/cfd_tunnel")) {
      result = [{ id: "existing", name: "preview-pr-20" }];
    } else if (path.endsWith("/token")) {
      result = { token: "again" };
    } else if (
      path.endsWith("/dns_records") &&
      (init.method ?? "GET") === "GET"
    ) {
      result = [
        {
          id: "dns-id",
          content: "existing.cfargotunnel.com",
          proxied: true,
        },
      ];
    } else {
      result = {};
    }
    return {
      ok: true,
      statusText: "OK",
      json: async () => ({ success: true, result }),
    };
  };
  await ensurePreviewTunnel({
    fetch: fetchImpl,
    accountId: "account",
    zoneId: "zone",
    apiToken: "api-token",
    pr: "20",
    writeToken: async () => {},
  });
  assert.equal(calls.includes("POST"), false);
  assert.equal(calls.includes("PATCH"), false);
});

test("preview-up refuses bad arguments and the production checkout", () => {
  const script = new URL("./preview-up.sh", import.meta.url);
  const run = (args, env = {}) =>
    spawnSync("bash", [script.pathname, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });

  const usage = run([]);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /Usage/);

  const image = run(["20", "weaver-plus:gascity"]);
  assert.equal(image.status, 2);
  assert.match(image.stderr, /ghcr.io digest/);

  const dir = mkdtempSync(join(tmpdir(), "preview-prod-"));
  try {
    const production = run(["20", digest], {
      PREVIEW_PRODUCTION_MARKER: dir,
    });
    assert.equal(production.status, 2);
    assert.match(production.stderr, /Refusing/);
    assert.equal(production.stdout.includes(digest), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("preview image workflow updates the shared Devbox after publish", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/preview-image.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /needs:\s*publish/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /namespacelabs\/nscloud-setup@v0/);
  assert.match(workflow, /devbox exec Wewebplus-ci/);
  assert.match(workflow, /PREVIEW_SKIP_TUNNEL=1 bash scripts\/gascity\/preview-up\.sh/);
  assert.match(workflow, /https:\/\/pr-\$\{PR\}\.anakwannaphaschaiyong\.com/);
  assert.equal(workflow.includes("13.251.216.187"), false);
});

test("preview exec workflow uses GitHub federation and does not touch production", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/preview-exec.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /namespacelabs\/nscloud-setup@v0/);
  assert.match(workflow, /devbox exec Wewebplus-ci -- echo federated-ok/);
  assert.match(workflow, /PREVIEW_SKIP_TUNNEL=1/);
  assert.equal(workflow.includes("EC2_SSH_KEY"), false);
  assert.equal(workflow.includes("13.251.216.187"), false);
  assert.equal(workflow.includes("gascity-rollout"), false);
});

test("compose preview file does not publish the factory port or mount the production city", () => {
  const compose = readFileSync(
    new URL("../../compose.preview.yml", import.meta.url),
    "utf8",
  );
  assert.equal(/^\s*ports:/m.test(compose), false);
  assert.equal(compose.includes("network_mode: host"), false);
  assert.equal(/^\s*- \/?opt\/gascity/m.test(compose), false);
  assert.equal(/^\s*build:/m.test(compose), false);
  assert.match(compose, /GAS_CITY_HOST_BRIDGE_HOST: "0.0.0.0"/);
  assert.match(compose, /WEAVER_BASE_URL: http:\/\/dyad:32100/);
  assert.match(compose, /network_mode: service:dyad/);
  assert.match(compose, /pr-\$\{PREVIEW_PR:\?Set PREVIEW_PR\}-city/);
  assert.match(compose, /name: preview-\$\{PREVIEW_PR:\?Set PREVIEW_PR\}/);
});
