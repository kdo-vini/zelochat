import assert from 'node:assert/strict';
import { CAMPAIGN_STEPS, canAdvanceCampaignStep, canScheduleCampaign } from '../src/domain/campaignWizard.ts';

assert.deepEqual(CAMPAIGN_STEPS, ['audience', 'message', 'test', 'review', 'delivery']);
assert.equal(canAdvanceCampaignStep('audience', { hasAudience: false, hasMessage: false, testSent: false, previewReady: false }), false);
assert.equal(canAdvanceCampaignStep('audience', { hasAudience: true, hasMessage: false, testSent: false, previewReady: false }), true);
assert.equal(canAdvanceCampaignStep('message', { hasAudience: true, hasMessage: false, testSent: false, previewReady: false }), false);
assert.equal(canAdvanceCampaignStep('test', { hasAudience: true, hasMessage: true, testSent: false, previewReady: false }), false);
assert.equal(canAdvanceCampaignStep('test', { hasAudience: true, hasMessage: true, testSent: true, previewReady: false }), true);
assert.equal(canScheduleCampaign({ hasAudience: true, hasMessage: true, testSent: true, previewReady: false }), false);
assert.equal(canScheduleCampaign({ hasAudience: true, hasMessage: true, testSent: true, previewReady: true }), true);

console.log('campaignUiGuardrails: ok');
