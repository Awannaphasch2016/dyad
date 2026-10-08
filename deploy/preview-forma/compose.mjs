import { readFile } from "node:fs/promises";

// The runner does not install this repository. Accept only the small compose
// shape this preview uses.
export function parseCompose(text) {
  const document = { services: {} };
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    if (/^\s*#/.test(raw) || !raw.trim()) continue;
    if (raw.trim() === "services:") continue;
    const service = /^ {2}([A-Za-z0-9][A-Za-z0-9._-]*):\s*$/.exec(raw);
    if (service) {
      current = service[1];
      document.services[current] = {};
      continue;
    }
    const field = /^ {4}([A-Za-z0-9_-]+):\s*(\S.*?)\s*$/.exec(raw);
    if (current && field) {
      document.services[current][field[1]] = field[2].replace(
        /^["']|["']$/g,
        "",
      );
      continue;
    }
    throw new Error("Compose file has an unsupported line");
  }
  return document;
}

const pinnedImage =
  /^ghcr\.io\/awannaphasch2016\/([a-z0-9][a-z0-9._-]{0,100})(?::sha-([0-9a-f]{40})|@sha256:([0-9a-f]{64}))$/;

export function pinnedImages(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("Compose file must be a mapping");
  }
  const services = document.services;
  if (!services || typeof services !== "object" || Array.isArray(services)) {
    throw new Error("Compose file must name at least one service");
  }
  const images = [];
  for (const [name, service] of Object.entries(services)) {
    if (!service || typeof service !== "object" || Array.isArray(service)) {
      throw new Error(`Service ${name} is invalid`);
    }
    if (service.build) {
      throw new Error(`Service ${name} must not build an image`);
    }
    const image = String(service.image || "");
    const match = pinnedImage.exec(image);
    if (!match) {
      throw new Error(
        `Service ${name} must pin ghcr.io/awannaphasch2016/<name>:sha-<40 hex>`,
      );
    }
    images.push({
      service: name,
      image,
      repository: match[1],
      reference: match[2] ? `sha-${match[2]}` : `sha256:${match[3]}`,
    });
  }
  if (images.length === 0) {
    throw new Error("Compose file must name at least one service");
  }
  return images;
}

export async function readPinnedImages(path) {
  const text = await readFile(path, "utf8");
  return pinnedImages(parseCompose(text));
}

export function manifestUrl(image) {
  const [found] = pinnedImages({ services: { check: { image } } });
  return `https://ghcr.io/v2/awannaphasch2016/${found.repository}/manifests/${found.reference}`;
}
