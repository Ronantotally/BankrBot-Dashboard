import { DexScreenerPair, TokenData } from "@/types/token";

// BNKR bot deployer addresses on Base
export const BANKR_DEPLOYERS = [
  "0x2112b8456AC07c15fA31ddf3Bf713E77716fF3F9",
  "0xdb034A1485dA0300175B07282F5a84AF69C2493e",
];

const DEXSCREENER_BASE = "https://api.dexscreener.com";
// Blockscout v2 REST API for Base — free, no API key required
const BLOCKSCOUT_V2 = "https://base.blockscout.com/api/v2";

interface BlockscoutInternalTx {
  type: string;
  created_contract?: {
    hash: string;
    name?: string;
  };
}

interface BlockscoutInternalTxResponse {
  items: BlockscoutInternalTx[];
  next_page_params: Record<string, string> | null;
}

/**
 * Fetch contract addresses created via internal transactions for a single deployer.
 * Uses Blockscout v2 REST API which tracks factory-created contracts.
 */
async function fetchContractsForDeployer(deployer: string): Promise<string[]> {
  const contracts: string[] = [];
  let nextUrl =
    `${BLOCKSCOUT_V2}/addresses/${deployer}/internal-transactions?filter=to%7Cfrom`;

  for (let page = 0; page < 20; page++) {
    const res: Response = await fetch(nextUrl, { cache: "no-store" });

    if (!res.ok) {
      console.error(`[Blockscout] Internal txns error for ${deployer}: HTTP ${res.status}`);
      break;
    }

    const data: BlockscoutInternalTxResponse = await res.json();

    for (const tx of data.items) {
      if (
        (tx.type === "create" || tx.type === "create2") &&
        tx.created_contract?.hash
      ) {
        contracts.push(tx.created_contract.hash);
      }
    }

    // Paginate if more results
    if (data.next_page_params) {
      const params = new URLSearchParams(data.next_page_params);
      nextUrl = `${BLOCKSCOUT_V2}/addresses/${deployer}/internal-transactions?${params}`;
    } else {
      break;
    }
  }

  console.log(`[Blockscout] ${deployer.slice(0, 10)}...: ${contracts.length} contracts from internal txns`);
  return contracts;
}

/**
 * Also check regular transactions for direct contract creations.
 */
async function fetchDirectCreations(deployer: string): Promise<string[]> {
  const contracts: string[] = [];
  let nextUrl =
    `${BLOCKSCOUT_V2}/addresses/${deployer}/transactions?filter=to%7Cfrom`;

  for (let page = 0; page < 20; page++) {
    const res: Response = await fetch(nextUrl, { cache: "no-store" });

    if (!res.ok) break;

    const data = await res.json();

    for (const tx of data.items ?? []) {
      if (tx.created_contract?.hash) {
        contracts.push(tx.created_contract.hash);
      }
    }

    if (data.next_page_params) {
      const params = new URLSearchParams(data.next_page_params);
      nextUrl = `${BLOCKSCOUT_V2}/addresses/${deployer}/transactions?${params}`;
    } else {
      break;
    }
  }

  console.log(`[Blockscout] ${deployer.slice(0, 10)}...: ${contracts.length} contracts from direct txns`);
  return contracts;
}

/**
 * Fetch all contract addresses deployed by BNKR deployers.
 * Checks both direct contract creations and factory-pattern (internal) creations.
 */
export async function fetchDeployedTokens(): Promise<string[]> {
  const allContracts = new Set<string>();

  // Fetch from all deployer addresses in parallel
  const results = await Promise.all(
    BANKR_DEPLOYERS.flatMap((deployer) => [
      fetchContractsForDeployer(deployer),
      fetchDirectCreations(deployer),
    ])
  );

  for (const contracts of results) {
    for (const addr of contracts) {
      allContracts.add(addr.toLowerCase());
    }
  }

  console.log(`[Blockscout] Total unique contracts: ${allContracts.size}`);
  return Array.from(allContracts);
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
