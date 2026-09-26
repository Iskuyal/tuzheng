let pendingLandingUpload: File | null = null;

export function queueLandingUpload(file: File): void {
  pendingLandingUpload = file;
}

export function takeLandingUpload(): File | null {
  const file = pendingLandingUpload;
  pendingLandingUpload = null;
  return file;
}
