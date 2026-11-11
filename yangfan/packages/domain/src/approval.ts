import { fail, ok, type Result } from '../../contracts/src/result.ts';
import type { ApproveGenerationInput, PreparedGeneration } from '../../contracts/src/generation.ts';
import type { RunConfigSnapshot } from '../../contracts/src/models.ts';
export function estimateMicros(config: RunConfigSnapshot, units?: number): Result<number | null> {
  if (config.pricing.status === 'unknown') return ok(null);
  if ('perThousandCharacters' in config.pricing || 'perAudioSecond' in config.pricing) {
    if (typeof units !== 'number' || !Number.isFinite(units) || units <= 0 || units > 24000000) return fail('INVALID_AUDIO_UNITS', '音频计费单位无效。');
    const rate = priceMicros('perThousandCharacters' in config.pricing ? config.pricing.perThousandCharacters : config.pricing.perAudioSecond);
    if (!rate.ok) return rate;
    const estimate = Math.ceil(rate.value * units / ('perThousandCharacters' in config.pricing ? 1000 : 1));
    return Number.isSafeInteger(estimate) && estimate <= 1000000000000 ? ok(estimate) : fail('PRICE_PRECISION', '估算金额超出支持范围。');
  }
  const seconds = 'perSecond' in config.pricing ? config.parameters.duration : 1;
  if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 15) return fail('INVALID_PARAMETERS', '视频时长无效。');
  const rate = priceMicros('perSecond' in config.pricing ? config.pricing.perSecond : config.pricing.perImage);
  if (!rate.ok) return rate;
  if (rate.value > Math.floor(1000000000000 / seconds)) return fail('PRICE_PRECISION', '估算金额超出支持范围。');
  return ok(rate.value * seconds);
}
/** Parse decimal currency into exactly six fixed fractional digits without floating point multiplication. */
export function priceMicros(price: number): Result<number> {
  const text = price.toString(); if (!/^\d+(\.\d{1,6})?$/.test(text)) return fail('PRICE_PRECISION', '计价最多支持六位小数，请更新报价。');
  const [whole, fraction = ''] = text.split('.'); const amount = Number(whole) * 1000000 + Number(fraction.padEnd(6, '0'));
  return Number.isSafeInteger(amount) ? ok(amount) : fail('PRICE_PRECISION', '报价金额超出支持范围。');
}
export function verifyApproval(prepared: PreparedGeneration, input: ApproveGenerationInput, now: number): Result<void> {
  if (prepared.planHash !== input.approvedPlanHash || prepared.executionOwner !== input.executionOwner || prepared.runId !== input.runId) return fail('APPROVAL_MISMATCH', '审批与本次固定计划或执行身份不符。');
  if (prepared.expiresAt <= now) return fail('APPROVAL_EXPIRED', '审批已到期，请重新准备并批准。');
  if (prepared.estimateMicros === null && !input.acknowledgeUnknown) return fail('UNKNOWN_PRICE_CONFIRMATION', '价格未知，需要明确确认有限风险额度。');
  if (prepared.currency !== null && prepared.currency !== input.currency || prepared.estimateMicros !== null && prepared.estimateMicros > input.allowanceMicros) return fail('ALLOWANCE_EXCEEDED', '币种或风险额度不足。');
  return ok(undefined);
}
