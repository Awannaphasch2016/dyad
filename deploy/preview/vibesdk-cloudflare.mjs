// Create and delete one Vibe SDK preview's Worker, D1, KV, and R2.
// A missing resource is success. Lab and production ids are refused first.

import {
  assertAccountId,
  assertResourceId,
  assertSafePreview,
  previewNames,
} from "./vibesdk.mjs";

export function rowsOf(payload) {
  const result = payload?.result;
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.buckets)) return result.buckets;
  return [];
}

function findNamed(rows, field, expected) {
  return (rows ?? []).find((row) => row?.[field] === expected) ?? null;
}

function d1Id(row) {
  return String(row?.uuid ?? row?.database_id ?? "");
}

async function listRows(request, path) {
  const rows = [];
  for (let page = 1; page <= 10; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const result = await request(
      "GET",
      `${path}${separator}page=${page}&per_page=100`,
    );
    if (result.status !== 200 || result.payload?.success === false) {
      throw new Error(`GET ${path.split("?")[0]} ${result.status}`);
    }
    rows.push(...rowsOf(result.payload));
    const info = result.payload?.result_info;
    if (!info?.total_pages || page >= info.total_pages) break;
  }
  return rows;
}

async function ensureByName(request, { path, body, field, expected }) {
  const existing = findNamed(await listRows(request, path), field, expected);
  if (existing) return existing;
  const created = await request("POST", path, body);
  if (created.status === 200 || created.status === 201) {
    return created.payload?.result ?? {};
  }
  const again = findNamed(await listRows(request, path), field, expected);
  if (again) return again;
  throw new Error(`POST ${path.split("?")[0]} ${created.status}`);
}

async function deleteRequest(request, path) {
  let removed = await request("DELETE", path);
  if (removed.status === 400 || removed.status === 412) {
    removed = await request("DELETE", `${path}?force=true`);
  }
  if (removed.status === 404) return { deleted: false };
  if (
    (removed.status !== 200 && removed.status !== 204) ||
    removed.payload?.success === false
  ) {
    throw new Error(`DELETE ${path.split("?")[0]} ${removed.status}`);
  }
  return { deleted: true };
}

async function deleteNamed(
  request,
  { listPath, field, expected, removePath, idOf, kind },
) {
  const row = findNamed(await listRows(request, listPath), field, expected);
  if (!row) return { deleted: false };
  const id = idOf(row);
  assertResourceId(id, kind);
  return deleteRequest(request, removePath(id));
}

export async function ensurePreviewResources({ request, accountId, pr }) {
  assertAccountId(accountId);
  const names = previewNames(pr);
  assertSafePreview(names);
  const account = `/accounts/${accountId}`;
  const database = await ensureByName(request, {
    path: `${account}/d1/database`,
    body: { name: names.d1 },
    field: "name",
    expected: names.d1,
  });
  const databaseId = d1Id(database);
  assertResourceId(databaseId, "d1");
  const kv = await ensureByName(request, {
    path: `${account}/storage/kv/namespaces`,
    body: { title: names.kv },
    field: "title",
    expected: names.kv,
  });
  const kvId = String(kv.id ?? "");
  assertResourceId(kvId, "kv");
  await ensureByName(request, {
    path: `${account}/r2/buckets`,
    body: { name: names.r2 },
    field: "name",
    expected: names.r2,
  });
  return { names, databaseId, kvId };
}

export async function deletePreviewResources({ request, accountId, pr }) {
  assertAccountId(accountId);
  const names = previewNames(pr);
  assertSafePreview(names);
  const account = `/accounts/${accountId}`;
  const workerLookup = await request(
    "GET",
    `${account}/workers/scripts/${names.worker}`,
  );
  let worker = { deleted: false };
  if (workerLookup.status !== 404) {
    if (
      workerLookup.status !== 200 ||
      workerLookup.payload?.success === false
    ) {
      throw new Error(
        `GET workers/scripts/${names.worker} ${workerLookup.status}`,
      );
    }
    worker = await deleteRequest(
      request,
      `${account}/workers/scripts/${names.worker}`,
    );
  }
  const r2 = await deleteNamed(request, {
    listPath: `${account}/r2/buckets`,
    field: "name",
    expected: names.r2,
    removePath: () => `${account}/r2/buckets/${encodeURIComponent(names.r2)}`,
    idOf: () => names.r2,
    kind: "r2",
  });
  const kv = await deleteNamed(request, {
    listPath: `${account}/storage/kv/namespaces`,
    field: "title",
    expected: names.kv,
    removePath: (id) =>
      `${account}/storage/kv/namespaces/${encodeURIComponent(id)}`,
    idOf: (row) => String(row.id ?? ""),
    kind: "kv",
  });
  const d1 = await deleteNamed(request, {
    listPath: `${account}/d1/database`,
    field: "name",
    expected: names.d1,
    removePath: (id) => `${account}/d1/database/${encodeURIComponent(id)}`,
    idOf: d1Id,
    kind: "d1",
  });
  return { names, worker, r2, kv, d1 };
}
