type EmailConfigLike = Partial<{
  EMAIL_SERVICE_PROVIDER: string;
  EMAIL_WELCOME_ENABLED: boolean;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  SMTP_FROM: string;
  SMTP_HOST: string;
  SMTP_PASS: string;
  SMTP_PORT: number;
  SMTP_USER: string;
}>;

const DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com',
  'bot.gptweb.ru',
  'guerrillamail.com',
  'mailinator.com',
  'tempmail.com',
  'temp-mail.org',
  'yopmail.com',
]);

export interface SignupEmailAssessment {
  domain: string;
  reasons: string[];
  suspicious: boolean;
}

export const assessSignupEmail = (email: string): SignupEmailAssessment => {
  const normalized = email.trim().toLowerCase();
  const [local = '', domain = ''] = normalized.split('@');
  const reasons: string[] = [];

  if (!domain || !local) reasons.push('invalid_shape');
  if (DISPOSABLE_DOMAINS.has(domain)) reasons.push('disposable_domain');
  if (/^(?:gmaij|gmai|gmial|mal|mali)\.|^gmail\.cjm$/.test(domain)) reasons.push('typo_domain');
  if (local.includes('+')) reasons.push('plus_alias');
  if (/^(?:test|demo|bot|spam|fake|user)\d{3,}/.test(local)) reasons.push('patterned_local_part');
  if (/\d{8,}/.test(local)) reasons.push('long_digit_sequence');

  return {
    domain,
    reasons,
    suspicious: reasons.length > 0,
  };
};

export const isEmailDeliveryConfigured = (config: EmailConfigLike): boolean => {
  if (config.EMAIL_SERVICE_PROVIDER === 'resend') {
    return Boolean(config.RESEND_API_KEY && config.RESEND_FROM);
  }

  if (config.EMAIL_SERVICE_PROVIDER === 'nodemailer') {
    return Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASS);
  }

  return false;
};

export const shouldSendWelcomeEmail = (config: EmailConfigLike): boolean => {
  return config.EMAIL_WELCOME_ENABLED !== false && isEmailDeliveryConfigured(config);
};
