export const CAMPAIGN_STEPS = ['audience', 'message', 'test', 'review', 'delivery'] as const;
export type CampaignStep = (typeof CAMPAIGN_STEPS)[number];

export interface CampaignWizardProgress {
  hasAudience: boolean;
  hasMessage: boolean;
  testSent: boolean;
  previewReady: boolean;
}

export function canAdvanceCampaignStep(step: CampaignStep, progress: CampaignWizardProgress): boolean {
  if (step === 'audience') return progress.hasAudience;
  if (step === 'message') return progress.hasMessage;
  if (step === 'test') return progress.testSent;
  if (step === 'review') return progress.previewReady;
  return canScheduleCampaign(progress);
}

export function canScheduleCampaign(progress: CampaignWizardProgress): boolean {
  return progress.hasAudience && progress.hasMessage && progress.testSent && progress.previewReady;
}
