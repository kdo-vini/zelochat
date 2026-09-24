# Avaliação do roteador

`v1.jsonl` é a referência histórica (75 mensagens), usada no ajuste original do prompt. Não é um conjunto independente de validação.

`challenge-v1.jsonl` tem 26 casos sintéticos com expectativas fixadas antes da primeira execução em 24/09/2026: negação, mensagens mistas, fornecedor, dúvidas de produto e seis históricos curtos. Não representa uma amostra de tráfego real nem mede a resposta final. Depois de usar seus resultados para ajustar o prompt, deixa de ser validação independente.

Executar: `npx tsx scripts/evalOrderingRouter.ts [caminho-do-jsonl]`.

Falha do roteador é `fallback_unknown`, nunca um acerto genérico presumido: o comportamento legado depende do catálogo e não é reproduzido aqui. Qualquer falha bloqueia o gate. O gate também exige zero entradas indevidas em pedido/cardápio em todos os casos genéricos, acurácia ao menos igual à aproximação por palavras-chave e nenhuma regressão na contagem de entradas comerciais perdidas. Trocar pedido por cardápio (ou o inverso) conta como perda. PASS avalia esses critérios relativos; não significa 100% nem aprovação de experiência ponta a ponta.

Execução real em 24/09/2026: após disponibilização da chave e correções de oferta comercial e intenção mista, prompt final passou duas vezes em ambos os conjuntos (75/75 e 26/26 decisões). Zero falhas e zero confusões compra/dúvida; esta confusão agora também bloqueia o gate. Houve falhas em rodadas anteriores; ver relatório de revisão. O conjunto challenge foi usado para ajustar o prompt e agora é regressão, não holdout.
