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
    return NextResponse.json(
      { error: "Failed to fetch token data" },
      { status: 500 }
    );
  }
}
