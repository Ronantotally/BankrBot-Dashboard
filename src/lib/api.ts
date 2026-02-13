import { DexScreenerPair, TokenData } from "@/types/token";

// BNKR bot deployer addresses on Base
export const BANKR_DEPLOYERS = [
  "0x2112b8456AC07c15fA31ddf3Bf713E77716fF3F9",
  "0xdb034A1485dA0300175B07282F5a84AF69C2493e",
];

const DEXSCREENER_BASE = "https://api.dexscreener.com";
// Blockscout etherscan-compatible API for Base — free, no API key required
const BLOCKSCOUT_API = "https://base.blockscout.com/api";

interface TokenTxItem {
  contractAddress: string;
  from: string;
  to: string;
}

/**
 * Discover tokens for a deployer by looking at ERC-20 token transfers.
 * When a factory creates a token and mints the initial supply to the deployer,
 * it appears as a token transfer event — so we can extract unique token addresses.
 */
async function fetchTokensForDeployer(deployer: string): Promise<string[]> {
  const tokens = new Set<string>();

  for (let page = 1; page <= 10; page++) {
    const url = `${BLOCKSCOUT_API}?module=account&action=tokentx&address=${deployer}&page=${page}&offset=1000&sort=desc`;

    try {
      const res: Response = await fetch(url, { cache: "no-store" });

      if (!res.ok) {
        console.error(`[Blockscout] tokentx error for ${deployer}: HTTP ${res.status}`);
        break;
      }

      const data = await res.json();

      if (data.status !== "1" || !Array.isArray(data.result)) {
        console.log(`[Blockscout] tokentx: ${data.message ?? "no results"} for ${deployer.slice(0, 10)}... (page ${page})`);
        break;
      }

      for (const tx of data.result as TokenTxItem[]) {
        if (tx.contractAddress) {
          tokens.add(tx.contractAddress.toLowerCase());
        }
      }

      console.log(`[Blockscout] tokentx page ${page} for ${deployer.slice(0, 10)}...: ${data.result.length} transfers, ${tokens.size} unique tokens`);

      // If we got fewer than the offset, there are no more pages
      if (data.result.length < 1000) break;
    } catch (err) {
      console.error(`[Blockscout] tokentx fetch error for ${deployer}:`, err);
      break;
    }
  }

  return Array.from(tokens);
}

/**
 * Fetch all token addresses associated with BNKR deployers.
 * Uses ERC-20 transfer history to discover tokens — this works with factory-deployed
 * tokens since the initial mint is a transfer event to the deployer.
 */
export async function fetchDeployedTokens(): Promise<string[]> {
  const allTokens = new Set<string>();

  const results = await Promise.all(
    BANKR_DEPLOYERS.map((deployer) => fetchTokensForDeployer(deployer))
  );

  for (const tokens of results) {
    for (const addr of tokens) {
      allTokens.add(addr);
    }
  }

  console.log(`[Blockscout] Total unique token addresses: ${allTokens.size}`);
  return Array.from(allTokens);
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
