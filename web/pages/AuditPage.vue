<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import SiteHeader from "../components/SiteHeader.vue";
import AuditRecordList from "../components/AuditRecordList.vue";
import AuditSessionBar from "../components/AuditSessionBar.vue";
import { auditStatusLabel, groupClaimAuditRows, buildClaimAuditRows, type ClaimAuditRow } from "../audit-record-rows.js";
import { takeLandingUpload } from "../upload-transfer.js";
import { initialValueSource, toAuditObservation, type AuditObservation, type AuditResult, type ChartObservation, type DataPointObservation, type GrowthClaimObservation, type ModelReadTrace, type ObservationSource } from "../../shared/audit.js";
import {
  applyClaimEdit,
  completeClaimReview,
  createClaimWorkspace,
  recordCorrection,
  recordReview,
  resetClaimWorkspace,
  toClaimAuditSubmission,
  updateClaimDraft,
  valuesFromObservation,
  type ClaimAuditChange,
  type ClaimAuditLog,
  type ClaimWorkspace,
  type ClaimWorkspaceEdit,
  type ClaimWorkspaceEntry,
} from "../../shared/claim-workspace.js";

interface SampleSummary {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
}

interface CropSelection {
  left: number;
  top: number;
  width: number;
  height: number;
}

const samples = ref<SampleSummary[]>([]);
const activeSampleId = ref<string | null>(null);
const chartObservation = ref<ChartObservation | null>(null);
const claimWorkspace = ref<ClaimWorkspace | null>(null);
const claimErrors = ref<Record<string, string>>({});
const busyClaimId = ref<string | null>(null);
const resetNotice = ref("");
const observation = ref<AuditObservation | null>(null);
const result = ref<AuditResult | null>(null);
const imageUrl = ref("");
const imageAlt = ref("图表预览");
const selectedFileName = ref("");
const pendingUpload = ref<File | null>(null);
const errorMessage = ref("");
const busyMessage = ref("");
const modelRead = ref<ModelReadTrace | null>(null);
const modelReadRegion = ref<"crop" | "full">("full");
// 单主张路径（阶段一样例、或模型只读到一条主张）用自己的记录与会话快照，
// 规则与多主张共用 shared 里的 recordCorrection / recordReview。
const singleClaimLog = ref<ClaimAuditLog>([]);
const singleClaimId = ref("");
const singleClaimRevision = ref(0);
const initialObservation = ref<AuditObservation | null>(null);
const cropMode = ref(false);
const cropSelection = ref<CropSelection | null>(null);
const cropPreview = ref("");
const cropError = ref("");
const previewImage = ref<HTMLImageElement | null>(null);
const imageStage = ref<HTMLElement | null>(null);
const imageViewer = ref<HTMLDialogElement | null>(null);
const imageViewerStage = ref<HTMLDivElement | null>(null);
const imageZoom = ref(1);
const imageViewerStageHeight = ref<number | null>(null);
const imageViewerHeight = ref<number | null>(null);
const isNarrowViewport = ref(false);
const evidenceLedger = ref<HTMLDetailsElement | null>(null);
const activeAuditStep = ref<"image" | "review" | "result">("image");
let dragOrigin: { x: number; y: number } | null = null;
let objectUrl: string | null = null;
let auditStepFrame: number | undefined;
const route = useRoute();

const activeSample = computed(
  () => samples.value.find(({ id }) => id === activeSampleId.value) ?? null,
);
const hasMultipleClaims = computed(() => (chartObservation.value?.claims.length ?? 0) > 1);
const hasNoClaims = computed(() => chartObservation.value?.claims.length === 0);
const hasAnyAuditResult = computed(() => Boolean(result.value) || Boolean(claimWorkspace.value?.claims.some((claim) => claim.result)));
const claimAuditRows = computed<Record<string, ClaimAuditRow[]>>(
  () => groupClaimAuditRows(claimWorkspace.value?.events ?? []),
);
const singleClaimAuditRows = computed<ClaimAuditRow[]>(() => buildClaimAuditRows(singleClaimLog.value));
const cropSelectionStyle = computed(() => {
  const selection = cropSelection.value;
  const image = previewImage.value;
  if (!selection || !image || !image.naturalWidth || !image.naturalHeight) return {};

  const bounds = image.getBoundingClientRect();
  const imageRatio = image.naturalWidth / image.naturalHeight;
  let contentLeft = 0;
  let contentTop = 0;
  let contentWidth = bounds.width;
  let contentHeight = bounds.height;
  if (bounds.width / bounds.height > imageRatio) {
    contentWidth = bounds.height * imageRatio;
    contentLeft = (bounds.width - contentWidth) / 2;
  } else {
    contentHeight = bounds.width / imageRatio;
    contentTop = (bounds.height - contentHeight) / 2;
  }

  return {
    left: `${((contentLeft + (selection.left / 100) * contentWidth) / bounds.width) * 100}%`,
    top: `${((contentTop + (selection.top / 100) * contentHeight) / bounds.height) * 100}%`,
    width: `${((selection.width / 100) * contentWidth / bounds.width) * 100}%`,
    height: `${((selection.height / 100) * contentHeight / bounds.height) * 100}%`,
  };
});
const sourceLabel = computed(() => {
  if (chartObservation.value?.source === "vision-model") return "模型读取";
  if (chartObservation.value?.source === "preset-example") return "预置示例";
  return "等待图片";
});
const confirmationLabel = computed(() => {
  if (observation.value?.source === "preset-example") {
    return observation.value.confirmed ? "示例值已确认" : "请核对示例值";
  }
  return observation.value?.confirmed ? "你已确认" : "待你确认";
});
const resultLabel = computed(() => {
  if (result.value?.status === "consistent") return "图内一致";
  if (result.value?.status === "contradictory") return "图内矛盾";
  return "需要确认";
});

function forgetObjectUrl(): void {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
}

function clearCrop(): void {
  cropMode.value = false;
  cropSelection.value = null;
  cropPreview.value = "";
  cropError.value = "";
  dragOrigin = null;
}

function openImageViewer(): void {
  if (!imageUrl.value || !imageViewer.value) return;
  imageZoom.value = window.matchMedia("(max-width: 620px)").matches ? 1.5 : 1;
  imageViewer.value.showModal();
  window.requestAnimationFrame(updateImageViewerStageHeight);
}

function closeImageViewer(): void {
  imageViewer.value?.close();
}

function resetImageViewer(): void {
  imageZoom.value = 1;
  imageViewerStageHeight.value = null;
  imageViewerHeight.value = null;
}

function updateImageViewerStageHeight(): void {
  const stage = imageViewerStage.value;
  const header = imageViewer.value?.querySelector<HTMLElement>(".image-viewer-header");
  const image = stage?.querySelector<HTMLImageElement>("img");
  if (!stage || !header || !image?.naturalWidth || !image.naturalHeight) return;

  const contentWidth = Math.max(0, stage.clientWidth - 20);
  const scaledImageHeight = (contentWidth * imageZoom.value * image.naturalHeight) / image.naturalWidth + 20;
  const availableHeight = Math.max(180, window.innerHeight - header.offsetHeight - 64);
  imageViewerStageHeight.value = Math.round(Math.min(scaledImageHeight, availableHeight));
  imageViewerHeight.value = window.matchMedia("(max-width: 620px)").matches
    ? Math.min(window.innerHeight - 16, header.offsetHeight + imageViewerStageHeight.value + 4)
    : null;
}

function updateViewportMode(): void {
  isNarrowViewport.value = window.matchMedia("(max-width: 780px)").matches;
  updateImageViewerStageHeight();
  scheduleActiveAuditStep();
}

function updateActiveAuditStep(): void {
  const stepTargets: Array<{ step: "image" | "review" | "result"; id: string }> = [
    { step: "image", id: "audit-image" },
    { step: "review", id: "audit-review" },
    ...(hasAnyAuditResult.value
      ? [{ step: "result" as const, id: result.value ? "audit-result" : "audit-claim-results" }]
      : []),
  ];
  let active: "image" | "review" | "result" = "image";
  const stepLine = window.innerHeight * 0.45;
  for (const target of stepTargets) {
    const element = document.getElementById(target.id);
    if (element && element.getBoundingClientRect().top <= stepLine) active = target.step;
  }
  activeAuditStep.value = active;
}

function scheduleActiveAuditStep(): void {
  if (auditStepFrame !== undefined) return;
  auditStepFrame = window.requestAnimationFrame(() => {
    auditStepFrame = undefined;
    updateActiveAuditStep();
  });
}

watch(result, scheduleActiveAuditStep);
watch(claimWorkspace, scheduleActiveAuditStep);

function changeImageZoom(amount: number): void {
  imageZoom.value = Math.min(3, Math.max(1, imageZoom.value + amount));
  window.requestAnimationFrame(updateImageViewerStageHeight);
}

function panImageViewer(direction: -1 | 1): void {
  const stage = imageViewerStage.value;
  if (!stage) return;
  stage.scrollBy({ left: stage.clientWidth * 0.75 * direction, behavior: "smooth" });
}

function closeViewerOnBackdrop(event: MouseEvent): void {
  if (event.target === imageViewer.value) closeImageViewer();
}

function returnToImage(): void {
  imageStage.value?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function jumpToAuditStep(event: Event): void {
  const step = (event.target as HTMLSelectElement).value as typeof activeAuditStep.value;
  if (step === "result" && !hasAnyAuditResult.value) return;
  const targetId = step === "image"
    ? "audit-image"
    : step === "review"
      ? "audit-review"
      : result.value ? "audit-result" : "audit-claim-results";
  document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateErrorFrom(response: Response, payload: { error?: { message?: string } } | null): string {
  if (payload?.error?.message) return payload.error.message;
  return `请求失败（${response.status}）。请重试。`;
}

function setChartObservation(value: ChartObservation): void {
  chartObservation.value = value;
  claimWorkspace.value = value.claims.length > 1 ? createClaimWorkspace(value) : null;
  claimErrors.value = {};
  busyClaimId.value = null;
  resetNotice.value = "";
  const [claim] = value.claims;
  const single = value.claims.length === 1 && claim ? toAuditObservation(value, claim) : null;
  observation.value = single;
  initialObservation.value = single ? copyAuditObservation(single) : null;
  singleClaimId.value = single ? claim.id : "";
  singleClaimLog.value = [];
  singleClaimRevision.value += 1;
  result.value = null;
}

function copyAuditObservation(value: AuditObservation): AuditObservation {
  return {
    ...value,
    older: { ...value.older },
    newer: { ...value.newer },
    unreadableItems: [...value.unreadableItems],
  };
}

function applySingleEdit(edit: ClaimWorkspaceEdit): void {
  const current = observation.value;
  if (!current) return;

  const applied = applyClaimEdit(valuesFromObservation(current), edit);
  // 与多主张路径同一规则：数值没变就不记事件、不清结论、不动来源标记。
  if (!applied.changed) return;

  current.claimedGrowthPercent = applied.values.claimedGrowthPercent;
  current.older = { ...applied.values.older };
  current.newer = { ...applied.values.newer };
  singleClaimLog.value = recordCorrection(
    singleClaimLog.value,
    { claimId: singleClaimId.value, claimText: current.titleOriginal },
    applied.change,
  );
  singleClaimRevision.value += 1;
  resetNotice.value = "";
  invalidateResult();
}

async function loadSample(id: string): Promise<void> {
  busyMessage.value = "正在载入预置示例…";
  errorMessage.value = "";
  result.value = null;
  try {
    const response = await fetch("/api/audit/sample", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const payload = await response.json().catch(() => null) as {
      observation?: ChartObservation;
      error?: { message?: string };
    } | null;
    if (!response.ok || !payload?.observation) {
      throw new Error(updateErrorFrom(response, payload));
    }

    const sample = samples.value.find((candidate) => candidate.id === id);
    if (!sample) throw new Error("找不到这个样例。");
    forgetObjectUrl();
    clearCrop();
    pendingUpload.value = null;
    imageUrl.value = sample.imageUrl;
    imageAlt.value = `${sample.name}，团队自制图表示例`;
    selectedFileName.value = "";
    activeSampleId.value = id;
    modelRead.value = null;
    setChartObservation(payload.observation);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "样例载入失败，请重试。";
  } finally {
    busyMessage.value = "";
  }
}

async function loadSamples(): Promise<void> {
  try {
    const response = await fetch("/api/samples");
    const payload = await response.json().catch(() => null) as { samples?: SampleSummary[] } | null;
    if (!response.ok || !payload?.samples?.length) {
      throw new Error("样例清单无法载入。请确认前后端服务已启动。");
    }
    samples.value = payload.samples;
    const requestedId = typeof route.query.sample === "string" ? route.query.sample : null;
    const requestedSample = payload.samples.find(({ id }) => id === requestedId);
    await loadSample(requestedSample?.id ?? payload.samples[0].id);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "服务暂时不可用。";
  }
}

function selectSample(event: Event): void {
  const id = (event.target as HTMLSelectElement).value;
  if (id) void loadSample(id);
}

function prepareUpload(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  prepareUploadFile(file);
}

function prepareUploadFile(file: File): void {
  if (file.size > 5 * 1024 * 1024) {
    errorMessage.value = "图片不能超过 5 MB。";
    return;
  }
  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type)) {
    errorMessage.value = "请上传 PNG、JPG 或 WebP 图片。";
    return;
  }

  forgetObjectUrl();
  clearCrop();
  objectUrl = URL.createObjectURL(file);
  imageUrl.value = objectUrl;
  imageAlt.value = `上传图片预览：${file.name}`;
  selectedFileName.value = file.name;
  pendingUpload.value = file;
  activeSampleId.value = null;
  chartObservation.value = null;
  claimWorkspace.value = null;
  claimErrors.value = {};
  busyClaimId.value = null;
  observation.value = null;
  initialObservation.value = null;
  singleClaimId.value = "";
  singleClaimLog.value = [];
  singleClaimRevision.value += 1;
  result.value = null;
  modelRead.value = null;
  errorMessage.value = "";
  busyMessage.value = "";
}

async function analyzePendingUpload(): Promise<void> {
  if (!pendingUpload.value) return;
  const sentRegion: "crop" | "full" = cropPreview.value ? "crop" : "full";
  busyMessage.value = "正在请求模型读取图表文字…";
  try {
    const form = new FormData();
    if (cropPreview.value) {
      const cropBlob = await (await fetch(cropPreview.value)).blob();
      form.append("image", cropBlob, "chart-crop.png");
    } else {
      form.append("image", pendingUpload.value);
    }

    const response = await fetch("/api/audit/image", { method: "POST", body: form });
    const payload = await response.json().catch(() => null) as {
      observation?: ChartObservation;
      modelRead?: ModelReadTrace;
      error?: { message?: string };
    } | null;
    if (!response.ok || !payload?.observation) {
      throw new Error(updateErrorFrom(response, payload));
    }
    modelRead.value = payload.modelRead ?? null;
    modelReadRegion.value = sentRegion;
    setChartObservation(payload.observation);
  } catch (error) {
    modelRead.value = null;
    errorMessage.value = error instanceof Error ? error.message : "图片读取失败，请重试。";
  } finally {
    busyMessage.value = "";
  }
}

function toggleCropMode(): void {
  if (!imageUrl.value) return;
  if (cropMode.value) {
    cropMode.value = false;
    dragOrigin = null;
    return;
  }
  cropSelection.value = null;
  cropPreview.value = "";
  cropError.value = "";
  cropMode.value = true;
}

function cropPoint(event: PointerEvent): { x: number; y: number } | null {
  const image = previewImage.value;
  const overlay = event.currentTarget as HTMLDivElement | null;
  if (!image || !overlay || !image.naturalWidth || !image.naturalHeight) return null;
  const bounds = overlay.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  const imageRatio = image.naturalWidth / image.naturalHeight;
  let contentLeft = 0;
  let contentTop = 0;
  let contentWidth = bounds.width;
  let contentHeight = bounds.height;
  if (bounds.width / bounds.height > imageRatio) {
    contentWidth = bounds.height * imageRatio;
    contentLeft = (bounds.width - contentWidth) / 2;
  } else {
    contentHeight = bounds.width / imageRatio;
    contentTop = (bounds.height - contentHeight) / 2;
  }
  return {
    x: Math.min(100, Math.max(0, ((event.clientX - bounds.left - contentLeft) / contentWidth) * 100)),
    y: Math.min(100, Math.max(0, ((event.clientY - bounds.top - contentTop) / contentHeight) * 100)),
  };
}

function updateCropSelection(event: PointerEvent): void {
  if (!dragOrigin) return;
  const point = cropPoint(event);
  if (!point) return;
  cropSelection.value = {
    left: Math.min(dragOrigin.x, point.x),
    top: Math.min(dragOrigin.y, point.y),
    width: Math.abs(point.x - dragOrigin.x),
    height: Math.abs(point.y - dragOrigin.y),
  };
}

function beginCrop(event: PointerEvent): void {
  if (!cropMode.value) return;
  const point = cropPoint(event);
  if (!point) return;
  dragOrigin = point;
  cropSelection.value = { left: point.x, top: point.y, width: 0, height: 0 };
  cropError.value = "";
  (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
}

function finishCrop(event: PointerEvent): void {
  if (!dragOrigin) return;
  updateCropSelection(event);
  const selection = cropSelection.value;
  const image = previewImage.value;
  dragOrigin = null;
  if (!selection || !image || selection.width < 3 || selection.height < 3) {
    cropError.value = "请拖动并框住一块文字或数字区域。";
    return;
  }

  const sourceX = Math.round((selection.left / 100) * image.naturalWidth);
  const sourceY = Math.round((selection.top / 100) * image.naturalHeight);
  const sourceWidth = Math.max(1, Math.round((selection.width / 100) * image.naturalWidth));
  const sourceHeight = Math.max(1, Math.round((selection.height / 100) * image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    cropError.value = "无法生成选区预览，请重试。";
    return;
  }
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
  cropPreview.value = canvas.toDataURL("image/png");
  cropMode.value = false;
  cropError.value = "";
}

function invalidateResult(): void {
  if (!observation.value) return;
  observation.value.confirmed = false;
  result.value = null;
  errorMessage.value = "";
}

function editClaim(event: Event): void {
  const raw = (event.target as HTMLInputElement).value;
  applySingleEdit({ kind: "growth-percent", value: raw === "" ? null : Number(raw) });
}

function editPoint(
  pointName: "older" | "newer",
  field: "period" | "value" | "unit",
  event: Event,
): void {
  const input = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (field === "value") {
    applySingleEdit({ kind: "value", point: pointName, value: input.value === "" ? null : Number(input.value) });
    return;
  }
  applySingleEdit({ kind: field, point: pointName, value: input.value || null });
}

async function confirmAndCalculate(): Promise<void> {
  if (!observation.value) return;
  const wasConfirmed = observation.value.confirmed;
  const recordedObservation = observation.value;
  const revisionAtStart = singleClaimRevision.value;
  observation.value.confirmed = true;
  resetNotice.value = "";
  busyMessage.value = "正在用已确认数字计算…";
  errorMessage.value = "";
  result.value = null;
  try {
    const response = await fetch("/api/audit/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(observation.value),
    });
    const payload = await response.json().catch(() => null) as {
      result?: AuditResult;
      error?: { message?: string };
    } | null;
    if (!response.ok || !payload?.result) {
      throw new Error(updateErrorFrom(response, payload));
    }
    // 计算期间换图、重置或继续编辑都算会话已换，迟到的响应不写回。
    if (singleClaimRevision.value !== revisionAtStart || observation.value !== recordedObservation) return;
    result.value = payload.result;
    singleClaimLog.value = recordReview(
      singleClaimLog.value,
      { claimId: singleClaimId.value, claimText: recordedObservation.titleOriginal },
      {
        action: wasConfirmed ? "recompute" : "confirm",
        result: { status: payload.result.status, summary: payload.result.summary },
      },
    );
  } catch (error) {
    if (singleClaimRevision.value !== revisionAtStart || observation.value !== recordedObservation) return;
    recordedObservation.confirmed = false;
    errorMessage.value = error instanceof Error ? error.message : "计算失败，请重试。";
  } finally {
    busyMessage.value = "";
  }
}

function editWorkspaceClaim(claimId: string, edit: ClaimWorkspaceEdit): void {
  const workspace = claimWorkspace.value;
  if (!workspace) return;
  claimWorkspace.value = updateClaimDraft(workspace, claimId, edit);
  const errors = { ...claimErrors.value };
  delete errors[claimId];
  claimErrors.value = errors;
  resetNotice.value = "";
}

function editWorkspaceGrowth(event: Event, claimId: string): void {
  const input = event.target as HTMLInputElement;
  const value = input.value === "" ? null : Number(input.value);
  editWorkspaceClaim(claimId, { kind: "growth-percent", value });
}

function editWorkspacePoint(
  claimId: string,
  point: "older" | "newer",
  field: "period" | "value" | "unit",
  event: Event,
): void {
  const input = event.target as HTMLInputElement;
  if (field === "value") {
    const value = input.value === "" ? null : Number(input.value);
    editWorkspaceClaim(claimId, { kind: "value", point, value });
    return;
  }
  editWorkspaceClaim(claimId, {
    kind: field,
    point,
    value: input.value || null,
  });
}

async function confirmWorkspaceClaim(claimId: string): Promise<void> {
  const workspace = claimWorkspace.value;
  const submission = workspace ? toClaimAuditSubmission(workspace, claimId) : null;
  if (!workspace || !submission || busyClaimId.value) return;

  busyClaimId.value = claimId;
  resetNotice.value = "";
  const errors = { ...claimErrors.value };
  delete errors[claimId];
  claimErrors.value = errors;
  try {
    const response = await fetch("/api/audit/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submission),
    });
    const payload = await response.json().catch(() => null) as {
      result?: AuditResult;
      error?: { message?: string };
    } | null;
    if (!response.ok || !payload?.result) {
      throw new Error(updateErrorFrom(response, payload));
    }
    if (claimWorkspace.value === workspace) {
      claimWorkspace.value = completeClaimReview(workspace, claimId, payload.result);
    }
  } catch (error) {
    if (claimWorkspace.value === workspace) {
      claimErrors.value = {
        ...claimErrors.value,
        [claimId]: error instanceof Error ? error.message : "计算失败，请重试。",
      };
    }
  } finally {
    if (busyClaimId.value === claimId) busyClaimId.value = null;
  }
}

function resetSingleClaim(): void {
  const initial = initialObservation.value;
  if (!initial || !observation.value || busyMessage.value) return;

  observation.value = copyAuditObservation(initial);
  result.value = null;
  singleClaimLog.value = [];
  singleClaimRevision.value += 1;
  errorMessage.value = "";
  resetNotice.value = "已重置本次会话：读数回到最初载入的值，确认状态、结果和审计记录已清空。";
}

function resetWorkspace(): void {
  const workspace = claimWorkspace.value;
  if (!workspace || !workspace.events.length || busyClaimId.value) return;

  claimWorkspace.value = resetClaimWorkspace(workspace);
  claimErrors.value = {};
  resetNotice.value = "已重置本次会话：读数回到最初载入的值，确认状态、结果和审计记录已清空。";
}

function formatValue(value: number | null, unit: string | null): string {
  if (value === null) return "尚未读清";
  const formatted = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
  return unit === "%" ? `${formatted}%` : `${formatted}${unit ? ` ${unit}` : ""}`;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds} 毫秒`;
  return `${(milliseconds / 1000).toFixed(1)} 秒`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

function formatTokenCount(value: number | null): string {
  if (value === null) return "未返回";
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatClaimPointValue(point: GrowthClaimObservation["older"]): string {
  if (point.value === null) return point.evidenceText?.trim() ? "尚未读清" : "缺少图内依据";
  return formatValue(point.value, point.unit);
}

function isPointCorrected(entry: ClaimWorkspaceEntry, point: "older" | "newer"): boolean {
  const draft = entry.draftValues[point];
  const observed = entry.observation[point];
  return draft.value !== observed.value || draft.period !== observed.period || draft.unit !== observed.unit;
}

// 标签与原始读数行的「（已更正）」用同一判据，避免出现「标签说已更正、读数行说没改」这类矛盾。
function pointSourceLabel(
  entry: ClaimWorkspaceEntry,
  point: "older" | "newer",
  source: ObservationSource,
): string {
  if (isPointCorrected(entry, point)) return valueSourceLabel("user");
  return valueSourceLabel(initialValueSource(source, entry.observation[point]));
}

function valueSourceLabel(source: DataPointObservation["valueSource"]): string {
  if (source === "model") return "模型读取 · 待确认";
  if (source === "user") return "用户手动更正";
  if (source === "unreadable") return "图上暂不可读";
  return "预置示例值";
}

onMounted(() => {
  const landingFile = takeLandingUpload();
  updateViewportMode();
  window.addEventListener("scroll", scheduleActiveAuditStep, { passive: true });
  void loadSamples().then(() => {
    if (landingFile) prepareUploadFile(landingFile);
    scheduleActiveAuditStep();
  });
  window.addEventListener("resize", updateViewportMode);
});
onBeforeUnmount(() => {
  forgetObjectUrl();
  window.removeEventListener("resize", updateViewportMode);
  window.removeEventListener("scroll", scheduleActiveAuditStep);
  if (auditStepFrame !== undefined) window.cancelAnimationFrame(auditStepFrame);
});
</script>

<template>
  <div class="app-shell">
    <SiteHeader />

    <main id="top" class="page-shell">
      <section class="intro" aria-labelledby="page-title">
        <div>
          <p class="eyebrow">图表截图自检</p>
          <h1 id="page-title">选择一张图，核对标题与数字</h1>
          <p class="intro-copy">只比较图片里看得到的内容。没有原始来源时，我们不会把图内检查说成事实核验。</p>
        </div>
        <div class="scope-stamp" aria-label="当前检查范围：一张图片">
          <span class="scope-stamp-mark" aria-hidden="true">图</span>
          <span>检查范围<br /><strong>一张图 · 多条图内主张</strong></span>
        </div>
      </section>

      <nav class="audit-step-nav" aria-label="页面内跳转：图表、核对、结论">
        <span class="audit-step-nav-label">
          <span class="audit-mobile-current-label" aria-hidden="true">当前图：</span>
          <strong>{{ activeSample?.name ?? (selectedFileName || "未选择图表") }}</strong>
          <small>· 页内跳转</small>
        </span>
        <a href="#audit-image" :class="{ active: activeAuditStep === 'image' }" :aria-current="activeAuditStep === 'image' ? 'location' : undefined"><span>01</span> 图表</a>
        <a href="#audit-review" :class="{ active: activeAuditStep === 'review' }" :aria-current="activeAuditStep === 'review' ? 'location' : undefined"><span>02</span> 核对</a>
          <a v-if="hasAnyAuditResult" :href="result ? '#audit-result' : '#audit-claim-results'" :class="{ active: activeAuditStep === 'result' }" :aria-current="activeAuditStep === 'result' ? 'location' : undefined"><span>03</span> 结论</a>
          <span v-else aria-disabled="true"><span>03</span> 待计算</span>
        <label class="audit-mobile-step-picker">
          <span>当前步骤</span>
          <select aria-label="跳转到审计步骤" :value="activeAuditStep" @change="jumpToAuditStep">
            <option value="image">01 · 图表</option>
            <option value="review">02 · 核对</option>
            <option v-if="hasAnyAuditResult" value="result">03 · 结论</option>
            <option v-else value="result" disabled>03 · 计算后查看</option>
          </select>
        </label>
      </nav>

      <div class="workspace-grid">
        <section id="audit-image" class="image-column" aria-labelledby="image-section-title">
          <div class="section-heading">
            <div>
              <p class="eyebrow">选择检查对象</p>
              <h2 id="image-section-title">图表截图</h2>
            </div>
            <label class="upload-button" for="chart-upload">
              <span aria-hidden="true">＋</span> 上传我的截图
              <input
                id="chart-upload"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                @change="prepareUpload"
              />
            </label>
          </div>

          <div class="sample-list" aria-label="团队自制样例">
            <button
              v-for="sample in samples"
              :key="sample.id"
              class="sample-button"
              :class="{ active: activeSampleId === sample.id }"
              :aria-pressed="activeSampleId === sample.id"
              :title="sample.description"
              @click="loadSample(sample.id)"
            >
              <span class="sample-button-name">{{ sample.name }}</span>
              <span class="sample-button-detail">{{ sample.description }}</span>
            </button>
          </div>

          <div v-if="samples.length" class="mobile-sample-picker">
            <div class="mobile-sample-current">
              <small>当前检查对象</small>
              <strong>{{ activeSample?.name ?? (selectedFileName ? "你的截图" : "尚未选择") }}</strong>
            </div>
            <label for="mobile-sample-select">切换自制样例</label>
            <select id="mobile-sample-select" :value="activeSampleId ?? ''" @change="selectSample">
              <option v-if="!activeSampleId" value="" disabled>选择一张样例</option>
              <option v-for="sample in samples" :key="sample.id" :value="sample.id">{{ sample.name }}</option>
            </select>
          </div>

          <figure ref="imageStage" class="image-stage">
            <div class="image-stage-head">
              <span class="image-label"><span class="image-label-dot"></span>原图预览</span>
              <span v-if="activeSample" class="image-filename">来源：团队自制样例</span>
              <span v-else-if="selectedFileName" class="image-filename">{{ selectedFileName }}</span>
              <span v-else class="image-filename">PNG · JPG · WebP，最大 5 MB</span>
              <button
                class="crop-toggle"
                type="button"
                :disabled="!imageUrl"
                :aria-pressed="cropMode"
                @click="toggleCropMode"
              >
                {{ cropMode ? "取消框选" : cropPreview ? "重新框选" : "框选证据区域" }}
              </button>
              <button v-if="imageUrl" class="zoom-image-button" type="button" @click="openImageViewer">放大查看</button>
            </div>
            <div v-if="imageUrl" class="chart-frame">
              <div class="chart-image-wrap">
                <img ref="previewImage" :src="imageUrl" :alt="imageAlt" />
                <div
                  v-if="cropMode"
                  class="crop-overlay"
                  aria-label="拖动以框选证据区域"
                  @pointerdown="beginCrop"
                  @pointermove="updateCropSelection"
                  @pointerup="finishCrop"
                  @pointercancel="toggleCropMode"
                ></div>
                <div
                  v-if="cropMode && cropSelection"
                  class="crop-selection"
                  :style="cropSelectionStyle"
                  aria-hidden="true"
                ></div>
                <span v-if="cropMode" class="crop-instruction">拖动框住标题或数字</span>
              </div>
            </div>
            <div v-else class="image-empty">
              <div class="empty-grid" aria-hidden="true"><span></span><span></span><span></span></div>
              <strong>先选一个样例，或上传图表截图</strong>
              <span>支持清晰数字标注的柱状图与折线图</span>
            </div>
            <figcaption v-if="activeSample" class="sample-caption">
              <span>团队自制</span>
              <span>没有对应的真实业务数据</span>
            </figcaption>
          </figure>

          <dialog
            ref="imageViewer"
            class="image-viewer"
            :style="imageViewerHeight ? { height: `${imageViewerHeight}px` } : undefined"
            aria-labelledby="image-viewer-title"
            @click="closeViewerOnBackdrop"
            @close="resetImageViewer"
          >
            <div class="image-viewer-header">
              <div>
                <h2 id="image-viewer-title">放大核对图表</h2>
                <p>放大后可左右滚动查看两侧，也可用方向按钮移动。</p>
              </div>
              <div class="image-viewer-controls">
                <button v-if="imageZoom > 1" type="button" aria-label="向左查看图表" @click="panImageViewer(-1)">←</button>
                <button type="button" aria-label="缩小图表" :disabled="imageZoom <= 1" @click="changeImageZoom(-0.5)">−</button>
                <output>{{ Math.round(imageZoom * 100) }}%</output>
                <button type="button" aria-label="放大图表" :disabled="imageZoom >= 3" @click="changeImageZoom(0.5)">＋</button>
                <button v-if="imageZoom > 1" type="button" aria-label="向右查看图表" @click="panImageViewer(1)">→</button>
                <button type="button" class="image-viewer-close" @click="closeImageViewer">关闭</button>
              </div>
            </div>
            <div
              ref="imageViewerStage"
              class="image-viewer-stage"
              :style="imageViewerStageHeight ? { height: `${imageViewerStageHeight}px` } : undefined"
            >
              <img :src="imageUrl" :alt="imageAlt" :style="{ width: `${imageZoom * 100}%` }" @load="updateImageViewerStageHeight" />
            </div>
          </dialog>

          <div v-if="cropPreview && pendingUpload" class="pending-crop-preview">
            <img :src="cropPreview" alt="准备发送给视觉模型的手动选区" />
            <span>当前选区预览 · 读取时只发送此区域</span>
          </div>
          <div v-if="pendingUpload" class="upload-read-action">
            <button class="read-image-button" :disabled="Boolean(busyMessage)" @click="analyzePendingUpload">
              读取{{ cropPreview ? "选中区域" : "整张图片" }}
            </button>
            <span>{{ cropPreview ? "只会把框选区域发送给已配置的模型服务。" : "点击后把图片发送给已配置的模型服务读取。" }}</span>
          </div>
          <p v-if="cropError" class="crop-error" role="alert">{{ cropError }}</p>
          <p class="privacy-note">
            预置示例使用本地观察值。上传图片仅在点击读取时发送给你配置的 Responses API 服务；可先框选需要检查的区域。
          </p>
        </section>

        <section id="audit-review" class="review-column" aria-labelledby="observation-title">
          <div class="section-heading review-heading">
            <div>
              <p class="eyebrow">先检查识别结果</p>
              <h2 id="observation-title">图中主张与观察</h2>
            </div>
          <div v-if="chartObservation" class="observation-meta">
              <span class="source-badge" :class="chartObservation.source">{{ sourceLabel }}</span>
              <span v-if="observation" class="confirmation-state" :class="{ confirmed: observation.confirmed }">{{ confirmationLabel }}</span>
              <span v-else-if="hasMultipleClaims" class="confirmation-state informational">各项主张可独立核对</span>
              <span v-else-if="hasNoClaims" class="confirmation-state">未发现可核对主张</span>
            </div>
          </div>

          <section v-if="modelRead" class="model-read" aria-label="模型读取过程">
            <div class="model-read-head">
              <span class="model-read-kicker">模型读取过程</span>
              <span class="model-read-facts">
                <span class="model-read-model">{{ modelRead.model }}</span>
                <span>耗时 {{ formatDuration(modelRead.latencyMs) }}</span>
                <span>发送{{ modelReadRegion === "crop" ? "框选区域" : "整张图片" }}（{{ formatBytes(modelRead.imageBytes) }}）</span>
                <span v-if="modelRead.usage">
                  用量 输入 {{ formatTokenCount(modelRead.usage.inputTokens) }} / 输出 {{ formatTokenCount(modelRead.usage.outputTokens) }} tokens
                </span>
              </span>
            </div>
            <details class="model-read-raw">
              <summary>模型原始返回（未经校验）</summary>
              <pre>{{ modelRead.rawText }}</pre>
              <p class="model-read-note">
                以上是模型直接返回的文本。它通过结构校验后才生成下方核对表里的观察值与来源标记；模型不返回确认状态、计算值或结论。
                <span v-if="modelRead.requestId" class="model-read-request">响应 id：{{ modelRead.requestId }}</span>
              </p>
            </details>
          </section>

          <AuditSessionBar
            v-if="hasMultipleClaims && chartObservation && claimWorkspace"
            :disabled="!claimWorkspace.events.length || busyClaimId !== null"
            :notice="resetNotice"
            @reset="resetWorkspace"
          />
          <div v-if="hasMultipleClaims && chartObservation && claimWorkspace" id="audit-claim-results" class="claim-observation-list" aria-label="图内主张和证据">
            <details v-for="(entry, index) in claimWorkspace.claims" :key="entry.observation.id" class="claim-observation-card" :open="index === 0">
              <summary class="claim-observation-summary">
                <span class="claim-observation-number">主张 {{ index + 1 }}</span>
                <span class="confirmation-state" :class="{ confirmed: entry.confirmationState === 'confirmed' }">{{ entry.confirmationState === "confirmed" ? "输入已确认" : "待核对" }}</span>
                <strong class="claim-observation-title">{{ entry.observation.claimText || "主张原文尚未读清" }}</strong>
                <span class="claim-observation-toggle"><span class="claim-toggle-closed">查看证据</span><span class="claim-toggle-open">收起证据</span></span>
              </summary>
              <div class="claim-observation-body">
                <label class="field-block claim-workspace-growth">
                  <span class="field-label">标题声称增长</span>
                  <span class="input-with-suffix">
                    <input
                      :value="entry.draftValues.claimedGrowthPercent ?? ''"
                      type="number"
                      step="any"
                      :disabled="busyClaimId === entry.observation.id"
                      @input="editWorkspaceGrowth($event, entry.observation.id)"
                    />
                    <span>%</span>
                  </span>
                  <small>图上原文：{{ entry.observation.claimText || "尚未读清" }}</small>
                </label>
                <div class="claim-observation-points">
                  <section class="claim-observation-point">
                    <div class="claim-point-head">
                      <span class="field-label">较早观察</span>
                      <span class="value-source">{{ pointSourceLabel(entry, 'older', claimWorkspace.source) }}</span>
                    </div>
                    <p class="claim-raw-observation">
                      图上原始读数：{{ entry.observation.older.period || "时间未读取" }} · {{ formatClaimPointValue(entry.observation.older) }}
                      <span v-if="isPointCorrected(entry, 'older')" class="claim-raw-corrected">（已更正）</span>
                    </p>
                    <div class="claim-workspace-point-fields">
                      <label class="field-block">
                        <span class="field-label">核对时间</span>
                        <input :value="entry.draftValues.older.period ?? ''" maxlength="80" :disabled="busyClaimId === entry.observation.id" @input="editWorkspacePoint(entry.observation.id, 'older', 'period', $event)" />
                      </label>
                      <label class="field-block">
                        <span class="field-label">核对数值</span>
                        <input :value="entry.draftValues.older.value ?? ''" type="number" step="any" :disabled="busyClaimId === entry.observation.id" @input="editWorkspacePoint(entry.observation.id, 'older', 'value', $event)" />
                      </label>
                      <label class="field-block">
                        <span class="field-label">单位</span>
                        <input :value="entry.draftValues.older.unit ?? ''" maxlength="40" :disabled="busyClaimId === entry.observation.id" @input="editWorkspacePoint(entry.observation.id, 'older', 'unit', $event)" />
                      </label>
                    </div>
                    <blockquote><span class="claim-evidence-label">图内证据</span>{{ entry.observation.older.evidenceText || "缺少图中文字依据" }}</blockquote>
                  </section>
                  <section class="claim-observation-point">
                    <div class="claim-point-head">
                      <span class="field-label">较新观察</span>
                      <span class="value-source">{{ pointSourceLabel(entry, 'newer', claimWorkspace.source) }}</span>
                    </div>
                    <p class="claim-raw-observation">
                      图上原始读数：{{ entry.observation.newer.period || "时间未读取" }} · {{ formatClaimPointValue(entry.observation.newer) }}
                      <span v-if="isPointCorrected(entry, 'newer')" class="claim-raw-corrected">（已更正）</span>
                    </p>
                    <div class="claim-workspace-point-fields">
                      <label class="field-block">
                        <span class="field-label">核对时间</span>
                        <input :value="entry.draftValues.newer.period ?? ''" maxlength="80" :disabled="busyClaimId === entry.observation.id" @input="editWorkspacePoint(entry.observation.id, 'newer', 'period', $event)" />
                      </label>
                      <label class="field-block">
                        <span class="field-label">核对数值</span>
                        <input :value="entry.draftValues.newer.value ?? ''" type="number" step="any" :disabled="busyClaimId === entry.observation.id" @input="editWorkspacePoint(entry.observation.id, 'newer', 'value', $event)" />
                      </label>
                      <label class="field-block">
                        <span class="field-label">单位</span>
                        <input :value="entry.draftValues.newer.unit ?? ''" maxlength="40" :disabled="busyClaimId === entry.observation.id" @input="editWorkspacePoint(entry.observation.id, 'newer', 'unit', $event)" />
                      </label>
                    </div>
                    <blockquote><span class="claim-evidence-label">图内证据</span>{{ entry.observation.newer.evidenceText || "缺少图中文字依据" }}</blockquote>
                  </section>
                </div>
                <ul v-if="entry.observation.unreadableItems.length" class="unreadable-list" aria-label="无法辨认内容">
                  <li v-for="item in entry.observation.unreadableItems" :key="item">暂时无法辨认：{{ item }}</li>
                </ul>
                <button class="confirm-button" :disabled="busyClaimId !== null" @click="confirmWorkspaceClaim(entry.observation.id)">
                  {{ busyClaimId === entry.observation.id ? "正在计算…" : entry.confirmationState === "confirmed" ? "重新计算此主张" : "确认并计算此主张" }}
                </button>
                <p class="confirm-hint">此操作只更新当前主张；其他主张的确认状态与结果保持不变。</p>
                <div v-if="claimErrors[entry.observation.id]" class="error-message" role="alert">{{ claimErrors[entry.observation.id] }}</div>
                <section v-if="entry.result" class="result-sheet claim-result-sheet" :aria-label="`${entry.observation.claimText || '主张'}的图内结果`">
                  <div class="result-sheet-top">
                    <span class="result-kicker">当前主张的图内结果</span>
                    <span class="result-status" :class="entry.result.status">
                      <span class="result-status-mark" aria-hidden="true"></span>
                      {{ auditStatusLabel(entry.result.status) }}
                    </span>
                  </div>
                  <h4 class="result-title">{{ entry.result.summary }}</h4>
                  <p v-if="entry.result.formula" class="formula-line"><span>公式</span><code>{{ entry.result.formula }}</code></p>
                  <ul v-if="entry.result.reasons.length" class="result-reasons">
                    <li v-for="reason in entry.result.reasons" :key="reason">{{ reason }}</li>
                  </ul>
                  <p class="result-boundary">这只说明已确认的图内观察与主张是否一致，不代表现实数据已核实。</p>
                </section>
                <AuditRecordList
                  v-if="claimAuditRows[entry.observation.id]?.length"
                  :rows="claimAuditRows[entry.observation.id]"
                />
              </div>
            </details>
          </div>

          <div v-else-if="observation" class="observation-form">
            <AuditSessionBar
              :disabled="!singleClaimAuditRows.length || Boolean(busyMessage)"
              :notice="resetNotice"
              @reset="resetSingleClaim"
            />

            <label class="field-block title-field">
              <span class="field-label">图表标题 · 原图摘录 · 只读</span>
              <textarea
                :value="observation.titleOriginal ?? ''"
                rows="2"
                maxlength="240"
                placeholder="图片中的标题尚未读清"
                readonly
              ></textarea>
            </label>

            <label class="field-block claim-field">
              <span class="field-label">标题声称增长</span>
              <span class="input-with-suffix">
                <input
                  :value="observation.claimedGrowthPercent ?? ''"
                  type="number"
                  step="any"
                  placeholder="未提取"
                  @input="editClaim"
                />
                <span>%</span>
              </span>
            </label>

            <div class="point-editor">
              <div class="point-editor-head">
                <div><span class="field-label">较早数值</span><span class="period-hint">时间顺序以标签为准</span></div>
                <span class="value-source">{{ valueSourceLabel(observation.older.valueSource) }}</span>
              </div>
              <div class="point-fields">
                <label class="field-block period-field">
                  <span class="field-label">年份 / 类别</span>
                  <input
                    :value="observation.older.period ?? ''"
                    maxlength="80"
                    placeholder="如：2024 年"
                    @input="editPoint('older', 'period', $event)"
                  />
                </label>
                <label class="field-block number-field">
                    <span class="field-label">数值 · 可核对</span>
                  <input
                    :value="observation.older.value ?? ''"
                    type="number"
                    step="any"
                    placeholder="未读清"
                    @input="editPoint('older', 'value', $event)"
                  />
                </label>
                <label class="field-block unit-field">
                  <span class="field-label">单位</span>
                  <input
                    :value="observation.older.unit ?? ''"
                    maxlength="40"
                    placeholder="如：万元"
                    @input="editPoint('older', 'unit', $event)"
                  />
                </label>
              </div>
              <div class="field-block evidence-field">
                <div class="evidence-field-head">
                  <label class="field-label" for="older-evidence">原图上的数字 · 只读</label>
                  <button class="evidence-locate-button" type="button" aria-label="回到原图核对较早数值" @click="returnToImage">回看原图</button>
                </div>
                <input
                  id="older-evidence"
                  :value="observation.older.evidenceText ?? ''"
                  readonly
                />
              </div>
            </div>

            <div class="point-editor newer-editor">
              <div class="point-editor-head">
                <div><span class="field-label">较新数值</span><span class="period-hint">较早之后的观察值</span></div>
                <span class="value-source">{{ valueSourceLabel(observation.newer.valueSource) }}</span>
              </div>
              <div class="point-fields">
                <label class="field-block period-field">
                  <span class="field-label">年份 / 类别</span>
                  <input
                    :value="observation.newer.period ?? ''"
                    maxlength="80"
                    placeholder="如：2025 年"
                    @input="editPoint('newer', 'period', $event)"
                  />
                </label>
                <label class="field-block number-field">
                    <span class="field-label">数值 · 可核对</span>
                  <input
                    :value="observation.newer.value ?? ''"
                    type="number"
                    step="any"
                    placeholder="未读清"
                    @input="editPoint('newer', 'value', $event)"
                  />
                </label>
                <label class="field-block unit-field">
                  <span class="field-label">单位</span>
                  <input
                    :value="observation.newer.unit ?? ''"
                    maxlength="40"
                    placeholder="如：万元"
                    @input="editPoint('newer', 'unit', $event)"
                  />
                </label>
              </div>
              <div class="field-block evidence-field">
                <div class="evidence-field-head">
                  <label class="field-label" for="newer-evidence">原图上的数字 · 只读</label>
                  <button class="evidence-locate-button" type="button" aria-label="回到原图核对较新数值" @click="returnToImage">回看原图</button>
                </div>
                <input
                  id="newer-evidence"
                  :value="observation.newer.evidenceText ?? ''"
                  readonly
                />
              </div>
            </div>

            <ul v-if="observation.unreadableItems.length" class="unreadable-list" aria-label="无法辨认内容">
              <li v-for="item in observation.unreadableItems" :key="item">暂时无法辨认：{{ item }}</li>
            </ul>

            <button class="confirm-button" :disabled="Boolean(busyMessage)" @click="confirmAndCalculate">
              {{ observation.confirmed ? "确认读数并重新计算" : "确认读数并计算" }}
            </button>
            <p class="confirm-hint">
              {{ observation.confirmed ? "读数已确认；更改任一字段后，需要重新确认并更新结论。" : "确认前不输出确定的数值结论，请先核对图中读数。" }}
            </p>
          </div>

          <div v-else-if="hasNoClaims" class="review-empty">
            <span class="review-empty-mark" aria-hidden="true">?</span>
            <strong>没有发现可核对的增长率主张</strong>
            <p>当前图片没有返回可核对的主张，因此不会生成图内结论。</p>
          </div>

          <div v-else class="review-empty">
            <span class="review-empty-mark" aria-hidden="true">?</span>
            <strong>{{ pendingUpload ? "图片已就绪，读取后由你核对数字" : "读取后，先由你核对每个数字" }}</strong>
            <p>{{ pendingUpload ? "可以先在左侧框选图表区域，再读取标题、数值和单位。" : "如果模型看错了年份、数值或单位，可以直接在这里更正。" }}</p>
          </div>

          <div v-if="busyMessage" class="busy-message" role="status" aria-live="polite">
            <span class="spinner" aria-hidden="true"></span>{{ busyMessage }}
          </div>
          <div v-if="errorMessage" class="error-message" role="alert">{{ errorMessage }}</div>

          <section v-if="result && observation" id="audit-result" class="result-sheet" tabindex="-1" aria-live="polite" aria-labelledby="result-title">
            <div class="result-sheet-top">
              <span class="result-kicker">图内结论</span>
              <span class="result-status" :class="result.status">
                <span class="result-status-mark" aria-hidden="true"></span>
                {{ resultLabel }}
              </span>
            </div>
            <h3 id="result-title" class="result-title">{{ result.summary }}</h3>
            <p v-if="result.formula" class="formula-line">
              <span>公式</span>
              <code>{{ result.formula }}</code>
            </p>
            <p v-else class="formula-line formula-missing">
              补全并确认两个数值、单位和时间后，才会代入增长率公式。
            </p>
            <ul v-if="result.reasons.length" class="result-reasons">
              <li v-for="reason in result.reasons" :key="reason">{{ reason }}</li>
            </ul>
            <p class="result-boundary">这只说明标题与已确认的图中文字是否一致；没有原始数据来源，不能核实真实数据。</p>
            <a class="evidence-jump" href="#evidence-details">查看完整证据摘录</a>
          </section>

          <AuditRecordList v-if="singleClaimAuditRows.length" :rows="singleClaimAuditRows" />
        </section>
      </div>

      <details
        v-if="observation"
        id="evidence-details"
        ref="evidenceLedger"
        class="evidence-ledger"
        :open="!isNarrowViewport"
        aria-labelledby="evidence-title"
      >
        <summary class="ledger-summary">
          <span class="ledger-summary-copy">
            <span class="eyebrow">可回到原图检查</span>
            <span id="evidence-title" class="ledger-title" role="heading" aria-level="2">证据摘录</span>
          </span>
          <span class="ledger-summary-note">图中文字与用户确认值分开显示。</span>
          <span class="ledger-summary-cue" aria-hidden="true"></span>
        </summary>
        <div class="ledger-body">
        <div v-if="cropPreview" class="crop-evidence-row">
          <figure class="crop-evidence-image">
            <img :src="cropPreview" alt="用户从原图框选的证据区域" />
            <figcaption>原图中的手动选区</figcaption>
          </figure>
          <div class="crop-evidence-text">
            <p><span>标题原文</span><strong>{{ observation.titleOriginal || "尚未读清" }}</strong></p>
            <p><span>较早标注</span><strong>{{ observation.older.evidenceText || "缺少图中文字依据" }}</strong></p>
            <p><span>较新标注</span><strong>{{ observation.newer.evidenceText || "缺少图中文字依据" }}</strong></p>
            <small>选区用于回看定位；请以原图确认摘录文字。</small>
          </div>
        </div>
        <div class="ledger-grid">
          <article class="ledger-entry title-entry">
            <span class="ledger-label">标题原文</span>
            <blockquote>{{ observation.titleOriginal || "标题尚未读清" }}</blockquote>
            <span class="ledger-source">{{ observation.source === "vision-model" ? "来自模型读取，待用户确认" : "团队自制样例中的预置观察值" }}</span>
          </article>
          <article class="ledger-entry">
            <span class="ledger-label">较早标注</span>
            <strong>{{ observation.older.period || "时间未读取" }} · {{ formatValue(observation.older.value, observation.older.unit) }}</strong>
            <blockquote>{{ observation.older.evidenceText || "缺少图中文字依据" }}</blockquote>
            <span class="ledger-source">{{ valueSourceLabel(observation.older.valueSource) }}</span>
          </article>
          <article class="ledger-entry">
            <span class="ledger-label">较新标注</span>
            <strong>{{ observation.newer.period || "时间未读取" }} · {{ formatValue(observation.newer.value, observation.newer.unit) }}</strong>
            <blockquote>{{ observation.newer.evidenceText || "缺少图中文字依据" }}</blockquote>
            <span class="ledger-source">{{ valueSourceLabel(observation.newer.valueSource) }}</span>
          </article>
        </div>
        </div>
      </details>

      <footer class="page-footer">
        <span>图证 / 单图图内审计</span>
        <span>判断范围止于这张截图</span>
      </footer>
    </main>
  </div>
</template>
