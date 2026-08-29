# Relatório — Tarefa 1

## Arquivos

- `src/domain/outbound.ts` — contrato discriminado de origem, política, lifecycle, payload persistível e validação.
- `src/types.ts` — campos opcionais de origem e lifecycle durável em `ChatMessage`, preservando o status legado.
- `tests/outboundContract.test.ts` — cobertura de políticas e limites de payload.

## Testes

- RED: `npx tsx tests/outboundContract.test.ts` falhou porque `src/domain/outbound.ts` ainda não existia (`ERR_MODULE_NOT_FOUND`).
- GREEN: `npx tsx tests/outboundContract.test.ts` passou.
- Lint: `npm run lint` passou (`tsc --noEmit`, zero erros).

### Correção após revisão

- RED: os testes adicionais reproduziram exceção em objeto runtime sem `text` (`Cannot read properties of undefined`) e rejeição de `quoted` no payload persistido.
- GREEN: `npx tsx tests/outboundContract.test.ts` passou após tornar a validação fail-closed e preservar `quoted` em media/audio/sticker.
- Lint: `npm run lint` passou novamente (`tsc --noEmit`, zero erros).

## Decisões

- Origens humanas usam `take_over`; IA, sistema, campanhas, automações e integração interna usam `preserve_ai`.
- A validação retorna códigos internos estáveis e não mensagens de infraestrutura; payload inválido falha fechado.
- `ChatMessage.status` permanece compatível com a UI atual. O lifecycle durável novo fica em `outboundState`, e a origem em `outboundOrigin`.
- Mídia, áudio e sticker exigem MIME não vazio; texto, poll, localização e reação têm limites básicos determinísticos.
- `PersistedOutboundPayload` mantém o contexto `quoted` em mídia, áudio e sticker; o validador aceita `unknown` em runtime e retorna código estável para qualquer discriminante malformado, sem lançar.
- `audio.ptt` e `reaction.targetFromMe` são campos obrigatórios com tipo booleano; reação sem alvo mantém o código específico de alvo ausente.
- A revisão também adicionou cobertura para anexos sem `fileName`/`type` e todos os discriminantes com campos ausentes ou tipos incorretos; nenhum caso lança exceção.

## Riscos / próximos passos

- Os campos ainda são opcionais até o backfill e as migrations das tarefas seguintes; writers existentes continuam compatíveis durante o rolling deploy.
- A validação é de contrato local. Persistência, fingerprint, idempotência, takeover e dispatch serão implementados nas tarefas posteriores.
