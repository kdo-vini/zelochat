import { readFileSync } from 'node:fs';
import { isCanonicalOrderingAllowedNow, setConfig } from '../server/configStore.js';
import { assert, assertIncludes, runSuite } from './testHarness.js';

const ai = readFileSync('server/ai.ts', 'utf8');
const router = readFileSync('server/router.ts', 'utf8');
const simulator = readFileSync('server/aiSimulator.ts', 'utf8');

await runSuite('AI canonical ordering follows restaurant mode', [
  {
    name: 'canonical ordering is allowed only for an active restaurant-mode empresa',
    run: () => {
      const empresaId = `canonical-ordering-allowed-${Date.now()}`;
      setConfig(empresaId, { zelochatMode: 'restaurant', aiMode: 'always_on' });
      assert(isCanonicalOrderingAllowedNow(empresaId), 'restaurant mode with the global AI enabled allows canonical ordering');
    },
  },
  {
    name: 'general mode and the global kill switch both disable canonical ordering',
    run: () => {
      const generalEmpresaId = `canonical-ordering-general-${Date.now()}`;
      setConfig(generalEmpresaId, { zelochatMode: 'general', aiMode: 'always_on' });
      assert(!isCanonicalOrderingAllowedNow(generalEmpresaId), 'general mode never enters canonical ordering');

      const disabledEmpresaId = `canonical-ordering-disabled-${Date.now()}`;
      setConfig(disabledEmpresaId, { zelochatMode: 'restaurant', aiMode: 'always_off' });
      assert(!isCanonicalOrderingAllowedNow(disabledEmpresaId), 'always_off remains a kill switch for canonical ordering');

      const aiDisabledEmpresaId = `canonical-ordering-ai-disabled-${Date.now()}`;
      setConfig(aiDisabledEmpresaId, { zelochatMode: 'restaurant', aiMode: 'always_on' });
      setConfig(aiDisabledEmpresaId, { aiEnabled: false });
      assert(!isCanonicalOrderingAllowedNow(aiDisabledEmpresaId), 'ai_enabled=false remains a kill switch for canonical ordering');
    },
  },
  {
    name: 'production AI enters canonical ordering for every non-general empresa',
    run: () => {
      assertIncludes(
        ai,
        /if \(!isGeneralMode\) \{\s+\/\/ FIX 2026-08-31:[\s\S]*?await tryHandleAiWhatsAppOrdering\(/,
        'the canonical handler is guarded only by restaurant mode',
      );
    },
  },
  {
    name: 'simulator enters canonical ordering for every restaurant-mode empresa',
    run: () => {
      assertIncludes(
        simulator,
        /if \(cfg\.zelochatMode !== 'general'\) \{[\s\S]*?tryHandleAiWhatsAppOrdering\(/,
        'the simulator mirrors production restaurant-mode routing',
      );
    },
  },
  {
    name: 'canonical button ids are gated before persistence or mutation',
    run: () => {
      assertIncludes(
        router,
        /if \(buttonId && parseOrderingButton\(buttonId\)\) \{[\s\S]*?await ensureAiSettingsHydrated\(empresaId\);[\s\S]*?if \(!isCanonicalOrderingAllowedNow\(empresaId\)\) return;[\s\S]*?await handleIncomingMessage\(data, empresaId\)/,
        'canonical button routing checks mode and global AI state before persisting the action',
      );
    },
  },
  {
    name: 'typed canonical actions are gated after pointer discovery and before mutation',
    run: () => {
      assertIncludes(
        router,
        /if \(canonicalPointer\) \{[\s\S]*?await ensureAiSettingsHydrated\(empresaId\);[\s\S]*?if \(!isCanonicalOrderingAllowedNow\(empresaId\)\) return;[\s\S]*?if \(isHardConfirm\)/,
        'typed confirm/cancel/alter checks mode and global AI state before entering the canonical path',
      );
    },
  },
]);
