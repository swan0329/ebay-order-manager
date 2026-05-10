/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound } from "next/navigation";
import { PackageOpen } from "lucide-react";
import { TopNav } from "@/components/TopNav";
import {
  listingUploadStatusLabel,
  resolveInventoryListingUploadStatus,
} from "@/lib/listing-upload-status";
import { productStockLabel } from "@/lib/products";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/view-models";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      movements: {
        include: { relatedOrder: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      },
      orderItems: {
        include: { order: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
      listingDrafts: {
        where: { userId: user.id },
        select: { id: true, status: true, updatedAt: true, errorSummary: true },
        orderBy: { updatedAt: "desc" },
        take: 5,
      },
      listingLinks: true,
    },
  });

  if (!product) {
    notFound();
  }

  const createdByIds = [
    ...new Set(product.movements.map((movement) => movement.createdBy).filter(Boolean)),
  ] as string[];
  const movementUsers = createdByIds.length
    ? await prisma.user.findMany({
        where: { id: { in: createdByIds } },
        select: { id: true, loginId: true, name: true },
      })
    : [];
  const movementUserById = new Map(
    movementUsers.map((movementUser) => [
      movementUser.id,
      movementUser.name ?? movementUser.loginId,
    ]),
  );
  const listingUploadStatus = resolveInventoryListingUploadStatus(product);

  return (
    <div className="min-h-screen bg-zinc-50">
      <TopNav loginId={user.loginId} />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-zinc-950">
              {product.productName}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {product.sku} · {product.optionName ?? "옵션 없음"}
            </p>
          </div>
          <Link
            href={`/products/${product.id}/edit`}
            className="inline-flex h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
          >
            수정
          </Link>
        </div>

        <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
          <aside className="space-y-4">
            <section className="rounded-lg border border-zinc-200 bg-white p-4">
              <div className="mb-4 flex aspect-square items-center justify-center overflow-hidden rounded-md bg-zinc-100">
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <PackageOpen className="h-12 w-12 text-zinc-400" />
                )}
              </div>
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-500">재고</dt>
                  <dd className="font-semibold text-zinc-950">
                    {product.stockQuantity}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-500">안전재고</dt>
                  <dd className="font-semibold text-zinc-950">
                    {product.safetyStock}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-500">상태</dt>
                  <dd className="font-semibold text-zinc-950">
                    {productStockLabel(product)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-500">eBay 등록</dt>
                  <dd className="text-right font-semibold text-zinc-950">
                    {listingUploadStatusLabel(listingUploadStatus)}
                    {product.ebayItemId ? (
                      <span className="mt-1 block text-xs text-zinc-500">
                        {product.ebayItemId}
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-500">위치</dt>
                  <dd className="font-semibold text-zinc-950">
                    {product.location ?? "-"}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="mb-3 text-base font-semibold text-zinc-950">
                기본 정보
              </h2>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-zinc-500">내부코드</dt>
                  <dd className="font-medium text-zinc-950">
                    {product.internalCode ?? "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">앨범명</dt>
                  <dd className="font-medium text-zinc-950">
                    {product.category ?? "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">그룹명</dt>
                  <dd className="font-medium text-zinc-950">{product.brand ?? "-"}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">가격</dt>
                  <dd className="font-medium text-zinc-950">
                    원가 {product.costPrice?.toString() ?? "-"} · 포카마켓 가격{" "}
                    {product.salePrice?.toString() ?? "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">원본 앨범명/메모</dt>
                  <dd className="whitespace-pre-wrap font-medium text-zinc-950">
                    {product.memo ?? "-"}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="mb-3 text-base font-semibold text-zinc-950">
                eBay 업로드 연결
              </h2>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-zinc-500">상태</dt>
                  <dd className="font-medium text-zinc-950">
                    {listingUploadStatusLabel(listingUploadStatus)}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">item_id / offer_id</dt>
                  <dd className="font-medium text-zinc-950">
                    {product.ebayItemId ?? product.listingLinks[0]?.ebayItemId ?? "-"} /{" "}
                    {product.ebayOfferId ?? product.listingLinks[0]?.offerId ?? "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">최근 draft</dt>
                  <dd className="font-medium text-zinc-950">
                    {product.listingDrafts[0]
                      ? `${product.listingDrafts[0].status} · ${formatDate(
                          product.listingDrafts[0].updatedAt,
                        )}`
                      : "-"}
                  </dd>
                </div>
                {product.uploadError || product.listingDrafts[0]?.errorSummary ? (
                  <div>
                    <dt className="text-zinc-500">오류</dt>
                    <dd className="whitespace-pre-wrap font-medium text-rose-700">
                      {product.uploadError ?? product.listingDrafts[0]?.errorSummary}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>
          </aside>

          <section className="space-y-4">
            <div id="stock-history" className="rounded-lg border border-zinc-200 bg-white p-4">
              <div className="mb-4 flex gap-2 border-b border-zinc-200 pb-3">
                <span className="rounded-md bg-zinc-950 px-3 py-1.5 text-sm font-semibold text-white">
                  변경 이력
                </span>
                <a
                  href="#linked-orders"
                  className="rounded-md px-3 py-1.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-100"
                >
                  연결된 주문
                </a>
              </div>
              {product.movements.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[780px] text-left text-sm">
                    <thead className="text-xs font-semibold uppercase text-zinc-500">
                      <tr>
                        <th className="px-3 py-2">일시</th>
                        <th className="px-3 py-2">유형</th>
                        <th className="px-3 py-2">수량</th>
                        <th className="px-3 py-2">변경</th>
                        <th className="px-3 py-2">사유</th>
                        <th className="px-3 py-2">주문</th>
                        <th className="px-3 py-2">처리자</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {product.movements.map((movement) => (
                        <tr key={movement.id}>
                          <td className="px-3 py-2 text-zinc-700">
                            {formatDate(movement.createdAt)}
                          </td>
                          <td className="px-3 py-2 font-medium text-zinc-950">
                            {movement.type}
                          </td>
                          <td className="px-3 py-2 text-zinc-700">
                            {movement.quantity}
                          </td>
                          <td className="px-3 py-2 text-zinc-700">
                            {movement.beforeQuantity} → {movement.afterQuantity}
                          </td>
                          <td className="px-3 py-2 text-zinc-700">
                            {movement.reason ?? "-"}
                          </td>
                          <td className="px-3 py-2 text-zinc-700">
                            {movement.relatedOrder ? (
                              <Link
                                href={`/orders/${movement.relatedOrder.id}`}
                                className="underline-offset-4 hover:underline"
                              >
                                {movement.relatedOrder.ebayOrderId}
                              </Link>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="px-3 py-2 text-zinc-700">
                            {movement.createdBy
                              ? movementUserById.get(movement.createdBy) ??
                                movement.createdBy
                              : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-zinc-500">재고 이동 이력이 없습니다.</p>
              )}
            </div>

            <div id="linked-orders" className="rounded-lg border border-zinc-200 bg-white p-4">
              <h2 className="mb-3 text-base font-semibold text-zinc-950">
                연결된 주문
              </h2>
              {product.orderItems.length ? (
                <div className="divide-y divide-zinc-200">
                  {product.orderItems.map((item) => (
                    <Link
                      key={item.id}
                      href={`/orders/${item.order.id}`}
                      className="grid gap-2 py-3 text-sm sm:grid-cols-[1fr_140px_90px]"
                    >
                      <span>
                        <span className="block font-medium text-zinc-950">
                          {item.order.ebayOrderId}
                        </span>
                        <span className="block text-zinc-500">{item.title}</span>
                      </span>
                      <span className="text-zinc-700">
                        {formatDate(item.order.orderDate)}
                      </span>
                      <span className="text-zinc-700">{item.quantity}개</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-500">연결된 주문이 없습니다.</p>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
