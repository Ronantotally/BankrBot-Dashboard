import { NextResponse } from "next/server";
import { fetchDeployedTokens, fetchTokenMarketData, pairsToTokenData } from "@/lib/api";

export const revalidate = 60;

export async function GET() {
  try {
    const addresses = await fetchDeployedTokens();

    if (addresses.length === 0) {
      return NextResponse.json({ tokens: [], count: 0 });
    }

    const pairs = await fetchTokenMarketData(addresses);
    const tokens = pairsToTokenData(pairs);

    // Sort by creation time descending by default
    tokens.sort((a, b) => b.createdAt - a.createdAt);

    return NextResponse.json({
      tokens,
      count: tokens.length,
      deployedContracts: addresses.length,
      lastUpdated: Date.now(),
    });
  } catch (error) {
    console.error("API route error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to fetch token data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
