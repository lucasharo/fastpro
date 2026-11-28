# Refino H-108 — Painel operacional mínimo (Issue #117, WF-03, Product Owner)

- **Issue:** #117 · **História:** H-108 ("[E12] Painel operacional mínimo") · **Workflow:** WF-03 · **Data:** 2026-11-11 · **Papel:** Product Owner
- **Decisão:** REFINADO_PO com **1 pergunta única ao líder** (Q-H108-1, quem vê). Os critérios de "quem vê" ficam condicionados a ela; o restante está pronto para Arquitetura.
- **Etiquetas:** `[DECIDIDO]` decisão registrada em 11-DECISOES ou do usuário · `[VERIFICADO]` conferido nos arquivos citados · `[PROPOSTA]` deste refino · `[NÃO VERIFICADO]` fora do alcance desta leitura.
- **Rastro:** 14-BACKLOG (H-108, H-092, H-094, H-007, H-103, H-021); 16-MANIFESTO (item 119); 21-ISSUES-CRIADAS (H-108 = #117); 08 §14 e §12.6; 09 (`ops_metric`); 10-ADRS ADR-013 e ADR-020; 11-ARQ-RISCOS-E-TESTES (Q-02 a Q-04); 17-CHECKLIST (painel sem PII); 35-DESENHO-H092 §9 e R-4; 59-DESENHO-H094 §2 e §5; 68-DESENHO-H021 CA-5; 69-REFINO-H103 §1 a §4.

---

## 1. Objetivo

Dar à operação, em uma única tela do console admin, contadores agregados e alertas mínimos sobre a saúde do produto. A tela lê somente agregados; nunca mostra dados pessoais.

Indicadores do painel:

| Bloco | O que a operação vê | Situação | Fonte |
|---|---|---|---|
| Fila de e-mail | Itens por estado; idade do item pendente mais antigo; adiados por cota; falhas por código | `[VERIFICADO]` métricas de H-092 | 35 §9 |
| Cotas em % | E-mail: uso do dia e do mês em %, nível de alerta (70 ou 85) e quando foi gravado | `[VERIFICADO]` contrato de leitura de H-094 | 59 §2 e §Exibição; 14 H-094 |
| Cotas em % (demais) | Storage, banco e Mapbox | `[PROPOSTA]` ver Q-H108-2 e Q-H108-3 | 11 Q-02, Q-03, Q-04 |
| Webhooks | Contagem de falhas e latência agregada; idade do evento mais antigo sem processar | `[VERIFICADO]` (08 §14); idade `[PROPOSTA]` (35 R-4) | 08 §14 |
| Fotos | Contagem de falhas de upload e de reencode, por tipo de falha | `[PROPOSTA]` (interpretação de "fotos" da linha do backlog) | 08 §14 |
| Erros de RLS | Contagem de negações de acesso (SQLSTATE 42501) | `[VERIFICADO]` | 08 §14 |

- **Fonte única:** a tela lê a série agregada `ops_metric` e a leitura de `external_quota` (`service='email'`), sem ferramenta externa. `[VERIFICADO]` (08 §14; 09; 59 §2). O painel calcula `%` a partir de `used` e `hard_limit`.
- **Por que existe:** o contador de cota é a fonte para decidir upgrade, com gatilho de 70% em 3 dias seguidos. `[VERIFICADO]` (08 §12.6, ADR-020).

## 2. Quem vê

- **Base de navegação:** console admin por papel (H-103, Issue #112). O menu mostra só as telas dos papéis ativos da conta, a rota é negada sem o papel, e nada abre sem MFA concluído (aal2). `[VERIFICADO]` (69 §2, §3: CA-H103-06, -08, -12).
- **Papel que vê o painel:** `[NÃO RESOLVIDO]`. A matriz de H-103 não tem linha para o painel, e 69 §4 diz que o painel "não é papel de acesso". RF-146 está ausente no PRD. `[VERIFICADO]`
- **Q-H108-1 (pergunta única ao líder):** qual papel vê o painel?
  - (a) **Superadmin** (recomendação): único papel com visão transversal já existente; coerente com menor privilégio (D-H103-4).
  - (b) Suporte e Superadmin: amplia a visão de quem atende caso.
  - (c) Novo papel "Operação": exige nova linha em AMB-08 e no RF-146. Não recomendado nesta etapa.
  - Destrava: CA-H108-01 e CA-H108-02.
- **Quem não vê:** Auditor (só lê trilha), Verificação, Moderador e Financeiro não veem o painel. `[PROPOSTA]`
- **Dependência de casca:** H-108 não lista H-102 nem H-103 como dependências (14 linha H-108). Como a tela vive no console, a casca de H-103 é necessária. `[VERIFICADO]` (ver Q-H108-4).

## 3. Critérios de aceite (Given/When/Then)

Papel e acesso:
- **CA-H108-01** `[PROPOSTA]` (depende de Q-H108-1). Dado uma conta com o papel de operação, quando abre o console, então vê o painel com os blocos da seção 1 e nenhuma tela de outro papel.
- **CA-H108-02** `[PROPOSTA]` (CA-H103-08). Dado uma conta sem esse papel, quando acessa a rota do painel diretamente, então recebe a negação definida em H-102 e nenhum dado.
- **CA-H108-03** `[PROPOSTA]` (CA-H103-12). Dado uma conta sem MFA concluído, quando tenta abrir o painel, então não abre.
- **CA-H108-04** `[PROPOSTA]`. Dado uma conta com o papel, quando tenta alterar qualquer contador ou alerta por chamada direta, então a API nega e nada muda.

Fila de e-mail:
- **CA-H108-05** `[PROPOSTA]` (testes de agregado). Dado itens em estados diferentes na fila, quando o painel carrega, então mostra a contagem por estado igual à do banco e a idade do pendente mais antigo.
- **CA-H108-06** `[PROPOSTA]`. Dado fila sem itens, quando o painel carrega, então mostra zero nos contadores e o texto "Nenhuma pendência no momento."

Cotas:
- **CA-H108-07** `[VERIFICADO]` (H-094; 59 §2). Dado o uso diário do e-mail em 70 de 100, quando o painel carrega, então mostra "70%" com alerta de 70 visível. Dado uso em 85, então mostra o alerta de 85. O mesmo vale para o mês (2.100 e 2.550 de 3.000).
- **CA-H108-08** `[VERIFICADO]` (H-094; 14 H-094). Dado uso do e-mail acima de 85%, quando o painel carrega, então mostra o percentual e **não** exibe alerta de 95% para o e-mail.
- **CA-H108-09** `[PROPOSTA]` (Q-H108-2). Dado uso de Storage ou Mapbox em 95%, quando o painel carrega, então exibe o alerta de 95% desse serviço. *Válido só se a resposta à Q-H108-2 for (b).*
- **CA-H108-10** `[PROPOSTA]`. Dado um serviço sem registro de uso, quando o painel carrega, então mostra "sem dados", sem zero falso.

Webhooks, fotos e RLS:
- **CA-H108-11** `[PROPOSTA]` (08 §14). Dado falhas de webhook no período, quando o painel carrega, então mostra a contagem e a latência agregada, sem corpo do evento nem identificador de pagamento em claro.
- **CA-H108-12** `[PROPOSTA]`. Dado falhas de upload ou reencode, quando o painel carrega, então mostra a contagem por tipo, sem nome de arquivo nem imagem.
- **CA-H108-13** `[PROPOSTA]` (08 §14). Dado negações de acesso registradas, quando o painel carrega, então mostra a contagem, sem identificador de usuário em claro.

Sem PII e estados:
- **CA-H108-14** `[VERIFICADO]` (17-CHECKLIST, "painel sem PII"). Dado qualquer indicador exibido, quando inspecionado na tela e na resposta da API, então não há e-mail, telefone, CPF/CNPJ, endereço, token, nome ou conteúdo de mensagem.
- **CA-H108-15** `[PROPOSTA]` (D-H103-3). Dado um indicador cuja fonte não está entregue, quando o painel é montado, então o indicador não aparece para nenhum papel.
- **CA-H108-16** `[PROPOSTA]` (texto de H-103). Dado falha ao carregar, quando o painel abre, então mostra "Não foi possível carregar esta tela. Tente novamente."

## 4. Fora de escopo

- Ferramenta externa de observabilidade e uso de logs da Vercel ou do Supabase (retenção curta, 1 hora e 1 dia). Decisão de SD-06 pendente. `[VERIFICADO]` (26 item 5; 08 §14).
- Interruptor, tela ou controle de e-mail; teto configurável em tela (decisões 23 e 27; 59 D2). `[DECIDIDO]`
- Séries históricas, gráficos e exportação. `[PROPOSTA]`
- Atualização em tempo real; a tela é atualizada ao recarregar. `[PROPOSTA]`
- Reconciliação com o provedor de e-mail e alargamento da janela de digest. `[VERIFICADO]` (59 §7)
- Gatilho automático de upgrade ou migração do ADR-020. `[PROPOSTA]` (Q-H108-5)
- Expurgo (H-110), dados de demonstração (H-120), matriz de papéis (H-103) e acesso excepcional a conversa ou documento (H-073). `[VERIFICADO]`

## 5. Dependências e pontos de atenção

- **H-092:** métricas da fila de e-mail (35 §9). `[VERIFICADO]`
- **H-094:** contrato de leitura de `external_quota` e alertas de 70 e 85. `[VERIFICADO]`
- **H-007:** logs sem PII; o painel usa só agregados. `[VERIFICADO]`
- **Status das dependências no quadro:** `[NÃO VERIFICADO]`. Não consultei o GitHub nesta etapa. O líder informou que estão concluídas ou em andamento.
- **H-021 (cota Mapbox no painel):** herdada por 68 CA-5, com recomendação de aceitar. Não há decisão registrada em 11-DECISOES. H-021 está bloqueada por criação de conta e limite de gasto (decisão 46). `[VERIFICADO]` / `[NÃO VERIFICADO]` quanto à aceitação.
- **Conflito de limiar:** 04-PRD §6.1 cita "≥ 90/dia" como exemplo de alerta. Essa linha é `[PROPOSTA]` e está superada pelo desenho de H-094 (alerta em 70 e 85; 90 e 2.700 são corte de classe, não alerta). `[VERIFICADO]` (59 §5, 08 §12.6)
- **Retenção de log da plataforma:** o painel não depende de log da Vercel. `[VERIFICADO]` (26 item 5)

## 6. Dúvidas (não bloqueantes, com recomendação)

Pergunta única ao líder: **Q-H108-1** (seção 2). O líder numera na lista única da sessão.

- **Q-H108-2 — 95% em Storage e Mapbox.** A linha de H-108 diz "sem 95%", escrita para o e-mail. Q-02 e Q-03 testam 70, 85 e 95% para Mapbox e Storage. Alternativas: (a) só 70 e 85 em todas as cotas; (b) 95% para Storage e Mapbox, e nunca para e-mail. **Recomendação: (b)**, que segue Q-02 e Q-03 e mantém a regra de H-094 para o e-mail.
- **Q-H108-3 — quais cotas entram.** Alternativas: (a) e-mail, Storage e banco agora, e Mapbox só se H-021 for entregue; (b) todas agora. **Recomendação: (a).**
- **Q-H108-4 — dependência de casca.** Adicionar H-103 (#112) às dependências de H-108, pois a tela vive no console. **Recomendação:** sim. Ajuste de backlog pelo líder.
- **Q-H108-5 — gatilho de upgrade no painel.** Mostrar a regra "70% por 3 dias seguidos" (ADR-020). Alternativas: (a) só o percentual e o alerta; (b) também o aviso de gatilho. **Recomendação: (a)** nesta história.

---

Commit: não executado. Nesta sessão não há ferramenta de shell disponível para o agente, então o commit em `feature/init` precisa ser feito pelo líder com a mensagem indicada no relatório.
