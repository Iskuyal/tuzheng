<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import SiteHeader from "../components/SiteHeader.vue";
import SourceClaimCard from "../components/SourceClaimCard.vue";
import {
  TOOL_LABELS,
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

const library = ref<PublicSourceLibraryEntry[]>([]);
const sample = ref<SourceAuditSample | null>(null);
const caption = ref("");
const selectedFileName = ref("");
const pendingFile = ref<File | null>(null);
const previewUrl = ref("");
const busy = ref(false);
const elapsedSeconds = ref(0);
const errorMessage = ref("");
const errorCode = ref("");
const result = ref<SourceInvestigationResult | null>(null);
const libraryOpen = ref(false);
let timer: number | null = null;
let controller: AbortController | null = null;

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
    const response = await fetch("/api/source-audit/sample");
    if (response.ok) {
      const body = await response.json() as { sample: SourceAuditSample };
      sample.value = body.sample;
    }
  } catch {
    // 样例入口缺失时仍可手动上传图片。
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
  errorMessage.value = "";
  errorCode.value = "";
  result.value = null;
  if (!file) {
    pendingFile.value = null;
    selectedFileName.value = "";
    return;
  }
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
  setPendingImage(file, file.name);
}

function setPendingImage(file: File, name: string): void {
  pendingFile.value = file;
  selectedFileName.value = name;
  if (previewUrl.value.startsWith("blob:")) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = URL.createObjectURL(file);
}

async function loadSampleImage(): Promise<void> {
  if (!sample.value) return;
  errorMessage.value = "";
  errorCode.value = "";
  result.value = null;
  try {
    const response = await fetch(sample.value.imageUrl);
    if (!response.ok) throw new Error("sample-unavailable");
    const blob = await response.blob();
    setPendingImage(new File([blob], `${sample.value.id}.png`, { type: "image/png" }), sample.value.name);
    caption.value = sample.value.caption;
  } catch {
    errorMessage.value = "样例图片暂时取不到，请改用手动上传。";
  }
}

function cancelRun(): void {
  controller?.abort();
  controller = null;
  busy.value = false;
  stopTimer();
  errorMessage.value = "已取消这次来源核验。";
}

async function runInvestigation(): Promise<void> {
  errorMessage.value = "";
  errorCode.value = "";
  result.value = null;
  if (!pendingFile.value) {
    errorMessage.value = "请先上传图表图片，或载入团队自制 CPI 样例。";
    return;
  }
  if (!caption.value.trim()) {
    errorMessage.value = "请填写要核对的配文，至少一句话。";
    return;
  }

  const form = new FormData();
  form.append("image", pendingFile.value);
  form.append("caption", caption.value.trim());

  busy.value = true;
  startTimer();
  controller = new AbortController();
  try {
    const response = await fetch("/api/source-audit/investigate", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null) as
      | { investigation: SourceInvestigationResult }
      | { error: { code: string; message: string } }
      | null;
    if (!response.ok) {
      const failure = body && "error" in body ? body.error : null;
      errorCode.value = failure?.code ?? "";
      errorMessage.value = failure?.message ?? "来源核验没有完成，请稍后重试。";
      return;
    }
    if (!body || !("investigation" in body)) {
      errorMessage.value = "服务端返回内容无法识别，请重试。";
      return;
    }
    result.value = body.investigation;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      errorMessage.value = "已取消这次来源核验。";
    } else {
      errorMessage.value = "无法连接本机服务端，请确认开发服务正在运行。";
    }
  } finally {
    busy.value = false;
    stopTimer();
    controller = null;
  }
}
</script>

<template>
  <div class="app-shell">
    <SiteHeader />
    <main class="page-shell source-audit-page">
      <section class="intro">
        <div>
          <p class="eyebrow">阶段四 · 公开来源核验</p>
          <h1>CPI 图文主张的来源核验</h1>
          <p class="intro-copy">
            上传一张图表截图并填写配文。模型自行选择受限工具，在固定国家统计局资料库中检索，
            程序校验工具名、参数、调用次数与引用来源，最后给出逐条来源结论。资料库在构建期固定，
            运行时不访问开放网络。
          </p>
        </div>
        <div class="scope-stamp">
          <span class="scope-stamp-mark" aria-hidden="true">源</span>
          <span><strong>固定资料库</strong><br />不抓取开放网络</span>
        </div>
      </section>

      <section class="source-input-grid" aria-label="核验输入">
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
          <p v-if="selectedFileName" class="source-file-name">当前图片：{{ selectedFileName }}</p>
          <div class="source-sample-row">
            <button
              v-if="sample"
              type="button"
              class="ghost-button"
              data-testid="load-source-sample"
              @click="loadSampleImage"
            >
              载入团队自制 CPI 样例
            </button>
            <span v-if="sample" class="source-sample-note">{{ sample.note }}</span>
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
            ></textarea>
          </label>
          <p class="source-caption-hint">
            图上没有写比较方式时，模型应把比较方式留空，并把口径缺口列进未解决项；
            引用只能来自本次检索命中的材料，否则结论降级为「来源待核对」。
          </p>
          <div class="source-run-row">
            <button
              type="button"
              class="read-image-button"
              data-testid="run-source-audit"
              :disabled="busy"
              @click="runInvestigation"
            >
              {{ busy ? `正在核验（${elapsedSeconds} 秒）` : "运行来源核验" }}
            </button>
            <button v-if="busy" type="button" class="read-cancel-button" @click="cancelRun">取消核验</button>
            <span v-if="busy" class="source-run-note">模型可能多轮调用工具，通常需要 5—30 秒。</span>
          </div>
          <p v-if="errorMessage" class="error-message" role="alert">
            {{ errorMessage }}
            <RouterLink v-if="errorCode === 'MODEL_NOT_CONFIGURED'" class="source-settings-link" to="/settings">
              前往模型设置并测试连接
            </RouterLink>
          </p>
        </div>
      </section>

      <section v-if="result" class="source-result" aria-label="核验结果">
        <div class="source-run-summary">
          <span class="source-run-chip">模型：{{ result.model }}</span>
          <span class="source-run-chip">耗时：{{ formatDuration(result.latencyMs) }}</span>
          <span class="source-run-chip">轮数：{{ result.rounds }}</span>
          <span class="source-run-chip">工具调用：{{ result.toolCallsUsed }} / 6</span>
          <span v-if="result.usage" class="source-run-chip">
            tokens：输入 {{ result.usage.inputTokens ?? "—" }} · 输出 {{ result.usage.outputTokens ?? "—" }}
          </span>
        </div>
        <p class="source-stop-reason" data-testid="stop-reason">停止原因：{{ result.stopReason }}</p>

        <p v-if="!result.claims.length" class="source-no-finding" data-testid="no-finding">
          模型没有给出可用的汇总，本次没有生成任何来源结论；上面的停止原因与工具轨迹记录了实际发生的事。
        </p>

        <div v-if="result.clarification" class="source-clarification">
          <p class="eyebrow">模型请求确认（本次调查仅此一次）</p>
          <p class="source-clarification-question">{{ result.clarification.question }}</p>
          <p class="source-clarification-purpose">用途：{{ result.clarification.purpose }}</p>
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

        <div class="source-section">
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

        <div class="source-section">
          <div class="section-heading">
            <div>
              <p class="eyebrow">证据</p>
              <h2>引用与检索命中</h2>
            </div>
          </div>
          <p class="source-section-note">
            只有本次命中的材料可以被引用；被引用的材料标明原始链接与发布日期。
          </p>
          <article
            v-for="hit in result.hits"
            :key="hit.document.id"
            class="source-document-card"
            :class="{ 'is-cited': citedSourceIds.has(hit.document.id) }"
          >
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
            <ul class="source-reason-list">
              <li v-for="reason in hit.matchReasons" :key="reason">{{ reason }}</li>
            </ul>
            <p class="source-document-fingerprint">内容指纹 {{ hit.document.fingerprint }}</p>
            <a class="source-document-link" :href="hit.document.url" target="_blank" rel="noreferrer noopener">
              查看原始链接
            </a>
          </article>
          <div v-if="result.excludedSources.length" class="source-excluded" data-testid="excluded-sources">
            <h3>本次排除的材料及原因</h3>
            <ul>
              <li v-for="excluded in result.excludedSources" :key="excluded.sourceId">
                <strong>{{ excluded.title }}</strong>：{{ excluded.reason }}
              </li>
            </ul>
          </div>
          <div v-if="result.citationsRejected.length" class="source-excluded" data-testid="rejected-citations">
            <h3>被拒绝的引用</h3>
            <ul>
              <li v-for="(rejected, index) in result.citationsRejected" :key="`${rejected.sourceId}-${index}`">
                <strong>{{ rejected.sourceId }}</strong>：{{ rejected.reason }}
              </li>
            </ul>
          </div>
        </div>

        <div class="source-section">
          <div class="section-heading">
            <div>
              <p class="eyebrow">过程</p>
              <h2>工具轨迹</h2>
            </div>
          </div>
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
        </div>

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

      <section v-if="library.length" class="source-library" aria-label="固定资料库">
        <div class="section-heading">
          <div>
            <p class="eyebrow">可复查</p>
            <h2>固定资料库（{{ library.length }} 条）</h2>
          </div>
          <button type="button" class="ghost-button" :aria-expanded="libraryOpen" @click="libraryOpen = !libraryOpen">
            {{ libraryOpen ? "收起资料库" : "展开资料库" }}
          </button>
        </div>
        <ul v-if="libraryOpen" class="source-library-list">
          <li v-for="entry in library" :key="entry.id">
            <a :href="entry.url" target="_blank" rel="noreferrer noopener">{{ entry.title }}</a>
            <span class="source-library-meta">
              {{ entry.publisher }} · {{ entry.publishedAt }} ·
              {{ entry.kind === "data-release" ? "数据发布" : "术语解释" }}
              <template v-if="entry.basis.period"> · 适用 {{ entry.basis.period }}</template>
              <template v-if="entry.distractor"> · 干扰项</template>
            </span>
            <span class="source-library-fingerprint">指纹 {{ entry.fingerprint }}</span>
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>
