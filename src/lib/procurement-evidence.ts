import type { Product } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
type SourceProduct = Pick<Product, "id" | "pocamarketId" | "pocamarketSyncedAt" | "salePrice" | "pocamarketAvailableCount">;
type Evidence = { productId: string; productNumber: string; observedPrice: unknown; observedAvailableCount: number | null; availability: string | null; observedAt: Date | null; appliedAt: Date | null };
export function procurementEvidenceMatches(product: SourceProduct, evidence: Evidence) {
  if (evidence.productId !== product.id || evidence.productNumber !== product.pocamarketId ||
      !evidence.appliedAt || evidence.observedAt?.getTime() !== product.pocamarketSyncedAt?.getTime()) return false;
  if (evidence.availability === "SOLD_OUT") return product.salePrice == null && product.pocamarketAvailableCount === 0;
  return evidence.availability === "AVAILABLE" && product.salePrice != null && evidence.observedPrice != null &&
    Number(product.salePrice) > 0 && Number(product.salePrice) === Number(evidence.observedPrice) &&
    product.pocamarketAvailableCount === evidence.observedAvailableCount;
}

// Independent source-observation history, not the mutable cost compared with itself.
export async function withVerifiedProcurementEvidence<T extends SourceProduct>(products: T[]): Promise<T[]> {
  const linked = products.filter(p => p.pocamarketId);
  if (!linked.length) return products;
  const observations: Evidence[] = [];
  for (let offset = 0; offset < linked.length; offset += 200) {
    observations.push(...await prisma.pocamarketSyncItem.findMany({
      where: { appliedAt: { not: null }, OR: linked.slice(offset, offset + 200).map(p => ({ productId: p.id, observedAt: p.pocamarketSyncedAt ?? new Date(0) })) },
      select: { productId: true, productNumber: true, observedPrice: true, observedAvailableCount: true, availability: true, observedAt: true, appliedAt: true },
    }));
  }
  const byId = new Map<string, Evidence[]>();
  for (const row of observations) byId.set(row.productId, [...(byId.get(row.productId) ?? []), row]);
  return products.map(p => !p.pocamarketId || byId.get(p.id)?.some(row => procurementEvidenceMatches(p, row)) ? p : {
    ...p, salePrice: null, finalListingPriceUsd: null, pocamarketAvailableCount: 0, pocamarketSyncedAt: null,
  });
}
