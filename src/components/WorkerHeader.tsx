"use client";

export function WorkerHeader({ name }: { name: string }) {
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  return <header className="border-b bg-white"><div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3"><div><strong>포토카드 이미지 작업</strong><span className="ml-3 text-sm text-zinc-500">{name}</span></div><button onClick={logout} className="rounded border px-3 py-2 text-sm font-semibold">로그아웃</button></div></header>;
}
