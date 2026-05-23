// src/server/modules/billing/email-templates/recovery-copy.ts
/**
 * RU copy for payment-recovery emails. Keyed by YK cancellation
 * reason × stage. Stage 1 is the immediate (5-min) nudge, Stage 2
 * is the 24-h follow-up. Tone: light humour, one funny line, never
 * at the user's expense.
 *
 * Reason codes come from `cancellation-reasons.ts` (SoT). When
 * adding a new reason there, add a CopyBlock here too — the
 * template falls back to `_default` if missing, but generic copy
 * converts worse.
 *
 * Subject lines: ≤60 chars, may include one emoji.
 */

export interface CopyBlock {
  /** Button text. {{amount}} placeholder is replaced with the RUB amount. */
  ctaLabel: string;
  /** 1 sentence with personality. Rendered as <p>. */
  humorLine: string;
  /** 1–2 sentences naming what happened. Rendered as <p>. */
  reasonHook: string;
  /** Email subject — ≤60 chars, optional single emoji. */
  subject: string;
}

export interface ReasonCopy {
  stage1: CopyBlock;
  stage2: CopyBlock;
}

const CTA_DEFAULT = 'Попробовать ещё раз — {{amount}} ₽';

/** Per-reason copy. Add new keys as new YK reasons appear. */
export const COPY: Record<string, ReasonCopy> = {
  'insufficient_funds': {
    stage1: {
      subject: 'Карта стесняется — не хватило денег',
      reasonHook: 'На карте не хватило средств — оплата не прошла.',
      humorLine: 'Бывает: иногда кошелёк просто хочет драматичную паузу.',
      ctaLabel: CTA_DEFAULT,
    },
    stage2: {
      subject: 'Карта пришла в себя? 😅',
      reasonHook: 'Прошли сутки. Карта уже отошла от шока?',
      humorLine: 'Мы припрятали ваш заказ — на этот раз должно получиться.',
      ctaLabel: CTA_DEFAULT,
    },
  },
  'expired_on_confirmation': {
    stage1: {
      subject: 'Не дожали оплату — что-то отвлекло?',
      reasonHook: 'Открыли форму YooKassa и закрыли, не успев подтвердить.',
      humorLine: 'Кофе остыл? Котик потребовал внимания? Понимаем.',
      ctaLabel: CTA_DEFAULT,
    },
    stage2: {
      subject: 'Прошли сутки, а вы всё ещё без подписки 🙃',
      reasonHook: 'Вчера так и не успели завершить оплату.',
      humorLine: 'Если ещё хотите — мы тут, всё ещё ждём и не нервничаем.',
      ctaLabel: CTA_DEFAULT,
    },
  },
  'expired_on_capture': {
    stage1: {
      subject: 'Сорвался захват средств',
      reasonHook: 'Платёж застрял на этапе захвата — банк не дождался ответа.',
      humorLine: 'Чисто техническая загвоздка, повторим — должно сработать.',
      ctaLabel: CTA_DEFAULT,
    },
    stage2: {
      subject: 'Вчера сорвалось — попробуем сегодня?',
      reasonHook: 'Прошлая попытка зависла на стороне банка.',
      humorLine: 'У нас всё готово, ждём только вас.',
      ctaLabel: CTA_DEFAULT,
    },
  },
  '3d_secure_failed': {
    stage1: {
      subject: 'Банк не пропустил 3-D Secure',
      reasonHook: 'Банк отклонил подтверждение 3-D Secure.',
      humorLine: 'Не паникуем — иногда проще через СБП, без капчей.',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
    stage2: {
      subject: '3-D Secure всё ещё бунтует?',
      reasonHook: 'Вчера 3-D Secure не пропустил — может, попробуем СБП?',
      humorLine: 'QR в банковском приложении обычно срабатывает с первого раза.',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
  },
  'card_expired': {
    stage1: {
      subject: 'Срок действия карты истёк',
      reasonHook: 'У карты, которой вы пытались оплатить, истёк срок.',
      humorLine: 'Заведите ту, что свежее — или попробуйте через СБП.',
      ctaLabel: 'Попробовать другой картой — {{amount}} ₽',
    },
    stage2: {
      subject: 'Карта всё ещё просрочена 🗓️',
      reasonHook: 'Вчера карта была просрочена.',
      humorLine: 'Если есть актуальная — мы тут, ждём.',
      ctaLabel: CTA_DEFAULT,
    },
  },
  'general_decline': {
    stage1: {
      subject: 'Банк отклонил без объяснений',
      reasonHook: 'Банк отказал в оплате без подробностей.',
      humorLine: 'Обычно помогает оплата через СБП — там другая цепочка проверок.',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
    stage2: {
      subject: 'Банк продолжает молчать о причине',
      reasonHook: 'Прошлая попытка отвалилась без объяснений.',
      humorLine: 'СБП обычно срабатывает в таких случаях — попробуем?',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
  },
  'payment_method_restricted': {
    stage1: {
      subject: 'Банк не разрешает онлайн-оплаты',
      reasonHook: 'Банк блокирует онлайн-оплату по этой карте.',
      humorLine: 'Решается через СБП — там оплата идёт прямо из приложения банка.',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
    stage2: {
      subject: 'Карта всё ещё закрыта для онлайна',
      reasonHook: 'Банк по-прежнему блокирует онлайн-оплаты по этой карте.',
      humorLine: 'СБП — самый прямой обход. Один QR, два касания.',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
  },
  'country_forbidden': {
    stage1: {
      subject: 'Карта из неподдерживаемой страны',
      reasonHook: 'YooKassa не принимает карты из вашей страны.',
      humorLine: 'СБП работает с любого российского банка — попробуем оттуда?',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
    stage2: {
      subject: 'Карта всё ещё не та',
      reasonHook: 'Карта по-прежнему из страны, которую YK не принимает.',
      humorLine: 'СБП от российского банка решит вопрос за минуту.',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
  },
  'permission_revoked': {
    stage1: {
      subject: 'Отозваны права на оплату',
      reasonHook: 'Банк отозвал разрешение на оплату.',
      humorLine: 'Стоит проверить настройки в приложении банка — либо сразу через СБП.',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
    stage2: {
      subject: 'Права на оплату всё ещё отозваны',
      reasonHook: 'Доступ к карте всё ещё закрыт.',
      humorLine: 'СБП обычно работает даже когда карта временно заблокирована.',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
  },
  'canceled_by_merchant': {
    stage1: {
      subject: 'Платёж отменён системой',
      reasonHook: 'Платёж был отменён на стороне платёжной системы.',
      humorLine: 'Обычно это случайный сбой — повтор почти всегда проходит.',
      ctaLabel: CTA_DEFAULT,
    },
    stage2: {
      subject: 'Вчера сорвался платёж',
      reasonHook: 'Прошлый платёж сорвался на стороне системы.',
      humorLine: 'Сегодня попробуем ещё раз — обычно срабатывает.',
      ctaLabel: CTA_DEFAULT,
    },
  },
  'internal_timeout': {
    stage1: {
      subject: 'Технический сбой YooKassa',
      reasonHook: 'YooKassa не успела обработать платёж — внутренний таймаут.',
      humorLine: 'Не ваша вина. Повторим — должно сработать.',
      ctaLabel: CTA_DEFAULT,
    },
    stage2: {
      subject: 'YooKassa тогда подвела — попробуем сейчас',
      reasonHook: 'Вчера YK не справилась с обработкой.',
      humorLine: 'Сегодня у неё гораздо лучше дела. Проверим?',
      ctaLabel: CTA_DEFAULT,
    },
  },
  'fraud_suspected': {
    stage1: {
      subject: 'Платёж попал под антифрод',
      reasonHook: 'Система безопасности банка приняла платёж за подозрительный.',
      humorLine: 'Иногда это лечится одним повтором, иногда — через СБП. Попробуем?',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
    stage2: {
      subject: 'Антифрод всё ещё подозрителен',
      reasonHook: 'Прошлая попытка снова попала под защиту.',
      humorLine: 'СБП обходит большинство антифрод-фильтров. Один QR — и готово.',
      ctaLabel: 'Попробовать через СБП — {{amount}} ₽',
    },
  },
  '_default': {
    stage1: {
      subject: 'Оплата не прошла — попробуем ещё раз?',
      reasonHook: 'Оплата сорвалась — точную причину банк не назвал.',
      humorLine: 'Точно не из-за вас. Попробуем ещё раз?',
      ctaLabel: CTA_DEFAULT,
    },
    stage2: {
      subject: 'Это наше последнее письмо по этой оплате',
      reasonHook: 'Прошли сутки с попытки оплаты, статус так и не изменился.',
      humorLine: 'Не хотим спамить — если ещё актуально, ссылка ниже.',
      ctaLabel: CTA_DEFAULT,
    },
  },
};

/** Resolve copy for (reason, stage). Falls back to `_default`. */
export function resolveCopy(
  reasonCode: string | null | undefined,
  stage: 'stage1' | 'stage2',
): CopyBlock {
  const key = reasonCode && COPY[reasonCode] ? reasonCode : '_default';
  return COPY[key][stage];
}
