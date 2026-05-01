import type { BusinessConfig } from './configStore.js';

export type AiHealthSummaryStatus = 'ready' | 'disabled' | 'needs_configuration';

export interface AiHealthReport {
  catalogLoaded: boolean;
  operatingHoursConfigured: boolean;
  deliveryConfigConfigured: boolean;
  managerPhonePresent: boolean;
  pixPresent: boolean;
  aiEnabled: boolean;
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
  const aiEnabled = config.aiEnabled === true;
  const blockedDatesCount = config.blockedDates.length;

  const ready = catalogLoaded
    && operatingHoursConfigured
    && deliveryConfigConfigured
    && managerPhonePresent
    && pixPresent
    && aiEnabled;

  return {
    catalogLoaded,
    operatingHoursConfigured,
    deliveryConfigConfigured,
    managerPhonePresent,
    pixPresent,
    aiEnabled,
    blockedDatesCount,
    safeSummaryStatus: ready ? 'ready' : aiEnabled ? 'needs_configuration' : 'disabled',
  };
}
