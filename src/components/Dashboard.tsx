"use client";

import { useState, useEffect, useCallback } from "react";
import { TokenData } from "@/types/token";
import TokenTable from "./TokenTable";
import StatsBar from "./StatsBar";

interface ApiResponse {
  tokens: TokenData[];
  count: number;
  deployedContracts: number;
  lastUpdated: number;
}

export default function Dashboard() {
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    setError(null);

    try {
      const res = await fetch("/api/tokens");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: ApiResponse = await res.json();
      setTokens(data.tokens);
      setLastUpdated(data.lastUpdated);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch token data"
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    // Auto-refresh every 2 minutes
    const interval = setInterval(() => fetchData(true), 120_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-black/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-sm">
              B
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">
                BNKR Token Dashboard
              </h1>
              <p className="text-xs text-zinc-500">
                Tracking tokens launched on Base via BNKR Bot
              </p>
            </div>
          </div>
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className={`flex items-center gap-2 px-4 py-2 text-sm rounded-lg border transition-all ${
              refreshing
                ? "border-zinc-700 text-zinc-500 cursor-not-allowed"
                : "border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white"
            }`}
          >
            <svg
              className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-zinc-400 text-sm">
              Loading tokens from BNKR deployer...
            </p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-6 py-4">
              Error: {error}
            </div>
            <button
              onClick={() => fetchData()}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <StatsBar tokens={tokens} lastUpdated={lastUpdated} />
            <TokenTable tokens={tokens} />
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 py-4 mt-8">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 text-center text-xs text-zinc-600">
          Data from BaseScan & DEX Screener. Deployer:{" "}
          <a
            href="https://basescan.org/address/0x2112b8456AC07c15fA31ddf3Bf713E77716fF3F9"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-500 hover:text-zinc-300 font-mono"
          >
            0x2112...F3F9
          </a>
        </div>
      </footer>
    </div>
  );
}
