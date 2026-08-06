import { UserTier } from '@prisma/client';

export type AiActionName = 'TRY_ON' | 'STYLIST' | 'CHATBOT';

export const AI_ACTION_LIMITS: Record<AiActionName, Record<UserTier, number>> = {
  TRY_ON: {
    FREE: 3,
    MEMBER: 10,
    VIP: Infinity,
  },
  STYLIST: {
    FREE: 5,
    MEMBER: 20,
    VIP: Infinity,
  },
  CHATBOT: {
    FREE: 50,
    MEMBER: 200,
    VIP: Infinity,
  },
};

export const AI_ACTION_LABELS: Record<AiActionName, string> = {
  TRY_ON: 'Thử Đồ',
  STYLIST: 'Tư Vấn AI',
  CHATBOT: 'Chatbot',
};

export const AI_ACTION_NAMES: AiActionName[] = ['TRY_ON', 'STYLIST', 'CHATBOT'];

export function isAiActionName(value: string | undefined): value is AiActionName {
  return value !== undefined && AI_ACTION_NAMES.includes(value as AiActionName);
}
