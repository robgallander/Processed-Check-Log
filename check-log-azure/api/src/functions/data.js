// Shared edits and manual rows, stored in one Azure Table ("CheckLog").
// PartitionKey = collection ("checks" or "manual"), RowKey = document id, data = JSON text.
const { app } = require("@azure/functions");
const crypto = require("crypto");
const { canView, canEdit, who, json, denied } = require("../lib/auth");
const { table, listPartition } = require("../lib/table");

const COLLECTIONS = new Set(["checks", "manual"]);

const validId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(id);
const fail = (e) => json(e.status || 500, { code: e.code || "upstream_error", error: e.error || String(e.message || e) });

async function readDoc(t, col, id) {
  try {
    const e = await t.getEntity(col, id);
    return { entity: e, data: JSON.parse(e.data || "{}") };
  } catch (e) {
    if (e.statusCode === 404) return null;
    throw e;
  }
}

async function writeDoc(t, col, id, data, request, etag) {
  const entity = { partitionKey: col, rowKey: id, data: JSON.stringify(data), updatedBy: who(request), updatedAt: new Date().toISOString() };
  if (etag) await t.updateEntity(entity, "Replace", { etag });
  else await t.upsertEntity(entity, "Replace");
}

app.http("dataList", {
  methods: ["GET"],
  route: "data/{col}",
  authLevel: "anonymous",
  handler: async (request) => {
    if (!canView(request)) return denied();
    const col = request.params.col;
    if (!COLLECTIONS.has(col)) return json(404, { error: "Unknown collection" });
    try {
      const items = (await listPartition(col)).map((i) => ({ id: i.id, data: i.data }));
      return json(200, { items });
    } catch (e) { return fail(e); }
  },
});

app.http("dataCreate", {
  methods: ["POST"],
  route: "data/{col}",
  authLevel: "anonymous",
  handler: async (request) => {
    if (!canEdit(request)) return denied();
    const col = request.params.col;
    if (col !== "manual") return json(404, { error: "Unknown collection" });
    try {
      const b = await request.json().catch(() => ({}));
      const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
      await writeDoc(await table(), col, id, b.data && typeof b.data === "object" ? b.data : {}, request);
      return json(201, { id });
    } catch (e) { return fail(e); }
  },
});

app.http("dataDoc", {
  methods: ["PUT", "PATCH", "DELETE"],
  route: "data/{col}/{id}",
  authLevel: "anonymous",
  handler: async (request) => {
    if (!canEdit(request)) return denied();
    const { col, id } = request.params;
    if (!COLLECTIONS.has(col) || !validId(id)) return json(404, { error: "Unknown document" });
    try {
      const t = await table();
      if (request.method === "DELETE") {
        await t.deleteEntity(col, id).catch((e) => { if (e.statusCode !== 404) throw e; });
        return json(200, { ok: true });
      }
      const b = await request.json().catch(() => ({}));
      const patch = b.data && typeof b.data === "object" ? b.data : {};
      if (request.method === "PUT") {
        await writeDoc(t, col, id, patch, request);
        return json(200, { ok: true });
      }
      // PATCH merges fields; retry if two people save the same row at once.
      for (let attempt = 0; attempt < 5; attempt++) {
        const cur = await readDoc(t, col, id);
        try {
          await writeDoc(t, col, id, Object.assign({}, cur ? cur.data : {}, patch), request, cur && cur.entity.etag);
          return json(200, { ok: true });
        } catch (e) {
          if (e.statusCode !== 412) throw e;
        }
      }
      return json(409, { code: "upstream_error", error: "Someone else was saving this row; try again." });
    } catch (e) { return fail(e); }
  },
});
