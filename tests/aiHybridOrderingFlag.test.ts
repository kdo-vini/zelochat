// PR 1.1/1.3 — a per-empresa flag must gate the canonical hybrid WhatsApp
// ordering router so merging this branch is a no-op for every existing
// tenant until an operator/Eng explicitly turns it on. No Supabase mocking
// exists in this codebase's test suite (see Task A/B/C's equivalent notes on
// `shouldRearmAfterAudioTranscription`/the auto-select depth guard) — the
// in-memory config path is exercised directly; the wiring into
// server/ai.ts, server/router.ts and server/aiSimulator.ts (which all
// require a real Supabase-backed session/config) is verified by source-order
// guardrails, matching this suite's established style
// (tests/routerWebhookGuardrails.test.ts).
import { readFileSync } from 'node:fs';
import { getConfig, setConfig, isAiHybridOrderingEnabled } from '../server/configStore.js';
import { assert, assertIncludes, runSuite } from './testHarness.js';

await runSuite('AI hybrid ordering flag', [
  {
    name: 'defaults to disabled for an empresa never hydrated/set',
    run: () => {
      const empresaId = `hybrid-flag-default-${Date.now()}`;
      assert(isAiHybridOrderingEnabled(empresaId) === false, 'unset empresa is disabled by default (fail closed)');
      assert(getConfig(empresaId).aiHybridOrderingEnabled !== true, 'in-memory config never defaults to true');
    },
  },
  {
    name: 'turns on only after an explicit true is set',
    run: () => {
      const empresaId = `hybrid-flag-on-${Date.now()}`;
      assert(isAiHybridOrderingEnabled(empresaId) === false, 'starts disabled');
      setConfig(empresaId, { aiHybridOrderingEnabled: true });
      assert(isAiHybridOrderingEnabled(empresaId) === true, 'enabled once explicitly set true');
    },
  },
  {
    name: 'a falsy-but-not-strictly-true value never enables it',
    run: () => {
      const empresaId = `hybrid-flag-falsy-${Date.now()}`;
      setConfig(empresaId, { aiHybridOrderingEnabled: false });
      assert(isAiHybridOrderingEnabled(empresaId) === false, 'explicit false stays disabled');
    },
  },
  {
    name: 'server/ai.ts only calls tryHandleAiWhatsAppOrdering when both isGeneralMode is false AND the flag is enabled',
    run: () => {
      const source = readFileSync('server/ai.ts', 'utf8');
      const callIdx = source.indexOf('await tryHandleAiWhatsAppOrdering(');
      assert(callIdx >= 0, 'tryHandleAiWhatsAppOrdering is still called from server/ai.ts');
      const guardStart = source.lastIndexOf('if (', callIdx);
      const guardLine = source.slice(guardStart, callIdx);
      assertIncludes(guardLine, '!isGeneralMode', 'restaurant-mode gate is still present');
      assertIncludes(guardLine, 'isAiHybridOrderingEnabled(resolvedEmpresaId)', 'the per-empresa flag now gates the canonical router too');
    },
  },
  {
    name: 'server/aiSimulator.ts only enters the canonical dry-run when the flag is enabled, mirroring production',
    run: () => {
      const source = readFileSync('server/aiSimulator.ts', 'utf8');
      const callIdx = source.indexOf('tryHandleAiWhatsAppOrdering(');
      assert(callIdx >= 0, 'the simulator still routes through the canonical handler');
      const guardStart = source.lastIndexOf('if (', callIdx);
      const guardLine = source.slice(guardStart, callIdx);
      assertIncludes(guardLine, "cfg.zelochatMode !== 'general'", 'restaurant-mode gate is still present');
      assertIncludes(guardLine, 'cfg.aiHybridOrderingEnabled', 'the simulator honors the same flag as production — the operator sees what customers see');
    },
  },
  {
    name: 'server/router.ts never routes a canonical button id to the ordering handler for a disabled empresa',
    run: () => {
      const source = readFileSync('server/router.ts', 'utf8');
      const parseIdx = source.indexOf('if (buttonId &&');
      assert(parseIdx >= 0, 'canonical button-id branch still exists');
      const line = source.slice(parseIdx, source.indexOf('\n', parseIdx));
      assertIncludes(line, 'isAiHybridOrderingEnabled(empresaId)', 'a disabled tenant never gets its button id parsed/routed to the canonical handler');
      assertIncludes(line, 'parseOrderingButton(buttonId)', 'still parses the canonical button id when enabled');
    },
  },
  {
    name: 'server/router.ts never routes typed Confirmar/Cancelar/Alterar to the canonical handler for a disabled empresa',
    run: () => {
      const source = readFileSync('server/router.ts', 'utf8');
      const collisionIdx = source.indexOf('(isHardConfirm || isHardCancel || isAlterText) && !(buttonId && parseOrderingButton(buttonId))');
      assert(collisionIdx >= 0, 'the canonical text-collision guard (C1/FN C4) still exists');
      const guardStart = source.lastIndexOf('if (', collisionIdx);
      const guardLine = source.slice(guardStart, collisionIdx);
      assertIncludes(guardLine, 'isAiHybridOrderingEnabled(empresaId)', 'a disabled tenant never gets its typed confirm/cancel/alter routed to the canonical handler even if a stale pointer exists');
    },
  },
  {
    name: 'GET /api/ai-ordering-status exposes the flag read-only, no self-service toggle route exists',
    run: () => {
      const source = readFileSync('server/router.ts', 'utf8');
      const routeIdx = source.indexOf("router.get('/api/ai-ordering-status'");
      assert(routeIdx >= 0, 'the status route still exists');
      const routeBody = source.slice(routeIdx, source.indexOf('});', routeIdx));
      assertIncludes(routeBody, 'hybridOrderingEnabled', 'the read-only status payload now includes the flag');
      assert(!source.includes("router.post('/api/ai-ordering-status'"), 'no POST/self-service toggle route was added for this flag');
      assert(!source.includes("router.patch('/api/ai-hybrid-ordering'"), 'no dedicated write route was added for this flag');
    },
  },
]);
