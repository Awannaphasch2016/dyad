// Keep the browser Buffer shim out of Rolldown's runtime chunk.
// Injecting it there makes the runtime import the Buffer bundle, and the Buffer
// bundle imports the runtime before that export exists. The page then stays blank.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

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

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const viteConfig = process.argv[2];
  const chatClient = process.argv[3];
  if (!viteConfig || !chatClient) {
    console.log("patch_args=absent");
    process.exit(1);
  }
  for (const [file, patch, label] of [
    [viteConfig, patchBrowserPolyfills, "polyfill_patch"],
    [chatClient, patchChatReady, "ready_patch"],
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
}
