import type { AuditStatus } from "../shared/audit.js";
import {
  previousResultStatus,
  type ClaimAuditChange,
  type ClaimAuditEvent,
  type ClaimAuditField,
} from "../shared/claim-workspace.js";

export interface ClaimAuditRow {
  id: number;
  time: string;
  action: string;
  detail: string;
  status: AuditStatus | null;
  wasLabel: string | null;
  clearedLabel: string | null;
}

const auditFieldLabels: Record<ClaimAuditField, string> = {
  claimedGrowthPercent: "标题声称增长",
  "older.period": "较早时间",
  "older.value": "较早数值",
  "older.unit": "较早单位",
  "newer.period": "较新时间",
  "newer.value": "较新数值",
  "newer.unit": "较新单位",
};

export function auditStatusLabel(status: AuditStatus): string {
  if (status === "consistent") return "图内一致";
  if (status === "contradictory") return "图内矛盾";
  return "需要确认";
}

function formatAuditValue(field: ClaimAuditField, value: number | string | null): string {
  if (value === null || value === "") return "未填写";
  if (field === "claimedGrowthPercent") {
    const formatted = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value));
    return `${formatted}%`;
  }
  return String(value);
}

function formatAuditChange(change: ClaimAuditChange): string {
  return `${auditFieldLabels[change.field]} ${formatAuditValue(change.field, change.from)} → ${formatAuditValue(change.field, change.to)}`;
}

function auditActionLabel(action: ClaimAuditEvent["action"]): string {
  if (action === "correct") return "更正读数";
  if (action === "confirm") return "确认并计算";
  return "重新计算";
}

function formatEventTime(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 把一张图、一条主张的记录转成可直接渲染的行；按主张分组用于多主张卡片。 */
export function buildClaimAuditRows(events: ClaimAuditEvent[]): ClaimAuditRow[] {
  return events.map((event, index) => {
    const status = event.result?.status ?? null;
    const previous = previousResultStatus(events, index);
    return {
      id: event.id,
      time: formatEventTime(event.at),
      action: auditActionLabel(event.action),
      detail: event.changes.length
        ? event.changes.map(formatAuditChange).join("；")
        : "按已确认的核对值计算",
      status,
      wasLabel: previous ? `此前为 ${auditStatusLabel(previous)}` : null,
      clearedLabel: status
        ? null
        : events.slice(0, index).some((earlier) => earlier.result)
          ? "原结论已清除，等待重新确认"
          : "等待重新确认",
    };
  });
}

export function groupClaimAuditRows(events: ClaimAuditEvent[]): Record<string, ClaimAuditRow[]> {
  const grouped: Record<string, ClaimAuditEvent[]> = {};
  for (const event of events) {
    grouped[event.claimId] = [...(grouped[event.claimId] ?? []), event];
  }
  return Object.fromEntries(
    Object.entries(grouped).map(([claimId, claimEvents]) => [claimId, buildClaimAuditRows(claimEvents)]),
  );
}
