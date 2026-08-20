// 아직 재고를 빼지 않은 주문이 잡아 둔 수량을 "예약"으로 본다.
//
// 예전에는 사람이 [재고 차감]을 눌러야 재고가 움직였다. 그 사이에 다른 채널에서
// 같은 카드가 또 팔리면 두 주문이 같은 한 장을 바라보게 된다. 실제로 한 리스팅에서
// 주문이 세 건 들어왔는데 재고는 한 장뿐인 일이 있었다.
//
// 예약은 따로 저장하지 않고 주문에서 그때그때 센다. 저장해 두면 차감·취소·연결 변경
// 때마다 맞춰 줘야 하고, 한 번 어긋나면 아무도 모르게 계속 틀린다.

export type ReservationLine = {
  productId: string;
  quantity: number;
  stockDeducted: boolean;
  // 취소된 주문은 잡아 둘 이유가 없다.
  orderCancelled: boolean;
};

export type Availability = {
  stock: number;
  /** 다른 주문이 잡아 둔 수량 */
  reservedByOthers: number;
  /** 이 주문이 필요로 하는 수량 */
  needed: number;
  /** 이 주문이 쓸 수 있는 수량 */
  available: number;
  /** 모자란 수량 */
  missing: number;
};

/**
 * 카드별로 아직 빠지지 않은 주문 수량을 합친다.
 *
 * 이미 차감한 줄은 재고에서 이미 빠졌으므로 세지 않는다. 두 번 세면 있는 재고를
 * 없다고 보게 된다.
 */
export function reservedByProduct(lines: ReservationLine[]) {
  const reserved = new Map<string, number>();
  for (const line of lines) {
    if (line.stockDeducted || line.orderCancelled) continue;
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) continue;
    reserved.set(line.productId, (reserved.get(line.productId) ?? 0) + line.quantity);
  }
  return reserved;
}

/**
 * 어떤 주문 하나가 이 카드를 실제로 몇 장 쓸 수 있는지 센다.
 *
 * 그 주문이 잡아 둔 몫은 자기 자신과 겨루지 않도록 예약에서 뺀다. 빼지 않으면
 * 재고가 넉넉해도 자기 예약 때문에 모자라다고 나온다.
 */
export function availabilityForOrder(input: {
  stock: number;
  totalReserved: number;
  neededByThisOrder: number;
}): Availability {
  const stock = Math.max(0, Number(input.stock) || 0);
  const needed = Math.max(0, Number(input.neededByThisOrder) || 0);
  const reservedByOthers = Math.max(0, (Number(input.totalReserved) || 0) - needed);
  const available = Math.max(0, stock - reservedByOthers);
  return {
    stock,
    reservedByOthers,
    needed,
    available,
    missing: Math.max(0, needed - available),
  };
}

/**
 * 채널에 올려 둘 판매 가능 수량.
 *
 * 예약된 몫을 빼야 같은 카드가 두 채널에서 동시에 팔리지 않는다. 안전재고를 두면
 * 그만큼 더 낮춰 올린다. eBay는 수량 반영이 파일이라 늦게 반영되므로 여유가 필요하다.
 */
export function sellableQuantity(input: {
  stock: number;
  reserved: number;
  safetyStock?: number;
}) {
  const stock = Math.max(0, Number(input.stock) || 0);
  const reserved = Math.max(0, Number(input.reserved) || 0);
  const safety = Math.max(0, Number(input.safetyStock) || 0);
  return Math.max(0, stock - reserved - safety);
}
