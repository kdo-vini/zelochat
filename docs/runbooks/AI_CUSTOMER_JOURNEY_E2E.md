# E2E — jornada completa de atendimento com IA

Este gate prova a jornada real:

`webhook WhatsApp → IA → link do ZeloMenu → checkout → pedido canônico → CRM → mudança de status → mensagem ao cliente`.

O teste usa OpenAI, Supabase, backend, fila de saída, serviço de WhatsApp e catálogo reais. Ele cria cliente, carrinho, pedido, mensagens e eventos. Por isso, **não pode rodar contra `chat.zelopdv.com.br` nem contra o projeto Supabase compartilhado `ZeloPDV`**.

## Ambiente obrigatório

- Supabase descartável com as migrations atuais.
- Tenant exclusivo cuja empresa, catálogo e instância tenham prefixo/sentinel E2E.
- Instância de WhatsApp exclusiva e conectada.
- Número receptor dedicado, que não pertença a cliente real.
- Produto publicado, sem controle de estoque, com opções obrigatórias válidas.
- Loja aberta durante o gate e IA ligada.
- Notificação de pedido em preparo ligada.
- Campanhas, automações, alerta ao gerente e recuperação de carrinho desligados.
- Backend iniciado com `WHATSMIAU_DISABLE_WEBHOOK_REGISTER=1` quando houver qualquer credencial compartilhada.

## Variáveis do runner

```powershell
$env:ZELOCHAT_E2E_CUSTOMER_JOURNEY='1'
$env:ZELOCHAT_E2E_ALLOW_WRITES='1'
$env:E2E_BASE_URL='http://127.0.0.1:3000'
$env:ZELOCHAT_E2E_API_URL='http://127.0.0.1:3001'
$env:ZELOCHAT_E2E_EMAIL='<conta-e2e>'
$env:ZELOCHAT_E2E_PASSWORD='<senha-via-secret-manager>'
$env:ZELOCHAT_E2E_INSTANCE='e2e-<instancia>'
$env:ZELOCHAT_E2E_WEBHOOK_TOKEN='<token-via-secret-manager>'
$env:ZELOCHAT_E2E_JID='55<ddd><numero>@s.whatsapp.net'
$env:ZELOCHAT_E2E_EXPECTED_SUPABASE_REF='<ref-do-projeto-descartavel>'
$env:ZELOCHAT_E2E_EXPECTED_EMPRESA_ID='<uuid-do-tenant-descartavel>'
npm run test:e2e:customer-journey
```

Senha, JWT, token de webhook, chave interna e service role ficam somente no ambiente do processo. O spec desliga trace, screenshot e vídeo e envia o token de webhook por header. Não grave `storageState` desse gate em CI.

Durante o login, o teste bloqueia as chamadas do painel. Antes de liberar `/app` ou enviar o primeiro webhook, confere o project ref no issuer do JWT, rejeita explicitamente o projeto compartilhado conhecido e chama `/api/bind-empresa` para conferir o UUID exato do tenant. Um frontend/backend local ligado por engano ao Supabase compartilhado falha antes de criar dados da jornada.

## O que o teste exige

1. Login real e instância conectada.
2. Número dedicado ainda inexistente no CRM.
3. Webhook cria sessão, mensagem e `pessoa_id`.
4. Resposta da IA contém a URL pública exata e chega a `sent`.
5. Checkout público usa produto real e confirma o carrinho pela interface do cliente.
6. Pedido canônico é materializado e vinculado ao mesmo cliente.
7. Status avança para `preparing` usando a revisão correta.
8. API pública do carrinho mostra `preparing` e uma nova mensagem `system_transactional` chega a `sent`.
9. A interface autenticada de Clientes mostra o histórico e o pedido vinculados à mesma pessoa.

## Isolamento e limpeza

O `finally` cancela o pedido e solicita exclusão da sessão/cliente pelos endpoints do produto, mas isso não remove raw webhooks, carrinhos, eventos e jobs históricos. A forma suportada de rerun é **resetar o banco descartável e reprovisionar a fixture**. Não tente “limpar por telefone” no banco compartilhado.

Se o teste parar depois do primeiro webhook, consulte os IDs marcados com `E2E-<timestamp>` somente no ambiente descartável.
