import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  patchBrowserPolyfills,
  patchChatReady,
  patchImplementationPreview,
  patchModelSelector,
  patchStreamModel,
  patchWalkthroughModel,
} from "./patch-bolt-polyfills.mjs";
import {
  WEBCONTAINER_COEP,
  coepTypeScriptSource,
  patchActionFailure,
  patchEmbedderPolicy,
  patchFileActionError,
  patchPreviewBootError,
  patchWebContainerBoot,
  webContainerBootFailureMessage,
  withWebContainerBootTimeout,
} from "./bolt-webcontainer-coep.mjs";
import {
  chooseOpenRouterSource,
  cloudflareReferencePlan,
  configReport,
  githubEnvAssignment,
  isProductionConfig,
  openRouterReferencePlan,
  previewEnvironmentBody,
  previewInheritsBody,
  prdInheritsBody,
  takeSecretNames,
} from "./bolt-project.mjs";

const workflow = readFileSync(
  new URL("../../.github/workflows/bolt-doppler-setup.yml", import.meta.url),
  "utf8",
);

test("cloudflare references point at vibesdk dev", () => {
  const plan = cloudflareReferencePlan([
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "ANTHROPIC_API_KEY",
  ]);
  assert.deepEqual(plan.missing, []);
  assert.equal(
    plan.secrets.CLOUDFLARE_API_TOKEN,
    "${vibesdk.dev.CLOUDFLARE_API_TOKEN}",
  );
  assert.equal(
    plan.secrets.CLOUDFLARE_ACCOUNT_ID,
    "${vibesdk.dev.CLOUDFLARE_ACCOUNT_ID}",
  );
  assert.equal(plan.secrets.ANTHROPIC_API_KEY, undefined);
});

test("cloudflare references fall back to the suffixed dyad names", () => {
  const plan = cloudflareReferencePlan([
    "CLOUDFLARE_API_TOKEN_",
    "CLOUDFLARE_ACCOUNT_ID_",
  ]);
  assert.equal(
    plan.secrets.CLOUDFLARE_API_TOKEN,
    "${vibesdk.dev.CLOUDFLARE_API_TOKEN_}",
  );
  assert.equal(
    plan.secrets.CLOUDFLARE_ACCOUNT_ID,
    "${vibesdk.dev.CLOUDFLARE_ACCOUNT_ID_}",
  );
});

test("an upstream root replaces a chained vibesdk reference", () => {
  const plan = cloudflareReferencePlan(
    ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
    {
      CLOUDFLARE_ACCOUNT_ID: "${forma.dev.CLOUDFLARE_ACCOUNT_ID}",
    },
  );
  assert.equal(
    plan.secrets.CLOUDFLARE_ACCOUNT_ID,
    "${forma.dev.CLOUDFLARE_ACCOUNT_ID}",
  );
  assert.equal(
    plan.secrets.CLOUDFLARE_API_TOKEN,
    "${vibesdk.dev.CLOUDFLARE_API_TOKEN}",
  );
});

test("a missing cloudflare name is reported and not invented", () => {
  const plan = cloudflareReferencePlan(["CLOUDFLARE_API_TOKEN"]);
  assert.deepEqual(plan.missing, ["CLOUDFLARE_ACCOUNT_ID"]);
  assert.equal(plan.secrets.CLOUDFLARE_ACCOUNT_ID, undefined);
});

test("preview is its own environment so the config name is preview", () => {
  assert.equal(previewEnvironmentBody().slug, "preview");
});

test("preview inherits bolt dev and prd inherits nothing", () => {
  assert.deepEqual(previewInheritsBody().inherits, [
    { project: "bolt", config: "dev" },
  ]);
  assert.deepEqual(prdInheritsBody().inherits, []);
});

test("secret name listing drops raw values", () => {
  const payload = {
    secrets: {
      CLOUDFLARE_API_TOKEN: { raw: "secret-value", computed: "secret-value" },
    },
  };
  assert.deepEqual(takeSecretNames(payload), ["CLOUDFLARE_API_TOKEN"]);
  assert.equal(payload.secrets.CLOUDFLARE_API_TOKEN.raw, undefined);
  assert.equal(payload.secrets.CLOUDFLARE_API_TOKEN.computed, undefined);
});

test("config report prints inheritance labels", () => {
  assert.deepEqual(
    configReport([
      { name: "preview", inherits: [{ project: "bolt", config: "dev" }] },
      { name: "prd", inherits: [] },
    ]),
    ["config=preview inherits=bolt.dev", "config=prd inherits=none"],
  );
});

test("the setup workflow uses the Doppler admin token and stays off main", () => {
  assert.match(workflow, /secrets\.DOPPLER_ADMIN_TOKEN/);
  assert.match(workflow, /cursor\/bolt-doppler-55d6/);
  assert.equal(workflow.includes("doppler-project: dyad"), false);
  assert.equal(workflow.includes("config: prd"), false);
});

test("the preview job reads Doppler and does not store Cloudflare secrets on bolt", () => {
  const deploy = readFileSync(
    new URL(
      "../../.github/workflows/bolt-preview-from-doppler.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(deploy, /secrets\.DOPPLER_ADMIN_TOKEN/);
  assert.match(deploy, /ensure-bolt-project\.mjs/);
  assert.match(deploy, /export-bolt-preview-env\.mjs/);
  assert.match(
    deploy,
    /wrangler secret put OPEN_ROUTER_API_KEY --name bolt-walkthrough-55d6/,
  );
  assert.match(deploy, /ModelSelector\.tsx/);
  assert.match(deploy, /stream-text\.ts bolt/);
  assert.match(deploy, /bolt-webcontainer-coep\.mjs/);
  assert.equal(deploy.includes("secrets.CLOUDFLARE_API_TOKEN"), false);
  assert.equal(deploy.includes("secrets.CLOUDFLARE_ACCOUNT_ID"), false);
  assert.equal(deploy.includes('echo "$OPEN_ROUTER_API_KEY"'), false);
});

test("the chat restore effect no longer reads an unbound ready", () => {
  const source = [
    "factoryRunToRestore(ready, chatId.get(), restoredChatId.current, chatMetadata.get());",
    "}, [ready, initialMessages]);",
  ].join("\n");
  const patched = patchChatReady(source);
  assert.match(patched, /factoryRunToRestore\(true,/);
  assert.match(patched, /\}, \[initialMessages\]\);/);
  assert.equal(patched.includes("[ready, initialMessages]"), false);
  assert.equal(patchChatReady(patched), patched);
});

test("implementation opens the preview and discovery closes it", () => {
  const source = [
    "  walkthroughPreviewVisible,",
    "} from '~/lib/factoryPhase';",
    "      if (!walkthroughPreviewVisible(factoryRun.phase)) {",
    "        workbenchStore.showWorkbench.set(false);",
    "      }",
  ].join("\n");
  const patched = patchImplementationPreview(source);
  assert.match(patched, /previewOpenForPhase/);
  assert.match(patched, /showWorkbench\.set\(true\)/);
  assert.match(patched, /currentView\.set\('preview'\)/);
  assert.match(patched, /showWorkbench\.set\(false\)/);
  assert.equal(patched.includes("if (!walkthroughPreviewVisible"), false);
  assert.equal(patchImplementationPreview(patched), patched);
});

test("a boot that never starts rejects with the expected header", async () => {
  const pending = new Promise(() => {});
  await assert.rejects(withWebContainerBootTimeout(pending, 20), (error) => {
    assert.match(error.message, /Cross-Origin-Embedder-Policy: credentialless/);
    assert.equal(error.message, webContainerBootFailureMessage());
    return true;
  });
});

test("a boot rejection keeps the runtime message and the expected header", async () => {
  const rejected = Promise.reject(new Error("SharedArrayBuffer is missing"));
  await assert.rejects(withWebContainerBootTimeout(rejected, 1000), (error) => {
    assert.match(error.message, /credentialless/);
    assert.match(error.message, /SharedArrayBuffer is missing/);
    return true;
  });
});

test("the page header and the boot call share credentialless", () => {
  const header = patchEmbedderPolicy(
    [
      "import { ServerRouter, type EntryContext, type RouterContextProvider } from 'react-router';",
      "  responseHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');",
    ].join("\n"),
  );
  const boot = patchWebContainerBoot(
    [
      "import { cleanStackTrace } from '~/utils/stacktrace';",
      "        return WebContainer.boot({",
      "          coep: 'credentialless',",
      "          workdirName: WORK_DIR_NAME,",
      "          forwardPreviewErrors: true, // Enable error forwarding from iframes",
      "        });",
    ].join("\n"),
  );
  assert.equal(WEBCONTAINER_COEP, "credentialless");
  assert.match(header, /WEBCONTAINER_COEP/);
  assert.equal(header.includes("'require-corp'"), false);
  assert.match(boot, /coep: WEBCONTAINER_COEP/);
  assert.match(boot, /withWebContainerBootTimeout/);
  assert.match(coepTypeScriptSource(), /WEBCONTAINER_COEP = 'credentialless'/);
  assert.equal(patchEmbedderPolicy(header), header);
  assert.equal(patchWebContainerBoot(boot), boot);
});

test("a failed file write shows the boot message", () => {
  const source = [
    "      this.#updateAction(actionId, { status: 'failed', error: 'Action failed' });",
    "      logger.error(`[${action.type}]:Action failed\\n\\n`, error);",
    "                    >",
    "                      {action.filePath}",
    "                    </code>",
    "                  </div>",
  ].join("\n");
  const patched = patchFileActionError(patchActionFailure(source));
  assert.match(patched, /error instanceof Error \? error.message/);
  assert.match(patched, /status === 'failed' && action.error/);
  assert.equal(patched.includes("error: 'Action failed'"), false);
});

test("the empty preview shows the boot message after rejection", () => {
  const source = [
    "import { workbenchStore } from '~/lib/stores/workbench';",
    "  const [activePreviewIndex, setActivePreviewIndex] = useState(0);",
    '            <div className="flex w-full h-full justify-center items-center bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary">',
    "              No preview available",
    "            </div>",
  ].join("\n");
  const patched = patchPreviewBootError(source);
  assert.match(patched, /webcontainer.catch/);
  assert.match(patched, /bootError \?\? 'No preview available'/);
  assert.equal(patchPreviewBootError(patched), patched);
});

test("the walkthrough chat starts on OpenRouter Sonnet 5.5", () => {
  const source = [
    "    const [model, setModel] = useState(() => {",
    "      const savedModel = Cookies.get('selectedModel');",
    "      return savedModel || DEFAULT_MODEL;",
    "    });",
    "    const [provider, setProvider] = useState(() => {",
    "      const savedProvider = Cookies.get('selectedProvider');",
    "      return (PROVIDER_LIST.find((p) => p.name === savedProvider) || DEFAULT_PROVIDER) as ProviderInfo;",
    "    });",
  ].join("\n");
  const patched = patchWalkthroughModel(source);
  assert.match(patched, /useState\(\(\) => 'anthropic\/claude-sonnet-5\.5'\)/);
  assert.match(patched, /p\.name === 'OpenRouter'/);
  assert.equal(patched.includes("Cookies.get('selectedModel')"), false);
  assert.equal(patchWalkthroughModel(patched), patched);
});

test("the model selector is a fixed label", () => {
  const source = [
    "  if (providerList.length === 0) {",
    "    return (",
    '      <div className="mb-2 p-4 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-prompt-background text-bolt-elements-textPrimary">',
    "        empty",
    "      </div>",
    "    );",
    "  }",
  ].join("\n");
  const patched = patchModelSelector(source);
  assert.match(patched, /Anthropic: Claude Sonnet 5\.5/);
  assert.match(patched, /aria-label="Model"/);
  assert.equal(patched.includes("setIsModelDropdownOpen"), false);
  assert.equal(patchModelSelector(patched), patched);
  assert.throws(() => patchModelSelector("no selector here"));
});

test("the server chat call uses Sonnet 5.5", () => {
  const source = [
    "      const { model, provider } = extractPropertiesFromMessage(message);",
    "      currentModel = model;",
    "      currentProvider = provider;",
  ].join("\n");
  const patched = patchStreamModel(source);
  assert.match(patched, /currentModel = 'anthropic\/claude-sonnet-5\.5'/);
  assert.match(patched, /currentProvider = 'OpenRouter'/);
  assert.equal(patched.includes("currentModel = model;"), false);
  assert.equal(patchStreamModel(patched), patched);
});

test("the polyfill patch skips the rolldown runtime", () => {
  const source =
    "transform(code: string, id: string) {\n      return null;\n    }";
  const patched = patchBrowserPolyfills(source);
  assert.match(patched, /id\.includes\("rolldown"\)/);
  assert.equal(patchBrowserPolyfills(patched), patched);
  assert.throws(() => patchBrowserPolyfills("no transform here"));
});

test("github env export accepts Cloudflare names and the OpenRouter key", () => {
  const assignment = githubEnvAssignment("CLOUDFLARE_API_TOKEN", "token-value");
  assert.match(
    assignment,
    /^CLOUDFLARE_API_TOKEN<<BOLT_CLOUDFLARE_API_TOKEN_EOF/,
  );
  const openRouter = githubEnvAssignment("OPEN_ROUTER_API_KEY", "sk-or-test");
  assert.match(
    openRouter,
    /^OPEN_ROUTER_API_KEY<<BOLT_OPEN_ROUTER_API_KEY_EOF/,
  );
  assert.throws(() => githubEnvAssignment("WEWEBPLUS_DATABASE_URL", "x"));
  assert.throws(() => githubEnvAssignment("OPENROUTER_API_KEY", "x"));
  assert.throws(() => githubEnvAssignment("CLOUDFLARE_API_TOKEN", ""));
});

test("the OpenRouter reference uses bolt's env name", () => {
  const plan = openRouterReferencePlan(
    { project: "dyad", config: "dev", name: "OPENROUTER_API_KEY" },
    "${dyad.dev.OPENROUTER_API_KEY}",
  );
  assert.deepEqual(plan.missing, []);
  assert.equal(
    plan.secrets.OPEN_ROUTER_API_KEY,
    "${dyad.dev.OPENROUTER_API_KEY}",
  );
});

test("a missing OpenRouter key is reported and not invented", () => {
  const plan = openRouterReferencePlan(null);
  assert.deepEqual(plan.missing, ["OPEN_ROUTER_API_KEY"]);
  assert.equal(plan.secrets.OPEN_ROUTER_API_KEY, undefined);
});

test("OpenRouter source prefers the first non-production name", () => {
  assert.equal(isProductionConfig("prd"), true);
  assert.equal(isProductionConfig("production"), true);
  assert.equal(isProductionConfig("preview"), false);
  assert.equal(isProductionConfig("product"), false);
  const found = chooseOpenRouterSource([
    { project: "bolt", config: "dev", names: ["OPEN_ROUTER_API_KEY"] },
    { project: "dyad", config: "prd", names: ["OPENROUTER_API_KEY"] },
    { project: "vibesdk", config: "dev", names: ["CLOUDFLARE_API_TOKEN"] },
    { project: "dyad", config: "dev", names: ["OPENROUTER_API_KEY"] },
    {
      project: "forma",
      config: "dev",
      names: ["OPEN_ROUTER_API_KEY"],
    },
  ]);
  assert.deepEqual(found, {
    project: "dyad",
    config: "dev",
    name: "OPENROUTER_API_KEY",
  });
});
