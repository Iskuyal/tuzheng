<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps<{ open: boolean; src: string; name: string }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const stage = ref<HTMLDivElement | null>(null);
const image = ref<HTMLImageElement | null>(null);
const scale = ref(1);
let previousFocus: HTMLElement | null = null;
let drag: { x: number; y: number; left: number; top: number } | null = null;

function fit(): void {
  if (!image.value?.naturalWidth || !stage.value) return;
  scale.value = Math.min(1, Math.max(.1, (stage.value.clientWidth - 2) / image.value.naturalWidth));
}
function changeZoom(delta: number): void { scale.value = Math.min(4, Math.max(.1, scale.value + delta)); }
function close(): void { dialog.value?.close(); }
function closed(): void {
  emit("update:open", false);
  previousFocus?.focus();
}
function pan(event: PointerEvent): void {
  if (!drag || !stage.value) return;
  stage.value.scrollLeft = drag.left - (event.clientX - drag.x);
  stage.value.scrollTop = drag.top - (event.clientY - drag.y);
}
function startPan(event: PointerEvent): void {
  if (event.pointerType !== "mouse" || event.button !== 0 || !stage.value) return;
  drag = { x: event.clientX, y: event.clientY, left: stage.value.scrollLeft, top: stage.value.scrollTop };
  stage.value.setPointerCapture(event.pointerId);
}
watch(() => props.open, async (open) => {
  await nextTick();
  if (open && !dialog.value?.open) {
    previousFocus = document.activeElement as HTMLElement | null;
    dialog.value?.showModal();
    fit();
  } else if (!open && dialog.value?.open) close();
});
onBeforeUnmount(close);
</script>

<template>
  <dialog ref="dialog" class="room-image-viewer" aria-labelledby="original-image-title" @close="closed" @click="event => { if (event.target === dialog) close(); }">
    <div class="room-viewer-header">
      <div><h2 id="original-image-title">查看图表原图</h2><p>{{ name }} · 缩放不改变核验材料</p></div>
      <button type="button" class="room-button secondary" autofocus @click="close">关闭</button>
    </div>
    <div ref="stage" class="room-viewer-stage" tabindex="0" aria-label="图表原图，可滚动或拖动查看" @pointerdown="startPan" @pointermove="pan" @pointerup="drag = null" @pointercancel="drag = null">
      <img ref="image" :src="src || undefined" alt="待核验的图表原图" draggable="false" :style="{ width: image?.naturalWidth ? `${image.naturalWidth * scale}px` : '100%' }" @load="fit" />
    </div>
    <div class="room-viewer-controls">
      <div class="room-viewer-zoom">
      <button type="button" class="room-button secondary" aria-label="缩小" :disabled="scale <= .1" @click="changeZoom(-.25)">−</button>
      <output aria-live="polite">{{ Math.round(scale * 100) }}%</output>
      <button type="button" class="room-button secondary" aria-label="放大" :disabled="scale >= 4" @click="changeZoom(.25)">＋</button>
      </div><div class="room-viewer-presets">
      <button type="button" class="room-button secondary" @click="scale = 1">原始像素</button>
      <button type="button" class="room-button secondary" @click="fit">适合屏幕</button>
      </div>
    </div>
    <p class="room-viewer-hint">拖动、滚动或使用方向键查看；按 Escape 返回材料。</p>
  </dialog>
</template>
