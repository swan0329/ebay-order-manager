export default function AppLoading() {
  return (
    <div
      className="min-h-screen bg-zinc-50 lg:pl-[272px]"
      role="status"
      aria-label="페이지를 불러오는 중"
    >
      <div className="h-14 border-b border-zinc-200 bg-white lg:hidden" />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="h-7 w-48 animate-pulse rounded bg-zinc-200" />
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="h-24 animate-pulse rounded-xl border border-zinc-200 bg-white"
            />
          ))}
        </div>
        <div className="mt-5 overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <div className="h-12 animate-pulse border-b border-zinc-100 bg-zinc-100" />
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="h-14 animate-pulse border-b border-zinc-100 last:border-0"
              style={{ animationDelay: `${index * 45}ms` }}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
