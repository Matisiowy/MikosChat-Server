export const ATTACHMENT_LIMITS = {
  maxFileSize: 50 * 1024 * 1024,
  maxTotalSize: 100 * 1024 * 1024,
  maxFiles: 5,
  maxImagePixels: 25_000_000,
  minFreeSpace: 2 * 1024 * 1024 * 1024,
} as const;

export const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',

  // Video
  'video/mp4',
  'video/webm',

  // Audio
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/webm',

  // Documents
  'application/pdf',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

  // Archives
  'application/zip',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
]);

export interface PreparedAttachment {
  originalName: string;
  storageKey: string;
  mimeType: string;
  size: bigint;
  width?: number;
  height?: number;
  duration?: number;
}
