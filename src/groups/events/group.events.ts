export const GROUP_EVENTS = {
  UPDATED: 'group.updated',
  MEMBERS_ADDED: 'group.members.added',
  MEMBER_REMOVED: 'group.member.removed',
  ROLE_UPDATED: 'group.role.updated',
  OWNER_TRANSFERRED: 'group.owner.transferred',
} as const;

export interface GroupEvent {
  conversationId: string;
  actorId: string;
  affectedUserIds: string[];
}
