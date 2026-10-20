// One-time import of the data your team entered on the claude.ai version of the Check Log.
// Usage (from this "scripts" folder):
//   npm install
//   STORAGE_CONNECTION_STRING="<your connection string>" node import-data.mjs ../data/existing-data.json
import { readFileSync } from "fs";
import { TableClient } from "@azure/data-tables";

const cs = process.env.STORAGE_CONNECTION_STRING;
const file = process.argv[2] || "../data/existing-data.json";
if (!cs) { console.error("Set STORAGE_CONNECTION_STRING first."); process.exit(1); }

const data = JSON.parse(readFileSync(file, "utf8"));
const client = TableClient.fromConnectionString(cs, "CheckLog");
await client.createTable().catch((e) => { if (e.statusCode !== 409) throw e; });

let n = 0;
for (const col of ["checks", "manual"]) {
  for (const [id, doc] of Object.entries(data[col] || {})) {
    let merged = doc;
    try {
      const cur = await client.getEntity(col, id);
      // Keep anything already entered on the Azure site; imported values fill the gaps.
      merged = Object.assign({}, doc, JSON.parse(cur.data || "{}"));
    } catch (e) { if (e.statusCode !== 404) throw e; }
    await client.upsertEntity({ partitionKey: col, rowKey: id, data: JSON.stringify(merged), updatedBy: "import", updatedAt: new Date().toISOString() }, "Replace");
    n++;
  }
}
console.log(`Imported ${n} rows into the CheckLog table.`);
