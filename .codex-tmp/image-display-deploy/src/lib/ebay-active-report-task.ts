import { currentEbayEnvironment } from "@/lib/ebay-environment";
import { prisma } from "@/lib/prisma";
import {
  ebayApiRequest,
  getActiveEbayInventoryAccount,
} from "@/lib/services/ebayApiService";

const FEED_TYPE = "LMS_ACTIVE_INVENTORY_REPORT";
const MAX_DAILY_TASKS = 20;
const REPORT_REFRESH_MS = 4 * 60 * 60 * 1000;
const pendingStatuses = new Set(["CREATED", "IN_PROCESS", "IN_PROGRESS"]);

export type EbayInventoryTask = {
  taskId?: string;
  status?: string;
  creationDate?: string;
};

function node(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export async function listEbayInventoryTasks(userId: string) {
  const account = await getActiveEbayInventoryAccount(userId);
  const response = await ebayApiRequest(account, {
    path: "/sell/feed/v1/inventory_task",
    query: { feed_type: FEED_TYPE, look_back_days: 1, limit: 50 },
  });
  const tasks = asArray(node(response.body).tasks)
    .map((value) => node(value) as EbayInventoryTask)
    .filter((task) => task.taskId)
    .sort((a, b) => Date.parse(b.creationDate ?? "") - Date.parse(a.creationDate ?? ""));
  return { account, tasks };
}

export async function requestEbayActiveReport(userId: string, force = false) {
  const { account, tasks } = await listEbayInventoryTasks(userId);
  const pending = tasks.find((task) => pendingStatuses.has(String(task.status).toUpperCase()));
  if (pending) return { status: "PENDING" as const, taskId: pending.taskId! };

  const newestDate = tasks[0]?.creationDate ? Date.parse(tasks[0].creationDate!) : 0;
  if (!force && newestDate && Date.now() - newestDate < REPORT_REFRESH_MS) {
    return { status: "FRESH" as const, taskId: tasks[0].taskId! };
  }
  if (tasks.length >= MAX_DAILY_TASKS) {
    return { status: "DAILY_LIMIT" as const, taskId: tasks[0]?.taskId ?? null };
  }

  const created = await ebayApiRequest(account, {
    method: "POST",
    path: "/sell/feed/v1/inventory_task",
    body: {
      feedType: FEED_TYPE,
      schemaVersion: "1.0",
      filterCriteria: { listingFormat: "FIXED_PRICE" },
    },
  });
  const body = node(created.body);
  const taskId = created.headers.get("location")?.split("/").filter(Boolean).at(-1)
    ?? (typeof body.taskId === "string" ? body.taskId : null);
  if (!taskId) throw new Error("eBay가 활성상품 보고서 작업 번호를 반환하지 않았습니다.");
  return { status: "REQUESTED" as const, taskId };
}

export async function listEbayReportSyncUsers() {
  const accounts = await prisma.ebayAccount.findMany({
    where: { environment: currentEbayEnvironment() },
    distinct: ["userId"],
    select: { userId: true },
  });
  return accounts.map((account) => account.userId);
}
