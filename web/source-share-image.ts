import { fnv1a64 } from "../shared/source-library.js";
import { SHARE_BOUNDARY, SHARE_TITLE } from "./source-share.js";

/**
 * 分享图片的排版：把摘要文字排成一张竖版长图。
 *
 * 这里只算「哪一行、放在哪、用什么字号」，不碰 canvas——真正的绘制在
 * `web/share-image-render.ts`。测量宽度由调用方注入（浏览器传真实的 `measureText`，
 * 单测传一个确定性的假测量器），因此折行、间距与截断都能在 Node 里直接测。
 *
 * 三条与文字摘要一致的规则：首行标题、第二行边界声明原文、指纹单独一行且不是最后一行。
 */

export const SHARE_IMAGE_WIDTH = 1080;
export const SHARE_IMAGE_PADDING = 72;
/** 图片最长边；超过就截断并明确写出「完整文字请用文字格式」，不假装图片是全的。 */
export const SHARE_IMAGE_MAX_HEIGHT = 12000;
export const SHARE_IMAGE_BACKGROUND = "#f7f1e6";
export const SHARE_IMAGE_ACCENT = "#2b3551";
export const SHARE_IMAGE_ACCENT_HEIGHT = 10;
const SHARE_IMAGE_MIN_HEIGHT = 640;
const GAP_HEIGHT = 26;

const TRUNCATION_NOTE = "（摘要过长，图片只显示到这里；完整内容请改用「文字」分享。）";

export type ShareImageFace = "serif" | "sans" | "mono";

export interface ShareImageTextStyle {
  face: ShareImageFace;
  size: number;
  weight: number;
  color: string;
}

export interface ShareImageLine {
  text: string;
  x: number;
  y: number;
  style: ShareImageTextStyle;
}

export interface ShareImageLayout {
  width: number;
  height: number;
  background: string;
  accent: string;
  accentHeight: number;
  lines: ShareImageLine[];
}

/** 量一段文字在某字号下的宽度；浏览器用 `ctx.measureText`，单测给确定性替身。 */
export type ShareTextMeasurer = (text: string, style: ShareImageTextStyle) => number;

const INK = "#2b3551";
const MUTED = "#596174";
const AMBER = "#79551f";

type LineKind = "title" | "boundary" | "header" | "body" | "fingerprint" | "footnote" | "note";
type BlockKind = LineKind | "gap";

interface KindSpec {
  style: ShareImageTextStyle;
  lineHeight: number;
  gapBefore: number;
}

function spec(kind: LineKind): KindSpec {
  switch (kind) {
    case "title":
      return { style: { face: "serif", size: 48, weight: 600, color: INK }, lineHeight: 68, gapBefore: 0 };
    case "boundary":
      return { style: { face: "sans", size: 26, weight: 400, color: MUTED }, lineHeight: 44, gapBefore: 14 };
    case "header":
      return { style: { face: "sans", size: 30, weight: 600, color: INK }, lineHeight: 46, gapBefore: 18 };
    case "body":
      return { style: { face: "sans", size: 27, weight: 400, color: INK }, lineHeight: 44, gapBefore: 0 };
    case "fingerprint":
      return { style: { face: "mono", size: 26, weight: 500, color: AMBER }, lineHeight: 44, gapBefore: 22 };
    case "footnote":
      return { style: { face: "sans", size: 22, weight: 400, color: MUTED }, lineHeight: 38, gapBefore: 6 };
    case "note":
      return { style: { face: "sans", size: 23, weight: 400, color: AMBER }, lineHeight: 40, gapBefore: 20 };
  }
}

/** CSS font 简写；canvas 与单测共用同一份描述，避免两边字号漂移。 */
export function shareImageFont(style: ShareImageTextStyle): string {
  const family = style.face === "serif"
    ? '"Noto Serif SC", SimSun, serif'
    : style.face === "mono"
      ? 'ui-monospace, Consolas, "Microsoft YaHei", monospace'
      : '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
  return `${style.weight} ${style.size}px ${family}`;
}

function classify(line: string, index: number): BlockKind {
  const text = line.trim();
  if (!text) return "gap";
  if (index === 0 || text === SHARE_TITLE) return "title";
  if (text === SHARE_BOUNDARY) return "boundary";
  if (text.startsWith("摘要指纹：")) return "fingerprint";
  if (text.startsWith("（指纹由")) return "footnote";
  if (/^ +\S/.test(line)) return "body";
  return "header";
}

/** 行首不能出现的收尾标点：折行后跟随上一行结尾（悬挂标点），避免出现只剩「。」的一行。 */
const CLOSING_PUNCTUATION = /^[。，、；：？！）」』】》〉…—·％%]+/;

function hangPunctuation(parts: string[]): string[] {
  for (let index = 1; index < parts.length; index += 1) {
    const match = CLOSING_PUNCTUATION.exec(parts[index]);
    if (!match) continue;
    parts[index - 1] += match[0];
    parts[index] = parts[index].slice(match[0].length);
    if (!parts[index]) {
      parts.splice(index, 1);
      index -= 1;
    }
  }
  return parts;
}

/** 拉丁词不劈开：先按词切，词本身太长才退化成按字符切。 */
function tokenize(text: string): string[] {
  return text.match(/[A-Za-z0-9][A-Za-z0-9._:/%+-]*|\s+|[\s\S]/gu) ?? [];
}

function wrap(text: string, style: ShareImageTextStyle, maxWidth: number, measure: ShareTextMeasurer): string[] {
  const parts: string[] = [];
  let current = "";
  for (const token of tokenize(text)) {
    const candidate = current + token;
    if (current && measure(candidate, style) > maxWidth) {
      parts.push(current.trimEnd());
      current = token.trimStart();
      // 单个词比整行还宽：按字符硬切，否则会溢出图片。
      while (current && measure(current, style) > maxWidth) {
        let cut = current.length - 1;
        while (cut > 1 && measure(current.slice(0, cut), style) > maxWidth) cut -= 1;
        parts.push(current.slice(0, cut));
        current = current.slice(cut);
      }
    } else {
      current = candidate;
    }
  }
  if (current.trim()) parts.push(current.trimEnd());
  return hangPunctuation(parts.length ? parts : [""]);
}

interface Block {
  kind: LineKind | "gap";
  segments: string[];
  indent: number;
}

function toBlocks(source: string[], innerWidth: number, measure: ShareTextMeasurer): Block[] {
  return source.map((raw, index) => {
    const kind = classify(raw, index);
    if (kind === "gap") return { kind: "gap", segments: [], indent: 0 };
    const { style } = spec(kind);
    const leading = /^ */.exec(raw)?.[0].length ?? 0;
    const indent = style.size * 0.6 * leading;
    return { kind, segments: wrap(raw.trim(), style, innerWidth - indent, measure), indent };
  });
}

function place(
  blocks: Block[],
  bottomLimit: number,
  note: { segments: string[]; style: ShareImageTextStyle; lineHeight: number; gapBefore: number } | null,
): { lines: ShareImageLine[]; endY: number; truncated: boolean } {
  const lines: ShareImageLine[] = [];
  const ceiling = SHARE_IMAGE_MAX_HEIGHT - SHARE_IMAGE_PADDING;
  let y = SHARE_IMAGE_ACCENT_HEIGHT + SHARE_IMAGE_PADDING;
  let truncated = false;

  for (const block of blocks) {
    if (truncated) break;
    if (block.kind === "gap") {
      y += GAP_HEIGHT;
      continue;
    }
    const { style, lineHeight, gapBefore } = spec(block.kind);
    y += gapBefore;
    for (const segment of block.segments) {
      if (y + lineHeight > bottomLimit) {
        truncated = true;
        break;
      }
      lines.push({ text: segment, x: SHARE_IMAGE_PADDING + block.indent, y: y + style.size, style });
      y += lineHeight;
    }
  }

  if (truncated && note) {
    if (y + note.gapBefore + note.lineHeight <= ceiling) y += note.gapBefore;
    for (const segment of note.segments) {
      // 提示行自己也不能顶出图片边界：宁可少一行，也不要溢出到白边外。
      if (y + note.lineHeight > ceiling) break;
      lines.push({ text: segment, x: SHARE_IMAGE_PADDING, y: y + note.style.size, style: note.style });
      y += note.lineHeight;
    }
  }

  return { lines, endY: y, truncated };
}


export function layoutShareImage(summary: string, measure: ShareTextMeasurer): ShareImageLayout {
  const source = summary.trim() ? summary.trim().split(/\r?\n/) : [SHARE_TITLE, SHARE_BOUNDARY];
  const innerWidth = SHARE_IMAGE_WIDTH - SHARE_IMAGE_PADDING * 2;
  const blocks = toBlocks(source, innerWidth, measure);
  const noteSpec = spec("note");
  const note = {
    segments: wrap(TRUNCATION_NOTE, noteSpec.style, innerWidth, measure),
    style: noteSpec.style,
    lineHeight: noteSpec.lineHeight,
    gapBefore: noteSpec.gapBefore,
  };
  const bottomLimit = SHARE_IMAGE_MAX_HEIGHT - SHARE_IMAGE_PADDING;

  // 先按「不截断」排一次；放不下才留出提示行的高度重排，保证提示本身也在图内。
  let result = place(blocks, bottomLimit, null);
  if (result.truncated) {
    const noteHeight = note.gapBefore + note.segments.length * note.lineHeight;
    result = place(blocks, bottomLimit - noteHeight, note);
  }

  return {
    width: SHARE_IMAGE_WIDTH,
    height: Math.max(Math.ceil(result.endY + SHARE_IMAGE_PADDING), SHARE_IMAGE_MIN_HEIGHT),
    background: SHARE_IMAGE_BACKGROUND,
    accent: SHARE_IMAGE_ACCENT,
    accentHeight: SHARE_IMAGE_ACCENT_HEIGHT,
    lines: result.lines,
  };
}

/** 图片文件名由摘要正文指纹推出：同一份摘要永远同名，不同摘要不会互相覆盖。 */
export function shareImageFileName(summary: string): string {
  return `图证-来源核验摘要-${fnv1a64(summary).slice(0, 8)}.png`;
}
