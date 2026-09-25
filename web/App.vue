<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { AuditObservation, AuditResult, DataPointObservation } from "../shared/audit.js";

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
const observation = ref<AuditObservation | null>(null);
const result = ref<AuditResult | null>(null);
const imageUrl = ref("");
const imageAlt = ref("图表预览");
const selectedFileName = ref("");
const pendingUpload = ref<File | null>(null);
const errorMessage = ref("");
const busyMessage = ref("");
const cropMode = ref(false);
const cropSelection = ref<CropSelection | null>(null);
const cropPreview = ref("");
const cropError = ref("");
const previewImage = ref<HTMLImageElement | null>(null);
let dragOrigin: { x: number; y: number } | null = null;
let objectUrl: string | null = null;

const activeSample = computed(
  () => samples.value.find(({ id }) => id === activeSampleId.value) ?? null,
);
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
  if (observation.value?.source === "vision-model") return "OpenAI 视觉读取 · 待确认";
  if (observation.value?.source === "preset-example") return "预置示例 · 待确认";
  return "等待图片";
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

function updateErrorFrom(response: Response, payload: { error?: { message?: string } } | null): string {
  if (payload?.error?.message) return payload.error.message;
  return `请求失败（${response.status}）。请重试。`;
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
      observation?: AuditObservation;
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
    observation.value = payload.observation;
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
    await loadSample(payload.samples[0].id);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "服务暂时不可用。";
  }
}

function prepareUpload(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;

  if (file.size > 5 * 1024 * 1024) {
    errorMessage.value = "图片不能超过 5 MB。";
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
  observation.value = null;
  result.value = null;
  errorMessage.value = "";
  busyMessage.value = "";
}

async function analyzePendingUpload(): Promise<void> {
  if (!pendingUpload.value) return;
  busyMessage.value = "正在请求 OpenAI 读取图表文字…";
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
      observation?: AuditObservation;
      error?: { message?: string };
    } | null;
    if (!response.ok || !payload?.observation) {
      throw new Error(updateErrorFrom(response, payload));
    }
    observation.value = payload.observation;
  } catch (error) {
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

function editTitle(event: Event): void {
  if (!observation.value) return;
  observation.value.titleOriginal = (event.target as HTMLTextAreaElement).value || null;
  invalidateResult();
}

function editClaim(event: Event): void {
  if (!observation.value) return;
  const value = (event.target as HTMLInputElement).value;
  observation.value.claimedGrowthPercent = value === "" ? null : Number(value);
  invalidateResult();
}

function editPoint(
  pointName: "older" | "newer",
  field: keyof DataPointObservation,
  event: Event,
): void {
  if (!observation.value) return;
  const point = observation.value[pointName];
  const input = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (field === "value") {
    const value = input.value;
    point.value = value === "" ? null : Number(value);
    point.valueSource = point.value === null ? "unreadable" : "user";
  } else if (field === "period" || field === "unit" || field === "evidenceText") {
    point[field] = input.value || null;
  }
  invalidateResult();
}

async function confirmAndCalculate(): Promise<void> {
  if (!observation.value) return;
  observation.value.confirmed = true;
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
    result.value = payload.result;
  } catch (error) {
    observation.value.confirmed = false;
    errorMessage.value = error instanceof Error ? error.message : "计算失败，请重试。";
  } finally {
    busyMessage.value = "";
  }
}

function formatValue(value: number | null, unit: string | null): string {
  if (value === null) return "尚未读清";
  const formatted = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
  return unit === "%" ? `${formatted}%` : `${formatted}${unit ? ` ${unit}` : ""}`;
}

function valueSourceLabel(source: DataPointObservation["valueSource"]): string {
  if (source === "model") return "模型读取 · 待确认";
  if (source === "user") return "用户手动更正";
  if (source === "unreadable") return "图上暂不可读";
  return "预置示例值";
}

onMounted(loadSamples);
onBeforeUnmount(forgetObjectUrl);
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="#top" aria-label="图证首页">
        <span class="brand-mark" aria-hidden="true">
          <i></i><i></i><i></i>
        </span>
        <span>图证</span>
      </a>
      <div class="topbar-note">
        <span class="status-dot" aria-hidden="true"></span>
        <span>单图图内检查</span>
      </div>
    </header>

    <main id="top" class="page-shell">
      <section class="intro" aria-labelledby="page-title">
        <div>
          <p class="eyebrow">图表截图自检</p>
          <h1 id="page-title">图上的标题，和数字对得上吗？</h1>
          <p class="intro-copy">只比较图片里看得到的内容。没有原始来源时，我们不会把图内检查说成事实核验。</p>
        </div>
        <div class="scope-stamp" aria-label="当前检查范围：一张图片">
          <span class="scope-stamp-mark">1</span>
          <span>一张图片<br /><strong>一个增长率</strong></span>
        </div>
      </section>

      <div class="workspace-grid">
        <section class="image-column" aria-labelledby="image-section-title">
          <div class="section-heading">
            <div>
              <p class="eyebrow">选择检查对象</p>
              <h2 id="image-section-title">图表截图</h2>
            </div>
            <label class="upload-button" for="chart-upload">
              <span aria-hidden="true">＋</span> 上传图片
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

          <figure class="image-stage">
            <div class="image-stage-head">
              <span class="image-label"><span class="image-label-dot"></span>原图预览</span>
              <span v-if="activeSample" class="image-filename">团队自制样例</span>
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

          <div v-if="cropPreview && pendingUpload" class="pending-crop-preview">
            <img :src="cropPreview" alt="准备发送给视觉模型的手动选区" />
            <span>当前选区预览 · 读取时只发送此区域</span>
          </div>
          <div v-if="pendingUpload" class="upload-read-action">
            <button class="read-image-button" :disabled="Boolean(busyMessage)" @click="analyzePendingUpload">
              读取{{ cropPreview ? "选中区域" : "整张图片" }}
            </button>
            <span>{{ cropPreview ? "只会把框选区域发送给 OpenAI。" : "点击后把图片发送给 OpenAI 读取。" }}</span>
          </div>
          <p v-if="cropError" class="crop-error" role="alert">{{ cropError }}</p>
          <p class="privacy-note">
            预置样例使用本地保存的预置观察值。上传图片仅在点击读取时发送给 OpenAI；可先框选需要检查的区域。
          </p>
        </section>

        <section class="review-column" aria-labelledby="observation-title">
          <div class="section-heading review-heading">
            <div>
              <p class="eyebrow">先检查识别结果</p>
              <h2 id="observation-title">图中观察值</h2>
            </div>
            <span v-if="observation" class="source-badge" :class="observation.source">
              {{ sourceLabel }}
            </span>
          </div>

          <div v-if="observation" class="observation-form">
            <label class="field-block title-field">
              <span class="field-label">标题原文</span>
              <textarea
                :value="observation.titleOriginal ?? ''"
                rows="2"
                maxlength="240"
                placeholder="图片中的标题尚未读清"
                @input="editTitle"
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
                  <span class="field-label">数值</span>
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
              <label class="field-block evidence-field">
                <span class="field-label">图中可见文字</span>
                <input
                  :value="observation.older.evidenceText ?? ''"
                  maxlength="240"
                  placeholder="写下对应的图中文字"
                  @input="editPoint('older', 'evidenceText', $event)"
                />
              </label>
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
                  <span class="field-label">数值</span>
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
              <label class="field-block evidence-field">
                <span class="field-label">图中可见文字</span>
                <input
                  :value="observation.newer.evidenceText ?? ''"
                  maxlength="240"
                  placeholder="写下对应的图中文字"
                  @input="editPoint('newer', 'evidenceText', $event)"
                />
              </label>
            </div>

            <ul v-if="observation.unreadableItems.length" class="unreadable-list" aria-label="无法辨认内容">
              <li v-for="item in observation.unreadableItems" :key="item">暂时无法辨认：{{ item }}</li>
            </ul>

            <button class="confirm-button" :disabled="Boolean(busyMessage)" @click="confirmAndCalculate">
              {{ result ? "已确认 · 重新计算" : "确认观察值并计算" }}
              <span aria-hidden="true">↗</span>
            </button>
            <p class="confirm-hint">确认前不输出确定的数值结论。更改任一字段后需要重新确认。</p>
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

          <section v-if="result && observation" class="result-sheet" aria-live="polite" aria-labelledby="result-title">
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
          </section>
        </section>
      </div>

      <section v-if="observation" class="evidence-ledger" aria-labelledby="evidence-title">
        <div class="ledger-heading">
          <div>
            <p class="eyebrow">可回到原图检查</p>
            <h2 id="evidence-title">证据摘录</h2>
          </div>
          <p>图中文字与用户确认值分开显示。</p>
        </div>
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
      </section>

      <footer class="page-footer">
        <span>图证 / 阶段一 · 单图图内审计</span>
        <span>判断范围止于这张截图</span>
      </footer>
    </main>
  </div>
</template>
