import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Schema",
  description: "Schemaläggning och semesterplanering för chaufförer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  );
}
