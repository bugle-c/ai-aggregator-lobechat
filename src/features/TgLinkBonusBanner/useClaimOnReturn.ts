'use client';

import { message, Modal } from 'antd';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

const BOT_USERNAME = 'gptwebrubot';
const BOT_DEEPLINK = `https://t.me/${BOT_USERNAME}?start=welcome`;

function showBotOpenModal(grantedAmount: number) {
  Modal.success({
    title: grantedAmount > 0 ? `🎁 +${grantedAmount} кредитов на 30 дней!` : 'Telegram привязан',
    content:
      'Чтобы бот мог отправлять уведомления о платежах, новых функциях и расходе кредитов — открой чат и нажми «Старт».',
    cancelText: 'Позже',
    closable: true,
    okText: 'Открыть бота в Telegram',
    onOk: () => {
      if (typeof window !== 'undefined') {
        window.open(BOT_DEEPLINK, '_blank', 'noopener,noreferrer');
      }
    },
    okCancel: true,
    width: 480,
  });
}

/**
 * If the user lands on the app with ?tg_linked=1 in the URL, call the
 * idempotent claim mutation, show a modal with a deep-link to open the
 * bot (Telegram OIDC doesn't go through the bot chat, so the user must
 * /start the bot manually before we can DM them), then scrub the param.
 *
 * Idempotent on the server side — the mutation no-ops if already
 * claimed. We additionally use a ref to ensure the effect runs at
 * most once per mount (React strict-mode double-invoke safety).
 *
 * Gated on `isLogin` so we never fire the mutation for anonymous
 * visitors (would 401-loop). Effectively no-op until the auth state
 * resolves to logged-in.
 */
export function useClaimOnReturn() {
  const router = useRouter();
  const params = useSearchParams();
  const isLogin = useUserStore(authSelectors.isLogin);
  const ran = useRef(false);
  const claim = lambdaQuery.subscription.claimTgLinkBonus.useMutation();
  const utils = lambdaQuery.useUtils();

  useEffect(() => {
    if (ran.current) return;
    if (!isLogin) return;
    if (params.get('tg_linked') !== '1') return;
    ran.current = true;

    claim.mutate(undefined, {
      onError: () => {
        // Quiet failure on the bonus side — but still show the bot-open
        // modal so the user knows to /start the bot. Otherwise the link
        // is useless (no DMs possible without prior bot interaction).
        showBotOpenModal(0);
        console.warn('[tg-link-bonus] claim mutation failed');
      },
      onSuccess: async (data) => {
        if (data.granted > 0) {
          message.success(`🎁 +${data.granted} кредитов на 30 дней!`, 3);
          await utils.subscription.getBillingState.invalidate();
        }
        // Always show the modal — even if bonus was already claimed, the
        // user just went through OAuth and bot.sendMessage() will 403
        // until they /start the bot.
        showBotOpenModal(data.granted);

        const url = new URL(window.location.href);
        url.searchParams.delete('tg_linked');
        router.replace(url.pathname + url.search);
      },
    });
  }, [isLogin]); // re-evaluate when auth state resolves; ref still guards single-fire
}
