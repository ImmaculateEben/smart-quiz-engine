import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Clavis",
  description: "Enterprise multi-tenant assessment platform"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">{children}</div>
      </body>
    </html>
  );
}
