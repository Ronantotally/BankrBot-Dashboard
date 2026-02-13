import { DexScreenerPair, TokenData } from "@/types/token";

// BNKR bot deployer addresses on Base
export const BANKR_DEPLOYERS = [
  "0x2112b8456AC07c15fA31ddf3Bf713E77716fF3F9",
  "0xdb034A1485dA0300175B07282F5a84AF69C2493e",
];

const DEXSCREENER_BASE = "https://api.dexscreener.com";
const BLOCKSCOUT_API = "https://base.blockscout.com/api";
const CLANKER_API = "https://www.clanker.world/api";

// Known Clanker factory contract addresses on Base (all versions)
const CLANKER_FACTORIES = new Set([
  "0xe85a59c628f7d27878aceb4bf3b35733630083a9", // Clanker v4.0.0
  "0x375c15db32d28cecdcab5c03ab889bf15cbd2c5e", // v3
  "0x732560fa1d1a76350b1a500155ba978031b53833", // v2
  "0x9b84fce5dcd9a38d2d01d5d72373f6b6b067c3e1", // v1
  "0x250c9fb2b411b48273f69879007803790a6aea47", // v0 SocialDexDeployer
]);

const MAX_FACTORY_TXS = 200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Strategy 1: Clanker Public API ───────────────────────────────────────────
// Fast, no rate-limit issues. Returns Clanker-deployed tokens for an address.

async function fetchTokensFromClankerAPI(
  deployer: string
): Promise<string[]> {
  const url = `${CLANKER_API}/tokens/fetch-deployed-by-address?address=${deployer}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.log(
        `[Clanker API] HTTP ${res.status} for ${deployer.slice(0, 10)}...`
      );
      return [];
    }

    const data = await res.json();

    // Log a preview of the response shape to aid debugging
    const preview = JSON.stringify(data).slice(0, 300);
    console.log(
      `[Clanker API] Response for ${deployer.slice(0, 10)}...: ${preview}`
    );

    // Handle various possible response shapes
    const items = Array.isArray(data)
      ? data
      : (data.tokens ?? data.data ?? data.result ?? data.items ?? []);

    if (!Array.isArray(items)) {
      console.log(`[Clanker API] Unexpected response type: ${typeof items}`);
      return [];
    }

    const tokens: string[] = [];
    for (const item of items) {
      const addr =
        item.contract_address ??
        item.contractAddress ??
        item.ca ??
        item.address ??
        item.token_address;
      if (addr && typeof addr === "string") {
        tokens.push(addr.toLowerCase());
      }
    }

    console.log(
      `[Clanker API] Found ${tokens.length} tokens for ${deployer.slice(0, 10)}...`
    );
    return tokens;
  } catch (err) {
    console.error(
      `[Clanker API] Error for ${deployer.slice(0, 10)}...:`,
      err
    );
    return [];
  }
}

// ─── Strategy 2: On-chain discovery via Blockscout ────────────────────────────
// Catches both Clanker and non-Clanker tokens by dynamically discovering
// factory contracts the deployer interacts with.

interface TxListItem {
  hash: string;
  to: string;
  from: string;
  input: string;
  isError: string;
  txreceipt_status: string;
  contractAddress?: string;
}

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
        if (logDetail)
          console.log(`[OnChain] txlistinternal 429, waiting ${wait}ms...`);
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        if (logDetail)
          console.log(
            `[OnChain] txlistinternal HTTP ${res.status} for ${txHash.slice(0, 12)}...`
          );
        return null;
      }

      const data = await res.json();

      if (logDetail) {
        console.log(
          `[OnChain] txlistinternal: status=${data.status} count=${Array.isArray(data.result) ? data.result.length : "N/A"}`
        );
        if (Array.isArray(data.result) && data.result.length > 0) {
          const first = data.result[0];
          console.log(
            `[OnChain] Internal tx keys: ${Object.keys(first).join(", ")}`
          );
          console.log(
            `[OnChain] Internal tx: type=${first.type} contractAddress=${first.contractAddress} from=${first.from?.slice(0, 12)} to=${first.to?.slice(0, 12)}`
          );
        }
      }

      if (data.status !== "1" || !Array.isArray(data.result)) return null;

      for (const itx of data.result) {
        if (itx.contractAddress) {
          return itx.contractAddress.toLowerCase();
        }
      }

      return null;
    } catch (err) {
      if (logDetail) console.error(`[OnChain] txlistinternal error:`, err);
      await sleep(1000);
    }
  }

  return null;
}

/**
 * On-chain discovery with dynamic factory detection.
 *
 * 1. Fetch deployer txs (first 2 pages = up to 2000 txs)
 * 2. Collect direct contract creations (to="" with contractAddress)
 * 3. Identify top called contracts
 * 4. Probe top contracts to discover factories dynamically
 * 5. Process factory txs to extract created token addresses
 */
async function fetchTokensOnChain(deployer: string): Promise<string[]> {
  const directCreations: string[] = [];
  const txsByContract = new Map<string, TxListItem[]>();

  // Phase 1: Collect transactions (limit to 2 pages to stay within timeout)
  for (let page = 1; page <= 2; page++) {
    const url = `${BLOCKSCOUT_API}?module=account&action=txlist&address=${deployer}&page=${page}&offset=1000&sort=desc`;

    try {
      const res: Response = await fetch(url, { cache: "no-store" });

      if (res.status === 429) {
        console.log(`[OnChain] Rate limited on txlist page ${page}, waiting 3s...`);
        await sleep(3000);
        continue;
      }

      if (!res.ok) {
        console.error(`[OnChain] txlist HTTP ${res.status} for ${deployer.slice(0, 10)}...`);
        break;
      }

      const data = await res.json();
      if (data.status !== "1" || !Array.isArray(data.result) || data.result.length === 0) {
        if (page === 1)
          console.log(`[OnChain] txlist: ${data.message ?? "no results"} for ${deployer.slice(0, 10)}...`);
        break;
      }

      let directCount = 0;
      let contractCallCount = 0;

      for (const tx of data.result as TxListItem[]) {
        if (tx.from.toLowerCase() !== deployer.toLowerCase()) continue;
        if (tx.txreceipt_status !== "1") continue;

        // Direct contract creation (to is empty)
        if ((!tx.to || tx.to === "") && tx.contractAddress) {
          directCreations.push(tx.contractAddress.toLowerCase());
          directCount++;
          continue;
        }

        if (!tx.to) continue;

        // Contract call (has input data)
        if (tx.input && tx.input.length > 10) {
          const toLower = tx.to.toLowerCase();
          if (!txsByContract.has(toLower))
            txsByContract.set(toLower, []);
          txsByContract.get(toLower)!.push(tx);
          contractCallCount++;
        }
      }

      console.log(
        `[OnChain] Page ${page}: ${data.result.length} txs, ${directCount} direct creations, ${contractCallCount} contract calls`
      );

      if (data.result.length < 1000) break;
      await sleep(300);
    } catch (err) {
      console.error(`[OnChain] txlist fetch error:`, err);
      break;
    }
  }

  // Phase 2: Log top called contracts for diagnostics
  const topContracts = [...txsByContract.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10);

  console.log(
    `[OnChain] ${deployer.slice(0, 10)}... top contracts: ${topContracts.map(([addr, txs]) => `${addr}(${txs.length}x)`).join(", ")}`
  );
  console.log(
    `[OnChain] ${deployer.slice(0, 10)}... direct creations: ${directCreations.length}`
  );

  // Phase 3: Dynamic factory discovery — probe top contracts
  const discoveredFactories = new Set<string>([...CLANKER_FACTORIES]);

  for (const [contractAddr, txs] of topContracts.slice(0, 5)) {
    if (discoveredFactories.has(contractAddr)) {
      console.log(`[OnChain] ${contractAddr.slice(0, 12)}... already known factory (${txs.length} txs)`);
      continue;
    }

    // Sample 2 txs to check if this contract produces token creations
    let isFactory = false;
    for (const tx of txs.slice(0, 2)) {
      const token = await getCreatedTokenFromTx(tx.hash, true);
      if (token) {
        isFactory = true;
        break;
      }
      await sleep(500);
    }

    if (isFactory) {
      discoveredFactories.add(contractAddr);
      console.log(
        `[OnChain] DISCOVERED factory: ${contractAddr} (${txs.length} txs)`
      );
    } else {
      console.log(
        `[OnChain] ${contractAddr.slice(0, 12)}... NOT a factory (${txs.length} txs)`
      );
    }
    await sleep(500);
  }

  // Phase 4: Process all factory txs to extract token addresses
  const factoryHashes: string[] = [];
  for (const [contractAddr, txs] of txsByContract) {
    if (discoveredFactories.has(contractAddr)) {
      factoryHashes.push(...txs.map((t) => t.hash));
    }
  }

  // Cap at MAX_FACTORY_TXS
  const hashesToProcess = factoryHashes.slice(0, MAX_FACTORY_TXS);
  console.log(
    `[OnChain] Factory txs to process: ${hashesToProcess.length} (from ${factoryHashes.length} total)`
  );

  const tokens = new Set(directCreations);
  const BATCH_SIZE = 5;

  for (let i = 0; i < hashesToProcess.length; i += BATCH_SIZE) {
    const batch = hashesToProcess.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((h) => getCreatedTokenFromTx(h, false))
    );

    for (const addr of results) {
      if (addr) tokens.add(addr);
    }

    if ((i + BATCH_SIZE) % 50 === 0 || i + BATCH_SIZE >= hashesToProcess.length) {
      console.log(
        `[OnChain] Processed ${Math.min(i + BATCH_SIZE, hashesToProcess.length)}/${hashesToProcess.length} txs, found ${tokens.size} tokens`
      );
    }

    await sleep(500);
  }

  console.log(
    `[OnChain] ${deployer.slice(0, 10)}... total: ${tokens.size} tokens (${directCreations.length} direct + ${tokens.size - directCreations.length} factory)`
  );
  return [...tokens];
}

// ─── Main Discovery Pipeline ──────────────────────────────────────────────────

export async function fetchDeployedTokens(): Promise<string[]> {
  const allTokens = new Set<string>();

  // Strategy 1: Clanker API (fast, no rate limits)
  console.log("[Discovery] Starting Strategy 1: Clanker API");
  for (const deployer of BANKR_DEPLOYERS) {
    const tokens = await fetchTokensFromClankerAPI(deployer);
    for (const t of tokens) allTokens.add(t);
  }
  console.log(`[Discovery] Clanker API total: ${allTokens.size} tokens`);

  // Strategy 2: On-chain discovery (catches non-Clanker tokens)
  // Always run — BNKR may deploy tokens outside Clanker
  console.log("[Discovery] Starting Strategy 2: On-chain discovery");
  for (const deployer of BANKR_DEPLOYERS) {
    const tokens = await fetchTokensOnChain(deployer);
    const newCount = tokens.filter((t) => !allTokens.has(t)).length;
    for (const t of tokens) allTokens.add(t);
    console.log(
      `[Discovery] On-chain ${deployer.slice(0, 10)}...: ${tokens.length} tokens (${newCount} new)`
    );
  }

  console.log(`[Discovery] Grand total: ${allTokens.size} unique tokens`);
  return [...allTokens];
}

// ─── Market Data ──────────────────────────────────────────────────────────────

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

export async function fetchAllTokenData(): Promise<TokenData[]> {
  const addresses = await fetchDeployedTokens();
  if (addresses.length === 0) return [];

  const pairs = await fetchTokenMarketData(addresses);
  return pairsToTokenData(pairs);
}
