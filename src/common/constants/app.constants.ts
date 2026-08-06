/**
 * App-wide constants
 */
export const APP_CONSTANTS = {
  API_PREFIX: 'api',
  DEFAULT_PORT: 3000,
  DEFAULT_TIMEOUT_MS: 120000,
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
} as const;

export const GRADIO_CONSTANTS = {
  DEFAULT_BASE_URL: 'https://kwai-kolors-kolors-virtual-try-on.hf.space',
  DEFAULT_SPACE: 'Kwai-Kolors/Kolors-Virtual-Try-On',
  RETRY_COUNT: 6,
  RETRY_DELAY_MS: 10000,
} as const;

export const GEMINI_CONSTANTS = {
  MODEL: 'gemini-1.5-flash',
  MAX_TOKENS: 1024,
} as const;
