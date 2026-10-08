import { readFile } from "node:fs/promises";
import { parse } from "yaml";

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
  return pinnedImages(parse(text));
}

export function manifestUrl(image) {
  const [found] = pinnedImages({ services: { check: { image } } });
  return `https://ghcr.io/v2/awannaphasch2016/${found.repository}/manifests/${found.reference}`;
}
