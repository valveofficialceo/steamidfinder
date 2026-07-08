import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { steamIdChecks, searchSessions } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { checkSteamVanityUrl, isPotentiallyAvailable, type SteamIdStatus } from "@/lib/steam-checker";

type RepeatingMode =
  | "same_digit"       // 666, 9999, 1111
  | "same_letter"      // aaa, zzzz, bbbb
  | "same_any"         // both digits and letters
  | "repeated_pair"    // 6969, abab, 1212
  | "sequential_digits" // 1234, 4567, 789
  | "palindrome"       // 1221, abba, 12321
  | "prefix_repeat"    // x666, a999, b111
  | "suffix_repeat"    // 666x, 999a, 111b
  | "all";

function generateRepeatingIds(
  mode: RepeatingMode,
  minLength: number,
  maxLength: number,
  offset: number = 0,
  limit: number = 20,
): string[] {
  const results: string[] = [];
  const digits = "0123456789";
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const allChars = letters + digits;

  // Same digit repeated: 000, 111, ..., 0000, 1111, ..., 00000, etc
  if (mode === "same_digit" || mode === "same_any" || mode === "all") {
    for (let len = minLength; len <= maxLength; len++) {
      for (const d of digits) {
        results.push(d.repeat(len));
      }
    }
  }

  // Same letter repeated: aaa, bbb, ..., aaaa, bbbb, etc
  if (mode === "same_letter" || mode === "same_any" || mode === "all") {
    for (let len = minLength; len <= maxLength; len++) {
      for (const l of letters) {
        results.push(l.repeat(len));
      }
    }
  }

  // Repeated pairs: 6969, abab, 1212, etc
  if (mode === "repeated_pair" || mode === "all") {
    for (let len = minLength; len <= maxLength; len++) {
      if (len < 4) continue; // need at least 4 chars for pair repeat
      const pairLen = 2;
      const repeats = Math.floor(len / pairLen);
      if (repeats * pairLen !== len) continue; // only even lengths
      
      // Digit pairs
      for (const d1 of digits) {
        for (const d2 of digits) {
          if (d1 === d2) continue; // skip same digit, already covered
          const pair = d1 + d2;
          results.push(pair.repeat(repeats));
        }
      }
      
      // Letter pairs
      for (let i = 0; i < letters.length; i++) {
        for (let j = i + 1; j < letters.length && j < i + 5; j++) {
          const pair = letters[i] + letters[j];
          results.push(pair.repeat(repeats));
        }
      }

      // Mixed pairs (letter + digit)
      for (const l of letters.slice(0, 10)) {
        for (const d of digits) {
          const pair = l + d;
          results.push(pair.repeat(repeats));
        }
      }
    }
  }

  // Sequential digits: 1234, 2345, 4567, 6789, etc + reverse
  if (mode === "sequential_digits" || mode === "all") {
    for (let len = minLength; len <= maxLength; len++) {
      // Ascending sequences
      for (let start = 0; start <= 9 - len; start++) {
        let seq = "";
        for (let i = 0; i < len; i++) {
          seq += (start + i).toString();
        }
        results.push(seq);
      }
      // Descending sequences
      for (let start = 9; start >= len - 1; start--) {
        let seq = "";
        for (let i = 0; i < len; i++) {
          seq += (start - i).toString();
        }
        // avoid duplicates with ascending
        if (!results.includes(seq)) {
          results.push(seq);
        }
      }
    }
  }

  // Palindromes: 1221, abba, 12321, etc
  if (mode === "palindrome" || mode === "all") {
    // digit palindromes
    for (let len = minLength; len <= maxLength; len++) {
      const halfLen = Math.ceil(len / 2);
      // Generate a limited set of palindromes
      for (let i = 0; i < 50; i++) {
        let half = "";
        for (let j = 0; j < halfLen; j++) {
          half += allChars[Math.floor(Math.random() * allChars.length)];
        }
        const reversed = half.split("").reverse().join("");
        const palindrome = len % 2 === 0
          ? half + reversed
          : half + reversed.slice(1);
        if (palindrome.length === len && !results.includes(palindrome)) {
          results.push(palindrome);
        }
      }
    }
  }

  // Prefix + repeating: a666, x999, b111
  if (mode === "prefix_repeat" || mode === "all") {
    for (let len = minLength; len <= maxLength; len++) {
      if (len < 4) continue;
      const repeatLen = len - 1;
      for (const prefix of allChars) {
        for (const d of digits) {
          const id = prefix + d.repeat(repeatLen);
          if (!results.includes(id)) results.push(id);
        }
        for (const l of letters) {
          const id = prefix + l.repeat(repeatLen);
          if (prefix !== l && !results.includes(id)) results.push(id);
        }
      }
    }
  }

  // Suffix + repeating: 666a, 999x, 111b
  if (mode === "suffix_repeat" || mode === "all") {
    for (let len = minLength; len <= maxLength; len++) {
      if (len < 4) continue;
      const repeatLen = len - 1;
      for (const suffix of allChars) {
        for (const d of digits) {
          const id = d.repeat(repeatLen) + suffix;
          if (!results.includes(id)) results.push(id);
        }
        for (const l of letters) {
          const id = l.repeat(repeatLen) + suffix;
          if (suffix !== l && !results.includes(id)) results.push(id);
        }
      }
    }
  }

  // Deduplicate
  const unique = [...new Set(results)];

  // Apply pagination
  return unique.slice(offset, offset + limit);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      mode = "same_digit" as RepeatingMode,
      minLength = 3,
      maxLength = 6,
      offset = 0,
      limit = 15,
    } = body;

    if (minLength < 3 || maxLength > 12 || minLength > maxLength) {
      return NextResponse.json(
        { error: "Invalid length parameters" },
        { status: 400 }
      );
    }

    if (limit < 1 || limit > 30) {
      return NextResponse.json(
        { error: "Limit must be 1-30" },
        { status: 400 }
      );
    }

    // Create session
    const [session] = await db
      .insert(searchSessions)
      .values({
        minLength,
        maxLength,
        charset: "repeating",
        pattern: mode,
        status: "running",
        totalChecked: 0,
        totalAvailable: 0,
      })
      .returning();

    // Generate candidates
    const candidates = generateRepeatingIds(mode, minLength, maxLength, offset, limit);

    const results: {
      vanityUrl: string;
      status: SteamIdStatus;
      steamId64?: string;
      reason?: string;
      error?: string;
    }[] = [];

    let availableCount = 0;

    for (const candidate of candidates) {
      // Check cache
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
          error: "Ошибка проверки",
        });
      }

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

    // Count total generated to enable pagination
    const totalGenerated = generateRepeatingIds(mode, minLength, maxLength, 0, 99999).length;

    return NextResponse.json({
      sessionId: session.id,
      results,
      totalChecked: candidates.length,
      totalAvailable: availableCount,
      totalGenerated,
      hasMore: offset + limit < totalGenerated,
    });
  } catch (error) {
    console.error("Repeating check error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
