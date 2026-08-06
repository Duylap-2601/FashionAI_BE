export const TOKEN_TYPES = {
  access: 'access',
  refresh: 'refresh',
} as const;

export type TokenType = (typeof TOKEN_TYPES)[keyof typeof TOKEN_TYPES];
