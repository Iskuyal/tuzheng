import {
  layoutShareImage,
  shareImageFileName,
  shareImageFont,
  type ShareTextMeasurer,
} from "./source-share-image.js";

/**
 * 把分享摘要画成一张竖版长图（浏览器侧）。
 *
 * 排版全部由 `web/source-share-image.ts` 的纯函数决定，这里只负责：
 * 建一个真实的 canvas 上下文当测量器、按排版结果绘制、导出 PNG。
 * 因此折行与截断能在 Node 里单测，绘制这一层只剩「有没有画上去」。
 */

export interface RenderedShareImage {
  /** `data:image/png;base64,…`，可直接给 `<img src>` 与 `<a download href>`。 */
  dataUrl: string;
  width: number;
  height: number;
  fileName: string;
}

let measureContext: CanvasRenderingContext2D | null = null;

function measureCtx(): CanvasRenderingContext2D | null {
  if (measureContext) return measureContext;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  measureContext = canvas.getContext("2d");
  return measureContext;
}

const measurer: ShareTextMeasurer = (text, style) => {
  const ctx = measureCtx();
  if (!ctx) return text.length * style.size * 0.6;
  ctx.font = shareImageFont(style);
  return ctx.measureText(text).width;
};

/** 生成分享长图；浏览器不可用或 canvas 出错时返回 null，调用方退回文字格式并说明。 */
export function renderShareImage(summary: string): RenderedShareImage | null {
  const ctx = measureCtx();
  if (!ctx) return null;
  const layout = layoutShareImage(summary, measurer);
  const canvas = ctx.canvas;
  canvas.width = layout.width;
  canvas.height = layout.height;

  try {
    ctx.fillStyle = layout.background;
    ctx.fillRect(0, 0, layout.width, layout.height);
    ctx.fillStyle = layout.accent;
    ctx.fillRect(0, 0, layout.width, layout.accentHeight);
    ctx.textBaseline = "alphabetic";
    for (const line of layout.lines) {
      ctx.font = shareImageFont(line.style);
      ctx.fillStyle = line.style.color;
      ctx.fillText(line.text, line.x, line.y);
    }
    return {
      dataUrl: canvas.toDataURL("image/png"),
      width: layout.width,
      height: layout.height,
      fileName: shareImageFileName(summary),
    };
  } catch {
    return null;
  }
}

/** 把渲染好的图片写进剪贴板；返回 false 表示当前浏览器不支持或没有授权。 */
export async function copyShareImageToClipboard(dataUrl: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return false;
    const blob = await (await fetch(dataUrl)).blob();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}
