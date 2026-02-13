import { DexScreenerPair, TokenData } from "@/types/token";

// BNKR bot deployer addresses on Base
export const BANKR_DEPLOYERS = [
  "0x2112b8456AC07c15fA31ddf3Bf713E77716fF3F9",
  "0xdb034A1485dA0300175B07282F5a84AF69C2493e",
];

const DEXSCREENER_BASE = "https://api.dexscreener.com";
// Blockscout etherscan-compatible API for Base — free, no API key required
const BLOCKSCOUT_API = "https://base.blockscout.com/api";

// Well-known Base chain tokens to exclude — these are NOT BNKR-deployed tokens
const EXCLUDED_TOKENS = new Set([
  "0x4200000000000000000000000000000000000006", // WETH
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", // USDbC
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", // DAI
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22", // cbETH
  "0x940181a94a35a4569e4529a3cdfb74e38fd98631", // AERO
  "0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c", // rETH
  "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b", // BNKR token itself
  "0x1bc0c42215582d5a085795f4badbac3ff36d1bcb", // CLANKER
]);

interface TokenTxItem {
  contractAddress: string;
  tokenName: string;
  tokenSymbol: string;
  from: string;
  to: string;
}

/**
 * Discover tokens for a deployer by looking at ERC-20 token transfers.
 * Collects all unique token addresses the deployer interacted with,
 * excluding well-known infrastructure tokens (WETH, USDC, etc.).
 */
async function fetchTokensForDeployer(deployer: string): Promise<string[]> {
  const tokens = new Set<string>();
  const sampleTokens: string[] = []; // Log first few for debugging

  for (let page = 1; page <= 20; page++) {
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

      // Log first page's first 3 raw transfers for debugging
      if (page === 1) {
        for (const tx of data.result.slice(0, 3)) {
          console.log(`[Blockscout] Sample transfer: ${tx.tokenSymbol} (${tx.tokenName}) contract=${tx.contractAddress} from=${tx.from.slice(0, 10)}... to=${tx.to.slice(0, 10)}...`);
        }
      }

      for (const tx of data.result as TokenTxItem[]) {
        const addr = tx.contractAddress?.toLowerCase();
        if (addr && !EXCLUDED_TOKENS.has(addr)) {
          if (tokens.size < 5 && !tokens.has(addr)) {
            sampleTokens.push(`${tx.tokenSymbol}(${addr.slice(0, 10)}...)`);
          }
          tokens.add(addr);
        }
      }

      console.log(`[Blockscout] tokentx page ${page} for ${deployer.slice(0, 10)}...: ${data.result.length} transfers, ${tokens.size} unique tokens`);

      if (data.result.length < 1000) break;
    } catch (err) {
      console.error(`[Blockscout] tokentx fetch error for ${deployer}:`, err);
      break;
    }
  }

  console.log(`[Blockscout] ${deployer.slice(0, 10)}... found ${tokens.size} tokens. First few: ${sampleTokens.join(", ")}`);
  return Array.from(tokens);
}

/**
 * Fetch all token addresses associated with BNKR deployers.
 * Uses ERC-20 transfer history to discover tokens, excluding well-known tokens.
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
