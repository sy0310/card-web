import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { WishlistProvider } from "@/context/WishlistContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "K-pop Card Collection | Premium Marketplace",
  description: "Exquisite K-pop collection cards. Find your bias and build your dream wishlist.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <WishlistProvider>
          <div className="main-container">
            {children}
          </div>
        </WishlistProvider>
      </body>
    </html>
  );
}
