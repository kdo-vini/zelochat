# Relatório — Tarefa 1

## Arquivos

- `src/domain/outbound.ts` — contrato discriminado de origem, política, lifecycle, payload persistível e validação.
- `src/types.ts` — campos opcionais de origem e lifecycle durável em `ChatMessage`, preservando o status legado.
- `tests/outboundContract.test.ts` — cobertura de políticas e limites de payload.

## Testes

- RED: `npx tsx tests/outboundContract.test.ts` falhou porque `src/domain/outbound.ts` ainda não existia (`ERR_MODULE_NOT_FOUND`).
- GREEN: `npx tsx tests/outboundContract.test.ts` passou.
- Lint: `npm run lint` passou (`tsc --noEmit`, zero erros).

## Decisões

- Origens humanas usam `take_over`; IA, sistema, campanhas, automações e integração interna usam `preserve_ai`.
- A validação retorna códigos internos estáveis e não mensagens de infraestrutura; payload inválido falha fechado.
- `ChatMessage.status` permanece compatível com a UI atual. O lifecycle durável novo fica em `outboundState`, e a origem em `outboundOrigin`.
- Mídia, áudio e sticker exigem MIME não vazio; texto, poll, localização e reação têm limites básicos determinísticos.

## Riscos / próximos passos

- Os campos ainda são opcionais até o backfill e as migrations das tarefas seguintes; writers existentes continuam compatíveis durante o rolling deploy.
- A validação é de contrato local. Persistência, fingerprint, idempotência, takeover e dispatch serão implementados nas tarefas posteriores.
