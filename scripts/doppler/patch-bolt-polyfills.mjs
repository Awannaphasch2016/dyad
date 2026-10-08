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

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const file = process.argv[2];
  if (!file) {
    console.log("vite_config=absent");
    process.exit(1);
  }
  const source = readFileSync(file, "utf8");
  const patched = patchBrowserPolyfills(source);
  if (patched === source) {
    console.log("polyfill_patch=already");
  } else {
    writeFileSync(file, patched);
    console.log("polyfill_patch=applied");
  }
}
