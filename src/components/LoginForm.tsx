"use client";

import { useState } from "react";
import { LockKeyhole } from "lucide-react";

export function LoginForm() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        loginId: form.get("loginId"),
        password: form.get("password"),
      }),
    });

    setLoading(false);

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(data?.error ?? "로그인 실패");
      return;
    }

    window.location.href = "/orders";
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6 shadow-sm"
    >
      <div className="mb-6 flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-zinc-950 text-white">
          <LockKeyhole className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-semibold text-zinc-950">관리자 로그인</h1>
          <p className="text-sm text-zinc-500">주문/배송 관리 콘솔</p>
        </div>
      </div>

      <label className="mb-4 block">
        <span className="mb-1 block text-sm font-medium text-zinc-700">
          로그인 ID
        </span>
        <input
          name="loginId"
          type="text"
          required
          autoComplete="username"
          className="h-11 w-full rounded-md border border-zinc-300 px-3 text-sm text-zinc-950 outline-none focus:border-zinc-900"
        />
      </label>

      <label className="mb-5 block">
        <span className="mb-1 block text-sm font-medium text-zinc-700">
          비밀번호
        </span>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="h-11 w-full rounded-md border border-zinc-300 px-3 text-sm text-zinc-950 outline-none focus:border-zinc-900"
        />
      </label>

      {error ? <p className="mb-4 text-sm text-rose-600">{error}</p> : null}

      <button
        type="submit"
        disabled={loading}
        className="h-11 w-full rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-wait disabled:bg-zinc-400"
      >
        {loading ? "확인 중" : "로그인"}
      </button>
    </form>
  );
}
