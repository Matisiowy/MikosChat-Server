interface AttachmentRecord {
  id: string;
  messageId: string;
  originalName: string;
  storageKey: string;
  mimeType: string;
  size: bigint;
  width: number | null;
  height: number | null;
  duration: number | null;
  createdAt: Date;
}

export function serializeAttachment(
  attachment: AttachmentRecord,
) {
  return {
    id: attachment.id,
    messageId: attachment.messageId,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    size: Number(attachment.size),
    width: attachment.width,
    height: attachment.height,
    duration: attachment.duration,
    createdAt: attachment.createdAt,
    downloadUrl:
      `/api/v1/attachments/${attachment.id}/download`,
  };
}

export function serializeMessage<
  T extends {
    attachments: AttachmentRecord[];
    deletedAt?: Date | null;
  },
>(message: T) {
  const { attachments, ...rest } = message;

  return {
    ...rest,
    attachments: message.deletedAt
      ? []
      : attachments.map(serializeAttachment),
  };
}
