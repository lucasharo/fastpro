# H-009 — Refino (Issue #22): gate de pré-visualização da hospedagem Vercel

- **Etapa:** refino de Product Owner · **Data:** 2026-11-11 · **Workflow:** WF-03 · **Issue:** #22 (H-009, "[E0] Hospedagem Vercel (web, API e admin)") · **Branch:** feature/init
- **Natureza:** SOMENTE documento. Nenhuma ação na Vercel, no GitHub, no banco ou no código foi feita. Nenhum valor de `.env.local` foi lido.
- **Fontes:** `14-BACKLOG.md` (H-009), `08-ARQUITETURA.md` §16, `10-ADRS.md` (ADR-018, ADR-020, SD-01, SD-15), `spikes/S-09-RESULTADO.md`, `41-DECISAO-S09-CAMINHO.md`.
- **Etiquetas:** [APROVADO] decisão do titular ou regra da fábrica · [DELEGADO] adotado por delegação · [PROPOSTA] proposta deste refino, a validar.

---

## 0. Contexto

- **Autorização do titular (2026-11-11) [APROVADO]:** criar o projeto real de hospedagem na Vercel, plano Hobby, sem domínio, sem cobrança. Publicação em produção ou passo fora desse escopo exige nova autorização.
- **S-09 [APROVADO, decisão 41, opção 1]:** encerrado como PARCIAL. Ficaram NAO VERIFICADO: cold start, teto de 300 s, 413 da plataforma, memória na plataforma e proteção de deploy. Esta história é a primeira medição na plataforma.
- **Risco conhecido [APROVADO como fato]:** no S-09, o primeiro envio por CLI a um projeto novo foi atribuído à produção (`first_deployment_production`). Por isso o caminho de envio precisa ser resolvido antes de qualquer upload (CA-02 e D-H009-1).
- **ADR-018, alternativa A (função única NestJS) [DELEGADO]:** fica PROVISÓRIA até o gate concluir.

---

## 1. Critérios de aceite

O primeiro item da história é o **gate de pré-visualização**. Os demais critérios dependem dele.

### 1.1 Gate de pré-visualização (função única)

- **CA-01 [APROVADO] Só pré-visualização.**
  Dado que o projeto Hobby foi criado com a autorização do titular e não tem domínio,
  Quando a API de teste é enviada,
  Então o deployment tem destino "preview", nenhum deployment de produção é criado e nenhum alias de produção aponta para ele.
  Evidência: listagem dos deployments com o destino de cada um, com comando e saída registrados na Issue.

- **CA-02 [PROPOSTA] Caminho de envio com parada.**
  Dado que o primeiro envio de projeto novo pode ser tratado como produção (S-09 §3),
  Quando o caminho de envio é escolhido,
  Então ele só é executado após autorização escrita específica do titular, com a regra de parada: se qualquer resposta indicar destino "production", o gate para na hora, sem promoção nem alias, e o Orquestrador é avisado.

- **CA-03 [PROPOSTA] Cold start e aquecido.**
  Dado que a pré-visualização está ativa,
  Quando `/health` é chamado após inatividade e depois em sequência,
  Então são registradas no mínimo 10 amostras de cada tipo, com p50 e p95. O limiar de aprovação (referência do Architect: 3 s e 6 s, não validada) é definido pelo Architect antes do fechamento. Sem limiar aprovado, o valor é registrado e não é julgado.

- **CA-04 [PROPOSTA] Limite de duração.**
  Dado uma rota de teste que espera 330 s,
  Quando é chamada,
  Então a Vercel encerra a invocação no teto documentado (300 s, NAO VERIFICADO na plataforma), e o encerramento é registrado com código de resposta e log de execução.

- **CA-05 [PROPOSTA] Memória e imagem.**
  Dado uma rota de teste que reencoda um PNG sintético de 1,78 MB com a biblioteca nativa de imagem,
  Quando executada na função,
  Então a resposta é 200, o pico de memória reportado pela plataforma é registrado (referência: 2 GB do Hobby) e a biblioteca carrega no ambiente Linux da função. Se não carregar, H-027 e H-056 ficam bloqueadas (BLQ-SPK).

- **CA-06 [PROPOSTA] Tamanho do pacote e função única.**
  Dado o build da API,
  Quando a função vai para a pré-visualização,
  Então o tamanho reportado fica em até 250 MB (limite documentado) e o número de funções gerado é registrado (esperado: uma função para a API).

- **CA-07 [PROPOSTA] Corpo máximo.**
  Dado a API com limite de 4 MB na aplicação (já testado localmente),
  Quando são enviados 4,0 MB e 4,5 MB,
  Então 4,0 MB é aceito e 4,5 MB recebe 413. Registra-se se a resposta vem da aplicação ou da plataforma.

- **CA-08 [PROPOSTA] Healthcheck e tick.**
  Dado a pré-visualização ativa,
  Quando `GET /health` é chamado, e `POST /internal/jobs/tick` é chamado sem segredo e com o segredo de teste,
  Então `/health` responde 200, e o tick responde 401 sem segredo e 200 com segredo. O segredo existe só na configuração do ambiente de pré-visualização.

- **CA-09 [PROPOSTA] Mesma origem.**
  Dado o web de pré-visualização com `/api/*` encaminhado à API,
  Quando o navegador chama `/api/health` a partir da origem do web,
  Então a resposta é 200, sem configuração de CORS.

- **CA-10 [PROPOSTA] Admin com origem própria.**
  Dado o admin em projeto separado (depende de D-H009-2),
  Quando um cookie é definido por uma das origens,
  Então ele não é enviado à outra origem.

- **CA-11 [PROPOSTA] Conexão com o banco de teste.**
  Dado o pooler do ambiente de teste (modo transação), com papel de menor privilégio e sem DDL,
  Quando a função executa 50 consultas concorrentes e 200 transações com configuração local,
  Então há 0 erro e 0 vazamento de configuração. Se o host do pooler não estiver confirmado (D-H009-4), o critério fica NAO VERIFICADO e o gate registra a pendência; não bloqueia os demais.

- **CA-12 [PROPOSTA] Registro do resultado.**
  Dado que todos os critérios foram medidos,
  Quando o gate é concluído,
  Então cada critério registra valor medido, data, comando e status (verificado, NAO VERIFICADO ou reprovado). O ADR-018 passa de provisório para verificado ou para contingência (B, C ou D). A decisão de avançar é do Orquestrador e do Architect.

### 1.2 Regras gerais (valem para toda a história)

- **CA-13 [APROVADO] Nenhum envio para produção.**
  Dado qualquer etapa desta história,
  Quando um comando ou integração poderia criar deployment de produção, alias de produção, domínio ou cobrança,
  Então ele não é executado; a história para e pede nova autorização. Proibidos: `--prod`, promoção, alias de produção, domínio e plano pago.

- **CA-14 [APROVADO] Variáveis só por configuração.**
  Dado que a API usa variáveis (ambiente, nível de log, segredo do tick, conexão do banco),
  Quando repositório, logs ou documentos são inspecionados,
  Então só os nomes aparecem. Nenhum valor é gravado em arquivo versionado, log ou documento. Os valores ficam só na configuração da plataforma do ambiente de pré-visualização.

- **CA-15 [APROVADO] Dados sintéticos.**
  Dado qualquer teste desta história,
  Quando usa dados,
  Então usa somente dados sintéticos (ADR-016: dados de teste são sintéticos).

---

## 2. Fora de escopo

- **Produção:** deploy de produção, `--prod`, promoção, alias de produção.
- **Domínio próprio:** compra, DNS, certificado (H2; BK-10).
- **Plano pago:** Vercel Pro ou qualquer cobrança. Gatilho antes da primeira cobrança real (ADR-018, decisão 28).
- **Mercado Pago:** checkout, webhook real e sandbox (H-047 e H-048). CA-08 testa só o endpoint do tick.
- **E-mail real:** Resend e domínio (H-093). Nada é enviado.
- **Banco:** criação de projeto Supabase, mudança de schema ou DDL.
- **Limpeza do S-09:** remoção do projeto `fastpro-spike-s09` é ação do titular, pelo painel (S-09 §9, item 3). Não é desta história.
- **Git integrado (ramo de pré-visualização):** só com autorização própria (opção 2 da decisão 41; D-H009-1).
- **Mobile:** fora da onda.

---

## 3. Dúvidas ao Orquestrador

Numeração local deste refino (`D-H009-n`). O líder renumera na sessão.

- **D-H009-1 [BLOQUEANTE] Caminho do primeiro envio sem produção.**
  Opções: (a) integração Git com ramo que não seja o de produção (opção 2 da decisão 41), com autorização própria e a regra de parada de CA-02; o comportamento para projeto novo é NAO VERIFICADO; (b) envio por CLI com destino "preview", só se a Vercel confirmar antes do envio que não haverá produção (o S-09 mostrou o contrário); (c) não enviar e pedir decisão ao titular.
  **Recomendação:** (a). Enviar ao titular, antes de qualquer ação, o texto da regra de parada.

- **D-H009-2 [BLOQUEANTE] Escopo e número de projetos.**
  Web e API (função única) no mesmo projeto Hobby, com `/api/*` encaminhado? Admin em projeto separado já no gate (para CA-10) ou depois? O CLI só opera pelo time Hobby de dono único (S-09 §1), então o projeto deve ser criado nesse escopo.
  **Recomendação:** web e API no mesmo projeto no gate; admin só se CA-10 for necessário agora. Nomes sugeridos: `fastpro-web` e `fastpro-admin`, sem sufixo de ambiente.

- **D-H009-3 [NÃO BLOQUEANTE] Limiares de cold start.**
  Os valores 3 s e 6 s são do Architect e não foram validados.
  **Recomendação:** o Architect define o limiar antes do fechamento. Sem isso, a história só registra medidas.

- **D-H009-4 [NÃO BLOQUEANTE para o gate; bloqueia CA-11] Host do pooler.**
  O S-09 não obteve o host pelo MCP do Supabase. Este agente não tem acesso a esse MCP, e não tentei nenhuma consulta.
  **Pedido:** o Orquestrador obtém o host pelo MCP ou confirma que CA-11 fica NAO VERIFICADO até o DEV.

- **D-H009-5 [REGISTRO] Pendências fora desta história.**
  Remoção do projeto `fastpro-spike-s09` (titular, S-09 §9 item 3) e encerramento do servidor local na porta 3900 (S-09 §9 item 4).
  Atualização do ADR-018 e da linha de H-009 ao concluir o gate (decisão 41 §3, item 6).
