import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BNKR Token Dashboard | Base Chain",
  description:
    "Track all tokens launched on Base through BNKR Bot. Real-time market data, sorting by market cap, volume, liquidity, and more.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-black">{children}</body>
    </html>
  );
}
