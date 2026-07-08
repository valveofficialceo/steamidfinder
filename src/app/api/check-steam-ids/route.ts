import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { steamIdChecks, searchSessions } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { checkSteamVanityUrl, isPotentiallyAvailable, type SteamIdStatus } from "@/lib/steam-checker";

function generateIds(
  minLength: number,
  maxLength: number,
  charset: string,
  pattern: string,
  count: number
): string[] {
  let chars: string;
  switch (charset) {
    case "digits":
      chars = "0123456789";
      break;
    case "letters":
      chars = "abcdefghijklmnopqrstuvwxyz";
      break;
    case "alphanumeric":
    default:
      chars = "abcdefghijklmnopqrstuvwxyz0123456789";
      break;
  }

  const results: string[] = [];
  const seen = new Set<string>();

  if (pattern && pattern.trim() !== "") {
    // Generate IDs based on pattern
    // Pattern: * = any char from charset, fixed chars stay
    const generateFromPattern = (pat: string): string[] => {
      const ids: string[] = [];
      const starPositions: number[] = [];
      for (let i = 0; i < pat.length; i++) {
        if (pat[i] === "*") starPositions.push(i);
      }

      if (starPositions.length === 0) {
        return [pat];
      }

      const maxAttempts = count * 5;
      let attempts = 0;

      while (ids.length < count && attempts < maxAttempts) {
        const id = pat.split("");
        for (const pos of starPositions) {
          id[pos] = chars[Math.floor(Math.random() * chars.length)];
        }
        const idStr = id.join("");
        if (!seen.has(idStr)) {
          seen.add(idStr);
          ids.push(idStr);
        }
        attempts++;
      }

      return ids;
    };

    return generateFromPattern(pattern);
  }

  // Generate random IDs of varying lengths
  const maxAttempts = count * 5;
  let attempts = 0;

  while (results.length < count && attempts < maxAttempts) {
    const length =
      minLength + Math.floor(Math.random() * (maxLength - minLength + 1));
    let id = "";
    for (let i = 0; i < length; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    if (!seen.has(id) && id.length >= 3) {
      seen.add(id);
      results.push(id);
    }
    attempts++;
  }

  return results;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      minLength = 4,
      maxLength = 5,
      charset = "alphanumeric",
      batchSize = 10,
      pattern = "",
    } = body;

    // Validate inputs
    if (minLength < 3 || maxLength > 20 || minLength > maxLength) {
      return NextResponse.json(
        { error: "Invalid length parameters" },
        { status: 400 }
      );
    }

    if (batchSize < 1 || batchSize > 20) {
      return NextResponse.json(
        { error: "Batch size must be between 1 and 20" },
        { status: 400 }
      );
    }

    // Create search session
    const [session] = await db
      .insert(searchSessions)
      .values({
        minLength,
        maxLength,
        charset,
        pattern: pattern || null,
        status: "running",
        totalChecked: 0,
        totalAvailable: 0,
      })
      .returning();

    // Generate candidate IDs
    const candidates = generateIds(
      minLength,
      maxLength,
      charset,
      pattern,
      batchSize
    );

    const results: {
      vanityUrl: string;
      status: SteamIdStatus;
      steamId64?: string;
      reason?: string;
      error?: string;
    }[] = [];

    let availableCount = 0;

    // Check each candidate with a small delay between requests
    for (const candidate of candidates) {
      // Check cache first (last 24 hours)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const cached = await db
        .select()
        .from(steamIdChecks)
        .where(
          and(
            eq(steamIdChecks.vanityUrl, candidate),
            gt(steamIdChecks.checkedAt, oneDayAgo)
          )
        )
        .limit(1);

      if (cached.length > 0) {
        const cachedStatus = cached[0].status as SteamIdStatus;
        results.push({
          vanityUrl: candidate,
          status: cachedStatus,
          steamId64: cached[0].steamId64 || undefined,
          reason: cached[0].reason || undefined,
        });
        if (isPotentiallyAvailable(cachedStatus)) availableCount++;
        continue;
      }

      try {
        const checkResult = await checkSteamVanityUrl(candidate);

        // Save to cache
        await db.insert(steamIdChecks).values({
          vanityUrl: checkResult.vanityUrl,
          status: checkResult.status,
          steamId64: checkResult.steamId64 || null,
          reason: checkResult.reason || null,
        });

        results.push({
          vanityUrl: checkResult.vanityUrl,
          status: checkResult.status,
          steamId64: checkResult.steamId64,
          reason: checkResult.reason,
        });
        if (isPotentiallyAvailable(checkResult.status)) availableCount++;
      } catch {
        results.push({
          vanityUrl: candidate,
          status: "RESERVED_OR_UNKNOWN",
          error: "Check failed",
        });
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    // Update session
    await db
      .update(searchSessions)
      .set({
        totalChecked: candidates.length,
        totalAvailable: availableCount,
        status: "completed",
      })
      .where(eq(searchSessions.id, session.id));

    return NextResponse.json({
      sessionId: session.id,
      results,
      totalChecked: candidates.length,
      totalAvailable: availableCount,
    });
  } catch (error) {
    console.error("Steam ID check error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
