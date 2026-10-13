import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { buildInput, loadBundle } from "../scripts/holdout-evaluation.js";
import { fixtureOutput, offlineTransports } from "../scripts/holdout-fixtures.js";
import { runSourceInvestigation } from "../server/source-investigation.js";
import { createHttpTransports, HttpBudget } from "../scripts/holdout-http.js";

const config = { baseUrl: "http://127.0.0.1:3001/v1", model: "fixture-model", apiKey: "fake-secret-never-save" };
const response = (output: unknown, usage: unknown = { input_tokens: 10, output_tokens: 5 }) => new Response(JSON.stringify({
  model: "actual-model", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(output) }] }], usage,
}), { status: 200 });

describe("三臂实际HTTP传输和共享预算（全部替身）", () => {
  it("实际回环HTTP请求只发送一次，持久记录发送前running与发送后状态", async () => {
    const server = createServer((_request, reply) => { reply.setHeader("content-type", "application/json"); reply.end(JSON.stringify({ usage: { input_tokens: 1, output_tokens: 2 } })); });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    try {
      const address = server.address(); if (!address || typeof address === "string") throw new Error("无端口");
      const events: string[] = [];
      const budget = new HttpBudget({ maxRequests: 1, persist: async r => { events.push(r.status); } });
      await budget.send({ ...config, baseUrl: `http://127.0.0.1:${address.port}` }, "openai-responses", { model: config.model }, { arm: "A-direct", questionId: "h01", phase: "before" });
      expect(events).toEqual(["running", "ok"]); expect(budget.records).toHaveLength(1);
      await expect(budget.send(config, "openai-responses", {}, { arm: "B-full-context", questionId: "h01", phase: "before" })).rejects.toThrow("HTTP请求上限");
      expect(budget.records).toHaveLength(1);
    } finally { server.close(); await once(server, "close"); }
  });

  it("发送前落盘失败时不发请求；并发超过共享上限也不发请求", async () => {
    const fetchImpl = vi.fn(async () => response({}));
    const budget = new HttpBudget({ maxRequests: 1, fetchImpl, persist: async () => { throw new Error("磁盘故障"); } });
    await expect(budget.send(config, "anthropic", {}, { arm: "C-tools", questionId: "h01", phase: "before" })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled(); expect(budget.stopReason).toContain("记录");
  });

  it("并发预占预算时仍至多发送上限允许的一次HTTP", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response({}));
    const budget = new HttpBudget({ maxRequests: 1, fetchImpl, persist: async () => { await Promise.resolve(); } });
    const results = await Promise.allSettled([budget.send(config, "openai-responses", {}, { arm: "A-direct", questionId: "h01", phase: "before" }),
      budget.send(config, "openai-responses", {}, { arm: "B-full-context", questionId: "h01", phase: "before" })]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("A/B相同模型与输出约束，只有B收到全集，且归档不含密钥", async () => {
    const bundle = await loadBundle(); const input = await buildInput(bundle, bundle.questions[0], "B-full-context");
    const fetchImpl = vi.fn<typeof fetch>(async () => response(fixtureOutput(input)));
    const budget = new HttpBudget({ maxRequests: 3, fetchImpl });
    const transports = createHttpTransports("openai-responses", config, budget);
    const session = transports.direct(input); const reply = await session.send(input);
    expect(reply.raw).toEqual(fixtureOutput(input)); expect(reply.model).toBe("actual-model");
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.max_output_tokens).toBe(4096); expect(body.store).toBe(false);
    expect(body.text.format.type).toBe("json_schema"); expect(JSON.stringify(body)).toContain(bundle.corpus[0].id);
    expect(JSON.stringify(budget.records)).not.toContain(config.apiKey);
    const a = await buildInput(bundle, bundle.questions[0], "A-direct"); await transports.direct(a).send(a);
    expect(JSON.stringify(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)))).not.toContain(bundle.corpus[0].id);
  });

  it("Messages直接输出使用结构工具，并在补证前配对tool_result", async () => {
    const bundle = await loadBundle(); const q = bundle.questions.find(q => q.supplement)!;
    const input = await buildInput(bundle, q, "B-full-context"); const output = fixtureOutput(input);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ model: "actual", content: [{ type: "tool_use", id: "reply1", name: "report_holdout_result", input: output }], usage: { input_tokens: 10, output_tokens: 5 } })));
    const budget = new HttpBudget({ maxRequests: 3, fetchImpl }); const session = createHttpTransports("anthropic", config, budget).direct(input);
    await session.send(input); await session.send(await buildInput(bundle, q, "B-full-context", "after", output));
    const body = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.messages[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "reply1" });
    expect(session.requests).toHaveLength(2);
  });

  it.each(["bad-json", "empty", "truncated", "unknown-usage"])("保留%s响应并停止会计不明或无效输出", async kind => {
    const fetchImpl = vi.fn(async () => kind === "bad-json" ? new Response("not json") : kind === "truncated"
      ? new Response(JSON.stringify({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage: { input_tokens: 10, output_tokens: 5 } }))
      : response(kind === "empty" ? null : {}, kind === "unknown-usage" ? null : { input_tokens: 10, output_tokens: 5 }));
    const budget = new HttpBudget({ maxRequests: 4, fetchImpl });
    const bundle = await loadBundle(); const input = await buildInput(bundle, bundle.questions[0], "A-direct");
    await expect(createHttpTransports("openai-responses", config, budget).direct(input).send(input)).rejects.toThrow();
    expect(budget.records).toHaveLength(1); expect(budget.records[0].response).not.toBeUndefined();
    if (kind === "unknown-usage" || kind === "bad-json") expect(budget.stopReason).toBeTruthy();
  });

  it.each([401, 403, 429])("HTTP %i立即停止且错误正文中的密钥被清除", async status => {
    const fetchImpl = vi.fn(async () => new Response(config.apiKey, { status }));
    const budget = new HttpBudget({ maxRequests: 5, fetchImpl });
    await expect(budget.send(config, "anthropic", {}, { arm: "C-tools", questionId: "h01", phase: "before" })).rejects.toThrow();
    expect(budget.stopReason).toBeTruthy(); expect(JSON.stringify(budget.records)).not.toContain(config.apiKey);
    await expect(budget.send(config, "anthropic", {}, { arm: "C-tools", questionId: "h01", phase: "before" })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("C的400兼容回退每次HTTP都计数，第二次请求也受硬上限控制", async () => {
    const bundle = await loadBundle(); const input = await buildInput(bundle, bundle.questions[0], "C-tools");
    const fetchImpl = vi.fn(async () => new Response("unsupported thinking", { status: 400 }));
    const budget = new HttpBudget({ maxRequests: 1, fetchImpl }); const driver = createHttpTransports("anthropic", config, budget).tools(input);
    await expect(driver.start()).rejects.toThrow(); expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(driver.requestRecords).toHaveLength(1); expect(budget.stopReason).toContain("HTTP请求上限");
  });

  it("网络失败不自动重试，连续三次停止；拒绝重定向", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new Error("network " + config.apiKey); });
    const budget = new HttpBudget({ maxRequests: 10, fetchImpl });
    for (let n = 0; n < 3; n++) await expect(budget.send(config, "openai-responses", {}, { arm: "A-direct", questionId: "h01", phase: "before" })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(3); expect(budget.stopReason).toContain("连续");
    expect(fetchImpl.mock.calls[0]?.[1]?.redirect).toBe("error"); expect(JSON.stringify(budget.records)).not.toContain(config.apiKey);
  });

  it.each(["openai-responses", "anthropic"] as const)("%s工具臂实际执行检索、汇总及补证，HTTP记录只计增量", async provider => {
    const bundle = await loadBundle(); const q = bundle.questions.find(q => q.id === "h05")!;
    const input = await buildInput(bundle, q, "C-tools"); const fixture = offlineTransports().tools(input);
    let turn = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body[provider === "anthropic" ? "max_tokens" : "max_output_tokens"]).toBe(4096);
      const reply = turn++ === 0 ? await fixture.start() : await fixture.continue([]);
      return new Response(JSON.stringify(provider === "anthropic" ? {
        model: "fixture-http", content: reply.calls.map(c => ({ type: "tool_use", id: `${c.id}${turn}`, name: c.name, input: c.input })),
        usage: { input_tokens: 10, output_tokens: 5 },
      } : { model: "fixture-http", status: "completed", output: reply.calls.map(c => ({ type: "function_call", call_id: `${c.id}${turn}`, name: c.name, arguments: JSON.stringify(c.input) })),
        usage: { input_tokens: 10, output_tokens: 5 } }));
    });
    const budget = new HttpBudget({ maxRequests: 10, fetchImpl }); const driver = createHttpTransports(provider, config, budget).tools(input);
    const before = await runSourceInvestigation(driver, { caption: q.caption });
    expect(before.hits.length).toBeGreaterThan(0); expect(before.clarification?.field).toBe("basis");
    const beforeRequests = driver.requestRecords!.length;
    const after = await runSourceInvestigation(driver, { caption: q.caption, resume: { prior: before, answer: q.supplement!.answer } });
    expect(after.clarification).toBeNull(); expect(after.conclusions[0].status).toBe("source-match");
    expect(budget.records.filter(r => r.phase === "after")).toHaveLength(driver.requestRecords!.length - beforeRequests);
    expect(driver.requestRecords).toHaveLength(fetchImpl.mock.calls.length);
  });

  it("400兼容回退实际成功时两次HTTP均留档；拒绝回退也不漏计", async () => {
    const bundle = await loadBundle(); const input = await buildInput(bundle, bundle.questions[0], "C-tools");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("unsupported thinking", { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ model: "fixture", content: [{ type: "text", text: "继续核对" }], usage: { input_tokens: 5, output_tokens: 2 } })));
    const budget = new HttpBudget({ maxRequests: 3, fetchImpl });
    await createHttpTransports("anthropic", config, budget).tools(input).start();
    expect(budget.records.map(r => r.httpStatus)).toEqual([400, 200]);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)).thinking).toBeUndefined();
  });

  it("超时按一次HTTP失败计数，发送后落盘失败阻止下一次请求", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError")), { once: true });
    }));
    const budget = new HttpBudget({ maxRequests: 3, timeoutMs: 5, fetchImpl });
    await expect(budget.send(config, "openai-responses", {}, { arm: "A-direct", questionId: "h01", phase: "before" })).rejects.toMatchObject({ name: "TimeoutError" });
    expect(budget.records[0]).toMatchObject({ status: "failed", attempted: true }); expect(fetchImpl).toHaveBeenCalledTimes(1);
    const fetchOk = vi.fn<typeof fetch>(async () => response({}));
    const disk = new HttpBudget({ maxRequests: 3, fetchImpl: fetchOk, persist: async r => { if (r.completedAt) throw new Error("disk"); } });
    await expect(disk.send(config, "openai-responses", {}, { arm: "A-direct", questionId: "h01", phase: "before" })).rejects.toThrow("记录写入");
    await expect(disk.send(config, "openai-responses", {}, { arm: "A-direct", questionId: "h01", phase: "before" })).rejects.toThrow();
    expect(fetchOk).toHaveBeenCalledTimes(1);
  });
});
