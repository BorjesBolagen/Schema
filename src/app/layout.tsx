import type { Metadata } from "next";
import "./globals.css";
import { UserBar } from "@/components/UserBar";

export const metadata: Metadata = {
  title: "Schema",
  description: "Schemaläggning och semesterplanering för chaufförer",
};

/**
 * Kör funktionerna nära databasen.
 *
 * Databasen ligger i Supabases eu-west-1 (Irland). Utan den här körs
 * Vercels funktioner i sin standardregion i USA, och varje databasfråga
 * blir en transatlantisk tur och retur — långsamt, och känsligt för att
 * hänga på ett sätt en fråga inom samma världsdel inte är. dub1 (Dublin)
 * är Vercels närmaste region till eu-west-1.
 */
export const preferredRegion = "dub1";

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
