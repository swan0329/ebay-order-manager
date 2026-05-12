import { PhotoCardMatchClient } from "@/components/PhotoCardMatchClient";
import { TopNav } from "@/components/TopNav";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PhotoCardMatchPage() {
  const user = await requireUser();

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <PhotoCardMatchClient />
      </main>
    </div>
  );
}
