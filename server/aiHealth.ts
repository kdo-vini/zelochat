import type { BusinessConfig } from './configStore.js';
import { evaluateAiSchedule, type AiGlobalMode } from '../src/domain/aiSchedule.js';
import { isPixReceiptConfigActive } from '../src/domain/pixReceipt.js';

export type AiHealthSummaryStatus = 'ready' | 'disabled' | 'scheduled_off' | 'needs_configuration';

export interface AiHealthReport {
  catalogLoaded: boolean;
  operatingHoursConfigured: boolean;
  deliveryConfigConfigured: boolean;
  managerPhonePresent: boolean;
  pixPresent: boolean;
  pixReceiptConfigured: boolean;
  pixReceiptEnabled: boolean;
  aiEnabled: boolean;
  aiMode: AiGlobalMode;
  aiEffectiveEnabledNow: boolean;
  blockedDatesCount: number;
  safeSummaryStatus: AiHealthSummaryStatus;
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasAvailableCatalogProduct(config: BusinessConfig): boolean {
  return config.products.some((product) => product.available);
}

function isDeliveryConfigConfigured(config: BusinessConfig): boolean {
  const delivery = config.deliveryConfig;
  if (!delivery) return false;
  if (!delivery.enabled) return true;
  return delivery.neighborhoods.length > 0;
}

export function buildAiHealthReport(config: BusinessConfig): AiHealthReport {
  const catalogLoaded = hasAvailableCatalogProduct(config);
  const operatingHoursConfigured = hasText(config.openTime) && hasText(config.closeTime);
  const deliveryConfigConfigured = isDeliveryConfigConfigured(config);
  const managerPhonePresent = hasText(config.managerPhone);
  const pixPresent = hasText(config.pixKey);
  const pixReceiptEnabled = config.pixReceiptConfig.available === true && config.pixReceiptConfig.enabled === true;
  const pixReceiptConfigured = !pixReceiptEnabled || isPixReceiptConfigActive(config.pixReceiptConfig);
  const aiSchedule = evaluateAiSchedule(config);
  const aiEnabled = config.aiEnabled === true;
  const aiMode = aiSchedule.mode;
  const aiEffectiveEnabledNow = aiSchedule.effectiveEnabledNow;
  const blockedDatesCount = config.blockedDates.length;

  const ready = catalogLoaded
    && operatingHoursConfigured
    && deliveryConfigConfigured
    && managerPhonePresent
    && pixPresent
    && pixReceiptConfigured
    && aiEffectiveEnabledNow;

  let safeSummaryStatus: AiHealthSummaryStatus;
  if (aiMode === 'always_off') {
    safeSummaryStatus = 'disabled';
  } else if (aiMode === 'scheduled' && !aiSchedule.hasValidSchedule) {
    safeSummaryStatus = 'needs_configuration';
  } else if (aiMode === 'scheduled' && !aiEffectiveEnabledNow) {
    safeSummaryStatus = 'scheduled_off';
  } else {
    safeSummaryStatus = ready ? 'ready' : 'needs_configuration';
  }

  return {
    catalogLoaded,
    operatingHoursConfigured,
    deliveryConfigConfigured,
    managerPhonePresent,
    pixPresent,
    pixReceiptConfigured,
    pixReceiptEnabled,
    aiEnabled,
    aiMode,
    aiEffectiveEnabledNow,
    blockedDatesCount,
    safeSummaryStatus,
  };
}
