import { NextResponse } from "next/server";
import { db } from "@/db";
import { steamIdChecks } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  try {
    // Get available IDs (status = AVAILABLE)
    const available = await db
      .select()
      .from(steamIdChecks)
      .where(eq(steamIdChecks.status, "AVAILABLE"))
      .orderBy(desc(steamIdChecks.checkedAt))
      .limit(100);

    // Get recent checks (all statuses)
    const recent = await db
      .select()
      .from(steamIdChecks)
      .orderBy(desc(steamIdChecks.checkedAt))
      .limit(50);

    return NextResponse.json({ available, recent });
  } catch (error) {
    console.error("History error:", error);
    return NextResponse.json(
      { error: "Failed to fetch history" },
      { status: 500 }
    );
  }
}
