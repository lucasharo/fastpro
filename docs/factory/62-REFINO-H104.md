# Refino H-104 — Consulta à auditoria pelo Auditor (Issue #113, WF-03, Product Owner)

- **Issue:** #113 · **História:** H-104 ("[E12] Consulta à auditoria pelo Auditor") · **Workflow:** WF-03 · **Coluna:** Product Owner · **Data:** 2026-11-11 · **Papel:** Product Owner
- **Decisão:** REFINADO_PO. Pronto para Arquitetura. Os critérios `[APROVADO]` são fixos. Os `[PROPOSTA]` têm recomendação e podem seguir com ela; as dúvidas estão em §4.
- **Dependências concluídas:** H-006 (#19, auditoria append-only na mesma transação) e H-102 (#111, papéis administrativos, sessão de 8 h e TOTP).
- **Rastro:** 14-BACKLOG (H-104: P, dep. H-006 e H-102, testes T-08); 04-PRD RF-145 (Auditor, somente leitura, MFA) e RF-154 (consulta pelo Auditor); 05-CRITERIOS-ACEITE FA-031 (Auditor vê a trilha e não altera dados); 08-ARQUITETURA §13 (audit_event append-only; Auditor lê, nunca altera); 09-MODELO-DADOS `audit_event` (sem PII em claro); 23-DESENHO-H006 (`app_api` sem privilégio de tabela; H-104 concede a leitura); 54-DESENHO-H102 §1 (funções `private.admin_*`), §4 (404 e 403) e §4 (permissão `audit.read`); 53-REFINO-H102 (formato de referência).
- **Natureza:** SOMENTE documento. Nenhum código, migração, teste, conta, chave ou e-mail foi criado ou alterado.
- **Etiquetas:** `[APROVADO]` decisão do usuário (RF-145, RF-154, FA-031) · `[DELEGADO]` adotado por decisão anterior · `[PROPOSTA]` deste refino.

---

## 1. Critérios de aceite (Given/When/Then)

- **CA-H104-01 `[APROVADO]` consulta (RF-154) + `[PROPOSTA]` filtros.** Dado um Auditor com sessão válida e a permissão `audit.read`, quando consulta a trilha informando período (data/hora inicial e final), tipo de ação e/ou entidade (tipo do objeto e identificador), então recebe somente os eventos que atendem a todos os filtros informados, em ordem cronológica, com paginação. Filtro omitido não restringe. Período é obrigatório (teto em §4, dúvida 4).

- **CA-H104-02 `[APROVADO]` sem alteração nem exclusão (RF-145, FA-031).** Dado um Auditor, quando tenta alterar ou excluir um evento da trilha, então nada muda: não existe rota de alteração ou exclusão da trilha (resposta 404 de rota inexistente, D-H102-2) e o banco nega UPDATE e DELETE (H-006). Dado um Auditor que chama uma operação de outro papel (ex.: aprovar estorno), quando faz a chamada, então recebe 403 `permission_denied` e nada é alterado (CA-H102-04).

- **CA-H104-03 `[PROPOSTA]` cada consulta registrada.** Dado uma consulta feita pelo Auditor, quando ela é executada, com ou sem resultados, então é gravada uma entrada de auditoria com ator, filtros usados (período, tipo, entidade), quantidade de eventos devolvidos e instante. A entrada registra os filtros, nunca o conteúdo dos eventos lidos. Dado que a gravação falha, quando a consulta é tentada, então nenhum dado é devolvido (falha fecha; dúvida 2).

- **CA-H104-04 `[PROPOSTA]` sem dado pessoal além do necessário (08 §13; 09 `audit_event`).** Dado a resposta de uma consulta, quando é devolvida, então contém somente os campos de auditoria (instante, referência do ator, papel, ação, tipo e identificador do objeto, estado anterior e posterior, código de motivo, correlação). Nenhum e-mail, telefone, CPF/CNPJ, endereço, nome, token ou cookie aparece na resposta, nos logs ou nos erros. Os filtros aceitam só identificadores e valores do catálogo, nunca texto livre sobre pessoa.

- **CA-H104-05 `[APROVADO]` 404 e 403 (regra da H-102, D-H102-2).** Dado um usuário sem sessão admin válida, sem papel ativo ou com papel revogado, quando chama a consulta, então recebe 404 com corpo e cabeçalhos idênticos ao de rota inexistente, sem dado e sem entrada de consulta. Dado um papel ativo sem `audit.read` (ex.: Financeiro), quando chama a consulta, então recebe 403 `permission_denied`, sem dado.

- **CA-H104-06 `[PROPOSTA]` validação.** Dado uma consulta com período inicial posterior ao final, período acima do teto, ou tipo fora do catálogo, quando enviada, então recebe 422, sem dado e sem entrada de consulta.

- **CA-H104-07 `[PROPOSTA]` efeito imediato da revogação (CA-H102-08).** Dado um Auditor cujo papel foi revogado, quando faz a próxima consulta, então recebe 404 na mesma requisição, lido do banco e não do token.

---

## 2. Fora de escopo

- **Exportação** de eventos (CSV, PDF ou similar): não há história no backlog. Depende de decisão própria, por causa de dado pessoal e de cópia fora do sistema.
- **Painel operacional e métricas:** H-108.
- **Tela de consulta do Auditor e console por papel:** H-103 (ver dúvida 5). H-104 entrega a regra, a rota e os testes.
- **Dupla aprovação** (estorno e suspensão): H-105.
- **Acesso excepcional a conversa ou documento:** H-073 (RF-148).
- **Verificação de encadeamento por hash pelo Auditor:** fora desta história (dúvida 6).
- **Alteração, retenção ou expurgo da trilha:** continuam proibidos; retenção fica em H-109.

---

## 3. Pontos de atenção para Arquitetura e QA

- **Caminho de leitura (divergência a fechar):** 23-DESENHO-H006 diz que H-104 concede `SELECT` a `app_api` com política `audit.read` e `aal2`. 54-DESENHO-H102 §1 diz que as tabelas administrativas são acessadas só por funções `private.admin_*` executadas por `app_system`, sem acesso direto de `app_api`. Recomendação do PO: leitura por função `security definer`, alinhada a 54 §1, e atualizar 23 no desenho.
- **Ação nova no catálogo:** a consulta registrada (CA-H104-03) exige uma ação nova em `audit.action_catalog`, por migração (54 §1). Os valores de estado não podem conter chaves proibidas (`email`, `token`, `name`).
- **Testes (T-08):** CA-H104-02 e CA-H104-05 viram testes de rota por papel, gerados pela `access-matrix`. CA-H104-02 também tem teste de banco: UPDATE e DELETE negados para o papel do Auditor.
- **Teste de falha da gravação:** forçar falha na entrada de consulta e verificar que nenhum dado é devolvido (CA-H104-03).
- **Tamanho:** P, como no backlog. A gravação de consulta não muda o encadeamento da trilha porque só registra leitura.

---

## 4. Dúvidas ao Orquestrador (não bloqueantes; alternativas e recomendação)

1. **D-H104-1 Onde registrar a consulta.** *Alternativas:* (a) entrada na própria trilha (`audit_event`, ação nova de consulta, mesma transação da leitura); (b) log de acesso separado, como `sensitive_access_log` (08 §13). *Recomendação:* (a), para manter um único lugar de rastro. O custo é crescimento da tabela; mitigação: registrar só os filtros, nunca os resultados.
2. **D-H104-2 Falha ao registrar a consulta.** *Alternativas:* (a) não devolve dado (falha fecha); (b) devolve dado e alerta. *Recomendação:* (a), coerente com H-006 (sem auditoria, sem ação).
3. **D-H104-3 Negações (404 e 403) entram na trilha?** *Alternativas:* (a) só métrica sem dado pessoal, como na H-102; (b) entrada na trilha. *Recomendação:* (a), para não poluir a trilha com tentativas de rota inexistente.
4. **D-H104-4 Período e paginação.** *Alternativas:* (a) período obrigatório com teto de 90 dias por consulta e paginação por cursor; (b) 31 dias; (c) sem teto. *Recomendação:* (a) `[PROPOSTA]`, para limitar o volume de dado lido por consulta. O número é ajustável pelo Architect.
5. **D-H104-5 Tela do Auditor.** *Alternativas:* (a) a tela mínima da consulta entra em H-103 (console por papel), e H-104 entrega só a API; (b) H-104 inclui uma tela mínima só de consulta. *Recomendação:* (a). Sem tela, o Auditor só usa a rota até H-103 ser entregue.
6. **D-H104-6 Verificação do encadeamento pelo Auditor.** *Alternativas:* (a) fora desta história; (b) dentro, como botão "verificar integridade" com resultado binário. *Recomendação:* (a), porque 23 deixa a verificação para `app_system`.

---

## Resumo em linguagem simples

O Auditor poderá consultar o histórico de ações do sistema por período, tipo de ação ou item afetado, sem nunca alterar ou apagar nada. Cada consulta fica registrada, e quem não tem permissão não recebe nenhum dado.
