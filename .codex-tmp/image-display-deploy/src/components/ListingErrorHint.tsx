import type {
  ListingErrorCategory,
  ListingErrorClassification,
} from "@/lib/listing-error-classification";

const categoryClass: Record<ListingErrorCategory, string> = {
  image: "bg-sky-50 text-sky-700 ring-sky-200",
  policy: "bg-amber-50 text-amber-700 ring-amber-200",
  category: "bg-violet-50 text-violet-700 ring-violet-200",
  price_stock: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  auth: "bg-rose-50 text-rose-700 ring-rose-200",
  duplicate: "bg-orange-50 text-orange-700 ring-orange-200",
  temporary: "bg-blue-50 text-blue-700 ring-blue-200",
  promoted: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
  validation: "bg-red-50 text-red-700 ring-red-200",
  unknown: "bg-zinc-100 text-zinc-700 ring-zinc-200",
};

export function ListingErrorHint({
  classification,
  compact = false,
}: {
  classification: ListingErrorClassification | null;
  compact?: boolean;
}) {
  if (!classification) {
    return null;
  }

  return (
    <div className={compact ? "space-y-1" : "rounded-md border border-zinc-200 bg-white p-2"}>
      <span
        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
          categoryClass[classification.category]
        }`}
        title={classification.description}
      >
        {classification.label}
      </span>
      {!compact ? (
        <p className="mt-1 text-xs text-zinc-600">{classification.action}</p>
      ) : null}
    </div>
  );
}
