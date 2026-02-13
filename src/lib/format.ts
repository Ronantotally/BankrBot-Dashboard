/**
 * Format a number as a compact USD string (e.g., $1.2M, $45.3K)
 */
export function formatUsd(value: number): string {
  if (value === 0) return "$0";

  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`;
  }
  if (value >= 1) {
    return `$${value.toFixed(2)}`;
  }
  // Small values — show more decimals
  return `$${value.toPrecision(4)}`;
}

/**
 * Format a price string, handling very small prices with subscript notation
 */
export function formatPrice(priceStr: string): string {
  const price = parseFloat(priceStr);
  if (isNaN(price) || price === 0) return "$0";

  if (price >= 1) {
    return `$${price.toFixed(2)}`;
  }
  if (price >= 0.01) {
    return `$${price.toFixed(4)}`;
  }
  if (price >= 0.0001) {
    return `$${price.toFixed(6)}`;
  }

  // For very small prices, use scientific-style display
  const str = price.toFixed(20);
  const match = str.match(/^0\.(0+)(\d{4})/);
  if (match) {
    const zeros = match[1].length;
    const significant = match[2];
    return `$0.0(${zeros})${significant}`;
  }

  return `$${price.toPrecision(4)}`;
}

/**
 * Format a number with commas
 */
export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * Format a percentage change with + or - sign and color indicator
 */
export function formatPercent(value: number): { text: string; isPositive: boolean } {
  const sign = value >= 0 ? "+" : "";
  return {
    text: `${sign}${value.toFixed(2)}%`,
    isPositive: value >= 0,
  };
}

/**
 * Format a timestamp as a relative time string (e.g., "2h ago", "3d ago")
 */
export function formatTimeAgo(timestamp: number): string {
  if (!timestamp) return "Unknown";

  const now = Date.now();
  const diff = now - timestamp;

  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Truncate an Ethereum address for display
 */
export function truncateAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
