import "./load-env";
import { readFileSync } from "node:fs";

async function main() {
  const { pool } = await import("../src/lib/db");
  await pool.query(readFileSync("db/schema.sql", "utf8"));
  console.log("Schema applied.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
