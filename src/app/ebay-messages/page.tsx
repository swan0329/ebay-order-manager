import { EbayMessagesClient } from "@/components/EbayMessagesClient";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export default async function EbayMessagesPage() { await requireUser(); return <main className="mx-auto max-w-5xl p-4 md:p-7"><EbayMessagesClient /></main>; }
