import assert from 'node:assert/strict';
import { staleGuardAlert, staleGuardAlertHours } from '../server/ai.js';

// A assinatura dos tres defeitos de 09-10/09/2026: um guard deterministico
// bloqueou a resposta por causa de contexto velho. O caso real que motivou o
// alerta foi uma mensagem de 47 dias (1128h) virando "Esse horario ja passou
// hoje: 18:00" para quem so perguntou se a loja estava aberta.
assert.equal(staleGuardAlert('guard_business_hours', 1128), 'stale_history_guard');
assert.equal(staleGuardAlert('guard_blocked_date', 25), 'stale_history_guard');

// Dentro da janela nao alerta — conversa longa do mesmo dia e normal.
assert.equal(staleGuardAlert('guard_business_hours', 24), null, 'exatamente no limite nao alerta');
assert.equal(staleGuardAlert('guard_business_hours', 0.2), null);

// So caminhos de guard. O modelo respondendo com historico longo e legitimo.
assert.equal(staleGuardAlert('model', 1128), null);
assert.equal(staleGuardAlert('canonical_ordering', 1128), null);

// Sem idade conhecida nao inventa alerta: silencio e melhor que alarme falso.
assert.equal(staleGuardAlert('guard_business_hours', null), null);
assert.equal(staleGuardAlert('guard_business_hours', undefined), null);
assert.equal(staleGuardAlert('guard_business_hours', 'muito tempo'), null);
assert.equal(staleGuardAlert('guard_business_hours', Number.NaN), null);

// Janela configuravel, para afinar sem deploy de codigo.
assert.equal(staleGuardAlert('guard_business_hours', 8, 6), 'stale_history_guard');
assert.equal(staleGuardAlert('guard_business_hours', 8, 12), null);
assert.equal(staleGuardAlertHours(), 24, 'padrao documentado');

// O alerta avisa, nao suprime: a decisao do guard continua valendo. Logica
// errada se conserta, nao se contorna em silencio.
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../server/ai.ts', import.meta.url), 'utf8');
const decision = source.slice(source.indexOf('export function logAiTurnDecision'), source.indexOf('export function staleGuardAlertHours'));
assert.match(decision, /console\.warn\(`\[AiAlert\]/, 'o alerta sai como warn, separado da linha normal');
assert.doesNotMatch(decision, /return;|throw /, 'alertar nunca muda o fluxo do turno');

console.log('staleGuardAlert tests passed');
