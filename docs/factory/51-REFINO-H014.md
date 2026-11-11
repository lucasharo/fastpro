# Refino H-014 — Sessão de 7 dias e step-up (Issue #27, WF-03, Product Owner)

- **Decisão:** REFINADO_PO. Pronto para Arquitetura, com 5 dúvidas ao Orquestrador (§4). Nenhum critério é `[APROVADO]` diretamente pelo usuário; os itens são `[DELEGADO]` ou `[PROPOSTA]`.
- **Rastro:** 14-BACKLOG (H-014); 04-PRD RF-038 `[DELEGADO]`; 05-CRITERIOS-ACEITE FA-003; 07-AMBIGUIDADES AMB-13 (recomendação A+C); 08 §5.1 item 6 e §5.4; 10-ADRS ADR-005 §3; 46-DESENHO-H012 §3 (etapa `identificacao`, `D-H012-1`); 11-ARQ (ações com step-up); spikes/S-01-RESULTADO (D6 e nota de H-014); 33-DESENHO-H016 (DD-5 e CA-H016-19/20, que reutilizam este serviço).
- **Natureza:** SOMENTE documento. Nenhum código, migração, teste, conta, chave ou e-mail foi criado.
- **Etiquetas:** `[APROVADO]` decisão do usuário · `[DELEGADO]` adotado por decisão anterior · `[PROPOSTA]` deste refino, pendente de decisão.

## 1. Critérios de aceite (Given/When/Then)

### 1.1 Conversão da etapa em sessão de 7 dias

- **CA-H014-01 `[DELEGADO]` (46 §3, D-H012-1).** Dado uma etapa `identificacao` criada há menos de 15 min, com nonce e código conferidos pelas regras de H-013, quando a etapa é convertida, então ela vira `stage='ativa'`, `expires_at` = `absolute_expires_at` (7 dias contados do clique) e o cookie recebe um segredo novo; o segredo da etapa deixa de valer.
- **CA-H014-02 `[PROPOSTA]`.** Dado a conversão concluída, quando a sessão é gravada, então `recent_auth_at` = agora (o acesso por link/código conta como autenticação recente; ver D-H014-1).
- **CA-H014-03 `[PROPOSTA]`.** Dado uma etapa vencida (15 min) ou revogada, quando alguém tenta convertê-la, então nenhuma sessão é criada, nenhum cookie é emitido e a pessoa é orientada a pedir novo acesso.
- **CA-H014-04 `[DELEGADO]` (08 §5.1 item 6).** Dado uma sessão convertida, quando passam 7 dias do clique, então ela deixa de servir (401), mesmo com uso recente. Não há renovação deslizante.
- **CA-H014-05 `[PROPOSTA]` (concorrência, como H-012).** Dado duas conversões simultâneas da mesma etapa, quando processadas, então exatamente uma sessão é criada e a outra recebe a mesma resposta de CA-H014-03.
- **CA-H014-06 `[PROPOSTA]` (46 §3, R-7).** Dado uma etapa `identificacao` (vencida ou não), quando usada em rota de recurso, então é tratada como não autenticada (401). Somente a rota de conversão a aceita.

### 1.2 Sessão revogada não serve

- **CA-H014-07 `[PROPOSTA]` (S-01, nota de H-014).** Dado uma sessão com `revoked_at` preenchido, quando o cliente faz qualquer requisição, mesmo com token de curta duração ainda válido, então recebe 401. O estado é lido do banco a cada requisição, não do token.
- **CA-H014-08 `[PROPOSTA]`.** Dado uma sessão com `expires_at` no passado, quando o cliente faz qualquer requisição, então recebe 401 e a mesma resposta de CA-H014-07.

### 1.3 Sair e sair de todos

- **CA-H014-09 `[DELEGADO]` (08 §5.1 item 6; RF-038).** Dado uma sessão ativa, quando a pessoa clica em "sair", então a sessão atual é revogada, o cookie é apagado e a próxima requisição com o mesmo cookie recebe 401 (CA-H014-07). Outras sessões da mesma pessoa continuam válidas.
- **CA-H014-10 `[DELEGADO]` (08 §5.1 item 6; S-01 CA-S01-11).** Dado duas ou mais sessões da mesma pessoa, quando ela clica em "sair de todos" em uma delas, então todas são revogadas, inclusive a atual; nenhuma serve, nem por token ainda não expirado, nem por renovação.
- **CA-H014-11 `[PROPOSTA]` (D-H014-2).** Dado uma sessão ativa, quando a pessoa conclui um novo acesso por link em outro dispositivo, então as sessões anteriores continuam válidas. Só "sair" e "sair de todos" revogam.

### 1.4 Step-up para ação crítica

- **CA-H014-12 `[DELEGADO]` (AMB-13 A+C; 08 §5.4).** Dado uma sessão cujo `recent_auth_at` tem mais de 30 min, quando a pessoa tenta uma ação crítica (cancelar, concluir, corrigir conclusão, compartilhar ou revogar telefone/endereço), então a API responde 401 `step_up_required` e nada é alterado. Selecionar e trocar o selecionado entram na lista como `[PROPOSTA]` (08 §5.4; D-H014-5).
- **CA-H014-13 `[DELEGADO]` (D8; AMB-13 C).** Dado o `step_up_required`, quando a pessoa pede a confirmação, então recebe por e-mail um código de 6 dígitos. Validade de 15 min, uso único e até 5 tentativas seguem o mecanismo de H-013 `[PROPOSTA]` (D-H014-3).
- **CA-H014-14 `[PROPOSTA]`.** Dado um código correto dentro das tentativas, quando confirmado, então `recent_auth_at` = agora, a sessão continua a mesma (mesmo `sid`), o prazo de 7 dias não muda e a ação crítica repetida passa.
- **CA-H014-15 `[PROPOSTA]` (janela de 30 min, 08 §5.4).** Dado um step-up confirmado, quando passam 30 min da confirmação, então a próxima ação crítica pede novo código. A atividade comum não renova a janela.
- **CA-H014-16 `[PROPOSTA]`.** Dado 5 códigos errados no mesmo desafio de step-up, quando o quinto erro ocorre, então o desafio é invalidado, `recent_auth_at` não muda e a ação continua negada.
- **CA-H014-17 `[PROPOSTA]`.** Dado uma ação crítica sem `recent_auth_at` recente, quando a API responde, então a resposta é sempre 401 `step_up_required` (não 403 nem 404), para a interface saber que deve pedir o código.

## 2. Fora de escopo

- **Login por senha do profissional, troca de senha e "sair de todos" após troca de senha:** H-016 (33-DESENHO-H016). H-016 reutiliza o serviço de sessão deste refino (DD-5) e gera o `recent_auth_at` pela senha.
- **Login social (Google/Apple):** fora do MVP web (AMB-05; ADR-006). Só entra com a fase mobile (S-07).
- **Consumo do link, etapa `identificacao` e criação da conta:** H-012 (45 e 46). Este refino só converte a etapa.
- **Código de 6 dígitos do acesso e nonce de navegador:** H-013. **Limites de envio e de tentativas:** H-011 e H-015.
- **Aplicar o step-up a cada ação:** cada história dona chama o guarda (cancelar: H-077; concluir: H-078; corrigir: H-079; selecionar e trocar: H-074 e H-076; telefone e endereço: H-112).
- **Expurgo de sessões vencidas ou revogadas:** H-110 (já lista sessões).
- **Tela do pedido de código de step-up:** sem história própria no backlog; ver D-H014-4.

## 3. Pontos de atenção para Arquitetura e QA

- **Três caminhos de tempo:** prazo de 7 dias (absoluto, sem renovação), janela de step-up de 30 min (não deslizante) e validade da etapa de 15 min. QA testa cada um com relógio controlado, incluindo o limite exato.
- **Lista de ações críticas:** a lista de CA-H014-12 é a do 08 §5.4 e deve ser a mesma usada pelo guarda. Não criar exceções por tela.
- **Contrato de step-up:** o H-016 (33 §6.2) usa senha em `POST /v1/auth/step-up`; o cliente usa código. Ver D-H014-5.
- **Prioridade do e-mail de código:** o código de step-up é e-mail de conta e segurança; a prioridade na cota (RNF-EMAIL) é tratada em H-094 e não pode ficar abaixo de avisos comuns.
- **Alinhamento de documentação:** 09 (`app_session`) ainda lista colunas que diferem de 46 §3 (`stage`, `challenge_id`, `secret_hash`, `absolute_expires_at`). Já coberto por D-H012-7; H-014 não deve reabrir esse ponto.

## 4. Dúvidas ao Orquestrador (não bloqueantes; alternativas e recomendação)

- **D-H014-1 — `recent_auth_at` na conversão.** *Alternativas:* (a) a conversão conta como autenticação recente (30 min), para a pessoa que acabou de entrar não digitar código de novo; (b) toda ação crítica exige código, mesmo logo após o acesso. *Recomendação:* (a), que é o que AMB-13 A+C pretende (reautenticar só nas ações críticas).

- **D-H014-2 — Novo acesso não revoga sessões anteriores.** 08 §5.1 item 6 lista "novo desafio opcional" como revogação, mas S-01 (D6) decidiu o contrário e 25-REFINO-S01 pede confirmação. *Alternativas:* (a) não revoga, e só "sair" e "sair de todos" revogam; (b) novo acesso revoga as anteriores. *Recomendação:* (a). Confirmar e ajustar 08 §5.1 item 6 para não contradizer.

- **D-H014-3 — Código de step-up.** *Alternativas:* (a) mesmo mecanismo de H-013 (6 dígitos, 15 min, 5 tentativas, uso único) e janela de 30 min não deslizante; (b) validade de 5 min para o código. *Recomendação:* (a), porque a janela de 30 min já limita o risco e uma validade menor aumenta o abandono. Também confirmar que o e-mail do código tem prioridade acima de lembretes (decisão para H-094).

- **D-H014-4 — Tela do step-up.** Não há história para a tela que pede o código quando a ação crítica é recusada. *Alternativas:* (a) a tela entra com a primeira ação crítica (H-074 ou H-077); (b) criar história própria. *Recomendação:* (a), com o texto e o componente seguindo o EDS.

- **D-H014-5 — Contrato do step-up e lista de ações.** Dois pontos: (i) o nome e o formato do contrato precisam ser o mesmo para cliente (código) e profissional (senha); hoje 33 §6.2 usa `POST /v1/auth/step-up {password}`. *Recomendação:* a Arquitetura decide um único contrato com dois métodos de prova e o mesmo efeito (`recent_auth_at`). (ii) selecionar e trocar entram no step-up (08 §5.4 marca como `[PROPOSTA]`). *Recomendação:* sim, por ser a ação de maior consequência.

## Resumo em linguagem simples

Quando a pessoa confirma o acesso pelo e-mail, ela fica conectada por 7 dias, sem renovação automática, e pode sair neste aparelho ou em todos. Antes de ações importantes, como cancelar ou concluir um pedido, o sistema pede um código novo por e-mail se a última confirmação tiver mais de 30 minutos.
