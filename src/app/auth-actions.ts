"use server";

import { redirect } from "next/navigation";
import { destroySession } from "@/server/auth";

export async function signOut(): Promise<void> {
  await destroySession();
  redirect("/logga-in");
}
