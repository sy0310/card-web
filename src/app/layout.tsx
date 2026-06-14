import type { Metadata } from "next";
import "./globals.css";
import { WishlistProvider } from "@/context/WishlistContext";

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
      <body>
        <WishlistProvider>
          <div className="main-container">
            {children}
          </div>
        </WishlistProvider>
      </body>
    </html>
  );
}
