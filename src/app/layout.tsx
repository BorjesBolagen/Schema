import type { Metadata } from "next";
import "./globals.css";
import { UserBar } from "@/components/UserBar";

export const metadata: Metadata = {
  title: "Schema",
  description: "Schemaläggning och semesterplanering för chaufförer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body>
        <UserBar />
        {children}
      </body>
    </html>
  );
}
