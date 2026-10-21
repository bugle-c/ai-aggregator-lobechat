import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chargeBeforeGenerate } from '../chargeBeforeGenerate';
const { reserve, rate, gate, tier, calculate } = vi.hoisted(() => ({ reserve: vi.fn(), rate: vi.fn(), gate: vi.fn(), tier: vi.fn(), calculate: vi.fn() }));
vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: async () => ({}) }));
vi.mock('@/server/services/billing', () => ({ BillingService: vi.fn().mockImplementation(() => ({ reserveCredits: reserve, getUserPlanSlug: async () => 'pro' })) }));
vi.mock('@/server/services/billing/rates-source', () => ({ fetchRate: rate }));
vi.mock('@/server/modules/billing/checkUsageLimit', () => ({ checkUsageLimit: gate }));
vi.mock('@/server/modules/billing/model-tiers', () => ({ isModelAllowedForPlanAsync: tier }));
vi.mock('@/server/modules/billing/model-rates', () => ({ calculateCreditsAsync: calculate }));
const params = { generationTopicId: 'topic', model: 'model', provider: 'wavespeed', userId: 'user', params: { prompt: 'x', duration: 8 } };
beforeEach(() => {
 vi.clearAllMocks();
 reserve.mockResolvedValue({ id: 'hold' });
 rate.mockResolvedValue({ modelId: 'model', pricingUnit: 'second', isActive: true });
 gate.mockResolvedValue({ allowed: true }); tier.mockResolvedValue(true); calculate.mockResolvedValue(40);
});
describe('video source-aware reservation', () => {
 it('returns the service reservation identity', async () => {
 const result = await chargeBeforeGenerate(params);
 expect(result.prechargeResult).toEqual({ amount: 40, holdId: 'hold' });
 expect(reserve).toHaveBeenCalledWith(40, 'video-gen');
 });
 it('rejects before reserving when tier gate fails', async () => {
 tier.mockResolvedValue(false);
 await expect(chargeBeforeGenerate(params)).rejects.toThrow(/не доступна/);
 expect(reserve).not.toHaveBeenCalled();
 });
 it('rejects before reserving when quota gate fails', async () => {
 gate.mockResolvedValue({ allowed: false, message: 'cap reached' });
 await expect(chargeBeforeGenerate(params)).rejects.toThrow('cap reached');
 expect(reserve).not.toHaveBeenCalled();
 });
 it('propagates exhausted combined funding as an actionable error', async () => {
 reserve.mockRejectedValue(new Error('Insufficient credits'));
 await expect(chargeBeforeGenerate(params)).rejects.toThrow(/Кредиты закончились/);
 });
});
