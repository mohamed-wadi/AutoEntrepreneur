import { db, invoicesTable } from "@workspace/db";

async function check() {
    const all = await db.select().from(invoicesTable);
    console.log(JSON.stringify(all, null, 2));
    process.exit(0);
}

check().catch(console.error);
