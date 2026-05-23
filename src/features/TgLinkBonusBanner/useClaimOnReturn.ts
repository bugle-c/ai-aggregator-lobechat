'use client';

import { message } from 'antd';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { lambdaQuery } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

const BOT_USERNAME = 'gptwebrubot';
const BOT_DEEPLINK = `https://t.me/${BOT_USERNAME}?start=welcome`;

/**
 * Post-OAuth handler for `?tg_linked=1`.
 *
 * Flow:
 *   1. claim the bonus server-side (idempotent)
 *   2. show a brief toast on the source page
 *   3. redirect the user to the bot's /start welcome deep-link
 *
 * Why redirect to the bot instead of staying on the site:
 * Telegram OIDC authenticates via oauth.telegram.org — the user never
 * touches our bot during OAuth. So bot.sendMessage(chat_id) returns
 * 403 until the user manually opens the bot chat and presses Start.
 * Auto-redirecting closes that loop: the user lands in the bot, sees
 * @gptwebrubot in their chat list, and from then on all DMs work
 * (recovery emails, balance warnings, file_attached notices, etc.).
 *
 * Gated on `isLogin` so the mutation never fires for anonymous
 * visitors (would 401-loop). The `ran` ref guards against double-fire
 * under React strict mode.
 */
export function useClaimOnReturn() {
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
      onError: (err) => {
        console.warn('[tg-link-bonus] claim mutation failed', err);
        // Even on failure, redirect — the OAuth itself may have succeeded.
        if (typeof window !== 'undefined') window.location.href = BOT_DEEPLINK;
      },
      onSuccess: async (data) => {
        if (data.granted > 0) {
          message.success(`🎁 +${data.granted} кредитов на 30 дней!`, 2);
          await utils.subscription.getBillingState.invalidate();
        }
        // Small delay so the toast becomes visible before navigation kicks
        // in (mobile Safari shows the new page near-instant after redirect).
        setTimeout(() => {
          if (typeof window !== 'undefined') window.location.href = BOT_DEEPLINK;
        }, 700);
      },
    });
  }, [isLogin]); // re-evaluate when auth state resolves; ref still guards single-fire
}
