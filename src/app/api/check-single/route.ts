import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { steamIdChecks } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { checkSteamVanityUrl, type SteamIdStatus } from "@/lib/steam-checker";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { vanityUrl } = body;

    if (
      !vanityUrl ||
      typeof vanityUrl !== "string" ||
      vanityUrl.length < 3 ||
      vanityUrl.length > 32
    ) {
      return NextResponse.json(
        { error: "Invalid vanity URL (3-32 characters)" },
        { status: 400 }
      );
    }

    // Validate characters
    if (!/^[a-zA-Z0-9_-]+$/.test(vanityUrl)) {
      return NextResponse.json(
        { error: "Only letters, numbers, _ and - are allowed" },
        { status: 400 }
      );
    }

    const normalizedUrl = vanityUrl.toLowerCase();

    // Check cache first (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const cached = await db
      .select()
      .from(steamIdChecks)
      .where(
        and(
          eq(steamIdChecks.vanityUrl, normalizedUrl),
          gt(steamIdChecks.checkedAt, oneDayAgo)
        )
      )
      .limit(1);

    if (cached.length > 0) {
      return NextResponse.json({
        vanityUrl: normalizedUrl,
        status: cached[0].status as SteamIdStatus,
        steamId64: cached[0].steamId64,
        reason: cached[0].reason,
        cached: true,
      });
    }

    // Perform actual check
    const result = await checkSteamVanityUrl(normalizedUrl);

    // Save to cache
    await db.insert(steamIdChecks).values({
      vanityUrl: result.vanityUrl,
      status: result.status,
      steamId64: result.steamId64 || null,
      reason: result.reason || null,
    });

    return NextResponse.json({
      vanityUrl: result.vanityUrl,
      status: result.status,
      steamId64: result.steamId64,
      reason: result.reason,
      cached: false,
    });
  } catch (error) {
    console.error("Steam ID check error:", error);
    return NextResponse.json(
      { error: "Failed to check Steam ID" },
      { status: 500 }
    );
  }
}
