<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import SiteHeader from "../components/SiteHeader.vue";
import { queueLandingUpload } from "../upload-transfer.js";

interface SampleSummary {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
}

const router = useRouter();
const samples = ref<SampleSummary[]>([]);
const loadError = ref("");
const samplesLoading = ref(true);
const uploadError = ref("");

const samplePresentation: Record<string, { tone: string; kind: string }> = {
  conflict: { tone: "contradictory", kind: "图内矛盾" },
  consistent: { tone: "consistent", kind: "图内一致" },
  unclear: { tone: "needs-confirmation", kind: "需要确认" },
  "multi-claims": { tone: "grouped", kind: "多条主张" },
  "cross-a-revenue": { tone: "grouped", kind: "跨图基准" },
  "cross-b-consistent": { tone: "grouped", kind: "跨图对照" },
  "cross-b-conflict": { tone: "grouped", kind: "跨图对照" },
  "cross-b-scope-mismatch": { tone: "grouped", kind: "跨图对照" },
  "axis-zero-based": { tone: "grouped", kind: "纵轴对照" },
  "axis-truncated": { tone: "grouped", kind: "纵轴对照" },
  "axis-unknown-start": { tone: "grouped", kind: "纵轴对照" },
};

async function loadSamples(): Promise<void> {
  try {
    const response = await fetch("/api/samples");
    const payload = await response.json().catch(() => null) as { samples?: SampleSummary[] } | null;
    if (!response.ok || !payload?.samples) throw new Error("样例暂时无法载入。");
    samples.value = payload.samples;
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "样例暂时无法载入。";
  } finally {
    samplesLoading.value = false;
  }
}

function openSample(id: string): void {
  void router.push({ name: "audit", query: { sample: id } });
}

function uploadScreenshot(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;

  if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type)) {
    uploadError.value = "请上传 PNG、JPG 或 WebP 图片。";
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    uploadError.value = "图片不能超过 5 MB。";
    return;
  }

  uploadError.value = "";
  queueLandingUpload(file);
  void router.push({ name: "audit" });
}

function sampleTone(id: string): string {
  return samplePresentation[id]?.tone ?? "grouped";
}

function sampleKind(id: string): string {
  return samplePresentation[id]?.kind ?? "团队自制";
}

onMounted(loadSamples);
</script>

<template>
  <div class="landing-page">
    <SiteHeader />

    <main>
      <section class="landing-hero">
        <div class="hero-copy">
          <p class="hero-kicker">图表证据审计台 / 来源核验</p>
          <h1>图表与配文，<br /><span>有来源支持吗？</span></h1>
          <p class="hero-description">把截图与配文对照公开来源，逐条查看支持、矛盾或待核对的依据。先用 CPI 自制样例体验；只有截图时，也能做图内检查。</p>
          <div class="hero-actions">
            <RouterLink class="pixel-button primary-action" to="/source-audit?sample=cpi-2025-12">试用 CPI 来源核验样例 <span aria-hidden="true">→</span></RouterLink>
            <label class="pixel-button primary-upload-action" for="landing-upload">
              上传我的截图 <span aria-hidden="true">↑</span>
              <input id="landing-upload" type="file" accept="image/png,image/jpeg,image/webp" @change="uploadScreenshot" />
            </label>
            <a class="pixel-button secondary-sample-action" href="#sample-dock">浏览自制样例 <span aria-hidden="true">↓</span></a>
          </div>
          <p class="upload-support-note">样例入口只载入图片和配文，点击「运行来源核验」才调用模型。</p>
          <p class="upload-support-note">上传截图进入图内检查。支持 PNG、JPG、WebP；单张不超过 5 MB。</p>
          <p v-if="uploadError" class="landing-error" role="alert">{{ uploadError }}</p>
          <div class="signal-strip" aria-label="来源核验顺序：图文、来源、逐条核对">
            <span>图文</span><i></i><span>来源</span><i></i><span>逐条核对</span>
          </div>
        </div>

        <div class="hero-scene" aria-label="静态来源示意：2025 年 12 月全国 CPI 同比 0.8%、环比 0.2%；自制图，不是运行结果">
          <div class="scene-topline">
            <span>来源核验 / 自制示意</span>
            <span class="scene-live">非运行结果</span>
          </div>
          <div class="scene-screen">
            <div class="scene-title-row">
              <span>配文：比上月上涨</span>
              <strong>0.8%</strong>
            </div>
            <div class="scene-chart">
              <div class="scene-axis-labels" aria-hidden="true"><span>1.2</span><span>0.8</span><span>0.4</span><span>0</span></div>
              <svg class="scene-chart-svg" viewBox="0 0 520 264" role="img" aria-label="2025 年 12 月全国 CPI 同比上涨 0.8%，环比上涨 0.2%">
                <g class="scene-grid-lines">
                  <path d="M28 26H500M28 90H500M28 154H500M28 218H500" />
                </g>
                <g class="scene-bars" shape-rendering="crispEdges">
                  <rect x="116" y="90" width="102" height="128" />
                  <rect x="310" y="186" width="102" height="32" />
                </g>
                <g class="scene-chart-values">
                  <text x="167" y="76">0.8%</text><text x="361" y="172">0.2%</text>
                  <text x="167" y="250">同比</text><text x="361" y="250">环比</text>
                </g>
              </svg>
            </div>
            <div class="scene-verdict">
              <div class="scene-verdict-mark" aria-hidden="true"><span></span><span></span><span></span></div>
              <div><span>所引发布的环比数值</span><strong>上涨 0.2%</strong></div>
              <span class="scene-flag">比较方式不同</span>
            </div>
          </div>
          <div class="scene-footline"><a href="https://www.stats.gov.cn/sj/zxfb/202601/t20260109_1962273.html" target="_blank" rel="noopener noreferrer">来源：国家统计局 · 2025 年 12 月</a><span>不是官方原图</span></div>
        </div>
      </section>

      <section id="sample-dock" class="sample-section">
        <div class="section-title-row">
          <div>
            <p class="section-kicker">图内检查 / 团队自制</p>
            <h2>只有截图？先检查图内关系</h2>
          </div>
          <span class="section-count">{{ String(samples.length).padStart(2, "0") }} 个样例</span>
        </div>

        <div v-if="loadError" class="landing-error" role="alert">{{ loadError }}</div>
        <p v-else-if="samplesLoading" class="sample-loading" role="status">正在载入图内样例…</p>
        <div v-else class="sample-dock">
          <button
            v-for="(sample, index) in samples"
            :key="sample.id"
            class="sample-tile"
            :class="`tone-${sampleTone(sample.id)}`"
            @click="openSample(sample.id)"
          >
            <div class="sample-tile-top">
              <span class="sample-tile-index">{{ String(index + 1).padStart(2, "0") }}</span>
            <span class="sample-tile-kind">{{ sampleKind(sample.id) }}</span>
            </div>
            <div class="sample-thumb"><img :src="sample.imageUrl" :alt="sample.name" loading="lazy" /></div>
            <div class="sample-tile-bottom">
              <div><h3>{{ sample.name }}</h3><p>{{ sample.description }}</p></div>
              <span class="sample-open">使用此样例 <span aria-hidden="true">→</span></span>
            </div>
          </button>
        </div>
      </section>

      <footer class="landing-footer">
        <span>图证 / 图内检查与来源核验</span>
        <RouterLink to="/audit?sample=conflict">试跑矛盾样例 <span aria-hidden="true">→</span></RouterLink>
      </footer>
    </main>
  </div>
</template>
