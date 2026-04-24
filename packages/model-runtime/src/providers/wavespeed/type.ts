/**
 * WaveSpeed AI API response shapes
 * @see https://wavespeed.ai/docs
 */

/** Create prediction response (POST /api/v3/{model}) */
export interface WaveSpeedCreateResponse {
  code: number;
  data: {
    created_at: string;
    id: string;
    model: string;
    status: 'created' | 'processing' | 'completed' | 'failed';
    urls: {
      get: string;
    };
  };
  message: string;
}

/** Webhook payload body — same shape as GET result */
export interface WaveSpeedWebhookBody {
  completed_at?: string;
  created_at?: string;
  error?: string | null;
  id?: string;
  input?: Record<string, unknown>;
  model?: string;
  outputs?: string[];
  status?: 'created' | 'processing' | 'completed' | 'failed';
  timings?: { inference?: number };
}

/** Balance response */
export interface WaveSpeedBalanceResponse {
  code: number;
  data: { balance: number };
  message: string;
}
