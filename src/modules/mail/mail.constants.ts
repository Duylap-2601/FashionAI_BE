export const MAIL_QUEUE = 'mail';

export const MAIL_JOB = {
  VERIFICATION: 'verification',
  PASSWORD_RESET: 'password-reset',
  ORDER_CONFIRMATION: 'order-confirmation',
  ORDER_STATUS_UPDATE: 'order-status-update',
  RENEWAL_REMINDER: 'renewal-reminder',
} as const;
