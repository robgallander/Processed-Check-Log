// One Azure Table ("CheckLog") holds everything: PartitionKey = collection, RowKey = id, data = JSON text.
const { TableClient } = require("@azure/data-tables");
const TABLE = "CheckLog";
let client = null, ready = null;

function table() {
  const cs = process.env.STORAGE_CONNECTION_STRING;
  if (!cs) return Promise.reject({ status: 500, code: "config_error", error: "STORAGE_CONNECTION_STRING is not set" });
  if (!client) {
    client = TableClient.fromConnectionString(cs, TABLE);
    ready = client.createTable().catch((e) => { if (e.statusCode !== 409) { client = null; throw e; } });
  }
  return ready.then(() => client);
}

async function listPartition(col) {
  const t = await table();
  const items = [];
  for await (const e of t.listEntities({ queryOptions: { filter: `PartitionKey eq '${col}'` } })) {
    try { items.push({ id: e.rowKey, data: JSON.parse(e.data || "{}"), updatedAt: e.updatedAt }); } catch { /* skip bad row */ }
  }
  return items;
}

module.exports = { table, listPartition };
