/**
 * Shape of the `object` field in YooKassa webhook payloads + fetched
 * payments. We only declare the fields we actually read — YK includes
 * many more (amount, captured_at, refundable, ...) that don't matter
 * for telemetry.
 */
export interface YookassaPaymentObject {
  cancellation_details?: {
    party?: string;
    reason?: string;
  };
  id: string;
  payment_method?: {
    type?: string;
    id?: string;
    saved?: boolean;
    card?: {
      first6?: string;
      last4?: string;
      card_type?: string;
      issuer_country?: string;
      issuer_name?: string;
    };
    sbp?: {
      bank_id?: string;
    };
  };
  status: string;
}

export interface CancellationPatch {
  filled_at: string;
  party?: string;
  reason?: string;
}

export interface PaymentMethodPatch {
  card_first6: string | null;
  card_issuer_country: string | null;
  card_issuer_name: string | null;
  card_last4: string | null;
  sbp_bank_id: string | null;
  type: string | null;
}

export interface MetadataPatch {
  cancellation?: CancellationPatch;
  payment_method?: PaymentMethodPatch;
}

/**
 * Pure function: turn a YK payment object into a partial metadata
 * patch that can be merged into billing_payments.metadata via
 * `metadata = metadata || $patch::jsonb`. Returns an empty object
 * if YK sent nothing useful.
 */
export function extractMetadataPatch(obj: YookassaPaymentObject): MetadataPatch {
  const patch: MetadataPatch = {};

  if (obj.cancellation_details) {
    patch.cancellation = {
      party: obj.cancellation_details.party,
      reason: obj.cancellation_details.reason,
      filled_at: new Date().toISOString(),
    };
  }

  if (obj.payment_method) {
    patch.payment_method = {
      type: obj.payment_method.type ?? null,
      card_first6: obj.payment_method.card?.first6 ?? null,
      card_last4: obj.payment_method.card?.last4 ?? null,
      card_issuer_country: obj.payment_method.card?.issuer_country ?? null,
      card_issuer_name: obj.payment_method.card?.issuer_name ?? null,
      sbp_bank_id: obj.payment_method.sbp?.bank_id ?? null,
    };
  }

  return patch;
}
