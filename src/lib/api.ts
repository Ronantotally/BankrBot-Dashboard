import { DexScreenerPair, TokenData } from "@/types/token";

// BNKR bot deployer address on Base
// Update this if the deployer address changes
export const BANKR_DEPLOYER = "0x2112b8456AC07c15fA31ddf3Bf713E77716fF3F9";

const DEXSCREENER_BASE = "https://api.dexscreener.com";
const BASESCAN_BASE = "https://api.basescan.org/api";
const BASESCAN_API_KEY = process.env.BASESCAN_API_KEY ?? "";

/**
 * Fetch token contract creation transactions from the BNKR deployer via BaseScan.
 * Returns a list of contract addresses created by the deployer.
 */
export async function fetchDeployedTokens(): Promise<string[]> {
  // Get internal transactions (contract creations) from the deployer
  const apiKeyParam = BASESCAN_API_KEY ? `&apikey=${BASESCAN_API_KEY}` : "";
  const url = `${BASESCAN_BASE}?module=account&action=txlist&address=${BANKR_DEPLOYER}&startblock=0&endblock=99999999&sort=desc${apiKeyParam}`;

  const res = await fetch(url, { next: { revalidate: 120 } });
  const data = await res.json();

  if (data.status !== "1" || !Array.isArray(data.result)) {
    const msg = data.message || data.result || "Unknown error";
    console.error("[BaseScan] txlist error:", msg, "| API key present:", !!BASESCAN_API_KEY);
    throw new Error(`BaseScan API error: ${msg}`);
  }

  console.log(`[BaseScan] txlist returned ${data.result.length} transactions`);

  // Filter for contract creation transactions (to address is empty)
  // and successful transactions
  const contractAddresses: string[] = [];
  for (const tx of data.result) {
    if (tx.isError === "0" && tx.contractAddress && tx.contractAddress !== "") {
      contractAddresses.push(tx.contractAddress);
    }
  }
  console.log(`[BaseScan] Found ${contractAddresses.length} direct contract creations`);

  // Also try internal txns which capture CREATE/CREATE2 opcodes
  const internalUrl = `${BASESCAN_BASE}?module=account&action=txlistinternal&address=${BANKR_DEPLOYER}&startblock=0&endblock=99999999&sort=desc${apiKeyParam}`;

  try {
    const internalRes = await fetch(internalUrl, { next: { revalidate: 120 } });
    const internalData = await internalRes.json();

    if (internalData.status === "1" && Array.isArray(internalData.result)) {
      let internalCreates = 0;
      for (const tx of internalData.result) {
        if (
          tx.type === "create" ||
          tx.type === "create2" ||
          (tx.contractAddress && tx.contractAddress !== "")
        ) {
          const addr = tx.contractAddress;
          if (addr && !contractAddresses.includes(addr)) {
            contractAddresses.push(addr);
            internalCreates++;
          }
        }
      }
      console.log(`[BaseScan] Internal txns: ${internalData.result.length} total, ${internalCreates} new contract creations`);
    } else {
      console.warn("[BaseScan] Internal txns returned no results:", internalData.message || internalData.result);
    }
  } catch (err) {
    console.warn("[BaseScan] Internal txns fetch failed:", err);
  }

  return contractAddresses;
}

/**
 * Fetch market data for tokens from DEX Screener.
 * Batches requests in groups of 30 (API limit per call).
 */
export async function fetchTokenMarketData(
  tokenAddresses: string[]
): Promise<DexScreenerPair[]> {
  if (tokenAddresses.length === 0) return [];

  const pairs: DexScreenerPair[] = [];
  const batchSize = 30;

  for (let i = 0; i < tokenAddresses.length; i += batchSize) {
    const batch = tokenAddresses.slice(i, i + batchSize);
    const addresses = batch.join(",");
    const url = `${DEXSCREENER_BASE}/tokens/v1/base/${addresses}`;

    try {
      const res = await fetch(url, { next: { revalidate: 60 } });
      const data = await res.json();

      if (Array.isArray(data)) {
        pairs.push(...data);
      }
    } catch (err) {
      console.error("DEX Screener fetch error:", err);
    }
  }

  return pairs;
}

/**
 * Convert DEX Screener pairs to our TokenData format.
 * Picks the highest-liquidity pair for each token.
 */
export function pairsToTokenData(pairs: DexScreenerPair[]): TokenData[] {
  // Group pairs by base token address
  const tokenMap = new Map<string, DexScreenerPair[]>();

  for (const pair of pairs) {
    const addr = pair.baseToken.address.toLowerCase();
    if (!tokenMap.has(addr)) {
      tokenMap.set(addr, []);
    }
    tokenMap.get(addr)!.push(pair);
  }

  // For each token, pick the pair with highest liquidity
  const tokens: TokenData[] = [];

  for (const [, tokenPairs] of tokenMap) {
    const bestPair = tokenPairs.reduce((best, current) =>
      (current.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0)
        ? current
        : best
    );

    tokens.push({
      address: bestPair.baseToken.address,
      name: bestPair.baseToken.name,
      symbol: bestPair.baseToken.symbol,
      imageUrl: bestPair.info?.imageUrl,
      priceUsd: bestPair.priceUsd ?? "0",
      marketCap: bestPair.marketCap ?? bestPair.fdv ?? 0,
      fdv: bestPair.fdv ?? 0,
      volume24h: bestPair.volume?.h24 ?? 0,
      volumeH1: bestPair.volume?.h1 ?? 0,
      liquidity: bestPair.liquidity?.usd ?? 0,
      priceChange24h: bestPair.priceChange?.h24 ?? 0,
      priceChangeH1: bestPair.priceChange?.h1 ?? 0,
      txns24h:
        (bestPair.txns?.h24?.buys ?? 0) + (bestPair.txns?.h24?.sells ?? 0),
      buys24h: bestPair.txns?.h24?.buys ?? 0,
      sells24h: bestPair.txns?.h24?.sells ?? 0,
      pairAddress: bestPair.pairAddress,
      pairUrl: bestPair.url,
      createdAt: bestPair.pairCreatedAt ?? 0,
      dexId: bestPair.dexId,
    });
  }

  return tokens;
}

/**
 * Full pipeline: fetch deployed tokens, get market data, return merged results.
 */
export async function fetchAllTokenData(): Promise<TokenData[]> {
  const addresses = await fetchDeployedTokens();
  if (addresses.length === 0) return [];

  const pairs = await fetchTokenMarketData(addresses);
  return pairsToTokenData(pairs);
}
