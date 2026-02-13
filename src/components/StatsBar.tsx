"use client";

import { TokenData } from "@/types/token";
import { formatUsd, formatNumber } from "@/lib/format";

interface StatsBarProps {
  tokens: TokenData[];
  lastUpdated: number | null;
}

export default function StatsBar({ tokens, lastUpdated }: StatsBarProps) {
  const totalMarketCap = tokens.reduce((sum, t) => sum + t.marketCap, 0);
  const totalVolume24h = tokens.reduce((sum, t) => sum + t.volume24h, 0);
  const totalLiquidity = tokens.reduce((sum, t) => sum + t.liquidity, 0);

  const stats = [
    { label: "Tokens Tracked", value: formatNumber(tokens.length) },
    { label: "Total Market Cap", value: formatUsd(totalMarketCap) },
    { label: "24h Volume", value: formatUsd(totalVolume24h) },
    { label: "Total Liquidity", value: formatUsd(totalLiquidity) },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-3"
        >
          <div className="text-xs text-zinc-500 mb-1">{stat.label}</div>
          <div className="text-lg font-semibold text-white font-mono">
            {stat.value}
          </div>
        </div>
      ))}
      {lastUpdated && (
        <div className="col-span-2 lg:col-span-4 text-xs text-zinc-600 text-right">
          Last updated: {new Date(lastUpdated).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
