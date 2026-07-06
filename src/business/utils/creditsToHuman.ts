/**
 * Rough human-work equivalents for credit amounts, used on checkout/balance
 * surfaces so users reason in «посты и картинки», not abstract credits.
 * 1 credit ≈ 1 gpt-5-mini answer; an image ≈ 7 credits. Keep the constants in
 * sync with the live Supabase `model_rates` (nano-banana-2 rate).
 */
export const CHAT_CREDITS = 1;
export const IMAGE_CREDITS = 7;

export const creditsToHuman = (credits: number) => ({
  answers: Math.floor(credits / CHAT_CREDITS),
  images: Math.floor(credits / IMAGE_CREDITS),
});
