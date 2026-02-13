"use client";

import { useState, useMemo, useCallback } from "react";
import Image from "next/image";
import { TokenData, SortField, SortDirection } from "@/types/token";
import {
  formatPrice,
  formatUsd,
  formatPercent,
  formatNumber,
  formatTimeAgo,
} from "@/lib/format";

const SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: "createdAt", label: "Newest" },
  { field: "marketCap", label: "Market Cap" },
  { field: "volume24h", label: "Volume (24h)" },
  { field: "liquidity", label: "Liquidity" },
  { field: "priceChange24h", label: "Price Change" },
  { field: "txns24h", label: "Transactions" },
];

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection;
}) {
  if (!active) {
    return (
      <svg
        className="w-3 h-3 opacity-30"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
        />
      </svg>
    );
  }
  return direction === "desc" ? (
    <svg
      className="w-3 h-3"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 9l-7 7-7-7"
      />
    </svg>
  ) : (
    <svg
      className="w-3 h-3"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 15l7-7 7 7"
      />
    </svg>
  );
}

function SortableHeader({
  field,
  sortField,
  sortDirection,
  onSort,
  children,
  className = "",
}: {
  field: SortField;
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-3 text-right text-xs font-medium text-zinc-400 uppercase tracking-wider cursor-pointer hover:text-white transition-colors select-none ${className}`}
      onClick={() => onSort(field)}
    >
      <div className="flex items-center justify-end gap-1">
        {children}
        <SortIcon active={sortField === field} direction={sortDirection} />
      </div>
    </th>
  );
}

interface TokenTableProps {
  tokens: TokenData[];
}

export default function TokenTable({ tokens }: TokenTableProps) {
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [search, setSearch] = useState("");

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDirection((d) => (d === "desc" ? "asc" : "desc"));
      } else {
        setSortField(field);
        setSortDirection("desc");
      }
    },
    [sortField]
  );

  const filteredAndSorted = useMemo(() => {
    let result = [...tokens];

    // Filter by search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.symbol.toLowerCase().includes(q) ||
          t.address.toLowerCase().includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      if (sortField === "priceUsd") {
        const diff = parseFloat(a.priceUsd) - parseFloat(b.priceUsd);
        return sortDirection === "desc" ? -diff : diff;
      }

      const aVal = a[sortField] as number;
      const bVal = b[sortField] as number;
      const diff = aVal - bVal;
      return sortDirection === "desc" ? -diff : diff;
    });

    return result;
  }, [tokens, sortField, sortDirection, search]);

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
        {/* Search */}
        <div className="relative w-full sm:w-80">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Search by name, symbol, or address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Quick Sort Buttons */}
        <div className="flex gap-2 flex-wrap">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.field}
              onClick={() => handleSort(opt.field)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
                sortField === opt.field
                  ? "bg-blue-600/20 border-blue-500/50 text-blue-400"
                  : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600"
              }`}
            >
              {opt.label}
              {sortField === opt.field && (
                <span className="ml-1">
                  {sortDirection === "desc" ? "\u2193" : "\u2191"}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      <div className="text-xs text-zinc-500 mb-3">
        Showing {filteredAndSorted.length} of {tokens.length} tokens
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full">
          <thead>
            <tr className="bg-zinc-900/50 border-b border-zinc-800">
              <th className="px-3 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider w-8">
                #
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Token
              </th>
              <SortableHeader
                field="priceUsd"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
                className="!text-right"
              >
                Price
              </SortableHeader>
              <SortableHeader
                field="marketCap"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
              >
                Market Cap
              </SortableHeader>
              <SortableHeader
                field="volume24h"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
              >
                Vol (24h)
              </SortableHeader>
              <SortableHeader
                field="liquidity"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
              >
                Liquidity
              </SortableHeader>
              <SortableHeader
                field="priceChange24h"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
              >
                24h %
              </SortableHeader>
              <SortableHeader
                field="txns24h"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
              >
                Txns (24h)
              </SortableHeader>
              <SortableHeader
                field="createdAt"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
              >
                Age
              </SortableHeader>
              <th className="px-3 py-3 text-right text-xs font-medium text-zinc-400 uppercase tracking-wider">
                Links
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/50">
            {filteredAndSorted.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-12 text-center text-zinc-500"
                >
                  {search
                    ? "No tokens match your search."
                    : "No tokens found."}
                </td>
              </tr>
            ) : (
              filteredAndSorted.map((token, index) => {
                const priceChange = formatPercent(token.priceChange24h);
                return (
                  <tr
                    key={token.address}
                    className="hover:bg-zinc-900/30 transition-colors"
                  >
                    {/* Index */}
                    <td className="px-3 py-3 text-sm text-zinc-500">
                      {index + 1}
                    </td>

                    {/* Token name & symbol */}
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        {token.imageUrl ? (
                          <Image
                            src={token.imageUrl}
                            alt={token.symbol}
                            width={32}
                            height={32}
                            className="rounded-full bg-zinc-800"
                            unoptimized
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400">
                            {token.symbol.slice(0, 2)}
                          </div>
                        )}
                        <div>
                          <div className="font-medium text-sm text-white">
                            {token.symbol}
                          </div>
                          <div className="text-xs text-zinc-500 max-w-[120px] truncate">
                            {token.name}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Price */}
                    <td className="px-3 py-3 text-sm text-right text-white font-mono">
                      {formatPrice(token.priceUsd)}
                    </td>

                    {/* Market Cap */}
                    <td className="px-3 py-3 text-sm text-right text-zinc-300 font-mono">
                      {token.marketCap ? formatUsd(token.marketCap) : "\u2014"}
                    </td>

                    {/* Volume 24h */}
                    <td className="px-3 py-3 text-sm text-right text-zinc-300 font-mono">
                      {formatUsd(token.volume24h)}
                    </td>

                    {/* Liquidity */}
                    <td className="px-3 py-3 text-sm text-right text-zinc-300 font-mono">
                      {formatUsd(token.liquidity)}
                    </td>

                    {/* Price Change 24h */}
                    <td
                      className={`px-3 py-3 text-sm text-right font-mono font-medium ${
                        priceChange.isPositive
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    >
                      {priceChange.text}
                    </td>

                    {/* Transactions */}
                    <td className="px-3 py-3 text-sm text-right text-zinc-300 font-mono">
                      <span>{formatNumber(token.txns24h)}</span>
                      <div className="text-xs text-zinc-500">
                        <span className="text-emerald-500/70">
                          B:{token.buys24h}
                        </span>
                        {" / "}
                        <span className="text-red-500/70">
                          S:{token.sells24h}
                        </span>
                      </div>
                    </td>

                    {/* Age */}
                    <td className="px-3 py-3 text-sm text-right text-zinc-400">
                      {formatTimeAgo(token.createdAt)}
                    </td>

                    {/* Links */}
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <a
                          href={token.pairUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                          title="View on DEX Screener"
                        >
                          Chart
                        </a>
                        <a
                          href={`https://basescan.org/token/${token.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
                          title="View on BaseScan"
                        >
                          Scan
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
