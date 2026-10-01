import { isIP } from "node:net";
import { z } from "zod";

export function isCompletedModelEndpoint(value: string): boolean {
  try {
    const path = decodeURIComponent(new URL(value).pathname).replace(/\/+$/, "").toLowerCase();
    return ["/responses", "/chat/completions", "/completions", "/messages"]
      .some((suffix) => path.endsWith(suffix));
  } catch {
    return false;
  }
}

/** 127/8 必须是实际 IPv4 地址；域名的文字前缀不能证明它解析到回环。 */
export function isSafeModelBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname;
    const loopback = hostname === "localhost" || hostname.endsWith(".localhost")
      || hostname === "[::1]" || isIP(hostname) === 4 && hostname.split(".")[0] === "127";
    return (url.protocol === "https:" || url.protocol === "http:" && loopback)
      && !url.username && !url.password && !url.search && !url.hash
      && !isCompletedModelEndpoint(value);
  } catch {
    return false;
  }
}

export const modelBaseUrlSchema = z.string().url().max(500).refine(isSafeModelBaseUrl);
