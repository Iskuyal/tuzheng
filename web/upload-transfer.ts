const pendingLandingUploads = new Map<string, File>();
let sourceSampleRequested = false;

/** 首页明确选择样例的意图，与从设置页返回或浏览器后退区分。 */
export function requestLandingSourceSample(): void { sourceSampleRequested = true; }
export function takeLandingSourceSampleRequest(): boolean {
  const requested = sourceSampleRequested;
  sourceSampleRequested = false;
  return requested;
}

export function queueLandingUpload(file: File, destination: "audit" | "source-audit" = "audit"): void {
  pendingLandingUploads.set(destination, file);
}

export function takeLandingUpload(destination: "audit" | "source-audit" = "audit"): File | null {
  const file = pendingLandingUploads.get(destination) ?? null;
  pendingLandingUploads.delete(destination);
  return file;
}
