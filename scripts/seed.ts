import "./load-env";

// Usage: npm run db:seed            → reset the sandbox: CRM, calendar and the first 8 sample emails
//        npm run db:seed -- --all   → put all sample emails into the inbox
async function main() {
  const { pool } = await import("../src/lib/db");
  const { resetSandbox } = await import("../src/lib/seed");
  const n = await resetSandbox({ all: process.argv.includes("--all") });
  console.log(`Seeded: ${n.emails} emails, ${n.contacts} contacts, ${n.events} calendar events.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
