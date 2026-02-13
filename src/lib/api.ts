import { DexScreenerPair, TokenData } from "@/types/token";

// BNKR bot deployer addresses on Base
export const BANKR_DEPLOYERS = [
  "0x2112b8456AC07c15fA31ddf3Bf713E77716fF3F9",
  "0xdb034A1485dA0300175B07282F5a84AF69C2493e",
];

const DEXSCREENER_BASE = "https://api.dexscreener.com";
// Blockscout etherscan-compatible API for Base — free, no API key required
const BLOCKSCOUT_API = "https://base.blockscout.com/api";

// Known Clanker factory contract addresses on Base (all versions)
const CLANKER_FACTORIES = new Set([
  "0xeb9d2a726edffc887a574dc7f46b3a3638e8e44f", // Clanker v4
  "0xe85a59c628f7d27878aceb4bf3b35733630083a9", // Clanker v4 alt
  "0x375c15db32d28cecdcab5c03ab889bf15cbd2c5e", // v3
  "0x732560fa1d1a76350b1a500155ba978031b53833", // v2
  "0x9b84fce5dcd9a38d2d01d5d72373f6b6b067c3e1", // v1
  "0x250c9fb2b411b48273f69879007803790a6aea47", // v0 SocialDexDeployer
]);

interface TxListItem {
  hash: string;
  to: string;
  from: string;
  input: string;
  isError: string;
  txreceipt_status: string;
}

interface InternalTxItem {
  type: string;
  contractAddress: string;
}

/**
 * Step 1: Get transaction hashes where the deployer called a token factory.
 * Also logs the top called contracts for diagnostics (helps identify unknown factories).
 */
async function getFactoryTxHashes(deployer: string): Promise<string[]> {
  const factoryHashes: string[] = [];
  const contractCallCounts = new Map<string, number>();

  for (let page = 1; page <= 50; page++) {
    const url = `${BLOCKSCOUT_API}?module=account&action=txlist&address=${deployer}&page=${page}&offset=1000&sort=desc`;

    try {
      const res: Response = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        console.error(`[Discovery] txlist error for ${deployer}: HTTP ${res.status}`);
        break;
      }

      const data = await res.json();
      if (data.status !== "1" || !Array.isArray(data.result) || data.result.length === 0) {
        if (page === 1) console.log(`[Discovery] txlist: ${data.message ?? "no results"} for ${deployer.slice(0, 10)}...`);
        break;
      }

      for (const tx of data.result as TxListItem[]) {
        if (tx.from.toLowerCase() !== deployer.toLowerCase()) continue;
        if (tx.txreceipt_status !== "1") continue;
        if (!tx.to) continue;

        const toLower = tx.to.toLowerCase();

        // Track all contract calls for diagnostics
        if (tx.input && tx.input.length > 10) {
          contractCallCounts.set(toLower, (contractCallCounts.get(toLower) ?? 0) + 1);
        }

        // Check if this is a call to a known Clanker factory
        if (CLANKER_FACTORIES.has(toLower)) {
          factoryHashes.push(tx.hash);
        }
      }

      console.log(`[Discovery] txlist page ${page} for ${deployer.slice(0, 10)}...: ${data.result.length} txs, ${factoryHashes.length} factory calls`);
      if (data.result.length < 1000) break;
    } catch (err) {
      console.error(`[Discovery] txlist fetch error:`, err);
      break;
    }
  }

  // Log top 5 called contracts for diagnostics — helps identify unknown factories
  const topContracts = [...contractCallCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  console.log(`[Discovery] ${deployer.slice(0, 10)}... top called contracts: ${topContracts.map(([addr, count]) => `${addr.slice(0, 12)}...(${count}x)`).join(", ")}`);
  console.log(`[Discovery] ${deployer.slice(0, 10)}... found ${factoryHashes.length} known factory calls`);

  return factoryHashes;
}

/**
 * Step 2: For a transaction hash, find the token contract created in its internal transactions.
 */
async function getCreatedTokenFromTx(txHash: string): Promise<string | null> {
  const url = `${BLOCKSCOUT_API}?module=account&action=txlistinternal&txhash=${txHash}`;

  try {
    const res: Response = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;

    const data = await res.json();
    if (data.status !== "1" || !Array.isArray(data.result)) return null;

    for (const itx of data.result as InternalTxItem[]) {
      if ((itx.type === "create" || itx.type === "create2") && itx.contractAddress) {
        return itx.contractAddress.toLowerCase();
      }
    }
  } catch {
    // Silently skip failed lookups
  }

  return null;
}

/**
 * Discover BNKR-deployed tokens by tracing deployer → Clanker factory → created contracts.
 *
 * Flow: BNKR deployer calls Clanker factory's deployToken() → factory creates token contract
 * (via internal CREATE/CREATE2 transaction) → we extract the created contract address.
 */
export async function fetchDeployedTokens(): Promise<string[]> {
  // Step 1: Get factory call tx hashes from both deployers in parallel
  const txHashArrays = await Promise.all(
    BANKR_DEPLOYERS.map((d) => getFactoryTxHashes(d))
  );

  const allHashes = txHashArrays.flat();
  console.log(`[Discovery] Total factory transactions across all deployers: ${allHashes.length}`);

  if (allHashes.length === 0) {
    console.log(`[Discovery] No factory calls found — check deployer addresses and factory list`);
    return [];
  }

  // Step 2: For each factory tx, find the created token contract
  // Process in batches of 10 to avoid rate limiting
  const tokens = new Set<string>();
  const BATCH_SIZE = 10;

  for (let i = 0; i < allHashes.length; i += BATCH_SIZE) {
    const batch = allHashes.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((h) => getCreatedTokenFromTx(h)));

    for (const addr of results) {
      if (addr) tokens.add(addr);
    }

    if (i % 50 === 0 && i > 0) {
      console.log(`[Discovery] Processed ${i}/${allHashes.length} txs, found ${tokens.size} tokens so far`);
    }
  }

  console.log(`[Discovery] Found ${tokens.size} unique deployed tokens from ${allHashes.length} factory transactions`);
  return Array.from(tokens);
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
