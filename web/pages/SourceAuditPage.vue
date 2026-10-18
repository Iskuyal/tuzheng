<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import SiteHeader from "../components/SiteHeader.vue";
import OriginalImageViewer from "../components/OriginalImageViewer.vue";
import { takeLandingUpload, takeLandingSourceSampleRequest } from "../upload-transfer.js";
import SourceClaimCard from "../components/SourceClaimCard.vue";
import {
  CAPTION_CHANGE_LABELS,
  CLAIM_STATUS_LABELS,
  CLARIFICATION_FIELD_LABELS,
  TOOL_LABELS,
  type ClaimSourceStatus,
  type PublicSourceLibraryEntry,
  type SourceClaim,
  type SourceInvestigationResult,
  type ToolTraceEvent,
} from "../../shared/source-audit.js";

interface SourceAuditSample {
  id: string;
  name: string;
  imageUrl: string;
  caption: string;
  imageText: string;
  note: string;
}

interface ClaimRow {
  claim: SourceClaim;
  conclusion: SourceInvestigationResult["conclusions"][number] | null;
  index: number;
}

/** 被顶替或失效的历史结论；只作历史展示，不能当作当前结果。 */
interface HistoryEntry {
  result: SourceInvestigationResult;
  reason: string;
  /** 这条历史结果是被用户「采用建议」顶替的：历史里据此标明已采用。 */
  adopted?: boolean;
}

const route = useRoute();
const imageViewerOpen = ref(false);
const clarificationDeferred = ref(false);
const settingsLocation = computed(() => ({ name: "settings", query: { returnTo: route.fullPath.split("#")[0] } }));

function focusMaterials(): void {
  const input = document.getElementById("source-audit-caption");
  input?.scrollIntoView({ block: "center", behavior: "instant" });
  input?.focus({ preventScroll: true });
}
function navigateSection(id: string): void {
  const target = document.getElementById(id);
  if (target instanceof HTMLDetailsElement) {
    target.open = true;
    target.querySelector("summary")?.focus({ preventScroll: true });
  }
  target?.scrollIntoView({ block: "start", behavior: "instant" });
  target?.focus({ preventScroll: true });
}

onActivated(() => {
  const file = takeLandingUpload("source-audit");
  const sampleRequested = takeLandingSourceSampleRequest();
  if (!file) {
    if (sampleRequested && sample.value) void loadSampleImage();
    return;
  }
  invalidateCurrentResult("已更换图片，旧结果已失效");
  setPendingImage(file, file.name);
  caption.value = "";
  errorMessage.value = "";
  errorCode.value = "";
});
onDeactivated(() => {
  if (busy.value) cancelRun();
  imageViewerOpen.value = false;
});
const library = ref<PublicSourceLibraryEntry[]>([]);
const sampleLoading = ref(true);
const inputNotice = ref("");
const sampleController = new AbortController();
const sample = ref<SourceAuditSample | null>(null);
const caption = ref("");
const selectedFileName = ref("");
const pendingFile = ref<File | null>(null);
const previewUrl = ref("");
const busy = ref(false);
const elapsedSeconds = ref(0);
const errorMessage = ref("");
const errorCode = ref("");
const adoptedNotice = ref("");
const result = ref<SourceInvestigationResult | null>(null);
const history = ref<HistoryEntry[]>([]);
const clarificationAnswer = ref("");
const libraryOpen = ref(false);
watch(() => route.hash, (hash) => {
  if (route.name === "source-audit" && hash === "#source-library") libraryOpen.value = true;
}, { immediate: true });
let timer: number | null = null;
let controller: AbortController | null = null;
/** 请求序号：输入改动或取消时递增，在途响应若序号过期直接丢弃，不写回旧结论。 */
let requestSeq = 0;

function fieldLabel(field: string): string {
  return CLARIFICATION_FIELD_LABELS[field as keyof typeof CLARIFICATION_FIELD_LABELS] ?? field;
}

function statusClass(status: ClaimSourceStatus): string {
  return status === "source-match" ? "source-state-ok"
    : status === "source-mismatch" ? "source-state-conflict"
      : status === "not-verifiable" ? "source-state-out-of-scope"
        : "source-state-pending";
}

/** 引用只显示标题；找不到（理论上不该发生）时退回资料 ID。 */
function sourceTitle(sourceId: string): string {
  return result.value?.hits.find((hit) => hit.document.id === sourceId)?.document.title ?? sourceId;
}

/** 资料库条目标题；修订声明里指向的那份发布也用它显示。 */
function libraryTitle(sourceId: string): string {
  return library.value.find((entry) => entry.id === sourceId)?.title ?? sourceId;
}

/** 在历史条目的对照里按主张原文找补证前状态；配不上对或本来就没有对照时返回 null。 */
function changeBefore(
  changes: SourceInvestigationResult["conclusionChanges"],
  claimText: string,
): ClaimSourceStatus | null {
  return changes?.find((change) => change.claimText === claimText)?.before ?? null;
}

/** 把当前结论顶进历史并标记原因；历史只作展示，不参与当前判断。 */
function retireCurrentResult(reason: string, adopted = false): void {
  if (!result.value) return;
  history.value.unshift({ result: result.value, reason, adopted });
  result.value = null;
  clarificationAnswer.value = "";
  clarificationDeferred.value = false;
}

/**
 * 输入（图片或配文）改动即失效：当前结论移入历史、在途请求作废、迟到响应被序号挡住。
 * 依赖旧输入的证据与结论不能继续冒充当前结果——即使此刻还没有展示中的结论，
 * 在途请求也必须作废，否则迟到响应会把旧输入的结论写回来。
 */
function invalidateCurrentResult(reason: string): void {
  requestSeq += 1;
  controller?.abort();
  controller = null;
  if (busy.value) {
    busy.value = false;
    stopTimer();
  }
  retireCurrentResult(reason);
}

function startTimer(): void {
  stopTimer();
  elapsedSeconds.value = 0;
  timer = window.setInterval(() => { elapsedSeconds.value += 1; }, 1000);
}

function stopTimer(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

onBeforeUnmount(() => {
  stopTimer();
  controller?.abort();
  sampleController.abort();
  if (previewUrl.value.startsWith("blob:")) URL.revokeObjectURL(previewUrl.value);
});

// 配文一改动（含月份、范围、比较方式这些写在配文里的口径），旧结论立即失效。
// 无条件作废：即便当前没有展示中的结论，在途请求也必须被挡掉。
watch(caption, () => {
  invalidateCurrentResult("配文已改动，结论已失效");
});

onMounted(async () => {
  try {
    const response = await fetch("/api/source-audit/library");
    if (response.ok) {
      const body = await response.json() as { library: PublicSourceLibraryEntry[] };
      library.value = body.library;
    }
  } catch {
    // 资料库清单只用于展示，取不到时不影响核验路径。
  }
  try {
    const response = await fetch("/api/source-audit/sample", { signal: sampleController.signal });
    if (!response.ok) throw new Error("sample-unavailable");
    const body = await response.json() as { sample: SourceAuditSample };
    sample.value = body.sample;
    if (route.query.sample === sample.value.id && !pendingFile.value && !caption.value) await loadSampleImage();
  } catch {
    if (!sampleController.signal.aborted) errorMessage.value = "CPI 样例暂时无法载入，请刷新重试或手动上传图片并填写配文。";
  } finally {
    sampleLoading.value = false;
  }
});

const claimsWithConclusions = computed<ClaimRow[]>(() => {
  const investigation = result.value;
  if (!investigation) return [];
  return investigation.claims.map((claim, index) => ({
    claim,
    conclusion: investigation.conclusions[index] ?? null,
    index,
  }));
});

const imageClaims = computed(() => claimsWithConclusions.value.filter((row) => row.claim.fromImage));
const captionClaims = computed(() => claimsWithConclusions.value.filter((row) => !row.claim.fromImage));
function summarizeClaims(label: string, rows: ClaimRow[]): string {
  if (!rows.length) return `${label}：本次未拆出可核验主张。`;
  const counts = new Map<ClaimSourceStatus, number>();
  for (const row of rows) {
    const status = row.conclusion?.status ?? "source-pending";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return `${label}：${Array.from(counts, ([status, count]) => `${count} 条${CLAIM_STATUS_LABELS[status]}`).join("；")}。`;
}
const resultOverview = computed(() => [summarizeClaims("配文", captionClaims.value), summarizeClaims("图内观察", imageClaims.value)]);
const primaryFinding = computed(() => {
  if (result.value?.clarification) return result.value.clarification.question;
  const rows = captionClaims.value;
  const row = rows.find((entry) => entry.conclusion?.status !== "source-match") ?? rows[0] ?? imageClaims.value[0];
  return row?.conclusion
    ? `${row.claim.fromImage ? "图上" : "配文"}「${row.claim.claimText}」：${CLAIM_STATUS_LABELS[row.conclusion.status]}。`
    : "本次没有形成可用结论，请查看停止原因和工具记录。";
});
/** 只检查附注的可见引文，不把字面匹配当成语义或来源核验。 */
const unmatchedNoteQuotes = computed(() => {
  const current = caption.value.replace(/\s/g, "");
  const proposed = result.value?.captionSuggestion?.suggestedCaption.replace(/\s/g, "") ?? "";
  const quotes = (result.value?.captionSuggestion?.notes ?? []).flatMap((note) => Array.from(note.matchAll(/「([^」]+)」/g), (match) => match[1]));
  return [...new Set(quotes.filter((quote) => !current.includes(quote.replace(/\s/g, "")) && !proposed.includes(quote.replace(/\s/g, ""))))];
});
const unmatchedSuggestionNotes = computed(() => (result.value?.captionSuggestion?.notes ?? []).filter((note) => unmatchedNoteQuotes.value.some((quote) => note.includes(`「${quote}」`))));
const matchedSuggestionNotes = computed(() => (result.value?.captionSuggestion?.notes ?? []).filter((note) => !unmatchedSuggestionNotes.value.includes(note)));

const citedSourceIds = computed(() => new Set(
  (result.value?.acceptedCitations ?? []).map((citation) => citation.sourceId),
));

function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool;
}

function traceStatusLabel(status: ToolTraceEvent["status"]): string {
  return status === "ok" ? "已执行" : status === "rejected" ? "未执行" : "失败";
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} 秒` : `${ms} 毫秒`;
}

/** 引用角色决定这份材料能支持哪一类判断，复查时要看得到。 */
function citationRoleLabel(sourceId: string): string {
  const citation = result.value?.acceptedCitations.find((entry) => entry.sourceId === sourceId);
  if (!citation) return "";
  return citation.role === "value-basis" ? "用作数值依据"
    : citation.role === "term-explanation" ? "只用于解释术语"
      : "仅作背景";
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  if (!file) return;
  errorMessage.value = "";
  errorCode.value = "";
  adoptedNotice.value = "";
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    errorMessage.value = "请上传 PNG、JPG 或 WebP 图片。";
    input.value = "";
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    errorMessage.value = "图片不能超过 5 MB。";
    input.value = "";
    return;
  }
  invalidateCurrentResult("图片已改动，结论已失效");
  setPendingImage(file, file.name);
  input.value = "";
}

function setPendingImage(file: File, name: string): void {
  pendingFile.value = file;
  selectedFileName.value = name;
  if (previewUrl.value.startsWith("blob:")) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = URL.createObjectURL(file);
  inputNotice.value = "图片已载入，未开始核验。请核对配文后点击「运行来源核验」。";
}

async function loadSampleImage(): Promise<void> {
  if (!sample.value) return;
  errorMessage.value = "";
  errorCode.value = "";
  adoptedNotice.value = "";
  invalidateCurrentResult("已载入样例图片，旧结论已失效");
  const inputSeq = requestSeq;
  try {
    const response = await fetch(sample.value.imageUrl, { signal: sampleController.signal });
    if (!response.ok) throw new Error("sample-unavailable");
    const blob = await response.blob();
    // 下载期间的用户输入优先；迟到的样例不能覆盖新图片或配文。
    if (inputSeq !== requestSeq || sampleController.signal.aborted) return;
    setPendingImage(new File([blob], `${sample.value.id}.png`, { type: "image/png" }), sample.value.name);
    caption.value = sample.value.caption;
  } catch {
    if (inputSeq === requestSeq && !sampleController.signal.aborted) errorMessage.value = "样例图片暂时取不到，请改用手动上传。";
  }
}

function cancelRun(): void {
  requestSeq += 1;
  controller?.abort();
  controller = null;
  busy.value = false;
  stopTimer();
  errorMessage.value = "已取消这次来源核验。";
  void nextTick(() => document.querySelector<HTMLButtonElement>('[data-testid="run-source-audit"]')?.focus());
}

type PostOutcome =
  | { kind: "ok"; investigation: SourceInvestigationResult }
  | { kind: "error"; code: string; message: string }
  | { kind: "aborted"; message: string }
  | { kind: "stale" };

/**
 * 初查与补证恢复共用的提交：请求序号令牌 + AbortController 实现在途隔离——
 * 输入改动或取消会递增令牌，迟到响应即使到达也被丢弃，不写回旧结论。
 */
async function postInvestigation(path: string, form: FormData, cancelMessage: string): Promise<PostOutcome> {
  const seq = ++requestSeq;
  busy.value = true;
  startTimer();
  controller = new AbortController();
  try {
    const response = await fetch(path, { method: "POST", body: form, signal: controller.signal });
    const body = await response.json().catch(() => null) as
      | { investigation: SourceInvestigationResult }
      | { error: { code: string; message: string } }
      | null;
    if (seq !== requestSeq) return { kind: "stale" };
    if (!response.ok) {
      const failure = body && "error" in body ? body.error : null;
      return {
        kind: "error",
        code: failure?.code ?? "",
        message: failure?.message ?? "来源核验没有完成，请稍后重试。",
      };
    }
    if (!body || !("investigation" in body)) {
      return { kind: "error", code: "", message: "服务端返回内容无法识别，请重试。" };
    }
    return { kind: "ok", investigation: body.investigation };
  } catch (error) {
    if (seq !== requestSeq) return { kind: "stale" };
    if (error instanceof Error && error.name === "AbortError") {
      return { kind: "aborted", message: cancelMessage };
    }
    return { kind: "error", code: "", message: "无法连接本机服务端，请确认开发服务正在运行。" };
  } finally {
    if (seq === requestSeq) {
      busy.value = false;
      stopTimer();
      controller = null;
    }
  }
}

function applyOutcome(outcome: PostOutcome): boolean {
  if (outcome.kind === "stale") return false;
  if (outcome.kind === "aborted") {
    errorMessage.value = outcome.message;
    return false;
  }
  if (outcome.kind === "error") {
    errorCode.value = outcome.code;
    errorMessage.value = outcome.message;
    return false;
  }
  return true;
}

function buildAuditForm(): FormData {
  const form = new FormData();
  form.append("image", pendingFile.value as File);
  form.append("caption", caption.value.trim());
  return form;
}

async function runInvestigation(): Promise<void> {
  errorMessage.value = "";
  errorCode.value = "";
  adoptedNotice.value = "";
  // 重新核验会顶替当前结果；旧结论进历史，即使本次失败也不复活。
  retireCurrentResult("重新核验，上一份结论已转为历史");
  if (!pendingFile.value) {
    errorMessage.value = "请先上传图表图片，或载入团队自制 CPI 样例。";
    document.getElementById("source-audit-upload")?.focus();
    return;
  }
  if (!caption.value.trim()) {
    errorMessage.value = "请填写要核对的配文，至少一句话。";
    document.getElementById("source-audit-caption")?.focus();
    return;
  }

  const outcome = await postInvestigation("/api/source-audit/investigate", buildAuditForm(), "已取消这次来源核验。");
  if (!applyOutcome(outcome) || outcome.kind !== "ok") return;
  result.value = outcome.investigation;
  await nextTick();
  document.getElementById("source-result-title")?.focus();
}

/** 提交对追问的回答，沿同一段对话恢复调查；旧结果在成功后转为历史。 */
async function submitClarification(): Promise<void> {
  errorMessage.value = "";
  errorCode.value = "";
  const current = result.value;
  if (!current?.clarification || !current.investigationId) return;
  if (!clarificationAnswer.value.trim()) {
    errorMessage.value = "请先填写对追问的回答。";
    document.getElementById("source-clarification-answer")?.focus();
    return;
  }
  if (!pendingFile.value) {
    errorMessage.value = "图片已丢失，请重新发起核验。";
    return;
  }

  const form = buildAuditForm();
  form.append("answer", clarificationAnswer.value.trim());
  form.append("investigationId", current.investigationId);

  const outcome = await postInvestigation("/api/source-audit/resume", form, "已取消这次补充恢复。");
  if (!applyOutcome(outcome) || outcome.kind !== "ok") return;
  // 同一条记录的前后两段：补证前的结论转为历史，恢复段成为当前结果。
  retireCurrentResult("已由补证结果接续，本段转为历史");
  result.value = outcome.investigation;
  await nextTick();
  document.getElementById("source-result-title")?.focus();
}

/**
 * 采用修改建议：只把建议文本写进配文输入框，不自动替换。
 * 输入一改，旧结论与旧建议随即撤回并转入历史；采用记录留在历史里，提示重新核验。
 */
function adoptSuggestion(): void {
  const suggestion = result.value?.captionSuggestion;
  if (!suggestion) return;
  retireCurrentResult("已采用修改建议：配文输入框改为建议文本，旧结论与旧建议撤回", true);
  errorMessage.value = "";
  errorCode.value = "";
  caption.value = suggestion.suggestedCaption;
  adoptedNotice.value = "已采用修改建议：建议文本已写入配文输入框，请重新核验后再使用。";
  document.getElementById("source-audit-caption")?.focus();
}
</script>

<template>
  <div class="app-shell evidence-room">
    <SiteHeader />
    <main class="page-shell source-audit-page room-source" :class="{ 'has-result': result }">
      <section class="room-intro">
        <p class="room-breadcrumb"><RouterLink to="/">开始</RouterLink> / 来源核验 <span v-if="result"> / 阅读结果</span></p>
        <h1><template v-if="result">每一项判断，<br class="room-mobile-break" />都回到依据。</template><template v-else>先把图表与配文<br class="room-mobile-break" />放在一起。</template></h1>
        <p>逐条核对说法，把适用来源和仍待确认的部分分开。</p>
        <button v-if="result" type="button" class="room-button secondary room-back" @click="focusMaterials">← 回到材料</button>
      </section>
      <aside v-if="errorMessage || adoptedNotice" class="room-state-overview" :class="{ 'is-error': errorMessage }" aria-label="当前任务状态">
        <strong>{{ adoptedNotice ? "配文已更新，等待重新核验。" : "本次未形成新结论，材料已保留。" }}</strong>
        <button type="button" class="room-inline-button" @click="focusMaterials">{{ adoptedNotice ? "查看配文并重新核验 ↓" : "返回材料，重试或编辑 ↓" }}</button>
      </aside>
      <ol v-if="!result" class="room-steps" aria-label="核验步骤"><li aria-current="step"><span>01</span> 整理材料</li><li><span>02</span> 核验主张</li><li><span>03</span> 阅读依据</li></ol>

      <details class="source-mechanism">
        <summary>查看核验机制与使用边界</summary>
        <p>模型识别图文主张，自行选择检索、比较数值或请求确认等受限工具；程序校验工具名、参数、预算与引用。每轮最多 3 次工具调用，单次调查最多 6 次，仅一次补证机会。</p>
        <p>资料库在构建期固定，运行时不抓取开放网络。检索命中仍需匹配指标、月份、范围与比较方式；用户补充不等于官方证据，术语页不能作为数值依据。结果只说明与所引来源的关系。</p>
        <p>图片和配文仅在点击「运行来源核验」后发送到所配模型服务。工具轨迹在响应返回后显示，不代表实时进度。</p>
      </details>

      <div class="room-source-layout">
      <section id="source-materials" class="source-input-grid" aria-label="核验输入">
        <div class="source-panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">第一步</p>
              <h2>图表图片</h2>
            </div>
            <label class="upload-button">
              <span aria-hidden="true">＋</span> 选择图片
              <input
                id="source-audit-upload"
                aria-label="选择图表图片"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                @change="onFileChange"
              />
            </label>
          </div>
          <div class="source-image-stage">
            <img v-if="previewUrl" :src="previewUrl" alt="待核验的图表预览" />
            <div v-else class="source-image-empty">
              <strong>还没有图表图片</strong>
              <span>上传自制图表截图，或载入团队自制 CPI 样例。</span>
            </div>
          </div>
          <div class="room-file-row"><p class="source-file-name">当前图片：{{ selectedFileName || "尚未选择" }}</p><button v-if="previewUrl" type="button" class="room-inline-button" @click="imageViewerOpen = true">放大查看原图</button></div>
          <div class="source-sample-row">
            <button
              type="button"
              class="ghost-button"
              data-testid="load-source-sample"
              :disabled="sampleLoading || !sample"
              @click="loadSampleImage"
            >
              {{ sampleLoading ? "正在载入 CPI 样例…" : "载入团队自制 CPI 样例" }}
            </button>
            <span class="source-sample-note">团队自制示意图，不是国家统计局原图。用于展示口径核对；与公开来源的关系须运行后查看。</span>
          </div>
        </div>

        <div class="source-panel">
          <div class="section-heading">
            <div>
              <p class="eyebrow">第二步</p>
              <h2>配文</h2>
            </div>
          </div>
          <label class="source-caption-field" for="source-audit-caption">
            <span>要核对的配文（用户提供，可能与来源不一致）</span>
            <textarea
              id="source-audit-caption"
              v-model="caption"
              rows="4"
              maxlength="400"
              placeholder="例如：比上月上涨 0.8%"
              aria-describedby="source-caption-hint"
            ></textarea>
          </label>
          <p class="room-field-note">用户提供 · 点击运行后才向所配模型发送图片与配文。</p>
          <p id="source-caption-hint" class="source-caption-hint">
            比较方式、月份或范围不清楚时会保留待核对项；只有适用来源才能支持结论。
          </p>
          <p v-if="!busy && !result && !errorMessage && !adoptedNotice" class="source-input-notice" role="status">{{ inputNotice || "尚未开始核验。请先选择图片并填写配文。" }}</p>
          <p v-if="errorMessage" class="error-message room-error" role="alert">
            {{ errorMessage }}
            <RouterLink v-if="errorCode === 'MODEL_NOT_CONFIGURED'" class="source-settings-link" :to="settingsLocation">
              前往模型设置并测试连接
            </RouterLink>
          </p>
          <div v-if="errorMessage" class="room-recovery"><button type="button" class="room-inline-button" @click="focusMaterials">返回材料，继续编辑</button><span>材料已保留；可修改后再运行。</span></div>
          <div v-if="adoptedNotice" class="source-adopted-notice" role="status" data-testid="adopted-notice"><strong>当前结果已失效</strong><p>{{ adoptedNotice }}</p><p>当前配文：{{ caption }}</p><a href="#source-history" @click.prevent="navigateSection('source-history')">查看上次结果（历史） ↓</a></div>
          <div class="source-run-row">
            <button
              type="button"
              class="read-image-button"
              data-testid="run-source-audit"
              :disabled="busy"
              @click="runInvestigation"
            >
              {{ busy ? `正在核验（${elapsedSeconds} 秒）` : errorMessage ? "重试核验" : adoptedNotice ? "重新核验" : "运行来源核验" }}
            </button>
            <button v-if="busy" type="button" class="read-cancel-button" @click="cancelRun">取消核验</button>
            <span v-if="busy" class="source-run-note">工具记录在结果返回后展示，期间可以取消。</span>
          </div>
          <p class="sr-only" role="status">{{ busy ? "正在等待模型核验，可取消。工具记录在响应返回后显示。" : result ? "核验已返回，请查看逐条结论与未解决项。" : "" }}</p>


          <RouterLink class="source-settings-link room-settings-link" data-testid="source-model-settings" :to="settingsLocation">前往模型设置并检查连接 ↗</RouterLink>

        </div>
      </section>

      <section v-if="result" class="source-result" aria-label="核验结果">
        <h2 id="source-result-title" tabindex="-1">本次核验结果</h2>
        <p class="room-result-boundary">仅核对当前主张与适用的收录来源；未确认整张图、原始数据或制作过程的真实性。</p>
        <nav class="room-result-directory" aria-label="本页结果目录"><span>接下来</span><a href="#source-claims">查看依据 ↓</a><a href="#source-citations">引用来源 ↓</a><a v-if="result.captionSuggestion" href="#source-suggestions">查看修改建议 ↓</a><a v-if="result.clarification && !clarificationDeferred" href="#source-clarification">补充回答 ↓</a><a href="#source-process" @click.prevent="navigateSection('source-process')">核验过程 ↓</a></nav>
        <div class="source-overview" data-testid="source-overview">
          <p class="room-primary-finding">{{ primaryFinding }}</p>
          <p v-for="line in resultOverview" :key="line">{{ line }}</p>
        </div>
        <details class="source-run-details">
          <summary>查看模型与运行统计</summary>
          <div class="source-run-summary">
          <span class="source-run-chip">模型：{{ result.model }}</span>
          <span class="source-run-chip">耗时：{{ formatDuration(result.latencyMs) }}</span>
          <span class="source-run-chip">轮数：{{ result.rounds }}</span>
          <span class="source-run-chip">工具调用：{{ result.toolCallsUsed }} / 6</span>
          <span v-if="result.usage" class="source-run-chip">
            tokens：输入 {{ result.usage.inputTokens ?? "—" }} · 输出 {{ result.usage.outputTokens ?? "—" }}
          </span>
          </div>
        </details>
        <p class="source-stop-reason" data-testid="stop-reason">停止原因：{{ result.stopReason }}</p>

        <p v-if="!result.claims.length" class="source-no-finding" data-testid="no-finding">
          模型没有给出可用的汇总，本次没有生成任何来源结论；上面的停止原因与工具轨迹记录了实际发生的事。
        </p>

        <div v-if="result.clarification && !clarificationDeferred" id="source-clarification" class="source-clarification" data-testid="clarification-block">
          <p class="eyebrow">再确认一项信息</p>
          <p class="source-clarification-question">{{ result.clarification.question }}</p>
          <p class="source-clarification-purpose">用途：{{ result.clarification.purpose }}</p>
          <p v-if="result.clarification.claimText" class="source-clarification-claim">
            影响的主张：「{{ result.clarification.claimText }}」（{{ fieldLabel(result.clarification.field) }}）
          </p>
          <label class="source-answer-field" for="source-clarification-answer">
            <span>补充回答（标为「用户提供」，只用于确定口径，不是官方来源）</span>
            <textarea
              id="source-clarification-answer"
              v-model="clarificationAnswer"
              rows="2"
              maxlength="400"
              :placeholder="`例如：${fieldLabel(result.clarification.field)}`"
              data-testid="clarification-answer"
            ></textarea>
          </label>
          <button
            type="button"
            class="read-image-button"
            data-testid="submit-clarification"
            :disabled="busy"
            @click="submitClarification"
          >
            {{ busy ? `正在恢复（${elapsedSeconds} 秒）` : "提交补充，继续核验" }}
          </button><button type="button" class="room-inline-button room-defer" :disabled="busy" @click="clarificationDeferred = true">暂不补充，保留待核对</button>
        </div>

        <p v-if="result.clarification && clarificationDeferred" class="room-deferred" role="status">尚未补充，结论保持待核对。<button type="button" class="room-inline-button" @click="clarificationDeferred = false">继续补充</button></p>

        <div v-if="result.supplement" class="source-supplement" data-testid="supplement-block">
          <p class="eyebrow">补证记录</p>
          <p class="source-supplement-item">
            追问：{{ result.supplement.question }}
            <template v-if="result.supplement.claimText">（影响主张：「{{ result.supplement.claimText }}」）</template>
          </p>
          <p class="source-supplement-item">
            用户回答（用户提供）：{{ result.supplement.answer }}
            <strong v-if="result.supplement.normalized" class="source-supplement-normalized">
              → 解析为 {{ result.supplement.normalized }}
            </strong>
          </p>
          <p class="source-supplement-note" data-testid="supplement-note">{{ result.supplement.note }}</p>
          <ul v-if="result.supplement.conflicts.length" class="source-supplement-conflicts">
            <li v-for="conflict in result.supplement.conflicts" :key="conflict.claimText">
              「{{ conflict.claimText }}」：图文写明 {{ conflict.fromImage }}，用户补充 {{ conflict.fromUser }}——双方都保留，请更正补充或确认以原文为准。
            </li>
          </ul>
        </div>

        <div v-if="result.conclusionChanges?.length" class="source-section" data-testid="conclusion-changes">
          <div class="section-heading">
            <div>
              <p class="eyebrow">补证前后</p>
              <h2>结论变化</h2>
            </div>
          </div>
          <p class="source-section-note">同一条主张在补充前后的状态对照，说明结论为什么改变；配不上对的主张也单列，不静默丢弃。</p>
          <ul class="source-change-list">
            <li v-for="change in result.conclusionChanges" :key="change.claimText" :class="{ 'is-changed': change.changed }">
              <span class="source-change-claim">「{{ change.claimText }}」</span>
              <span class="source-change-before">{{ change.before ? CLAIM_STATUS_LABELS[change.before] : "补证前无对照" }}</span>
              <span aria-hidden="true">→</span>
              <span class="source-change-after">{{ change.after ? CLAIM_STATUS_LABELS[change.after] : "恢复后未再汇报" }}</span>
              <span class="source-change-reason">{{ change.reason }}</span>
            </li>
          </ul>
        </div>

        <div id="source-claims" class="source-section room-caption-claims">
          <div class="section-heading">
            <div>
              <p class="eyebrow">结果</p>
              <h2>配文主张</h2>
            </div>
          </div>
          <p v-if="!captionClaims.length" class="source-section-note">模型没有从配文中拆出可核查主张。</p>
          <SourceClaimCard
            v-for="row in captionClaims"
            :key="`cap-${row.index}`"
            :claim="row.claim"
            :conclusion="row.conclusion"
            :hits="result.hits"
            :accepted-citations="result.acceptedCitations"
          />
        </div>

        <div class="source-section">
          <div class="section-heading">
            <div>
              <p class="eyebrow">结果</p>
              <h2>图内观察</h2>
            </div>
          </div>
          <p class="source-section-note">只列模型从图上读到的文字，不代表已确认。</p>
          <SourceClaimCard
            v-for="row in imageClaims"
            :key="`img-${row.index}`"
            :claim="row.claim"
            :conclusion="row.conclusion"
            :hits="result.hits"
            :accepted-citations="result.acceptedCitations"
          />
        </div>

        <div id="source-citations" class="source-section room-citations">
          <div class="section-heading">
            <div>
              <p class="eyebrow">证据</p>
              <h2>引用与检索命中</h2>
            </div>
          </div>
          <p class="source-section-note">
            只有本次命中的材料可以被引用；被引用的材料标明原始链接与发布日期。
          </p>
          <component
            :is="citedSourceIds.has(hit.document.id) ? 'article' : 'details'"
            v-for="hit in result.hits"
            :key="hit.document.id"
            :id="`source-document-${hit.document.id}`"
            :tabindex="citedSourceIds.has(hit.document.id) ? -1 : undefined"
            class="source-document-card"
            :class="{ 'is-cited': citedSourceIds.has(hit.document.id) }"
          >
            <summary v-if="!citedSourceIds.has(hit.document.id)" class="room-uncited-summary">未采用：{{ hit.document.title }}</summary>
            <div class="source-document-head">
              <h3>{{ hit.document.title }}</h3>
              <span v-if="citedSourceIds.has(hit.document.id)" class="source-cited-badge" data-testid="cited-badge">
                本次引用 · {{ citationRoleLabel(hit.document.id) }}
              </span>
              <span v-else class="source-excluded-badge">未采用</span>
            </div>
            <p class="source-document-meta">
              {{ hit.document.publisher }} · 发布 {{ hit.document.publishedAt }} ·
              {{ hit.document.kind === "data-release" ? "数据发布" : "术语解释" }}
              <template v-if="hit.document.basis.period"> · 适用 {{ hit.document.basis.period }}</template>
            </p>
            <p class="source-document-excerpt">{{ hit.document.excerpt }}</p>
            <details class="room-source-proof">
            <summary>适用性与内容指纹</summary>
            <ul class="source-reason-list">
              <li v-for="reason in hit.matchReasons" :key="reason">{{ reason }}</li>
            </ul>
            <p class="source-document-fingerprint">内容指纹 {{ hit.document.fingerprint }}</p>
            </details>
            <a class="source-document-link" :href="hit.document.url" target="_blank" rel="noreferrer noopener">
              查看原始链接
            </a>
          </component>
          <details v-if="result.excludedSources.length" class="source-excluded" data-testid="excluded-sources">
            <summary>查看被排除材料及原因（{{ result.excludedSources.length }}）</summary>
            <h3>本次排除的材料及原因</h3>
            <ul>
              <li v-for="excluded in result.excludedSources" :key="excluded.sourceId">
                <strong>{{ excluded.title }}</strong>：{{ excluded.reason }}
              </li>
            </ul>
          </details>
          <div v-if="result.citationsRejected.length" class="source-excluded" data-testid="rejected-citations">
            <h3>被拒绝的引用</h3>
            <ul>
              <li v-for="(rejected, index) in result.citationsRejected" :key="`${rejected.sourceId}-${index}`">
                <strong>{{ rejected.sourceId }}</strong>：{{ rejected.reason }}
              </li>
            </ul>
          </div>
        </div>

        <div v-if="result.captionSuggestion" id="source-suggestions" class="source-section source-suggestion" data-testid="caption-suggestion">
          <div class="section-heading">
            <div>
              <p class="eyebrow">建议</p>
              <h2>修改建议（不自动替换原配文）</h2>
            </div>
          </div>
          <p class="source-section-note">
            每一处改动都关联原句、修改内容、理由与当前有效引用：与所引来源一致的保留原句，不一致的用所引来源里的正确数值改正，
            没有适用来源或依据不足的保留限定或建议删除。采用前请逐处核对；采用后配文输入框会改动，需要重新核验。
          </p>
          <div class="source-suggestion-block">
            <p class="source-suggestion-label">原配文</p>
            <p class="source-suggestion-caption">{{ result.captionSuggestion.caption }}</p>
            <p class="source-suggestion-label">建议配文</p>
            <p class="source-suggestion-caption is-suggested" data-testid="suggested-caption">
              {{ result.captionSuggestion.suggestedCaption }}
            </p>
          </div>
          <details class="room-suggestion-details">
          <summary>逐处查看改动、理由与引用</summary>
          <ul class="source-suggestion-changes" data-testid="suggestion-changes">
            <li v-for="(change, index) in result.captionSuggestion.changes" :key="`${change.claimText}-${index}`">
              <div class="source-suggestion-head">
                <span class="source-suggestion-kind">{{ CAPTION_CHANGE_LABELS[change.kind] }}</span>
                <span class="source-state-pill" :class="statusClass(change.status)">{{ CLAIM_STATUS_LABELS[change.status] }}</span>
                <span class="source-suggestion-origin">
                  {{ change.origin === "model" ? "模型提议（已通过程序校验）" : "程序按结论生成" }}
                </span>
              </div>
              <p class="source-suggestion-line">原句：{{ change.original ?? change.claimText }}</p>
              <p class="source-suggestion-line">建议：{{ change.suggested || "（删除这句）" }}</p>
              <p class="source-suggestion-line">理由：{{ change.reason }}</p>
              <p v-if="change.sourceIds.length" class="source-suggestion-line">
                引用：{{ change.sourceIds.map(sourceTitle).join("、") }}
              </p>
              <p v-if="!change.applied" class="source-suggestion-line is-warning">
                这处改动没有并入建议配文，请按原句自行修改。
              </p>
            </li>
          </ul>
          <div
            v-if="result.captionSuggestion.rejectedProposals.length"
            class="source-suggestion-rejected"
            data-testid="suggestion-rejected"
          >
            <h3>模型提议但未通过校验（不采用）</h3>
            <ul>
              <li v-for="(proposal, index) in result.captionSuggestion.rejectedProposals" :key="`${proposal.claimText}-${index}`">
                「{{ proposal.claimText }}」→「{{ proposal.suggestedText || "（删除这句）" }}」：{{ proposal.rejectedReason }}
              </li>
            </ul>
          </div>
          </details>
          <div
            v-if="result.captionSuggestion.notes.length"
            class="source-suggestion-notes"
            data-testid="suggestion-notes"
          >
            <ul v-if="matchedSuggestionNotes.length"><li v-for="note in matchedSuggestionNotes" :key="note">{{ note }}</li></ul>
            <div v-if="unmatchedSuggestionNotes.length" class="room-note-warning">
              <strong>未匹配到当前配文的附注（{{ unmatchedSuggestionNotes.length }}）</strong>
              <p data-testid="suggestion-note-unmatched">「{{ unmatchedNoteQuotes.join("」、「") }}」未在当前配文中找到，也未出现在建议配文中；不计入当前配文的未核验项。</p>
              <details><summary>查看未对齐附注原记录</summary><ul><li v-for="note in unmatchedSuggestionNotes" :key="note">{{ note }}</li></ul><p>原记录保留供复查，不作为当前配文的说明。</p></details>
            </div>
          </div>
          <details class="room-suggestion-fingerprint"><summary>查看建议依据快照</summary><p class="source-suggestion-fingerprint">
            依据快照指纹 {{ result.captionSuggestion.fingerprint }}：输入、补证或引用一变，这条建议即失效并转入历史。
          </p></details>
          <button
            type="button"
            class="read-image-button"
            data-testid="adopt-suggestion"
            @click="adoptSuggestion"
          >
            采用这条建议（写入配文输入框）
          </button><p class="room-adopt-explainer">仅更新配文，旧结果转入历史；须再次主动运行，才有新结论。</p>
        </div>

        <div
          v-if="result.omittedClaims.length || result.captionCoverageNote"
          class="source-section source-omitted"
          data-testid="omitted-claims"
        >
          <div class="section-heading">
            <div>
              <p class="eyebrow">边界</p>
              <h2>本次没有核验的内容</h2>
            </div>
          </div>
          <p class="source-section-note">
            单次最多核验三条主张。没有展开的内容在这里逐条保留原文，避免缩小范围前被默认成「已经查过」。
          </p>
          <ul class="source-omitted-list">
            <li v-for="omitted in result.omittedClaims" :key="omitted.claimText">
              <strong>「{{ omitted.claimText }}」</strong>
              <span class="source-omitted-source">
                {{ omitted.source === "caption" ? "配文未展开" : "图上说明／其他声明" }}
              </span>
              ：{{ omitted.reason }}
            </li>
          </ul>
          <p v-if="result.captionCoverageNote" class="source-omitted-note">{{ result.captionCoverageNote }}</p>
          <p v-if="result.captionCoverage !== null" class="source-section-note">
            已展开主张覆盖配文约 {{ Math.round((result.captionCoverage ?? 0) * 100) }}%。
          </p>
        </div>



        <details id="source-process" class="source-section source-tool-details">
          <summary>查看工具轨迹与调用预算</summary>
          <p class="source-section-note">
            每轮最多 3 次工具调用，单次调查共 6 次；检索、比较与追问计入预算，汇总不计入。
          </p>
          <ol class="source-trace" data-testid="tool-trace">
            <li v-for="(event, index) in result.trace" :key="`${event.round}-${event.order}-${index}`" :class="`trace-${event.status}`">
              <div class="trace-head">
                <span class="trace-round">第 {{ event.round }} 轮 · {{ event.order }}</span>
                <span class="trace-tool">{{ toolLabel(event.tool) }}</span>
                <span class="trace-status">{{ traceStatusLabel(event.status) }}</span>
                <span class="trace-duration">{{ formatDuration(event.durationMs) }}</span>
              </div>
              <p class="trace-detail">{{ event.detail }}</p>
              <p class="trace-io">输入：{{ event.inputSummary }}</p>
              <p class="trace-io">结果：{{ event.resultSummary }}</p>
            </li>
          </ol>
        </details>

        <div v-if="result.unresolvedItems.length || result.noApplicableSourceReason" class="source-section">
          <div class="section-heading">
            <div>
              <p class="eyebrow">边界</p>
              <h2>未解决项</h2>
            </div>
          </div>
          <ul class="source-unresolved-list" data-testid="unresolved-items">
            <li v-for="item in result.unresolvedItems" :key="item">{{ item }}</li>
          </ul>
          <p v-if="result.noApplicableSourceReason" class="source-section-note">
            没有适用来源的原因：{{ result.noApplicableSourceReason }}
          </p>
        </div>
      </section>

      </div>

      <section v-if="history.length" id="source-history" tabindex="-1" class="source-history" aria-label="历史结论" data-testid="history-section">
        <div class="section-heading">
          <div>
            <p class="eyebrow">历史</p>
            <h2>历史结论（仅作历史展示）</h2>
          </div>
        </div>
        <p class="source-section-note">
          下列结论与修改建议依赖的输入已改动或已被补证接续，只作历史查看，不代表当前结果；旧建议已随之撤回。
        </p>
        <details
          v-for="(entry, index) in history"
          :key="`${entry.result.investigationId ?? 'entry'}-${index}`"
          class="source-history-entry"
          :data-testid="`history-entry-${index}`"
        >
          <summary>
            <span class="source-history-badge">历史</span>
            <span v-if="entry.adopted" class="source-history-badge is-adopted" data-testid="history-adopted">已采用建议</span>
            <span class="source-history-reason">{{ entry.reason }}</span>
            <span class="source-history-meta">模型：{{ entry.result.model }} · 停止原因：{{ entry.result.stopReason }}</span>
          </summary>
          <ul class="source-history-claims">
            <li v-for="(conclusion, conclusionIndex) in entry.result.conclusions" :key="conclusionIndex">
              「{{ conclusion.claimText }}」——{{ CLAIM_STATUS_LABELS[conclusion.status] }}
              <span
                v-if="changeBefore(entry.result.conclusionChanges, conclusion.claimText)"
                class="source-history-change"
              >
                （补证前：{{ CLAIM_STATUS_LABELS[changeBefore(entry.result.conclusionChanges, conclusion.claimText)!] }}）
              </span>
            </li>
          </ul>
          <p v-if="entry.result.supplement" class="source-history-supplement">
            补证：{{ entry.result.supplement.answer }}（用户提供）——{{ entry.result.supplement.note }}
          </p>
          <p v-if="entry.result.captionSuggestion" class="source-history-suggestion" data-testid="history-suggestion">
            历史建议配文：{{ entry.result.captionSuggestion.suggestedCaption }}
            <span class="source-history-suggestion-note">（依据快照 {{ entry.result.captionSuggestion.fingerprint }}，不代表当前结果）</span>
          </p>
        </details>
      </section>

      <section id="source-library" class="source-library" aria-label="固定资料库">
        <div class="section-heading">
          <div>
            <p class="eyebrow">可复查</p>
            <h2>固定资料库（{{ library.length }} 条）</h2>
          </div>
          <button type="button" class="ghost-button" :aria-expanded="libraryOpen" :disabled="!library.length" @click="libraryOpen = !libraryOpen">
            {{ libraryOpen ? "收起资料库" : "展开资料库" }}
          </button>
        </div>
        <p v-if="!library.length" class="source-section-note" role="status">{{ sampleLoading ? "正在载入资料库范围…" : "资料库清单暂不可用，核验时仍须有适用来源才能给出结论。" }}</p>
        <ul v-if="libraryOpen && library.length" class="source-library-list">
          <li v-for="entry in library" :key="entry.id">
            <a :href="entry.url" target="_blank" rel="noreferrer noopener">{{ entry.title }}</a>
            <span class="source-library-meta">
              {{ entry.publisher }} · {{ entry.publishedAt }} ·
              {{ entry.kind === "data-release" ? "数据发布" : "术语解释" }} · {{ entry.basis.metric }}
              <template v-if="entry.basis.period"> · 适用 {{ entry.basis.period }}</template>
              <template v-else-if="entry.kind === 'data-release'"> · 逐月 {{ entry.measureCount }} 行</template>
              <template v-if="entry.distractor"> · 干扰项</template>
            </span>
            <span v-if="entry.revision" class="source-library-revision" data-testid="library-revision">
              本发布修订了《{{ libraryTitle(entry.revision.supersedes) }}》（{{ entry.revision.revisedAt }}）：{{ entry.revision.statement }}
            </span>
            <span class="source-library-fingerprint">指纹 {{ entry.fingerprint }}</span>
          </li>
        </ul>
      </section>
      <footer class="room-footer"><span>图证 · 每一项判断，都留下依据。</span><RouterLink to="/audit">仅核对截图：图内检查 ↗</RouterLink></footer>
      <OriginalImageViewer v-model:open="imageViewerOpen" :src="previewUrl" :name="selectedFileName" />
    </main>
  </div>
</template>
