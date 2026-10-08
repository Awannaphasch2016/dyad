// One embedder policy for the walkthrough page and the in-browser runtime.
// Boot rejects when it does not start. It does not switch to require-corp.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const WEBCONTAINER_COEP = "credentialless";
export const WEBCONTAINER_BOOT_TIMEOUT_MS = 15_000;

export function webContainerBootFailureMessage() {
  return `WebContainer did not start. Expected Cross-Origin-Embedder-Policy: ${WEBCONTAINER_COEP}.`;
}

export function withWebContainerBootTimeout(
  boot,
  timeoutMs = WEBCONTAINER_BOOT_TIMEOUT_MS,
) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(webContainerBootFailureMessage()));
    }, timeoutMs);
    boot.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        const reason = error instanceof Error ? error.message : String(error);
        const expected = webContainerBootFailureMessage();
        reject(
          new Error(
            reason.includes(expected) ? reason : `${expected} ${reason}`,
          ),
        );
      },
    );
  });
}

export function coepTypeScriptSource() {
  return `export const WEBCONTAINER_COEP = '${WEBCONTAINER_COEP}' as const;

export const WEBCONTAINER_BOOT_TIMEOUT_MS = ${WEBCONTAINER_BOOT_TIMEOUT_MS};

export function webContainerBootFailureMessage(): string {
  return \`WebContainer did not start. Expected Cross-Origin-Embedder-Policy: \${WEBCONTAINER_COEP}.\`;
}

export function withWebContainerBootTimeout<T>(
  boot: Promise<T>,
  timeoutMs = WEBCONTAINER_BOOT_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(webContainerBootFailureMessage()));
    }, timeoutMs);
    boot.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        const reason = error instanceof Error ? error.message : String(error);
        const expected = webContainerBootFailureMessage();
        reject(new Error(reason.includes(expected) ? reason : \`\${expected} \${reason}\`));
      },
    );
  });
}
`;
}

const embedderHeader =
  "responseHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');";
const embedderHeaderFixed =
  "responseHeaders.set('Cross-Origin-Embedder-Policy', WEBCONTAINER_COEP);";
const embedderImport =
  "import { ServerRouter, type EntryContext, type RouterContextProvider } from 'react-router';";
const embedderImportFixed = `${embedderImport}
import { WEBCONTAINER_COEP } from '~/lib/webcontainer/coep';`;

export function patchEmbedderPolicy(source) {
  if (source.includes(embedderHeaderFixed)) return source;
  if (!source.includes(embedderHeader) || !source.includes(embedderImport)) {
    throw new Error("embedder policy header was not found");
  }
  if (source.includes("'require-corp'")) {
    return source
      .replace(embedderImport, embedderImportFixed)
      .replace(embedderHeader, embedderHeaderFixed);
  }
  throw new Error("embedder policy header was not found");
}

const bootCall = `        return WebContainer.boot({
          coep: 'credentialless',
          workdirName: WORK_DIR_NAME,
          forwardPreviewErrors: true, // Enable error forwarding from iframes
        });`;
const bootCallFixed = `        return withWebContainerBootTimeout(
          WebContainer.boot({
            coep: WEBCONTAINER_COEP,
            workdirName: WORK_DIR_NAME,
            forwardPreviewErrors: true, // Enable error forwarding from iframes
          }),
        );`;
const bootImport = "import { cleanStackTrace } from '~/utils/stacktrace';";
const bootImportFixed = `${bootImport}
import { WEBCONTAINER_COEP, withWebContainerBootTimeout } from './coep';`;

export function patchWebContainerBoot(source) {
  if (source.includes("withWebContainerBootTimeout(")) return source;
  if (!source.includes(bootCall) || !source.includes(bootImport)) {
    throw new Error("webcontainer boot call was not found");
  }
  return source
    .replace(bootImport, bootImportFixed)
    .replace(bootCall, bootCallFixed);
}

const failedAction = `      this.#updateAction(actionId, { status: 'failed', error: 'Action failed' });
      logger.error(\`[\${action.type}]:Action failed\\n\\n\`, error);`;
const failedActionFixed = `      const failureMessage = error instanceof Error ? error.message : 'Action failed';
      this.#updateAction(actionId, { status: 'failed', error: failureMessage });
      logger.error(\`[\${action.type}]:Action failed\\n\\n\`, error);`;

export function patchActionFailure(source) {
  if (source.includes("const failureMessage = error instanceof Error")) {
    return source;
  }
  if (!source.includes(failedAction)) {
    throw new Error("file action failure update was not found");
  }
  return source.replace(failedAction, failedActionFixed);
}

const previewEmpty = `            <div className="flex w-full h-full justify-center items-center bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary">
              No preview available
            </div>`;
const previewEmptyFixed = `            <div className="flex w-full h-full justify-center items-center bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary px-4 text-center">
              {bootError ?? 'No preview available'}
            </div>`;
const previewState = `  const [activePreviewIndex, setActivePreviewIndex] = useState(0);`;
const previewStateFixed = `  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [bootError, setBootError] = useState<string | undefined>();
  useEffect(() => {
    let cancelled = false;
    webcontainer.catch((error: unknown) => {
      if (cancelled) {
        return;
      }
      setBootError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
  }, []);`;
const previewImport =
  "import { workbenchStore } from '~/lib/stores/workbench';";
const previewImportFixed = `${previewImport}
import { webcontainer } from '~/lib/webcontainer';`;

export function patchPreviewBootError(source) {
  if (source.includes("bootError ?? 'No preview available'")) return source;
  if (
    !source.includes(previewEmpty) ||
    !source.includes(previewState) ||
    !source.includes(previewImport)
  ) {
    throw new Error("preview empty state was not found");
  }
  return source
    .replace(previewImport, previewImportFixed)
    .replace(previewState, previewStateFixed)
    .replace(previewEmpty, previewEmptyFixed);
}

const fileRow = `                    >
                      {action.filePath}
                    </code>
                  </div>`;
const fileRowFixed = `                    >
                      {action.filePath}
                    </code>
                    {status === 'failed' && action.error ? (
                      <span className="ml-2 text-bolt-elements-icon-error">{action.error}</span>
                    ) : null}
                  </div>`;

export function patchFileActionError(source) {
  if (source.includes("status === 'failed' && action.error")) return source;
  if (!source.includes(fileRow)) {
    throw new Error("file action row was not found");
  }
  return source.replace(fileRow, fileRowFixed);
}

export function applyWebContainerCoepPatches(boltRoot) {
  const files = {
    entryServer: join(boltRoot, "app/entry.server.tsx"),
    webcontainerIndex: join(boltRoot, "app/lib/webcontainer/index.ts"),
    actionRunner: join(boltRoot, "app/lib/runtime/action-runner.ts"),
    preview: join(boltRoot, "app/components/workbench/Preview.tsx"),
    artifact: join(boltRoot, "app/components/chat/Artifact.tsx"),
    coep: join(boltRoot, "app/lib/webcontainer/coep.ts"),
  };
  const coepSource = coepTypeScriptSource();
  writeFileSync(files.coep, coepSource);
  const patches = [
    [files.entryServer, patchEmbedderPolicy, "embedder_policy_patch"],
    [files.webcontainerIndex, patchWebContainerBoot, "webcontainer_boot_patch"],
    [files.actionRunner, patchActionFailure, "action_failure_patch"],
    [files.preview, patchPreviewBootError, "preview_boot_error_patch"],
    [files.artifact, patchFileActionError, "file_action_error_patch"],
  ];
  const results = ["coep_module=written"];
  for (const [file, patch, label] of patches) {
    const source = readFileSync(file, "utf8");
    const patched = patch(source);
    if (patched !== source) writeFileSync(file, patched);
    results.push(`${label}=${patched === source ? "already" : "applied"}`);
  }
  if (!readFileSync(files.entryServer, "utf8").includes("WEBCONTAINER_COEP")) {
    throw new Error("embedder policy was not patched");
  }
  return results;
}
