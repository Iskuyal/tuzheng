<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  copyShareImageToClipboard,
  renderShareImage,
  type RenderedShareImage,
} from "../share-image-render.js";

const props = defineProps<{ open: boolean; summary: string }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

type ShareFormat = "text" | "image" | "both";

const FORMATS: { value: ShareFormat; label: string; hint: string }[] = [
  { value: "text", label: "文字", hint: "纯文本摘要，可粘贴进聊天或文档。" },
  { value: "image", label: "图片", hint: "一张竖版长图，适合发在图片为主的场合。" },
  { value: "both", label: "文字+图片", hint: "两种都给：文字可核对，图片可转发。" },
];

const dialog = ref<HTMLDialogElement | null>(null);
const summaryField = ref<HTMLTextAreaElement | null>(null);
const copyButton = ref<HTMLButtonElement | null>(null);
const formatGroup = ref<HTMLElement | null>(null);

const format = ref<ShareFormat>("text");
const status = ref("");
const imageStatus = ref("");
const image = ref<RenderedShareImage | null>(null);
const imageError = ref("");

let previousFocus: HTMLElement | null = null;

const COPIED = "已复制到剪贴板。";
const COPIED_MANUAL = "已选中摘要文本，请按 Ctrl+C 复制。";
const COPY_FAILED = "复制未成功，已选中摘要文本，请按 Ctrl+C 重试。";
const IMAGE_COPIED = "已复制图片到剪贴板。";
const IMAGE_COPY_FAILED = "图片复制未成功，请用「下载图片」保存。";

const showText = computed(() => format.value !== "image");
const showImage = computed(() => format.value !== "text");
const formatHint = computed(() => FORMATS.find((entry) => entry.value === format.value)?.hint ?? "");

function close(): void {
  dialog.value?.close();
}

function closed(): void {
  emit("update:open", false);
  status.value = "";
  imageStatus.value = "";
  previousFocus?.focus();
}

/** 只在真的要看图时渲染，避免每次打开弹层都画一张长图。 */
function ensureImage(): void {
  if (image.value || imageError.value) return;
  if (!props.summary) return;
  const rendered = renderShareImage(props.summary);
  if (rendered) image.value = rendered;
  else imageError.value = "当前浏览器无法生成图片，请改用「文字」格式。";
}

/** 剪贴板不可用（无权限、非安全上下文或旧浏览器）时退回「选中文本让用户自己复制」。 */
async function copyText(): Promise<void> {
  const text = props.summary;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(text);
    status.value = COPIED;
  } catch {
    const field = summaryField.value;
    if (!field) {
      status.value = COPY_FAILED;
      return;
    }
    field.focus();
    field.select();
    status.value = field.selectionEnd !== field.selectionStart ? COPIED_MANUAL : COPY_FAILED;
  }
}

async function copyImage(): Promise<void> {
  ensureImage();
  const rendered = image.value;
  if (!rendered) {
    imageStatus.value = IMAGE_COPY_FAILED;
    return;
  }
  imageStatus.value = (await copyShareImageToClipboard(rendered.dataUrl)) ? IMAGE_COPIED : IMAGE_COPY_FAILED;
}

watch(() => props.open, async (open) => {
  await nextTick();
  if (open && !dialog.value?.open) {
    previousFocus = document.activeElement as HTMLElement | null;
    status.value = "";
    imageStatus.value = "";
    dialog.value?.showModal();
    formatGroup.value?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus();
    // 上次关闭时若停在图片档，重新打开要立刻画出来，不能停在「正在生成图片…」。
    if (showImage.value) ensureImage();
  } else if (!open && dialog.value?.open) {
    close();
  }
});

// 摘要变了（换了配文、重新核验）就丢掉旧图，下次看图重画。
watch(() => props.summary, () => {
  image.value = null;
  imageError.value = "";
  imageStatus.value = "";
});

watch([format, () => props.summary], () => {
  if (props.open && showImage.value) ensureImage();
});

onBeforeUnmount(close);
</script>

<template>
  <dialog
    ref="dialog"
    class="room-share-dialog"
    :class="{ 'has-image': showText && showImage }"
    aria-labelledby="source-share-title"
    aria-describedby="source-share-note"
    @close="closed"
    @click="event => { if (event.target === dialog) close(); }"
  >
    <div class="room-share-header">
      <div>
        <h2 id="source-share-title">分享这次核验</h2>
        <p id="source-share-note">含结论、引用来源与使用边界。模型建议只作参考，不会写成事实结论。</p>
      </div>
      <button type="button" class="room-button secondary" @click="close">关闭</button>
    </div>

    <fieldset ref="formatGroup" class="room-share-formats">
      <legend>分享格式</legend>
      <div class="room-share-format-options">
        <label v-for="option in FORMATS" :key="option.value" class="room-share-format">
          <input
            v-model="format"
            type="radio"
            name="share-format"
            :value="option.value"
            :data-testid="`share-format-${option.value}`"
          >
          <span>{{ option.label }}</span>
        </label>
      </div>
      <p class="room-share-format-hint" data-testid="share-format-hint">{{ formatHint }}</p>
    </fieldset>

    <div v-if="showImage" class="room-share-image">
      <img
        v-if="image"
        class="room-share-image-preview"
        data-testid="share-image-preview"
        :src="image.dataUrl"
        :alt="`核验结果长图预览，${image.width}×${image.height} 像素`"
        :width="image.width"
        :height="image.height"
      >
      <p v-else-if="imageError" class="room-share-status" data-testid="share-image-error">{{ imageError }}</p>
      <p v-else class="room-share-status">正在生成图片…</p>
      <div v-if="image" class="room-share-actions">
        <a
          class="read-image-button"
          data-testid="share-image-download"
          :href="image.dataUrl"
          :download="image.fileName"
        >下载图片</a>
        <button type="button" class="room-button secondary" data-testid="share-image-copy" @click="copyImage">复制图片</button>
        <p class="room-share-status" role="status" data-testid="share-image-status">{{ imageStatus }}</p>
      </div>
      <p v-if="image" class="room-share-image-meta" data-testid="share-image-meta">{{ image.width }} × {{ image.height }} 像素 · {{ image.fileName }} · 图片是文字摘要的排版截图，同样只代表这一次核验。</p>
    </div>

    <template v-if="showText">
      <textarea
        ref="summaryField"
        class="room-share-text"
        data-testid="share-summary-text"
        readonly
        aria-label="核验结果纯文本摘要"
        :value="summary"
        rows="16"
      ></textarea>
      <div class="room-share-actions">
        <button ref="copyButton" type="button" class="read-image-button" data-testid="share-copy" @click="copyText">复制文字</button>
        <p class="room-share-status" role="status" data-testid="share-status">{{ status }}</p>
      </div>
    </template>

    <p class="room-share-hint">摘要是当前这一次结果的快照；配文或输入改变后需要重新核验再分享。按 Escape 关闭。</p>
  </dialog>
</template>
