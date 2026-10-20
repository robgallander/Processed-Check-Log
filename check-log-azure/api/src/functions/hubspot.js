// HubSpot data arrives by workflow webhook (no HubSpot API key needed).
//   POST /api/hubspot/webhook  <- called by the HubSpot workflow; protected by WEBHOOK_SECRET
//   GET  /api/hubspot/deals    -> the stored deals, for the page
//   POST /api/hubspot/owners   -> coordinator names, from owners.json
const { app } = require("@azure/functions");
const crypto = require("crypto");
const { canView, json, denied } = require("../lib/auth");
const { table, listPartition } = require("../lib/table");
const OWNERS = require("../lib/owners.json");

const STAGE_BB = "1072094529"; // Pending Settlement Funds (BB)
const STAGE_CK = "148011373";  // Pending Settlement Funds (CK)
const STAGE_LABELS = { "pending settlement funds (bb)": STAGE_BB, "pending settlement funds (ck)": STAGE_CK };
const PROCESSED = ["Complete", "Manual (No SMS)"];
const DATE_ONLY = ["surrender_date", "checks_received_date", "checks_reviewed_date"];
const DATETIME = ["hs_v2_date_entered_" + STAGE_BB, "hs_v2_date_entered_" + STAGE_CK];
const PROPERTIES = [
  "dealname", "clio_matter", "dealstage", "checks_received", "fees_by_motion", "clio_address_confirmed",
  "surrender_date", "plaintiff_name_short", "car_manufacturer__cloned_", "check_coordinator",
  "checks_under_review", "checks_received_date", "checks_reviewed_date", ...DATETIME,
];

const fail = (e) => json(e.status || 500, { code: e.code || "upstream_error", error: e.error || String(e.message || e) });

function secretOk(request) {
  const want = process.env.WEBHOOK_SECRET || "";
  const got = request.headers.get("x-checklog-key") || request.query.get("key") || "";
  if (!want || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

// HubSpot can send dates as "2026-01-08", as epoch milliseconds, or as full timestamps.
function normValue(name, v) {
  if (v && typeof v === "object" && "value" in v) v = v.value;
  if (v === undefined || v === null) return undefined;
  v = String(v).trim();
  if (v === "") return "";
  const isEpoch = /^\d{11,14}$/.test(v);
  if (DATE_ONLY.includes(name)) {
    if (isEpoch) return new Date(Number(v)).toISOString().slice(0, 10);
    return v.slice(0, 10);
  }
  if (DATETIME.includes(name) && isEpoch) return new Date(Number(v)).toISOString();
  if (name === "dealstage" && STAGE_LABELS[v.toLowerCase()]) return STAGE_LABELS[v.toLowerCase()];
  if (name === "checks_received") return /^(true|yes)$/i.test(v) ? "true" : /^(false|no)$/i.test(v) ? "false" : v;
  return v;
}

function extract(body) {
  const src = body && typeof body.properties === "object" && body.properties ? body.properties : body || {};
  const props = {};
  for (const k of PROPERTIES) {
    const v = normValue(k, src[k]);
    if (v !== undefined) props[k] = v;
  }
  let id = body.hs_object_id || body.objectId || body.id || src.hs_object_id || body.vid;
  if (id && typeof id === "object" && "value" in id) id = id.value;
  return { id: id ? String(id).trim() : "", props };
}

// Keep only deals the check log shows; anything else is removed so a deal that leaves the stages drops off.
function relevant(p) {
  if (p.dealstage === STAGE_BB || p.dealstage === STAGE_CK) return true;
  return PROCESSED.includes(p.checks_under_review) && !!p.checks_received_date;
}

app.http("hubspotWebhook", {
  methods: ["POST"],
  route: "hubspot/webhook",
  authLevel: "anonymous",
  handler: async (request, context) => {
    if (!secretOk(request)) return json(401, { error: "Bad or missing key" });
    try {
      const raw = await request.json().catch(() => null);
      if (!raw) return json(400, { error: "Expected a JSON body" });
      const t = await table();
      let saved = 0, removed = 0;
      for (const body of Array.isArray(raw) ? raw : [raw]) {
        const { id, props } = extract(body);
        if (!/^\d{1,20}$/.test(id)) { context.warn("Webhook without a usable deal id", JSON.stringify(body).slice(0, 300)); continue; }
        let merged = props;
        try { merged = Object.assign(JSON.parse((await t.getEntity("deals", id)).data || "{}"), props); }
        catch (e) { if (e.statusCode !== 404) throw e; }
        if (relevant(merged)) {
          await t.upsertEntity({ partitionKey: "deals", rowKey: id, data: JSON.stringify(merged), updatedAt: new Date().toISOString() }, "Replace");
          saved++;
        } else {
          await t.deleteEntity("deals", id).catch((e) => { if (e.statusCode !== 404) throw e; });
          removed++;
        }
      }
      return json(200, { ok: true, saved, removed });
    } catch (e) { return fail(e); }
  },
});

app.http("hubspotDeals", {
  methods: ["GET"],
  route: "hubspot/deals",
  authLevel: "anonymous",
  handler: async (request) => {
    if (!canView(request)) return denied();
    try {
      const items = await listPartition("deals");
      return json(200, { results: items.map((i) => ({ id: i.id, properties: i.data })), fetchedAt: Date.now() });
    } catch (e) { return fail(e); }
  },
});

app.http("hubspotOwners", {
  methods: ["POST"],
  route: "hubspot/owners",
  authLevel: "anonymous",
  handler: async (request) => {
    if (!canView(request)) return denied();
    const b = await request.json().catch(() => ({}));
    const ids = Array.isArray(b.ownerIds) ? b.ownerIds.map(String) : [];
    return json(200, { owners: ids.filter((id) => OWNERS[id]).map((id) => ({ ownerId: Number(id), name: OWNERS[id] })) });
  },
});
module.exports._test = { extract, relevant };
