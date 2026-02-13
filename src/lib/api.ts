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

// Max factory txs to process (avoids rate limiting and timeout)
const MAX_FACTORY_TXS = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TxListItem {
  hash: string;
  to: string;
  from: string;
  input: string;
  isError: string;
  txreceipt_status: string;
}

/**
 * Step 1: Get transaction hashes where the deployer called a token factory.
 * Includes rate limiting between pages to avoid 429 errors.
 * Also logs the top called contracts for diagnostics.
 */
async function getFactoryTxHashes(deployer: string): Promise<string[]> {
  const factoryHashes: string[] = [];
  const contractCallCounts = new Map<string, number>();

  for (let page = 1; page <= 50; page++) {
    const url = `${BLOCKSCOUT_API}?module=account&action=txlist&address=${deployer}&page=${page}&offset=1000&sort=desc`;

    try {
      const res: Response = await fetch(url, { cache: "no-store" });

      if (res.status === 429) {
        console.log(`[Discovery] Rate limited on txlist page ${page}, waiting 3s...`);
        await sleep(3000);
        continue;
      }

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

        if (tx.input && tx.input.length > 10) {
          contractCallCounts.set(toLower, (contractCallCounts.get(toLower) ?? 0) + 1);
        }

        if (CLANKER_FACTORIES.has(toLower)) {
          factoryHashes.push(tx.hash);
        }
      }

      console.log(`[Discovery] txlist page ${page} for ${deployer.slice(0, 10)}...: ${data.result.length} txs, ${factoryHashes.length} factory calls`);

      // Stop early if we have enough
      if (factoryHashes.length >= MAX_FACTORY_TXS) {
        console.log(`[Discovery] Reached ${MAX_FACTORY_TXS} factory tx limit, stopping txlist pagination`);
        break;
      }

      if (data.result.length < 1000) break;

      // Rate limit: wait between pages
      await sleep(300);
    } catch (err) {
      console.error(`[Discovery] txlist fetch error:`, err);
      break;
    }
  }

  // Log top 5 called contracts for diagnostics
  const topContracts = [...contractCallCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  console.log(`[Discovery] ${deployer.slice(0, 10)}... top contracts: ${topContracts.map(([addr, count]) => `${addr.slice(0, 12)}...(${count}x)`).join(", ")}`);
  console.log(`[Discovery] ${deployer.slice(0, 10)}... found ${factoryHashes.length} factory calls (capped at ${MAX_FACTORY_TXS})`);

  return factoryHashes.slice(0, MAX_FACTORY_TXS);
}

/**
 * Step 2: For a transaction hash, find the token contract created in its internal transactions.
 * Retries on 429 with exponential backoff.
 */
async function getCreatedTokenFromTx(
  txHash: string,
  logDetail: boolean
): Promise<string | null> {
  const url = `${BLOCKSCOUT_API}?module=account&action=txlistinternal&txhash=${txHash}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res: Response = await fetch(url, { cache: "no-store" });

      if (res.status === 429) {
        const wait = 2000 * (attempt + 1);
        if (logDetail) console.log(`[Discovery] txlistinternal 429, waiting ${wait}ms...`);
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        if (logDetail) console.log(`[Discovery] txlistinternal HTTP ${res.status} for ${txHash.slice(0, 12)}...`);
        return null;
      }

      const data = await res.json();

      // Log the first successful response in detail for debugging
      if (logDetail) {
        console.log(`[Discovery] FIRST txlistinternal: status=${data.status} message=${data.message} count=${Array.isArray(data.result) ? data.result.length : "N/A"}`);
        if (Array.isArray(data.result) && data.result.length > 0) {
          // Log first internal tx to see the actual field names and values
          const first = data.result[0];
          console.log(`[Discovery] FIRST internal tx keys: ${Object.keys(first).join(", ")}`);
          console.log(`[Discovery] FIRST internal tx: type=${first.type} contractAddress=${first.contractAddress} from=${first.from?.slice(0, 12)} to=${first.to?.slice(0, 12)}`);
        }
      }

      if (data.status !== "1" || !Array.isArray(data.result)) return null;

      // Look for contract creation — check contractAddress field regardless of type
      // (Blockscout may use different type names than Etherscan)
      for (const itx of data.result) {
        if (itx.contractAddress) {
          return itx.contractAddress.toLowerCase();
        }
      }

      return null;
    } catch (err) {
      if (logDetail) console.error(`[Discovery] txlistinternal error:`, err);
      await sleep(1000);
    }
  }

  return null;
}

/**
 * Discover BNKR-deployed tokens by tracing deployer → Clanker factory → created contracts.
 *
 * Flow: BNKR deployer calls Clanker factory's deployToken() → factory creates token contract
 * (via internal CREATE/CREATE2 transaction) → we extract the created contract address.
 *
 * Rate limited: 200ms between txlist pages, batches of 5 for txlistinternal with 500ms gaps.
 */
export async function fetchDeployedTokens(): Promise<string[]> {
  // Step 1: Get factory call tx hashes from both deployers (sequentially to avoid rate limits)
  const allHashes: string[] = [];

  for (const deployer of BANKR_DEPLOYERS) {
    const hashes = await getFactoryTxHashes(deployer);
    allHashes.push(...hashes);
  }

  console.log(`[Discovery] Total factory txs to process: ${allHashes.length}`);

  if (allHashes.length === 0) {
    console.log(`[Discovery] No factory calls found — check deployer addresses and factory list`);
    return [];
  }

  // Step 2: For each factory tx, find the created token contract
  // Process in small batches with delays to respect rate limits
  const tokens = new Set<string>();
  const BATCH_SIZE = 5;
  let firstCall = true;

  for (let i = 0; i < allHashes.length; i += BATCH_SIZE) {
    const batch = allHashes.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((h, idx) => {
        const shouldLog = firstCall && idx === 0;
        if (shouldLog) firstCall = false;
        return getCreatedTokenFromTx(h, shouldLog);
      })
    );

    for (const addr of results) {
      if (addr) tokens.add(addr);
    }

    // Log progress periodically
    if ((i + BATCH_SIZE) % 50 === 0 || i + BATCH_SIZE >= allHashes.length) {
      console.log(`[Discovery] Processed ${Math.min(i + BATCH_SIZE, allHashes.length)}/${allHashes.length} txs, found ${tokens.size} tokens`);
    }

    // Rate limit: wait between batches
    await sleep(500);
  }

  console.log(`[Discovery] Found ${tokens.size} unique deployed tokens from ${allHashes.length} factory txs`);
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
  const tokenMap = new Map<string, DexScreenerPair[]>();

  for (const pair of pairs) {
    const addr = pair.baseToken.address.toLowerCase();
    if (!tokenMap.has(addr)) {
      tokenMap.set(addr, []);
    }
    tokenMap.get(addr)!.push(pair);
  }

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
