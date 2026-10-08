// Keep the browser Buffer shim out of Rolldown's runtime chunk.
// Injecting it there makes the runtime import the Buffer bundle, and the Buffer
// bundle imports the runtime before that export exists. The page then stays blank.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { applyBoltHitlPatches } from "./bolt-hitl.mjs";
import { applyBoltWorkflowPatches } from "./bolt-workflow.mjs";
import { applyWebContainerCoepPatches } from "./bolt-webcontainer-coep.mjs";

const transformStart = "transform(code: string, id: string) {";
const skip = `transform(code: string, id: string) {
      if (
        id.includes("\\0") ||
        id.includes("rolldown") ||
        id.includes("vite-plugin-node-polyfills")
      ) {
        return null;
      }
`;

export function patchBrowserPolyfills(source) {
  if (source.includes('id.includes("rolldown")')) return source;
  if (!source.includes(transformStart)) {
    throw new Error("bolt polyfill transform was not found");
  }
  return source.replace(transformStart, skip);
}

const readyCall =
  "factoryRunToRestore(ready, chatId.get(), restoredChatId.current, chatMetadata.get());";
const readyCallFixed =
  "factoryRunToRestore(true, chatId.get(), restoredChatId.current, chatMetadata.get());";
const readyDeps = "}, [ready, initialMessages]);";
const readyDepsFixed = "}, [initialMessages]);";

const previewImport = `  walkthroughPreviewVisible,
} from '~/lib/factoryPhase';`;
const previewImportFixed = `  previewOpenForPhase,
  walkthroughPreviewVisible,
} from '~/lib/factoryPhase';`;

const previewEffect = `      if (!walkthroughPreviewVisible(factoryRun.phase)) {
        workbenchStore.showWorkbench.set(false);
      }`;
const previewEffectFixed = `      if (walkthroughPreviewVisible(factoryRun.phase)) {
        workbenchStore.showWorkbench.set(true);
        if (previewOpenForPhase(factoryRun.phase)) {
          workbenchStore.currentView.set('preview');
        }
      } else {
        workbenchStore.showWorkbench.set(false);
      }`;

export function patchImplementationPreview(source) {
  if (source.includes(previewEffectFixed)) return source;
  if (!source.includes(previewImport) || !source.includes(previewEffect)) {
    throw new Error("implementation preview effect was not found");
  }
  return source
    .replace(previewImport, previewImportFixed)
    .replace(previewEffect, previewEffectFixed);
}

export function patchChatReady(source) {
  if (source.includes(readyCallFixed) && !source.includes(readyCall)) {
    return source;
  }
  if (!source.includes(readyCall) || !source.includes(readyDeps)) {
    throw new Error("walkthrough restore effect was not found");
  }
  return source
    .replace(readyCall, readyCallFixed)
    .replace(readyDeps, readyDepsFixed);
}

export const WALKTHROUGH_MODEL = "anthropic/claude-sonnet-5.5";
export const WALKTHROUGH_MODEL_LABEL = "Anthropic: Claude Sonnet 5.5";
export const WALKTHROUGH_PROVIDER = "OpenRouter";

const savedModelState = `    const [model, setModel] = useState(() => {
      const savedModel = Cookies.get('selectedModel');
      return savedModel || DEFAULT_MODEL;
    });
    const [provider, setProvider] = useState(() => {
      const savedProvider = Cookies.get('selectedProvider');
      return (PROVIDER_LIST.find((p) => p.name === savedProvider) || DEFAULT_PROVIDER) as ProviderInfo;
    });`;

const fixedModelState = `    const [model, setModel] = useState(() => '${WALKTHROUGH_MODEL}');
    const [provider, setProvider] = useState(
      () => (PROVIDER_LIST.find((p) => p.name === '${WALKTHROUGH_PROVIDER}') || DEFAULT_PROVIDER) as ProviderInfo,
    );`;

export function patchWalkthroughModel(source) {
  if (source.includes(fixedModelState)) return source;
  if (!source.includes(savedModelState)) {
    throw new Error("walkthrough model state was not found");
  }
  return source.replace(savedModelState, fixedModelState);
}

const selectorGate = `  if (providerList.length === 0) {
    return (
      <div className="mb-2 p-4 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-prompt-background text-bolt-elements-textPrimary">`;
const fixedSelector = `  useEffect(() => {
    const openRouter = providerList.find((item) => item.name === '${WALKTHROUGH_PROVIDER}');
    if (openRouter && provider?.name !== '${WALKTHROUGH_PROVIDER}') {
      setProvider?.(openRouter);
    }
    if (model !== '${WALKTHROUGH_MODEL}') {
      setModel?.('${WALKTHROUGH_MODEL}');
    }
  }, [model, provider, providerList, setModel, setProvider]);

  return (
    <div className="flex gap-2 flex-col sm:flex-row" aria-label="Model">
      <div className="w-full p-2 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-prompt-background text-bolt-elements-textPrimary">
        ${WALKTHROUGH_PROVIDER}
      </div>
      <div className="w-full min-w-[70%] p-2 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-prompt-background text-bolt-elements-textPrimary">
        ${WALKTHROUGH_MODEL_LABEL}
      </div>
    </div>
  );

  if (providerList.length === 0) {
    return (
      <div className="mb-2 p-4 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-prompt-background text-bolt-elements-textPrimary">`;

export function patchModelSelector(source) {
  if (
    source.includes(WALKTHROUGH_MODEL_LABEL) &&
    source.includes('aria-label="Model"')
  ) {
    return source;
  }
  if (!source.includes(selectorGate)) {
    throw new Error("model selector gate was not found");
  }
  return source.replace(selectorGate, fixedSelector);
}

const extractedModel = `      const { model, provider } = extractPropertiesFromMessage(message);
      currentModel = model;
      currentProvider = provider;`;

const forcedModel = `      const extracted = extractPropertiesFromMessage(message);
      currentModel = '${WALKTHROUGH_MODEL}';
      currentProvider = '${WALKTHROUGH_PROVIDER}';
      logger.info(\`Walkthrough model \${currentProvider}/\${currentModel} overrides \${extracted.provider}/\${extracted.model}\`);`;

export function patchStreamModel(source) {
  if (source.includes(`currentModel = '${WALKTHROUGH_MODEL}'`)) return source;
  if (!source.includes(extractedModel)) {
    throw new Error("stream model assignment was not found");
  }
  return source.replace(extractedModel, forcedModel);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const viteConfig = process.argv[2];
  const chatClient = process.argv[3];
  const modelSelector = process.argv[4];
  const streamText = process.argv[5];
  const boltRoot = process.argv[6];
  if (
    !viteConfig ||
    !chatClient ||
    !modelSelector ||
    !streamText ||
    !boltRoot
  ) {
    console.log("patch_args=absent");
    process.exit(1);
  }
  for (const [file, patch, label] of [
    [viteConfig, patchBrowserPolyfills, "polyfill_patch"],
    [chatClient, patchChatReady, "ready_patch"],
    [chatClient, patchImplementationPreview, "preview_patch"],
    [chatClient, patchWalkthroughModel, "model_state_patch"],
    [modelSelector, patchModelSelector, "model_selector_patch"],
    [streamText, patchStreamModel, "stream_model_patch"],
  ]) {
    const source = readFileSync(file, "utf8");
    const patched = patch(source);
    if (patched === source) {
      console.log(`${label}=already`);
    } else {
      writeFileSync(file, patched);
      console.log(`${label}=applied`);
    }
  }
  for (const line of applyWebContainerCoepPatches(boltRoot)) {
    console.log(line);
  }
  for (const line of applyBoltHitlPatches(boltRoot)) {
    console.log(line);
  }
  for (const line of applyBoltWorkflowPatches(boltRoot)) {
    console.log(line);
  }
}
