import { describe, expect, it } from "vitest";
import { axisBarPercent, axisRangeText, crossStateLabel } from "../web/cross-image-view.js";
import { assessAxisRisk } from "../shared/axis-risk.js";

describe("跨图与纵轴的展示换算", () => {
  it("口径状态给中文标签", () => {
    expect(crossStateLabel("aligned")).toBe("一致");
    expect(crossStateLabel("confirmed-by-user")).toBe("你已确认一致");
    expect(crossStateLabel("missing")).toBe("图上没读到");
    expect(crossStateLabel("mismatch")).toBe("不一致");
  });

  it("柱高按各自范围归一化，缺失或全零时为 0", () => {
    expect(axisBarPercent([0, 20], 0)).toBe(0);
    expect(axisBarPercent([0, 20], 1)).toBe(100);
    expect(axisBarPercent([80, 100], 0)).toBe(80);
    expect(axisBarPercent(null, 0)).toBe(0);
    expect(axisBarPercent([0, 0], 1)).toBe(0);
  });

  it("轴范围文案区分读到上下界、只读到起点与未读到", () => {
    const full = assessAxisRisk({ label: "营业收入", min: 80, max: 100, unit: "万元" }, [80, 100]);
    expect(axisRangeText(full)).toBe("（80–100 万元）");

    const openEnded = assessAxisRisk({ label: "营业收入", min: null, max: null, unit: "万元" }, [80, 100], 80);
    expect(axisRangeText(openEnded)).toBe("（起点 80 万元）");

    const missing = assessAxisRisk(null, [80, 100]);
    expect(axisRangeText(missing)).toBe("（未读到）");
  });
});
