# Refino H-102 — RBAC e MFA no admin (Issue #111, WF-03, Product Owner)

- **Issue:** #111 · **História:** H-102 ("[E12] RBAC e MFA no admin") · **Workflow:** WF-03 · **Coluna:** Product Owner · **Data:** 2026-11-11 · **Papel:** Product Owner
- **Decisão:** REFINADO_PO. Pronto para Arquitetura. D-H102-1 (fator de entrada) e D-H102-5 (troca de papel) afetam o contrato; as demais têm recomendação e podem seguir com ela.
- **Rastro:** 14-BACKLOG (H-102; BK-11; E12); 04-PRD RF-145, RF-146 (ausente), RF-154; 05-CRITERIOS-ACEITE FA-031; 07-AMBIGUIDADES AMB-08; 08-ARQUITETURA §4.2, §5.2, §13; 10-ADRS ADR-012; 09-MODELO-DADOS §3.12; 46-DESENHO-H012 §4 (conta administrativa não recebe link de cliente); 33-DESENHO-H016 (login de profissional não serve ao admin); 19-PLANO-TECNICO-DEV (Onda 1, O-7); 21-ISSUES-CRIADAS (H-102 = #111).
- **Natureza:** SOMENTE documento. Nenhum código, migração, teste, convite, conta, chave ou e-mail foi criado. A tabela `admin_staff` não existe no banco (informado pelo Orquestrador; não conferido nesta sessão).
- **Etiquetas:** `[APROVADO]` decisão do usuário (RF-145, FA-031) · `[DELEGADO]` adotado por decisão anterior (AMB-08 A como base de papéis, BK-11 (a), revogável) · `[PROPOSTA]` deste refino.

---

## 1. Critérios de aceite (Given/When/Then)

### 1.1 Acesso só por papel atribuído (convite, sem auto-cadastro)

- **CA-H102-01 `[PROPOSTA]` (08 §5.2; ADR-012).** Dado que não existe conta administrativa para um e-mail, quando alguém tenta se cadastrar pelo fluxo público ou pelo link de cliente ou profissional, então nenhuma conta administrativa é criada e a resposta é a de link inválido (46 §4), sem sessão.
- **CA-H102-02 `[PROPOSTA]`.** Dado um convite emitido por Superadmin com um ou mais papéis, quando a pessoa aceita o convite e cadastra o TOTP (CA-H102-05), então a conta passa a existir com exatamente os papéis do convite. Dado convite expirado ou já usado, quando aberto, então é negado e nada é criado. Validade: D-H102-3.
- **CA-H102-03 `[PROPOSTA]` (RF-145, menor privilégio `[APROVADO]`).** Dado um usuário autenticado sem nenhum papel ativo, ou com todos revogados, quando chama qualquer rota `/v1/admin/*`, então recebe a mesma resposta de rota inexistente (D-H102-2) e nenhum dado ou tela é devolvido.
- **CA-H102-04 `[APROVADO]` (FA-031: negação na API, não só na tela).** Dado um papel sem a permissão da operação (ex.: Auditor tentando aprovar estorno), quando chama a API diretamente, então recebe 403 `permission_denied` e nada é alterado.
- **CA-H102-05 `[APROVADO]` (RF-145, MFA obrigatório) e `[PROPOSTA]` (TOTP, 08 §13).** Dado uma conta administrativa sem TOTP cadastrado, quando acessa `/v1/admin/*`, então recebe 401 `mfa_enrollment_required` e só consegue acessar o fluxo de cadastro do TOTP.
- **CA-H102-06 `[APROVADO]` (MFA obrigatório) e `[PROPOSTA]` (aal2).** Dado uma conta com TOTP cadastrado e sessão só com a primeira etapa (aal1), quando acessa `/v1/admin/*`, então recebe 401 `mfa_required` e nenhum dado. Dado código TOTP correto, quando confirmado, então a sessão passa a aal2 e as rotas liberadas são as dos papéis da conta.
- **CA-H102-07 `[PROPOSTA]` (08 §13; H-009).** Dado uma sessão de cliente ou profissional, quando seu cookie é apresentado na origem do admin, então é recusado: origem e cookies do admin são próprios.
- **CA-H102-08 `[PROPOSTA]` (mesmo princípio de CA-H014-07).** Dado uma sessão admin ativa e um papel revogado, quando a pessoa faz a próxima requisição, então a permissão do papel é negada, lida do banco a cada requisição e não do token.

### 1.2 Troca de papel registrada em auditoria

- **CA-H102-09 `[PROPOSTA]` (08 §13; ADR-012; RF-154 não lista troca de papel, ver D-H102-5).** Dado um Superadmin que concede ou revoga um papel, quando a operação conclui, então é gravado um evento de auditoria na mesma transação, com ator, alvo, papel, estado anterior, estado posterior e instante, sem dado pessoal em claro.
- **CA-H102-10 `[PROPOSTA]` (H-006; I-15).** Dado uma falha na gravação da auditoria, quando a troca de papel é tentada, então a troca é desfeita (papel não alterado e nenhum evento). Dado uma tentativa de UPDATE ou DELETE no evento, então é negada.
- **CA-H102-11 `[PROPOSTA]` (RF-145, segregação de funções `[APROVADO]`).** Dado um Superadmin, quando tenta conceder papel a si mesmo, então é negado e a tentativa fica registrada.

---

## 2. Fora de escopo

- **Telas e fluxos por papel (console mínimo):** H-103. **Consulta de auditoria:** H-104. **Dupla aprovação de estorno e suspensão:** H-105. **Estorno:** H-106. **Catálogo e promoções:** H-107. **Painel operacional:** H-108. **Fila de verificação:** H-039. **Moderação:** H-090. **Acesso excepcional a conversa ou documento:** H-073. Todas dependem de H-102; nenhuma é entregue aqui.
- **Cadastro e login do profissional** (senha, perfil, verificação): H-016 e H-035. **Login do cliente, sessão de 7 dias e step-up:** H-011 a H-015. Esses fluxos não usam o domínio do admin.
- **Infra do app admin** (projeto Vercel separado, origem e cookies): H-009.
- **Recuperação de MFA perdido (reenrolamento):** não especificado aqui; depende de D-H102-6 (risco R-21 em 10-ADRS).
- **Matriz detalhada de telas por papel (RF-146):** artefato próprio, com base em AMB-08 A (BK-11). Não é definida neste refino.

---

## 3. Pontos de atenção para Arquitetura e QA

- **Banco:** `admin_staff` (09 §3.12) não existe. A checagem de conta administrativa de H-012 (46 §4, item 1) depende dela. Sem a tabela, H-012 não consegue negar com segurança o link de cliente a um e-mail de admin (D-H102-7).
- **Convite é e-mail de conta:** tem prioridade alta na cota do Resend (RNF-EMAIL). Em desenvolvimento e teste, só vai para a conta cadastrada (decisão 15).
- **Entrada antes do TOTP:** 08 §5.2 exige TOTP, mas não diz como a pessoa entra antes dele (D-H102-1).
- **TOTP no plano gratuito:** `[NÃO VERIFICADO]` (08 §13, ADR-012). Arquitetura verifica antes de fechar o desenho.
- **Testes:** CA-H102-03 a 08 viram testes de API por papel e de banco (pgTAP), gerados pela `access-matrix` (08 §4.4), no conjunto T-08 (11-ARQ).
- **Ordem:** H-102 é Onda 1 (19-PLANO-TECNICO-DEV). H-009 só bloqueia o deploy (O-7); RBAC e MFA são desenvolvidos e testados localmente.

---

## 4. Dúvidas ao Orquestrador (não bloqueantes; alternativas e recomendação)

- **D-H102-1 — fator de entrada do admin.** *Alternativas:* (a) senha + TOTP; (b) código por e-mail + TOTP. *Recomendação:* (a). E-mail fica para convite e recuperação. Afeta o contrato de login da Arquitetura.
- **D-H102-2 — resposta sem papel ou fora da rota.** *Alternativas:* (a) 404 para quem não é admin ou não tem papel; 403 para papel insuficiente; (b) 403 para tudo. *Recomendação:* (a), pelo princípio de negação indistinguível (P10). Mantém o "papel inadequado → 403" do backlog.
- **D-H102-3 — validade do convite.** *Recomendação:* 72 h, uso único; reenvio por Superadmin invalida o convite anterior. *Alternativas:* 24 h ou 7 dias.
- **D-H102-4 — duração da sessão admin.** *Alternativas:* (a) 8 h absolutas, sem renovação; (b) 7 dias, como o cliente (H-014). *Recomendação:* (a), pela sensibilidade do acesso. Ações críticas de admin seguem a dupla aprovação de H-105.
- **D-H102-5 — concessão e revogação de papel.** *Alternativas:* (a) só auditoria (CA-H102-09 a 11); (b) concessão de Superadmin exige aprovação de outro Superadmin (08 §13, "ações críticas de Superadmin"); (c) dupla aprovação para todos os papéis. *Recomendação:* (b). Revogação é imediata, sem dupla aprovação, por segurança.
- **D-H102-6 — MFA perdido (R-21).** *Alternativas:* (a) reenrolamento por Superadmin com dupla aprovação (08 §13); (b) outro administrador com papel equivalente; (c) suporte manual fora do MVP. *Recomendação:* (a), como história própria ou como CA adicional de H-102, conforme decisão do Orquestrador.
- **D-H102-7 — ordem com H-012.** *Alternativas:* (a) criar `admin_staff` em H-102 antes de H-012 ser concluída; (b) concluir H-012 com a checagem de admin pendente e marcada como incompleta. *Recomendação:* (a).
- **D-H102-8 — papéis de partida.** Confirmar que BK-11 (a) (AMB-08 A) vale para H-102, que os códigos de permissão de 08 §13 são o ponto de partida e que a matriz de telas (RF-146) não bloqueia H-102. *Recomendação:* sim.
- **D-H102-9 — primeiro Superadmin (bootstrap).** Como o primeiro convite é emitido, já que o convite depende de um Superadmin. *Alternativas:* (a) script local e único, fora da API pública, com registro em auditoria; (b) SQL manual com conferência em dupla. *Recomendação:* (a).

---

## Resumo em linguagem simples

Só entra na área administrativa quem recebe um convite da equipe e ativa a proteção por código no celular. Quem não tem um papel atribuído não vê nada, e cada troca de papel fica registrada.
