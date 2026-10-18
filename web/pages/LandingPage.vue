<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import SiteHeader from "../components/SiteHeader.vue";
import { queueLandingUpload, requestLandingSourceSample } from "../upload-transfer.js";

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

function uploadScreenshot(event: Event, destination: "audit" | "source-audit" = "audit"): void {
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
  queueLandingUpload(file, destination);
  void router.push({ name: destination });
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
  <div class="landing-page evidence-room">
    <SiteHeader />
    <main class="room-container">
      <section class="room-hero">
        <div class="room-hero-copy">
          <p class="room-kicker">图表、主张与它们的依据</p>
          <h1>看见数字，<br />也看见依据。</h1>
          <p class="room-hero-description">把图表与配文放在一起，看看哪里值得再问一句。<br class="room-desktop-break" />从图内矛盾，到适用来源，每一步都说明为什么。</p>
          <div class="room-hero-actions">
            <RouterLink class="room-button" to="/source-audit?sample=cpi-2025-12" @click="event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) requestLandingSourceSample(); }">试用 CPI 来源核验样例 <span aria-hidden="true">→</span></RouterLink>
            <RouterLink class="room-inline-link" to="/audit">只有截图？先做图内检查 ↗</RouterLink>
          </div>
          <p class="room-support">载入团队自制 CPI 样例，点击运行后才调用模型。</p>
          <label class="room-upload" for="landing-source-upload">
            <span class="room-upload-icon" aria-hidden="true">＋</span>
            <span><strong>图表＋配文：进入来源核验</strong><small>只查收录资料 · PNG / JPG / WebP，最大 5 MB</small></span><span class="room-upload-arrow" aria-hidden="true">→</span>
            <input id="landing-source-upload" type="file" accept="image/png,image/jpeg,image/webp" @change="uploadScreenshot($event, 'source-audit')" />
          </label>
          <p class="room-coverage">当前收录 CPI、社会消费品零售等少量公开资料；不覆盖时保留待核对。<RouterLink to="/source-audit#source-library">查看范围 ↗</RouterLink></p>
          <p v-if="uploadError" class="landing-error" role="alert">{{ uploadError }}</p>
        </div>
        <div class="room-specimen" aria-label="静态来源示意，自制图，不是模型运行结果">
          <div class="room-specimen-inner">
            <div class="room-specimen-top"><span class="room-tag">示例预览</span><span>团队自制 · 非运行结果</span></div>
            <h2>2025 年 12 月 · 全国 CPI</h2>
            <p class="room-big-number">0.8<span>%</span></p>
            <p class="room-support">图上没有标明：与什么时候比较？</p>
            <div class="room-specimen-claim"><span>配文说</span><p>“<u>比上月</u>上涨 0.8%”</p><span class="room-tag conflict">比较方式有疑点</span></div>
            <p class="room-support">来源中的两种比较</p>
            <div class="room-comparisons"><div><strong>同比 0.8%</strong><span>与去年同月比较</span></div><div><strong>环比 0.2%</strong><span>与上个月比较</span></div></div>
            <a class="room-specimen-source" href="https://www.stats.gov.cn/sj/zxfb/202601/t20260109_1962273.html" target="_blank" rel="noopener noreferrer">来源：国家统计局 · 2026-01-09 ↗</a>
          </div>
        </div>
      </section>
      <section id="how-it-works" class="room-how">
        <h2>从一个疑问，走到一条可复查的结论。</h2>
        <ol><li><span>01</span><div><h3>放入图表与配文</h3><p>一张截图就能开始。没有来源时，<br />结论停留在图内检查。</p></div></li><li><span>02</span><div><h3>逐条看清依据</h3><p>把说法、数值与适用来源对应，<br />区分矛盾、风险和仍待确认的部分。</p></div></li><li><span>03</span><div><h3>带着依据继续</h3><p>核对修改建议，或补一条关键信息，<br />再看看判断如何变化。</p></div></li></ol>
      </section>
      <details id="sample-dock" class="room-samples">
        <summary>只有截图？浏览 {{ samples.length }} 个团队自制图内样例 <span aria-hidden="true">＋</span></summary>
        <p class="room-support">只检查截图内的关系，不将其当作来源核验。</p>
        <label class="room-button secondary" for="landing-upload">上传截图做图内检查<input id="landing-upload" class="room-file-input" type="file" accept="image/png,image/jpeg,image/webp" @change="uploadScreenshot($event)" /></label>
        <div v-if="loadError" class="landing-error" role="alert">{{ loadError }} <button type="button" @click="loadSamples">重新载入</button></div>
        <p v-else-if="samplesLoading" role="status">正在载入图内样例…</p>
        <div v-else class="room-sample-grid"><button v-for="item in samples" :key="item.id" type="button" class="room-sample" @click="openSample(item.id)"><img :src="item.imageUrl" :alt="item.name" loading="lazy" /><span class="room-tag">{{ sampleKind(item.id) }}</span><strong>{{ item.name }}</strong><span>{{ item.description }}</span></button></div>
      </details>
      <footer class="room-footer"><span>图证 · 每一项判断，都留下依据。</span><a href="#how-it-works">了解检查范围与用法 ↑</a></footer>
    </main>
  </div>
</template>
