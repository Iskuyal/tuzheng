<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps<{ open: boolean; summary: string }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const dialog = ref<HTMLDialogElement | null>(null);
const summaryField = ref<HTMLTextAreaElement | null>(null);
const copyButton = ref<HTMLButtonElement | null>(null);
const status = ref("");
let previousFocus: HTMLElement | null = null;

const COPIED = "已复制到剪贴板。";
const COPIED_MANUAL = "已选中摘要文本，请按 Ctrl+C 复制。";
const COPY_FAILED = "复制未成功，已选中摘要文本，请按 Ctrl+C 重试。";

function close(): void {
  dialog.value?.close();
}

function closed(): void {
  emit("update:open", false);
  status.value = "";
  previousFocus?.focus();
}

/** 剪贴板不可用（无权限、非安全上下文或旧浏览器）时退回「选中文本让用户自己复制」。 */
async function copy(): Promise<void> {
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

watch(() => props.open, async (open) => {
  await nextTick();
  if (open && !dialog.value?.open) {
    previousFocus = document.activeElement as HTMLElement | null;
    dialog.value?.showModal();
    copyButton.value?.focus();
  } else if (!open && dialog.value?.open) {
    close();
  }
});
onBeforeUnmount(close);
</script>

<template>
  <dialog
    ref="dialog"
    class="room-share-dialog"
    aria-labelledby="source-share-title"
    aria-describedby="source-share-note"
    @close="closed"
    @click="event => { if (event.target === dialog) close(); }"
  >
    <div class="room-share-header">
      <div>
        <h2 id="source-share-title">分享这次核验</h2>
        <p id="source-share-note">纯文本摘要，含结论、引用来源与使用边界。模型建议只作参考，不会写成事实结论。</p>
      </div>
      <button type="button" class="room-button secondary" @click="close">关闭</button>
    </div>
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
      <button ref="copyButton" type="button" class="read-image-button" data-testid="share-copy" @click="copy">复制摘要</button>
      <p class="room-share-status" role="status" data-testid="share-status">{{ status }}</p>
    </div>
    <p class="room-share-hint">摘要是当前这一次结果的快照；配文或输入改变后需要重新核验再分享。按 Escape 关闭。</p>
  </dialog>
</template>
