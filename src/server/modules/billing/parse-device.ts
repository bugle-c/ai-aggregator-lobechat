// Coarse device classification from a User-Agent string, for the
// "what devices do customers pay from" admin metric. Stored on
// billing_payments.metadata.device at payment-creation time.
//
// Heuristic (order matters): tablet first (iPad / Android-without-"mobile"),
// then mobile, else desktop. Good enough for a desktop/mobile/tablet split;
// not a full UA parser (no extra dependency).
export type PaymentDevice = 'mobile' | 'tablet' | 'desktop' | 'unknown';

export function parseDevice(userAgent?: string | null): PaymentDevice {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  // Tablets: iPad, generic "tablet", Kindle Silk/PlayBook, Android tablets
  // (Android UAs that do NOT contain "mobile").
  if (/ipad|tablet|playbook|silk|kindle|android(?!.*mobile)/.test(ua)) return 'tablet';
  // Phones / small touch devices.
  if (
    /mobi|iphone|ipod|android.*mobile|windows phone|blackberry|opera mini|iemobile|webos/.test(ua)
  )
    return 'mobile';
  return 'desktop';
}
