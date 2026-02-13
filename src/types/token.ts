export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  marketCap: number;
  pairCreatedAt: number;
  info?: {
    imageUrl?: string;
    header?: string;
    openGraph?: string;
    websites?: { label: string; url: string }[];
    socials?: { type: string; url: string }[];
  };
}

export interface TokenData {
  address: string;
  name: string;
  symbol: string;
  imageUrl?: string;
  priceUsd: string;
  marketCap: number;
  fdv: number;
  volume24h: number;
  volumeH1: number;
  liquidity: number;
  priceChange24h: number;
  priceChangeH1: number;
  txns24h: number;
  buys24h: number;
  sells24h: number;
  pairAddress: string;
  pairUrl: string;
  createdAt: number;
  dexId: string;
}

export type SortField =
  | "createdAt"
  | "marketCap"
  | "volume24h"
  | "liquidity"
  | "priceChange24h"
  | "priceUsd"
  | "txns24h";

export type SortDirection = "asc" | "desc";
