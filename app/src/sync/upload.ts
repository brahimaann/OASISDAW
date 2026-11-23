/**
 * Uploads a file to the server's sound pool, resumably (tus), in chunks small
 * enough for Cloudflare. If the pool already has it (same SHA-256), it skips.
 */
import * as tus from "tus-js-client";

export const fileUrl = (hash: string) => `/files/${hash}`;

export async function uploadToPool(
  blob: Blob,
  hash: string,
  getToken: () => Promise<string>,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const url = fileUrl(hash);
  const head = await fetch(url, { method: "HEAD" }).catch(() => null);
  if (head?.ok) {
    onProgress?.(1);
    return url;
  }
  const token = await getToken();
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(blob, {
      endpoint: "/uploads",
      chunkSize: 8 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000, 10000, 20000, 30000],
      metadata: { hash, filename: `${hash}.wav`, filetype: blob.type || "audio/wav" },
      headers: { Authorization: `Bearer ${token}` },
      // Same file -> same fingerprint, so a refresh resumes instead of restarting.
      fingerprint: async () => `oasis-${hash}`,
      removeFingerprintOnSuccess: true,
      onProgress: (sent, total) => onProgress?.(total ? sent / total : 0),
      onError: reject,
      onSuccess: () => resolve(),
    });
    upload.findPreviousUploads().then((previous) => {
      if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }, reject);
  });
  return url;
}
