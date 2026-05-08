"use client";

import { useState, type FormEvent } from "react";
import { ClipboardCheck, ExternalLink, RotateCcw } from "lucide-react";

type EbayManualCodeFormProps = {
  initialCodeOrUrl?: string;
  initialState?: string;
};

export function EbayManualCodeForm({
  initialCodeOrUrl = "",
  initialState = "",
}: EbayManualCodeFormProps) {
  const [codeOrUrl, setCodeOrUrl] = useState(() => {
    if (initialCodeOrUrl || typeof window === "undefined") {
      return initialCodeOrUrl;
    }

    return new URLSearchParams(window.location.search).has("code")
      ? window.location.href
      : "";
  });
  const [state, setState] = useState(() => {
    if (initialState || typeof window === "undefined") {
      return initialState;
    }

    return new URLSearchParams(window.location.search).get("state") ?? "";
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const response = await fetch("/api/ebay/oauth/manual-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ codeOrUrl, state: state || undefined }),
    });

    setLoading(false);

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(data?.error ?? "Manual OAuth connection failed.");
      return;
    }

    window.location.href = "/connect?connected=1";
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-zinc-700">
          Returned URL or authorization code
        </span>
        <textarea
          value={codeOrUrl}
          onChange={(event) => setCodeOrUrl(event.target.value)}
          rows={4}
          maxLength={4096}
          className="w-full resize-y rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-900"
          placeholder="Paste a URL containing code=..., or paste the code value."
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-zinc-700">
          State, optional
        </span>
        <input
          value={state}
          onChange={(event) => setState(event.target.value)}
          maxLength={512}
          className="h-10 w-full rounded-md border border-zinc-300 px-3 text-sm text-zinc-950 outline-none focus:border-zinc-900"
          placeholder="Usually included automatically when a full callback URL is pasted."
        />
      </label>

      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="submit"
          disabled={loading || !codeOrUrl.trim()}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          <ClipboardCheck className="h-4 w-4" />
          {loading ? "Connecting..." : "Connect pasted code"}
        </button>
        <a
          href="/api/ebay/oauth/start"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-50"
        >
          <RotateCcw className="h-4 w-4" />
          Fresh eBay Connect
        </a>
        <a
          href="/api/ebay/oauth/debug-url"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 hover:bg-zinc-50"
        >
          <ExternalLink className="h-4 w-4" />
          Open debug JSON
        </a>
      </div>
    </form>
  );
}
