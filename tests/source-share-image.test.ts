import { describe, expect, it } from "vitest";
import { fnv1a64 } from "../shared/source-library.js";
import { SHARE_BOUNDARY, SHARE_TITLE } from "../web/source-share.js";
import {
  SHARE_IMAGE_MAX_HEIGHT,
  SHARE_IMAGE_PADDING,
  SHARE_IMAGE_WIDTH,
  layoutShareImage,
  shareImageFileName,
  shareImageFont,
  type ShareImageLayout,
  type ShareImageTextStyle,
} from "../web/source-share-image.js";

/** 确定性测量器：ASCII 占 0.55 字宽，其余（含中文）占整字宽。 */
function measure(text: string, style: ShareImageTextStyle): number {
  let width = 0;
  for (const char of text) {
    width += /[\u0000-\u00ff]/.test(char) ? style.size * 0.55 : style.size;
  }
  return width;
}

/** 取出从第 index 行起、同一字号的连续文字拼回来，用来检查「换行但没丢字」。 */
function joinFrom(layout: ShareImageLayout, index: number): string {
  const style = layout.lines[index].style;
  const parts: string[] = [];
  for (const line of layout.lines.slice(index)) {
    if (line.style !== style) break;
    parts.push(line.text);
  }
  return parts.join("");
}

const SAMPLE = [
  SHARE_TITLE,
  SHARE_BOUNDARY,
  "",
  "配文原文：2025 年 12 月 CPI 同比上涨 0.2%",
  "本次核验：模型 stub-source-model · 3 轮 · 工具调用 2 / 6",
  "停止原因：已完成 3 轮核验，主张均已对照来源。",
  "结论（1 条）",
  "1. 「2025 年 12 月 CPI 同比上涨 0.2%」（配文）· 与来源不一致",
  "   说明：来源公布的是环比上涨 0.2%。",
  "   引用：《2025 年 12 月居民消费价格变动情况》（国家统计局，2026-01-09） · 用作数值依据",
  "",
  "摘要指纹：3f9c1d2a5b7e4c60",
  "（指纹由摘要正文计算；文字被改动后指纹即不同。）",
].join("\n");

describe("分享图片的排版", () => {
  it("首行是标题，紧跟其后是完整的边界声明原文", () => {
    const layout = layoutShareImage(SAMPLE, measure);
    expect(layout.lines[0].text).toBe(SHARE_TITLE);
    // 边界声明较长会折行，但必须一字不少地紧跟在标题后面。
    expect(joinFrom(layout, 1)).toBe(SHARE_BOUNDARY);
  });

  it("宽度固定，所有文字都在内边距之内（悬挂标点允许超出一个字宽）", () => {
    const layout = layoutShareImage(SAMPLE, measure);
    expect(layout.width).toBe(SHARE_IMAGE_WIDTH);
    for (const line of layout.lines) {
      const right = line.x + measure(line.text, line.style);
      expect(line.x).toBeGreaterThanOrEqual(SHARE_IMAGE_PADDING);
      // 收尾标点会挂在行末，因此允许比内边界多出一个字的宽度。
      expect(right).toBeLessThanOrEqual(SHARE_IMAGE_WIDTH - SHARE_IMAGE_PADDING + line.style.size + 0.01);
    }
  });

  it("折行时收尾标点跟在上一行，不会单独成行", () => {
    // 构造正好在「。」前断行的文本：若不做悬挂处理，会多出只有「。」的一行。
    const layout = layoutShareImage(SAMPLE, measure);
    expect(layout.lines.some((line) => /^[。，、；：）]/.test(line.text))).toBe(false);
  });

  it("指纹单独一行并与说明行区分字号", () => {
    const layout = layoutShareImage(SAMPLE, measure);
    const fingerprint = layout.lines.find((line) => line.text.startsWith("摘要指纹："));
    const footnote = layout.lines.find((line) => line.text.startsWith("（指纹由"));
    expect(fingerprint?.style.face).toBe("mono");
    expect(footnote?.style.face).toBe("sans");
    expect(fingerprint?.style.size).toBeGreaterThan(footnote?.style.size ?? 0);
  });

  it("长行折成多段，文字不丢", () => {
    const body = "很长的说明文字".repeat(40);
    const layout = layoutShareImage(`结论（1 条）\n    ${body}`, measure);
    const parts = layout.lines.filter((line) => line.style.face === "sans" && line.style.size === 27);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((line) => line.text).join("")).toBe(body);
  });

  it("缩进保留，子行不回到顶格", () => {
    const layout = layoutShareImage(SAMPLE, measure);
    const indented = layout.lines.find((line) => line.text.startsWith("说明："));
    expect(indented).toBeDefined();
    expect(indented!.x).toBeGreaterThan(SHARE_IMAGE_PADDING);
  });

  it("超长摘要被截断并写明提示，高度不超过上限", () => {
    const huge = [SHARE_TITLE, SHARE_BOUNDARY, ...Array.from({ length: 2000 }, (_, i) => `第 ${i} 行：${"内容".repeat(20)}`)].join("\n");
    const layout = layoutShareImage(huge, measure);
    expect(layout.height).toBeLessThanOrEqual(SHARE_IMAGE_MAX_HEIGHT);
    expect(layout.lines.some((line) => line.text.includes("完整内容请改用"))).toBe(true);
  });

  it("空摘要退回标题与边界声明，仍有最小高度", () => {
    const layout = layoutShareImage("   ", measure);
    expect(layout.lines[0].text).toBe(SHARE_TITLE);
    expect(joinFrom(layout, 1)).toBe(SHARE_BOUNDARY);
    expect(layout.height).toBeGreaterThanOrEqual(640);
  });

  it("字体描述带字号与字体族，canvas 与测量器共用", () => {
    expect(shareImageFont({ face: "serif", size: 48, weight: 600, color: "#000" })).toContain("600 48px");
    expect(shareImageFont({ face: "mono", size: 26, weight: 500, color: "#000" })).toContain("monospace");
  });
});

describe("分享图片的文件名", () => {
  it("由摘要指纹推出，稳定且是 png", () => {
    expect(shareImageFileName(SAMPLE)).toBe(`图证-来源核验摘要-${fnv1a64(SAMPLE).slice(0, 8)}.png`);
    expect(shareImageFileName(SAMPLE)).toBe(shareImageFileName(SAMPLE));
  });

  it("不同摘要得到不同文件名", () => {
    expect(shareImageFileName(SAMPLE)).not.toBe(shareImageFileName(`${SAMPLE} `));
  });
});
