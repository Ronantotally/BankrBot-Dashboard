import { NextResponse } from "next/server";
import { fetchDeployedTokens, fetchTokenMarketData, pairsToTokenData } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const hasApiKey = !!process.env.BASESCAN_API_KEY;

  try {
    if (!hasApiKey) {
      console.warn("[tokens] BASESCAN_API_KEY is not set — requests will be rate-limited");
    }

    const addresses = await fetchDeployedTokens();
    console.log(`[tokens] Found ${addresses.length} deployed contracts`);

    if (addresses.length === 0) {
      return NextResponse.json({
        tokens: [],
        count: 0,
        deployedContracts: 0,
        lastUpdated: Date.now(),
        hasApiKey,
      });
    }

    const pairs = await fetchTokenMarketData(addresses);
    const tokens = pairsToTokenData(pairs);
    console.log(`[tokens] ${addresses.length} contracts → ${pairs.length} pairs → ${tokens.length} tokens`);

    // Sort by creation time descending by default
    tokens.sort((a, b) => b.createdAt - a.createdAt);

    return NextResponse.json({
      tokens,
      count: tokens.length,
      deployedContracts: addresses.length,
      lastUpdated: Date.now(),
      hasApiKey,
    });
  } catch (error) {
    console.error("[tokens] API route error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to fetch token data";
    return NextResponse.json(
      { error: message, hasApiKey },
      { status: 500 }
    );
  }
}
