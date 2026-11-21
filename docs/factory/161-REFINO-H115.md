# Refino H-115 — Autorização por recurso e paridade entre API e banco (Issue #124)

- **Issue:** #124 `[E15] Autorização por recurso e paridade` · **História:** H-115 · **Épico:** E15 — Hardening e release (Ondas 3 a 5) · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner (primeira coluna do quadro).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-19.
- **EXEC-ID:** não atribuído (não informado pelo líder).
- **Natureza:** somente documento. Nenhum código, migração, banco de dados, quadro nem `11-DECISOES.md` foi alterado. O cartão permanece em Product Owner até decisão humana/Orquestrador.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas:
- `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`.
- `docs/factory/quadro-status.md` (atualizado em 2026-11-19 local, após a Rodada 144).
- `14-BACKLOG.md` (linha H-115, E15, H-003, H-042, H-055, H-004, H-011 a H-018, H-031 a H-034, H-036 a H-041, H-043 a H-046, H-102 a H-114 e §2 Ondas).
- `04-PRD.md` (RF-013, RF-016, RF-028, RF-030, RF-031, RF-046 a RF-050, RF-062, RF-065, RF-075, RF-100, RF-110, RF-136 a RF-141, RF-145 a RF-154; §2 Estados ortogonais).
- `05-CRITERIOS-ACEITE.md` (FA-001 a FA-011, FA-016 a FA-018, FA-025, FA-027, FA-030, FA-031, FA-032, FA-035).
- `08-ARQUITETURA.md` (§0 Histórico, §1.1, §4 Autorização — fontes de verdade: §4.1 Camadas e papéis, §4.2 Papéis de banco, §4.3 Decisão por recurso, §4.4 Paridade de políticas, §5 Identidade, sessão e anti-enumeração, §6 Máquinas de estado, §7.2 Aceite, §10 Mídia, §11 Chat, §13 Administração RBAC, §14 Observabilidade).
- `09-MODELO-DADOS.md` (§1 Convenções, §2 Visão geral, §3 Entidades por módulo: §3.1 identity, §3.3 verification/profissional, §3.4 requests, §3.5 distribution, §3.7 chat/mídia, §3.8 privacidade, §3.10 billing, §3.12 admin; §4 Estados e transições; §6 Catálogo de políticas RLS; §7 Matriz de dados sensíveis C0 a C4; §8 Classes de retenção RC-01 a RC-10; §10 Expurgos operacionais).
- `10-ADRS.md` (ADR-001 Arquitetura, ADR-002 Fonte de verdade da autorização e paridade, ADR-003 Concorrência, ADR-004 Estados ortogonais, ADR-005 Identidade e sessão D8, ADR-006 Provedor de identidade, ADR-009 Mídia e fotos, ADR-010 Chat e Realtime, ADR-014 Anti-enumeração e abuso, ADR-016 Retenção, ADR-021 Mensagens automáticas).
- `11-ARQ-RISCOS-E-TESTES.md` (Risco crítico R-01 "Divergência NestJS × RLS gera vazamento ou bloqueio indevido", R-05 Complexidade de RLS, R-07 Documentos, R-25 Auditoria; Invariantes I-09, I-12, I-15, I-16, I-18, I-19, I-25, I-26; Testes T-02 Autorização por recurso IDOR, T-03 Revelação e visibilidade, T-04 Estado × elegibilidade, T-05 RLS default-deny e catálogo, T-06 Paridade de políticas, T-08 Admin RBAC/MFA, T-11 Logs e PII).
- `11-DECISOES.md` (Decisões 4, 10, 14, 15, 23, 27, 28, 31, 32, 33, 409, 417, 420, 423, 424, 426, 448, 563 a 582, 603 a 622, 640 a 645, 654, 800+; Rodadas 14, 37, 67, 73/75, 80, 82, 91, 92, 107, 121, 138 a 144).
- `packages/access-matrix/src/index.ts` (estado atual no repositório: placeholder inicial com `catalog.manage` e papel superadmin).
- `packages/domain/src/admin/roles.ts` (papéis administrativos, permissões RBAC e mapeamento canônico).
- `packages/domain/src/request/visibility.ts` (listas fechadas `OWNER_KEYS`, `ELIGIBLE_PROFESSIONAL_KEYS`, `VISIBILITY_ROLES`).
- `packages/domain/src/eligibility/professional-access.ts` (modos da guarda: `descoberta_aceite` e `participacao`).
- `apps/api/src/app.ts` e `apps/api/src/composicao.ts` (arquitetura real da API em Node http sem framework).
- Modelos estruturais: `docs/factory/139-REFINO-H055.md` (padrão de profundidade, tabelas e rigor) e `docs/factory/160-REFINO-H101.md`.

Limitações `[NÃO VERIFICADO]`:
- O texto original da Issue #124 no GitHub não foi lido por comando de rede (ambiente estritamente isolado sem ferramentas de rede externa). O objetivo e escopo foram integralmente reconstruídos a partir da linha H-115 do backlog oficial (`14-BACKLOG.md`) e do cruzamento com todas as fontes canônicas de arquitetura, critérios de aceite e histórico de decisões.
- Nenhum comando de escrita, migração ou modificação foi executado no banco de desenvolvimento (ambiente preservado; sem consultas destrutivas).
- Não há Docker no ambiente: utiliza-se o projeto Supabase na nuvem em desenvolvimento, ou scripts de teste locais com Postgres isolado.
- Não há chamadas a provedores externos de mapas (sem Mapbox em testes ou produção).
- Não há envio de e-mail real: em desenvolvimento e testes locais, o envio opera desligado ou redirecionado para mocks/Mailpit local; envio real exige domínio verificado no Resend (decisão 15).
- Não há backup de dados: formalmente removido do escopo do projeto (decisão do usuário na Rodada 73/75 e Issue #151).
- Resposta uniforme anti-enumeração (404 em vez de 403 para recursos inexistentes ou de outro titular) aplicada rigorosamente.

---

## 1. Verificação de fila

- `[VERIFICADO]` O quadro da fábrica (`docs/factory/quadro-status.md`) lista a Issue #124 (`[E15] Autorização por recurso e paridade`) na primeira coluna de trabalho: **Product Owner (7)**.
- `[VERIFICADO]` Total de 75 Issues Concluídas no quadro, englobando as principais fundações de controle de acesso, perfis, dados e infraestrutura já entregues:
  - **#3 (`H-003`):** Monorepo pnpm e Turborepo (estrutura de pacotes, incluindo `packages/access-matrix`);
  - **#18 (`H-005`):** Outbox, jobs, idempotência e `ops.app_config`;
  - **#19 (`H-006`):** Auditoria append-only (`ops.audit_event`, imutabilidade);
  - **#20 (`H-007`):** Logs sem PII e varredura estática de conformidade;
  - **#24 a #28 (`H-011` a `H-015`):** Identidade, autenticação por link mágico/código, sessão de 7 dias, step-up e anti-enumeração;
  - **#29 (`H-016`):** Cadastro e login do profissional via Supabase Auth com senha;
  - **#30 (`H-017`):** Exclusividade de papéis (`app_user` 1—0..1 cliente e profissional; proibição de autoatendimento);
  - **#44 (`H-031`):** Publicação de pedidos (`app.service_request`, prazo de 7 dias);
  - **#45 (`H-032`):** Visibilidade de localização e listas fechadas por papel (`GET /v1/requests/:id` e `GET /v1/professional/requests/:id`);
  - **#46 (`H-033`):** Opt-in de telefone no pedido e revelação restrita de contato;
  - **#47 (`H-034`):** Painel do cliente na sessão do dono (`GET /v1/requests`);
  - **#48 (`H-035`):** Cadastro profissional com documento CPF/CNPJ cifrado (`document_enc`, `document_hmac`);
  - **#49 (`H-036`):** Perfil profissional: serviços declarados, base e raio (`app.professional_service`, `app.professional_area`);
  - **#50 (`H-037`):** Documentos de identidade do profissional (`app.identity_document`, bucket `identity-docs`, sem leitura pelo dono);
  - **#52 (`H-039`):** Fila de verificação de identidade e auditoria (`app.verification_case`);
  - **#53 (`H-040`):** Retenção de aprovação por duplicidade de documento;
  - **#54 (`H-041`):** Estado da verificação visível e recurso;
  - **#55 (`H-042`):** Guarda de elegibilidade na API e no banco (`private.professional_access_guard`);
  - **#56 (`H-043`):** Perfil público do profissional e selo verificado (`GET /v1/public/professionals/:slug`);
  - **#57 (`H-044`):** Ativação de trial de 14 dias (`billing.access_grant` com `type = 'trial'`);
  - **#58 (`H-045`):** Acesso comercial derivado (`billing.access_grant`, `billing.subscription` e `private.commercial_access`);
  - **#59 (`H-046`):** Planos e preços em centavos;
  - **#83 (`H-073`):** Acesso excepcional a conversa por caso autorizado (`app.admin_access_case`);
  - **#111 a #117 (`H-102` a `H-108`):** Suíte administrativa: RBAC, MFA compulsório, console admin, consulta à auditoria pelo Auditor, dupla aprovação para estorno e suspensão, gestão de catálogo e painel operacional mínimo;
  - **#118 (`H-109`):** Mecanismo de retenção sem prazos (`ops.retention_policy`, `ops.legal_hold`);
  - **#119 (`H-110`):** Expurgos operacionais;
  - **#125 (`H-116`):** Testes de injeção e abuso (SQL injection, XSS, upload malicioso, CSRF, SSRF);
  - **#141 (`H-026` / `H-029`):** Composição de rotas de mídia e fotos (`/v1/media`);
  - **#150:** Remoção definitiva do histórico de acesso a fotos (`media_access_log` eliminado).
- `[VERIFICADO]` Issues em QA e Code Review no quadro:
  - **#68 (`H-055`, QA):** Descoberta de pedidos elegíveis (`GET /v1/professional/discovery/requests`, cursor cifrado AEAD);
  - **#51 (`H-038`, Aguardando aprovação):** Certificações para atividades regulamentadas;
  - **#120 (`H-111`, Desenvolvimento):** Direitos do titular (`ops.dsr_case`, anonimização).
- `[VERIFICADO]` Dependências declaradas de H-115 no backlog (`14-BACKLOG.md`):
  1. **H-003 (#3):** `Concluído` no quadro. Entrega a infraestrutura do monorepo Turborepo e o pacote `packages/access-matrix`.
  2. **H-042 (#55):** `Concluído` no quadro (concluída na Rodada 140 por decisão humana). Entrega a primitiva central de elegibilidade `private.professional_access_guard`.
  3. **H-055 (#68):** `QA` no quadro (código, domínio e adaptadores entregues nas Rodadas 141/142). Entrega a rota de descoberta de pedidos e projeção de dados.
- `[VERIFICADO]` Faixa de numeração de perguntas ao líder: o prompt oficial determina numeração a partir de **910** (até 20 perguntas, 910 a 929).

---

## 2. Objetivo

Estabelecer a **fonte única da verdade de autorização por recurso** em todo o ecossistema FastPro por meio da especificação completa e estruturada da matriz de acesso legível por máquina (`packages/access-matrix`), e implementar a **suíte de testes automatizados de paridade estrita entre a camada de aplicação (API em Node) e a camada de banco de dados (PostgreSQL RLS — Row-Level Security)**.

A história H-115 materializa a decisão de arquitetura **ADR-002** e combate frontalmente o risco crítico **R-01** (*"Divergência NestJS/API × RLS gera vazamento ou bloqueio indevido"*):
1. **Defesa em profundidade com default-deny:** a API é a fonte primária de decisão e aplicação de regras de negócio, mas o PostgreSQL impõe invariantes e RLS ativado e forçado (`FORCE ROW LEVEL SECURITY`) em 100% das tabelas de domínio. Se a API cometer uma falha de autorização, o banco bloqueia; se a API tentar permitir um caminho proibido pela política do banco, o resultado é negação compulsória (*deny vence*, AND lógico).
2. **Eliminação de IDOR (Insecure Direct Object Reference - T-02):** clientes jamais podem visualizar ou alterar rascunhos, pedidos, fotos ou consentimentos de outros clientes; profissionais jamais podem visualizar conversas, aceites ou dados privados de outros profissionais; profissionais elegíveis não participantes jamais recebem dados pessoais de clientes (e-mail nunca, telefone só com consentimento, endereço exato só com compartilhamento).
3. **Auditoria de catálogo RLS (T-05):** verificação automatizada e contínua de que nenhuma migração existente ou futura cria tabelas sem RLS, que os papéis de conexão externa (`anon`, `authenticated`) não possuem grants de leitura/escrita direta nas tabelas de negócio, e que todas as funções `SECURITY DEFINER` possuem `search_path=''` fixo.
4. **Verificação de paridade de políticas (T-06):** execução determinística de casos gerados diretamente a partir de `packages/access-matrix`, exercitando em paralelo o endpoint HTTP da API e a consulta SQL direta como papel `app_api` com o contexto da transação (`set_config`), reprovando o release imediatamente se houver divergência entre as duas camadas em qualquer caminho exposto.

---

## 3. Escopo (dentro de H-115)

1. **Especificação canônica da Matriz de Acesso em `packages/access-matrix`:**
   - Tipagem completa e declarativa das entidades, recursos, ações, papéis e condições de contexto.
   - Mapeamento exaustivo de todos os papéis do sistema: `anonymous`, `customer_owner`, `customer_other` (cenário de ataque IDOR), `pro_eligible`, `pro_ineligible_unapproved`, `pro_ineligible_expired`, `pro_ineligible_geo`, `pro_participant`, `pro_participant_withdrawn`, `pro_other` (cenário IDOR), papéis administrativos (`superadmin`, `verificacao`, `moderador`, `financeiro`, `suporte`, `auditor`, `governanca_dados`) e `app_system`.
   - Mapeamento dos recursos e operações já construídos ou projetados: pedidos (`service_request`), rascunhos (`draft`), fotos (`media_asset`), consentimentos (`contact_consent`), perfis profissionais (`professional_profile`, `area`, `service`), documentos de identidade (`identity_document`), casos de verificação (`verification_case`), faturamento (`billing.*`), painéis admin e auditoria (`audit_event`).
2. **Definição da regra de composição e detecção de divergência (ADR-002 / R-01):**
   - Composição estrita: `Decisão_Final = Decisão_API AND Decisão_RLS`.
   - Classificação de divergências em caminhos expostos:
     - *Divergência Tipo 1 (Vazamento Crítico):* API permite acesso que a matriz ou RLS proíbe (falha grave de segurança);
     - *Divergência Tipo 2 (Bloqueio Indevido):* API projeta permitir, mas o banco devolve SQLSTATE 42501 ou 0 linhas por ausência de política (falha funcional);
     - *Divergência Tipo 3 (Exposição Latente no Banco):* API bloqueia corretamente, mas o RLS no banco permitiria leitura direta caso o papel `app_api` executasse a query crua sem filtro.
3. **Suíte automatizada de testes de catálogo RLS (T-05):**
   - Teste de introspecção contra o catálogo do PostgreSQL (`pg_tables`, `pg_class`, `pg_policy`):
     - 100% das tabelas nos esquemas `app`, `billing` e `ops` possuem `rowsecurity = true` E `forcerowsecurity = true`;
     - Nenhuma tabela possui grants públicos para as roles `anon` ou `authenticated` do Supabase (acesso direto a tabelas cruas é proibido);
     - A role `app_api` (sem BYPASSRLS) opera estritamente sob as políticas RLS parametrizadas pelas variáveis de sessão `app.principal_id`, `app.principal_type`, `app.aal` e `app.sid`;
     - Todas as funções `SECURITY DEFINER` nos esquemas `private.*` e `app.*` possuem obrigatoriamente `proconfig` configurado com `search_path=''`.
4. **Suíte automatizada de testes de Autorização por Recurso (IDOR - T-02):**
   - Cliente A tentando ler ou modificar pedidos, rascunhos ou telefones de Cliente B (resposta uniforme HTTP 404 `{ "code": "recurso_nao_encontrado" }` na API; 0 linhas ou negação no banco);
   - Profissional P1 tentando acessar documentos de identidade, área de atuação ou faturamento de P2 (resposta 404 na API; 0 linhas no banco);
   - Profissional não participante tentando ler o primeiro nome do cliente antes do aceite (proibição absoluta; campo omitido ou nulo);
   - Profissional participante com aceite ativo recebendo apenas o primeiro nome e rótulo generalizado, sem telefone (a menos que haja consentimento ativo) e sem endereço exato (a menos que haja `address_share`);
   - Profissional participante com aceite retirado mantendo histórico apenas leitura da conversa, perdendo acesso a atualizações e novos dados.
5. **Blindagem absoluta de dados pessoais (PII / Invariante I-16 / T-11):**
   - Teste de contrato e varredura estática: e-mail do cliente JAMAIS aparece em qualquer resposta de API voltada a profissional (elegível, participante ou selecionado) e jamais consta em views ou projeções de profissional no banco de dados;
   - Telefone do cliente só é exposto se houver opt-in no pedido ou autorização individual no chat, com registro em trilha de auditoria;
   - Endereço exato do cliente só é exposto após compartilhamento específico (`address_share`);
   - Coordenadas exatas (`exact_point`, `match_cell`, `match_lon`, `match_lat`) nunca são devolvidas ao front-end do profissional.
6. **Suíte de paridade RBAC e MFA para funções administrativas (T-08):**
   - Requisições a endpoints `/admin/*` sem MFA (`aal < 2`) resultam em recusa imediata (HTTP 401/403 com `mfa_required`);
   - Teste de segregação de funções: papéis específicos possuem apenas suas permissões concedidas em `ADMIN_ROLE_PERMISSIONS`;
   - O papel `superadmin` NÃO herda permissões operacionais não concedidas (ex.: não pode aprovar estorno financeiro, não pode realizar verificação de identidade, não pode julgar denúncia de moderação);
   - O papel `auditor` possui permissão estritamente de consulta (`audit.read`); qualquer tentativa de escrita em `ops.audit_event` ou tabelas de negócio resulta em negação sumária (403 na API, 42501 no banco);
   - Bloqueio de autoaprovação e exigência de dupla aprovação independente para estornos > R$ 200,00 e suspensão permanente.
7. **Suíte de testes de Paridade API × Banco (T-06):**
   - Execução de matriz de casos de teste em baterias comparativas:
     - Bateria 1: Ciclo de Pedidos e Descoberta (Cliente Dono vs Profissional Elegível vs Inelegível vs Atacante IDOR);
     - Bateria 2: Mídia e Fotos (Dono vs Elegível com marca d'água vs Visitante sem acesso);
     - Bateria 3: Identidade e Verificação (Profissional Dono vs Verificador com caso atribuído vs Outro Admin);
     - Bateria 4: Acesso Comercial e Faturamento (Profissional Titular vs Financeiro vs Outros Papéis);
     - Bateria 5: Console Administrativo e RBAC.
8. **Relatório estruturado de paridade de autorização:**
   - Mecanismo que gera sumário detalhado de cobertura por recurso, apontando 100% de paridade ou listando nominalmente qualquer discrepância para correção mandatória antes de release.

---

## 4. Fora de escopo

- **Implementação das rotas e tabelas de Chat e Mensagens entre cliente e profissional:** pertencem às histórias H-058 (#71), H-065 (#76), H-066 (#77) e H-068 (#136). A matriz de acesso de H-115 documenta e especifica a política de chat (par de membros legítimos, somente texto, sem anexos), mas a execução de testes contra endpoints reais de chat fica condicionada à conclusão dessas issues.
- **Implementação do fluxo de seleção, troca, cancelamento e conclusão:** pertencem a H-078 a H-085 (#84 a #91).
- **Implementação do motor de avaliações:** pertence a H-086 a H-091 (#96 a #101).
- **Implementação de checkout e integração externa com Mercado Pago:** pertencem a H-046 a H-053 (#60 a #67).
- **Testes de carga pesada e concorrência massiva multi-conexão (C-01 a C-18, F-01 a F-12):** pertencem à história H-117 (Issue #126). H-115 foca estritamente na lógica de autorização por recurso, modelo de permissões e paridade de políticas.
- **Testes de vulnerabilidades de injeção técnica (SQLi, XSS, CSRF, SSRF):** já entregues e concluídos na história H-116 (Issue #125).
- **Testes de acessibilidade WCAG:** pertencem à história H-118 (Issue #127).
- **Backup, exportação ou restauração de dados:** formalmente removido do escopo do projeto (decisão do usuário na Rodada 73/75 e Issue #151).
- **Chamadas a provedores externos de mapas ou geocodificação em tempo real:** proibição estrita de Mapbox em tempo de execução de testes ou na aplicação.
- **Envio real de e-mails para a Internet:** proibido em desenvolvimento/testes; operando exclusivamente com mock em memória ou Mailpit local.

---

## 5. Fluxos e estados

### 5.1 Arquitetura de Autorização em Duas Camadas (ADR-002)

A autorização no FastPro não depende exclusivamente do código da API e nem depende unicamente do banco. Toda operação passa pelo crivo das duas camadas:

```
[Requisição HTTP do Cliente / Front-end]
                  |
                  v
       +--------------------+
       |  Camada 1: API     |
       |  (Node / NestJS)   |
       +--------------------+
                  |
        (Valida Sessão, Papel,
         Step-Up, Elegibilidade)
                  |
     [Permitido?] -- NÃO --> Resposta HTTP 401 / 403 / 404 (Anti-enumeração)
                  |
                 SIM
                  |
                  v
       +--------------------+
       |  Injeção de Contexto|
       |  (SET LOCAL app.*) |
       +--------------------+
                  |
        set_config('app.principal_id', user_id, true)
        set_config('app.principal_type', type, true)
        set_config('app.aal', aal_level, true)
        set_config('app.sid', session_id, true)
                  |
                  v
       +--------------------+
       |  Camada 2: RLS     |
       |  (PostgreSQL RLS)  |
       +--------------------+
                  |
        (Políticas RLS em SQL
         Default-Deny forçado)
                  |
     [Permitido?] -- NÃO --> SQLSTATE 42501 ou 0 Linhas (Empty Set)
                  |
                 SIM
                  |
                  v
       +--------------------+
       |  Projeção Segura   |
       |  (Serializador API)| --> Remove PII proibida (e-mail, exato)
       +--------------------+
                  |
                  v
       HTTP 200 OK com Dados Autorizados
```

### 5.2 Estados de Sessão, Papéis e Matriz de Contexto

Para que a avaliação de autorização ocorra de forma determinística, a requisição é contextualizada em uma tupla de segurança:

| Papel / Principal | Origem da Identidade | Nível de Autenticação (`aal`) | Contexto Injetado no Banco | Restrições Principais |
|---|---|---|---|---|
| `anonymous` | Sem cookie de sessão | `aal0` | `app.principal_type = 'anonymous'`, `principal_id = null` | Acesso apenas a rotas públicas (`/health`, `/v1/auth/*`, `/v1/public/*`, busca no catálogo). Nenhuma tabela de domínio legível. |
| `customer_owner` | Cookie de sessão `fastpro_session` | `aal1` (ou `aal2` se step-up recente) | `app.principal_type = 'customer'`, `principal_id = <user_id>` | Acesso total aos próprios pedidos, rascunhos e mensagens. Não lê e não altera recursos de outros clientes. |
| `customer_other` | Cookie de sessão de outro cliente | `aal1` | `app.principal_type = 'customer'`, `principal_id = <atacante_id>` | Simula ataque IDOR. Bloqueio absoluto: recebe 404 uniforme na API e 0 linhas no banco. |
| `pro_eligible` | Cookie de sessão + perfil verificado | `aal1` | `app.principal_type = 'professional'`, `principal_id = <user_id>` | Verificação `aprovada`, conta `ativo`, `email_verified = true`, acesso comercial `ativo/trial`. Descobre pedidos elegíveis na sua região via função dedicada. |
| `pro_ineligible` | Cookie de sessão + perfil pendente/vencido | `aal1` | `app.principal_type = 'professional'`, `principal_id = <user_id>` | Não aprovado ou sem assinatura. Silêncio financeiro: recebe lista vazia (200 OK `{ items: [] }`) na descoberta; bloqueio 403/404 em detalhes não participados. |
| `pro_participant` | Cookie de sessão + aceite ativo no pedido | `aal1` | `app.principal_type = 'professional'`, `principal_id = <user_id>` | Vê primeiro nome do cliente e conversa própria. Não vê e-mail. Telefone só com opt-in; endereço só com compartilhamento. |
| `pro_other` | Cookie de sessão de profissional estranho | `aal1` | `app.principal_type = 'professional'`, `principal_id = <outro_pro_id>` | Simula tentativa de invasão de conversa ou dados de P1. Recebe 404 uniforme na API e 0 linhas no banco. |
| `admin_staff` | Cookie `__Host-fp_admin` + MFA verificado | `aal2` obrigatório | `app.principal_type = 'admin'`, `principal_id = <admin_id>`, `app.aal = 'aal2'` | Permissões estritamente delimitadas por `ADMIN_ROLE_PERMISSIONS`. Sem acesso a chat ou fotos sem `access_case` registrado. |
| `app_system` | Processos em lote, jobs, outbox | N/A (BYPASSRLS interno) | Executado exclusivamente em conexões de background | Papel interno sem endpoint HTTP exposto; nunca manipulável diretamente por requisições de clientes. |

### 5.3 Ciclo de Avaliação de Paridade

1. **Definição declarativa:** O caso de teste especifica `(Recurso, Ação, Papel, Estado_Recurso, Contexto)`.
2. **Execução na API:** A rota HTTP correspondente é chamada com a sessão do papel. O resultado esperado (código HTTP, cabeçalhos, corpo, chaves presentes e chaves ausentes) é registrado.
3. **Execução no Banco (SQL direto):** Uma transação direta é aberta com a role `app_api`. É emitido `SET LOCAL` com as variáveis do papel. O comando SQL correspondente (`SELECT`, `INSERT`, `UPDATE`, `DELETE` ou chamada de função) é executado. O resultado (linhas retornadas, colunas acessíveis ou erro 42501) é registrado.
4. **Comparação de Paridade:**
   - Se a API devolve Sucesso (200/201), o banco DEVE retornar a linha correspondente com os dados autorizados;
   - Se a API devolve Negação por Anti-enumeração (404) ou Proibição (403), o banco DEVE retornar 0 linhas ou erro de permissão (42501);
   - Se houver discrepância em qualquer sentido, o teste FALHA e registra o motivo no relatório de divergência.

---

## 6. Regras de negócio e invariantes

| Ref. | Regra | Fonte | Como H-115 atende e prova |
|---|---|---|---|
| **RN-H115-01** | **Default-deny compulsório em RLS.** Todas as tabelas de dados nos esquemas de aplicação possuem RLS ativado e forçado. Nenhum registro é retornado sem política que autorize explicitamente. | ADR-002; `08` §4.1; `09` §6; T-05 | Teste de catálogo automatizado que varre `pg_class` e falha se qualquer tabela em `app`, `billing` ou `ops` não possuir `relrowsecurity` e `relforcerowsecurity` ativos; CA-H115-02. |
| **RN-H115-02** | **Isolamento de conexões externas (`anon` / `authenticated`).** Os papéis de conexão direta do cliente Supabase não possuem privilégios de tabela nos esquemas de negócio. | `08` §4.2; ADR-002; T-05 | Teste de permissões que confirma `has_table_privilege('anon', t, 'select') = false` e `has_table_privilege('authenticated', t, 'select') = false`; CA-H115-03. |
| **RN-H115-03** | **Injeção transacional de contexto do principal.** A conexão `app_api` opera sem BYPASSRLS e injeta o principal por transação (`set_config(..., true)`). | ADR-002; `08` §4.2; T-05 | Verificação nos testes de integração e adaptadores de banco; CA-H115-04. |
| **RN-H115-04** | **Proteção estrita contra IDOR (Cliente × Cliente).** Cliente nunca acessa ou modifica pedidos, rascunhos, mídias ou consentimentos de outro cliente. | RF-136; FA-002, FA-009; T-02 | Cenários de ataque com `customer_other` tentando ler/alterar pedidos de `customer_owner`. Resposta uniforme 404 e 0 linhas no banco; CA-H115-05. |
| **RN-H115-05** | **Proteção estrita contra IDOR (Profissional × Profissional).** Profissional nunca acessa dados cadastrais privados, documentos de identidade, propostas ou finanças de outro profissional. | RF-046; FA-009; T-02 | Cenários de ataque com `pro_other` tentando ler perfil ou documentos de `pro_owner`. Resposta 404 na API e 0 linhas no banco; CA-H115-06. |
| **RN-H115-06** | **Isolamento de conversas de chat.** Conversa e mensagens só são acessíveis pelos dois membros legítimos do par (cliente dono e profissional com aceite ativo). | RF-100, RF-110; FA-009; ADR-010; I-12 | Cenários de P1 tentando ler chat de P2 e cliente tentando ler conversa alheia. Bloqueio mútuo na API e RLS; CA-H115-07. |
| **RN-H115-07** | **Blindagem total de PII: E-mail do cliente nunca.** Nenhuma tela, API, view ou função voltada a profissional expõe o e-mail do cliente, mesmo após aceite ou seleção. | RF-137; FA-030; `08` §4.3; I-16; T-11 | Teste de contrato com sentinelas sintéticos e inspeção estrita de payload de resposta; CA-H115-11. |
| **RN-H115-08** | **Revelação condicional de telefone.** Telefone do cliente só é exposto se houver opt-in no pedido ou autorização individual no chat, e exclusivamente a participantes com aceite ativo. | RF-016, RF-138; FA-030; `08` §4.3; I-16 | Cenários com e sem opt-in testando API de revelação e tabela de consentimento; CA-H115-12. |
| **RN-H115-09** | **Revelação condicional de endereço completo.** Endereço exato (texto e coordenadas) é proibido na descoberta; só é acessível após compartilhamento explícito (`address_share`). | RF-139; FA-030; `08` §4.3; I-16 | Verificação das listas fechadas `OWNER_KEYS` vs `ELIGIBLE_PROFESSIONAL_KEYS` e RLS correspondente; CA-H115-13. |
| **RN-H115-10** | **Silêncio financeiro e anti-enumeração na descoberta.** Profissionais não elegíveis recebem resposta uniforme 200 OK vazia (`items: []`), sem revelar status de pagamento ou documento. | Decisão 569; `114` §privacidade; RF-137 | Paridade entre a guarda `private.professional_access_guard` e a rota `GET /v1/professional/discovery/requests`; CA-H115-09. |
| **RN-H115-11** | **Segregação de funções e menor privilégio no Admin.** Acesso a rotas administrativas exige MFA (`aal2`) e permissão estrita em `ADMIN_ROLE_PERMISSIONS`. | RF-145, RF-146; FA-031; `08` §13; T-08 | Teste de cada papel administrativo contra rotas dos demais papéis; CA-H115-14 e CA-H115-15. |
| **RN-H115-12** | **Superadmin não possui privilégio universal.** Superadmin não herda permissões de moderação, financeiro, verificação ou governança de dados. | RF-145; `packages/domain/src/admin/roles.ts` | Teste do Superadmin tentando operações de outros papéis (deve falhar); CA-H115-17. |
| **RN-H115-13** | **Admin sem navegação livre.** Nenhum administrador (inclusive Superadmin) pode ler conversas ou documentos de identidade sem um caso formal autorizado (`access_case`). | RF-148; FA-031; `08` §4.3; T-08 | Tentativa de leitura sem caso resulta em 403 na API e bloqueio no RLS; CA-H115-16. |
| **RN-H115-14** | **Auditor somente leitura.** O papel Auditor pode ler auditoria, mas é incapaz de alterar, inserir ou excluir qualquer dado em qualquer tabela. | RF-154; FA-031; `08` §13; I-15; T-08 | Teste de mutação direta como Auditor resultando em erro 42501; CA-H115-18. |
| **RN-H115-15** | **Blindagem de funções `SECURITY DEFINER`.** Funções com privilégios elevados devem possuir `search_path=''` fixo e nomes totalmente qualificados. | ADR-002; `11` T-05; decisões consolidadas | Teste de introspecção em `pg_proc` garantindo `prosecdef = true ⇒ proconfig @> '{search_path=}'`; CA-H115-19. |
| **RN-H115-16** | **Impedimento de autoatendimento.** O mesmo `app_user` não pode participar como profissional de um pedido em que é o cliente dono. | `08` §5.2; I-19; Issue #30 (`H-017`) | Teste de tentativa de aceite do próprio pedido barrado pela guarda de domínio e trigger; CA-H115-05. |
| **RN-H115-17** | **Detecção e bloqueio de divergências.** Qualquer discrepância entre a autorização concedida pela API e a imposta pelo RLS em caminho exposto é falha grave. | R-01; ADR-002; `08` §4.4; T-06 | Executor comparador de paridade que emite relatório estruturado e bloqueia o release em caso de divergência; CA-H115-20. |

Invariantes citadas de `11-ARQ-RISCOS-E-TESTES.md`:
- **I-09:** Integridade e isolamento de avaliações.
- **I-12:** Conversa atômica e isolada entre par legítimo.
- **I-15:** Auditoria append-only imutável na mesma transação.
- **I-16:** Nenhuma consulta a profissional retorna e-mail do cliente; telefone só com consentimento; endereço exato só com `address_share`.
- **I-18:** Aprovador de estorno ≠ solicitante e dupla aprovação independente para valores > R$ 200,00.
- **I-19:** Profissional não participa do próprio pedido (`app_user` igual).
- **I-25:** Restrições rígidas de métodos e períodos de faturamento.
- **I-26:** Ausência de campos de preço e proposta no aceite.

---

## 7. Critérios de aceite (Given / When / Then)

Todos os critérios são testáveis, reprodutíveis e mensuráveis, sem depender de rede externa, chaves do Mapbox ou envio real de e-mails.

- **CA-H115-01 (Especificação estruturada da Matriz de Acesso em `packages/access-matrix`).**
  - **Dado** o pacote `@fastpro/access-matrix`,
  - **Quando** inspecionado por testes estáticos e de compilação,
  - **Então** exporta a definição completa, imutável e tipada da matriz de autorização do FastPro, contendo a lista exaustiva de papéis (`AccessRole`), recursos (`AccessResource`), ações (`AccessAction`), condições de contexto (`AccessContext`) e listas fechadas de projeção autorizada. Prova: `packages/access-matrix/src/*.ts` compila sem erros com `pnpm --filter @fastpro/access-matrix typecheck`.

- **CA-H115-02 (Catálogo RLS: default-deny e forçamento em 100% das tabelas).**
  - **Dado** o banco de dados PostgreSQL com todas as migrações aplicadas,
  - **Quando** uma consulta de introspecção é executada sobre as tabelas dos esquemas `app`, `billing` e `ops`,
  - **Então** 100% das tabelas possuem `relrowsecurity = true` (RLS habilitado) E `relforcerowsecurity = true` (RLS forçado até mesmo para donos da tabela). Nenhuma tabela pode estar em bypass. Prova: consulta SQL em `pg_class` com contagem de tabelas em conformidade igual ao total de tabelas existentes.

- **CA-H115-03 (Isolamento total de papéis Supabase `anon` e `authenticated`).**
  - **Dado** uma conexão direta ao banco utilizando a role `anon` ou `authenticated`,
  - **Quando** tenta executar qualquer `SELECT`, `INSERT`, `UPDATE` ou `DELETE` diretamente contra tabelas de domínio (`app.service_request`, `app.professional_profile`, `app.identity_document`, `billing.subscription`, `ops.audit_event`),
  - **Então** o PostgreSQL rejeita sumariamente a operação com SQLSTATE 42501 (`insufficient_privilege`), confirmando que os clientes front-end não possuem porta traseira ao banco.

- **CA-H115-04 (Injeção de contexto por transação para a role `app_api`).**
  - **Dado** a role `app_api` (utilizada pela API Node sem permissão de BYPASSRLS),
  - **Quando** executa consultas sem emitir previamente `SET LOCAL app.principal_id`,
  - **Então** o RLS opera em modo *default-deny* estrito, devolvendo exatamente 0 linhas ou rejeitando a operação. Ao emitir `SET LOCAL app.principal_id = 'user-uuid'`, o RLS filtra rigorosamente apenas os registros pertencentes àquele principal.

- **CA-H115-05 (IDOR Cliente × Cliente: proteção de pedidos e rascunhos).**
  - **Dado** um Cliente A que publicou um pedido `request-A`, e um Cliente B autenticado (`customer_other`),
  - **Quando** Cliente B requisita `GET /v1/requests/request-A` na API,
  - **Então** a API responde HTTP `404 Not Found` com corpo uniforme `{ "code": "recurso_nao_encontrado" }` (anti-enumeração estrita, sem vazar a existência do pedido com 403), e uma consulta direta como Cliente B via `app_api` no banco retorna exatamente 0 linhas.

- **CA-H115-06 (IDOR Profissional × Profissional: proteção de perfil e documentos).**
  - **Dado** um Profissional P1 e um Profissional P2 autenticado (`pro_other`),
  - **Quando** P2 tenta acessar dados privados, área de atuação ou documentos de identidade de P1 (`/v1/professional/profile` ou `/v1/professional/documents`),
  - **Então** a API recusa a requisição ou projeta apenas os dados próprios de P2, e o RLS impede qualquer visualização de registros cujo `professional_id` divirja do principal da sessão.

- **CA-H115-07 (Isolamento de conversas de chat entre membros do par).**
  - **Dado** um pedido com conversa estabelecida entre Cliente C1 e Profissional P1,
  - **Quando** um Profissional P2 (com ou sem aceite em outro pedido) tenta acessar as mensagens daquela conversa via API ou via consulta SQL com seu principal,
  - **Então** a API responde HTTP `404 Not Found` e o RLS bloqueia o acesso, garantindo sigilo absoluto da comunicação entre as partes legítimas.

- **CA-H115-08 (Paridade para Leitura de Pedidos pelo Cliente Dono).**
  - **Dado** um pedido publicado pelo Cliente C1,
  - **Quando** C1 requisita o detalhe do pedido na API (`GET /v1/requests/:id`) e consulta via banco como `app_api` com seu `principal_id`,
  - **Então** ambas as camadas concordam plenamente: todos os campos de `OWNER_KEYS` são retornados (incluindo `firstName` e `addressText`), e nenhuma divergência é registrada entre API e banco.

- **CA-H115-09 (Paridade na Descoberta de Pedidos: elegíveis vs inelegíveis).**
  - **Dado** profissionais com diferentes estados de elegibilidade (aprovado e pago vs não aprovado vs expirado),
  - **Quando** requisitam a rota de descoberta `GET /v1/professional/discovery/requests`,
  - **Então** a API e o banco operam com paridade absoluta:
    - O profissional elegível no raio recebe os pedidos com campos de `ELIGIBLE_PROFESSIONAL_KEYS` (sem dados pessoais e com distância generalizada);
    - O profissional não aprovado ou com acesso comercial expirado recebe 200 OK com `{ items: [] }` em ambas as camadas (silêncio financeiro e anti-enumeração).

- **CA-H115-10 (Paridade para Documentos de Identidade: gravação permitida, leitura proibida ao dono).**
  - **Dado** um profissional aprovado ou pendente,
  - **Quando** tenta fazer upload de documento de identidade para verificação, a operação é aceita; quando tenta baixar ou ler os documentos previamente enviados (`GET`),
  - **Então** a API e o banco negam a leitura ao próprio profissional (decisão 170: o dono não lê seus documentos após o envio; apenas a equipe de Verificação lê no âmbito de uma tarefa atribuída).

- **CA-H115-11 (Blindagem de PII: e-mail do cliente nunca exposto a profissionais).**
  - **Dado** qualquer requisição disparada por um profissional (elegível, participante, selecionado ou em qualquer estado),
  - **Quando** a resposta JSON da API e o conjunto de colunas devolvidos pelo banco são inspecionados exaustivamente,
  - **Então** a chave `email` do cliente NÃO existe no payload e nenhuma view acessível ao profissional contém a coluna de e-mail. Prova: teste automatizado de contrato com asserção estrita sobre esquemas de resposta.

- **CA-H115-12 (Revelação condicional de telefone com auditoria).**
  - **Dado** um pedido publicado,
  - **Quando** o profissional participante consulta os dados do pedido:
    - Se o cliente marcou opt-in de telefone: a API e a função de banco correspondente revelam o telefone e registram o evento na trilha de revelação de contatos;
    - Se o cliente não marcou opt-in: o telefone é omitido e o acesso direto ao campo cifrado no banco é barrado pelo RLS.

- **CA-H115-13 (Revelação condicional de endereço completo).**
  - **Dado** um pedido publicado,
  - **Quando** inspecionado por profissional antes da seleção ou sem consentimento de endereço,
  - **Então** o endereço completo em texto (`addressText` / `address_text_enc`) é estritamente omitido na API e protegido no RLS; apenas `publicLabel` ("Cidade - UF") e `distanceKm` são acessíveis. O endereço em texto só é liberado ao participante após o cliente conceder `address_share`.

- **CA-H115-14 (Admin RBAC: segregação estrita por permissão).**
  - **Dado** um colaborador administrativo autenticado com um papel específico (ex.: `verificacao`),
  - **Quando** tenta invocar endpoints reservados a outros papéis (ex.: aprovar estorno financeiro, alterar catálogo ou visualizar logs de auditoria),
  - **Então** a API responde HTTP `403 Forbidden` com código indicando falta de permissão, e a execução direta de comandos no banco como aquele papel resulta em negação de privilégios.

- **CA-H115-15 (Admin MFA Step-up compulsório em rotas administrativas).**
  - **Dado** uma requisição enviada para qualquer rota `/v1/admin/*`,
  - **Quando** a sessão administrativa não possui segundo fator confirmado (`aal` < 2),
  - **Então** a API responde imediatamente com HTTP `401 Unauthorized` ou `403 Forbidden` exigindo step-up (`aal2_required`), e as funções administrativas no banco (`private.admin_*`) barram a execução caso `app.aal` seja diferente de `'aal2'`.

- **CA-H115-16 (Admin sem navegação livre: chat e documentos exigem caso).**
  - **Dado** qualquer colaborador administrativo (inclusive com papel `superadmin`),
  - **Quando** tenta acessar o conteúdo de uma conversa entre usuários ou baixar um documento de identidade sem vincular a requisição a um caso de acesso sensível ativo (`access_case`),
  - **Então** a API e o banco negam sumariamente o acesso, garantindo que não haja visualização recreativa ou não justificada de dados confidenciais.

- **CA-H115-17 (Segregação de privilégios do Superadmin).**
  - **Dado** uma sessão com papel `superadmin`,
  - **Quando** tenta executar operações operacionais exclusivas de outros papéis (ex.: emitir voto de aprovação de estorno financeiro em `app.approval_vote` ou decidir denúncia de moderação),
  - **Então** a API e as constraints/triggers do banco negam a ação, confirmando que o Superadmin não acumula papéis operacionais.

- **CA-H115-18 (Auditor: perfil estritamente somente leitura).**
  - **Dado** uma sessão com papel `auditor`,
  - **Quando** executa consultas a `ops.audit_event`, a leitura é concedida; quando tenta emitir qualquer instrução `INSERT`, `UPDATE` ou `DELETE` em qualquer tabela do banco de dados,
  - **Então** o banco de dados aborta a instrução com erro 42501 (`insufficient_privilege`), comprovando que o papel é 100% somente leitura.

- **CA-H115-19 (Blindagem das funções `SECURITY DEFINER`).**
  - **Dado** todas as funções nos esquemas `private` e `app` marcadas como `SECURITY DEFINER`,
  - **Quando** inspecionadas pela suíte de catálogo no banco,
  - **Então** todas possuem `search_path` explicitamente configurado como vazio (`search_path = ''`), prevenindo ataques de substituição de operadores ou funções por schemas maliciosos.

- **CA-H115-20 (Suíte de Paridade Automatizada e Detector de Divergências).**
  - **Dado** a execução da suíte de testes de paridade no pipeline de integração,
  - **Quando** os casos de teste da matriz são executados contra a API e contra o PostgreSQL em paralelo,
  - **Então** a suíte consolida os resultados e falha o teste caso identifique qualquer divergência em caminho exposto (API permite e banco nega, ou API projeta e banco falha). O relatório emitido detalha os casos verificados e a conformidade de 100%.

---

## 8. Matriz de cenários de teste e cobertura

A matriz a seguir mapeia os cenários centrais de autorização por recurso e paridade de políticas que a suíte automatizada de H-115 deve cobrir:

| ID | Recurso / Operação | Papel / Principal | Contexto do Caso | Comportamento Esperado na API | Comportamento Esperado no Banco (RLS) | Paridade | Critério de Aceite |
|---|---|---|---|---|---|---|---|
| **CP-01** | Pedido: `GET /v1/requests/:id` | `customer_owner` | Pedido publicado pelo próprio usuário | 200 OK com `OWNER_KEYS` | Linha retornada com colunas autorizadas | OK (Paritário) | CA-H115-08 |
| **CP-02** | Pedido: `GET /v1/requests/:id` | `customer_other` | Pedido pertence a outro cliente (IDOR) | 404 `{code: "recurso_nao_encontrado"}` | 0 linhas retornadas (default-deny) | OK (Paritário) | CA-H115-05 |
| **CP-03** | Pedido: `GET /v1/requests/:id` | `anonymous` | Sem sessão de autenticação | 401 `{code: "sessao_necessaria"}` | Rejeição de privilégio (42501) | OK (Paritário) | CA-H115-03 |
| **CP-04** | Pedido: `GET /v1/professional/requests/:id` | `pro_eligible` | Pedido no raio, profissional elegível sem aceite | 200 OK com `ELIGIBLE_PROFESSIONAL_KEYS` | Linha retornada sem PII do cliente | OK (Paritário) | CA-H115-09 |
| **CP-05** | Pedido: `GET /v1/professional/requests/:id` | `pro_ineligible` | Profissional com verificação pendente/recusada | 404 ou lista vazia conforme rota | 0 linhas retornadas pela guarda | OK (Paritário) | CA-H115-09 |
| **CP-06** | Pedido: `GET /v1/professional/requests/:id` | `pro_participant` | Profissional com aceite ativo no pedido | 200 OK com chaves de participante + `firstName` | Linha retornada via view autorizada | OK (Paritário) | CA-H115-09 |
| **CP-07** | Pedido: revelação de telefone | `pro_participant` | Pedido com opt-in de telefone marcado | Telefone revelado no endpoint próprio | Revelação permitida via função auditada | OK (Paritário) | CA-H115-12 |
| **CP-08** | Pedido: revelação de telefone | `pro_participant` | Pedido SEM opt-in de telefone | 404 / telefone nulo | Negação no banco e sem revelação | OK (Paritário) | CA-H115-12 |
| **CP-09** | Pedido: revelação de telefone | `pro_eligible` | Profissional elegível porém sem aceite | Telefone omitido categoricamente | 0 linhas ou erro de acesso | OK (Paritário) | CA-H115-12 |
| **CP-10** | Pedido: inspeção de e-mail | Qualquer profissional | Qualquer estágio de participação | Chave `email` não existe na resposta JSON | Coluna de e-mail ausente nas views | OK (Paritário) | CA-H115-11 |
| **CP-11** | Pedido: endereço completo | `pro_participant` | Participante sem `address_share` | Endereço completo omitido (`publicLabel` ok) | Campo de texto cifrado protegido | OK (Paritário) | CA-H115-13 |
| **CP-12** | Pedido: endereço completo | `pro_participant` | Participante com `address_share` ativo | Endereço completo em texto fornecido | Leitura autorizada por consentimento | OK (Paritário) | CA-H115-13 |
| **CP-13** | Descoberta de pedidos | `pro_eligible` | Pedidos abertos no raio de atendimento | 200 OK com lista paginada de pedidos | Linhas filtradas pela função de busca | OK (Paritário) | CA-H115-09 |
| **CP-14** | Descoberta de pedidos | `pro_ineligible` | Assinatura expirada ou trial encerrado | 200 OK `{ items: [], next_cursor: null }` | 0 linhas retornadas (silêncio financeiro) | OK (Paritário) | CA-H115-09 |
| **CP-15** | Rascunho: manipulação | `customer_other` | Cookie de rascunho de outro cliente (IDOR) | 404 `{code: "rascunho_nao_encontrado"}` | 0 linhas retornadas no RLS | OK (Paritário) | CA-H115-05 |
| **CP-16** | Foto: visualização | `pro_eligible` | Profissional elegível requisitando foto | URL assinada de curta duração com marca d'água | Acesso via API; storage sem leitura direta | OK (Paritário) | CA-H115-09 |
| **CP-17** | Foto: visualização | `anonymous` | Visitante sem login requisitando foto | 401 ou 404 indistinguível | Storage nega acesso a papéis anônimos | OK (Paritário) | CA-H115-03 |
| **CP-18** | Documento de Identidade | `pro_owner` | Profissional tentando baixar próprio doc | 404 ou 403 (decisão 170: dono não lê) | RLS nega leitura ao próprio profissional | OK (Paritário) | CA-H115-10 |
| **CP-19** | Documento de Identidade | `admin_verificacao` | Verificador com tarefa atribuída no caso | Download de visualização autorizado via API | Leitura autorizada no contexto do caso | OK (Paritário) | CA-H115-10 |
| **CP-20** | Documento de Identidade | `admin_financeiro` | Papel administrativo não autorizado | 403 `{code: "permissao_insuficiente"}` | RLS nega privilégio ao papel | OK (Paritário) | CA-H115-14 |
| **CP-21** | Admin Console: rotas | Qualquer admin | Sessão com MFA não confirmado (`aal1`) | 401/403 `{code: "mfa_obrigatorio"}` | Funções barram execução sem `aal2` | OK (Paritário) | CA-H115-15 |
| **CP-22** | Admin: aprovação estorno | `superadmin` | Superadmin tentando aprovar estorno | 403 `{code: "permissao_insuficiente"}` | Constraint/trigger veta autoaprovação | OK (Paritário) | CA-H115-17 |
| **CP-23** | Admin: auditoria | `admin_auditor` | Auditor consultando eventos | 200 OK com lista de eventos de auditoria | SELECT concedido em `ops.audit_event` | OK (Paritário) | CA-H115-18 |
| **CP-24** | Admin: escrita em auditoria | `admin_auditor` | Auditor tentando atualizar/excluir auditoria | 403 ou método HTTP não suportado | 42501 (privilégio insuficiente no SQL) | OK (Paritário) | CA-H115-18 |
| **CP-25** | Catálogo: RLS ativo | N/A (Auditoria) | Varredura em todas as tabelas de domínio | N/A | 100% das tabelas com RLS forçado | OK (Paritário) | CA-H115-02 |
| **CP-26** | Funções: `search_path` | N/A (Auditoria) | Varredura de funções `SECURITY DEFINER` | N/A | 100% das funções com `search_path=''` | OK (Paritário) | CA-H115-19 |

---

## 9. Dependências

Estado real conferido em `docs/factory/quadro-status.md` e no histórico recente de decisões:

### 9.1 Dependências Concluídas no Quadro

1. **#3 (`H-003`):** `Concluído` no quadro. Monorepo Turborepo com o pacote `packages/access-matrix` criado e configurado.
2. **#18 (`H-005`):** `Concluído` no quadro. Infraestrutura de banco, idempotência e `ops.app_config`.
3. **#19 (`H-006`):** `Concluído` no quadro. Auditoria append-only (`ops.audit_event`), fornecendo a base de logs de revelação e acesso administrativo.
4. **#24 a #28 (`H-011` a `H-015`):** `Concluído` no quadro. Módulo de identidade, sessão do cliente de 7 dias, desafio de login e step-up.
5. **#29 (`H-016`):** `Concluído` no quadro. Cadastro e login do profissional com conta ativa e e-mail verificado.
6. **#30 (`H-017`):** `Concluído` no quadro. Exclusividade de papéis, garantindo que um mesmo usuário não realize autoatendimento em seus próprios pedidos.
7. **#44 (`H-031`):** `Concluído` no quadro. Modelo de pedidos com status `publicado` e prazos de admissão.
8. **#45 (`H-032`):** `Concluído` no quadro. Listas fechadas de visibilidade (`OWNER_KEYS`, `ELIGIBLE_PROFESSIONAL_KEYS`) e generalização de localização.
9. **#46 (`H-033`):** `Concluído` no quadro. Consentimento de contato e revelação de telefone.
10. **#47 (`H-034`):** `Concluído` no quadro. Lista de pedidos do dono (`GET /v1/requests`).
11. **#49 (`H-036`):** `Concluído` no quadro. Perfil profissional, serviços cadastrados, base e raio de atuação presencial.
12. **#50 (`H-037`):** `Concluído` no quadro. Documentos de identidade do profissional, regras de upload e proibição de leitura pelo dono (decisão 170).
13. **#52 (`H-039`):** `Concluído` no quadro. Fila de verificação administrativa e caso de verificação.
14. **#54 (`H-041`):** `Concluído` no quadro. Estado da verificação e recurso do profissional.
15. **#55 (`H-042`):** `Concluído` no quadro. Guarda única de elegibilidade na API e no banco (`private.professional_access_guard`).
16. **#56 (`H-043`):** `Concluído` no quadro. Perfil público do profissional por slug sem sessão.
17. **#57 e #58 (`H-044` e `H-045`):** `Concluído` no quadro. Ativação de trial de 14 dias e acesso comercial derivado (`private.commercial_access`).
18. **#111 a #117 (`H-102` a `H-108`):** `Concluído` no quadro. Suíte administrativa RBAC, MFA compulsório, console admin, dupla aprovação e auditoria.
19. **#118 e #119 (`H-109` e `H-110`):** `Concluído` no quadro. Retenção de dados e expurgos operacionais.
20. **#125 (`H-116`):** `Concluído` no quadro. Testes de injeção e abuso.

### 9.2 Condições de Desenvolvimento Imediato vs Partes que Dependem de Issues Pendentes

1. **Desenvolvimento e Testabilidade Imediatos (Fase Atual):**
   - A especificação integral da matriz de acesso legível por máquina em `packages/access-matrix` pode e deve ser totalmente escrita agora;
   - Os testes de catálogo RLS (T-05: 100% de tabelas com RLS forçado, isolamento de `anon`/`authenticated`, funções `SECURITY DEFINER` com `search_path=''`) podem ser executados e validados imediatamente contra o banco de desenvolvimento existente;
   - Os testes de autorização por recurso (IDOR - T-02) e testes de paridade (T-06) para os módulos já concluídos (Pedidos, Rascunhos, Mídias de pedidos, Perfis profissionais, Documentos de identidade, Acesso comercial/Trial, Administração RBAC, Auditoria) podem ser completamente desenvolvidos e integrados à esteira de testes agora.
2. **Parte que só pode terminar após Issues Pendentes:**
   - A validação ponta a ponta dos testes de paridade para **Chat e Mensagens** (`app.conversation`, `app.message`) requer que as tabelas físicas e endpoints de chat sejam implementados pelas issues #71 (`H-058`), #76 (`H-065`) e #77 (`H-066`), atualmente no Backlog/Product Owner;
   - A validação para ações de **Seleção, Cancelamento e Conclusão** de pedidos requer a entrega das issues #84, #87 e #88;
   - A validação para **Avaliações** requer as issues #96 a #101;
   - Portanto, a suíte de H-115 deve ser estruturada com suporte modular: os cenários das entidades já existentes entram em execução obrigatória e bloqueante imediata, enquanto os cenários das entidades futuras são definidos na matriz de acesso e marcados como *pendentes de implementação física do recurso*, ativando-se automaticamente assim que as respectivas migrações forem aterrissadas.

---

## 10. Riscos e mitigações

| ID | Risco | Severidade / Probabilidade | Mitigação no Desenho e Arquitetura |
|---|---|---|---|
| **R-01** | **Divergência NestJS/API × RLS gera vazamento de dados ou bloqueio indevido.** A API permite um caminho que o banco bloqueia (gerando erro 500 no cliente) ou a API falha na autorização e o banco não possui RLS defensivo (gerando vazamento IDOR). | Alta / Média | Implementação compulsória do princípio *deny vence* e da suíte automatizada de paridade (T-06), alimentada diretamente por `packages/access-matrix`. Qualquer discrepância reprova o build no CI. |
| **R-05** | **Complexidade e degradação de desempenho do RLS no Postgres.** Políticas RLS complexas com múltiplas subconsultas ou junções desacelerando consultas frequentes (ex.: descoberta de pedidos). | Média / Alta | Utilização de índices de suporte nas colunas de partição (`user_id`, `professional_id`, `request_id`), uso de views materializadas/projeções simplificadas e delegação da checagem pesada de elegibilidade a funções especializadas no banco (`private.professional_access_guard`). |
| **R-H115-01** | **Bypass acidental de RLS por uso indevido de conexões com superusuário ou `service_role`.** Se a API conectar ao Postgres com `service_role` ou superusuário, as políticas RLS são ignoradas silenciosamente. | Crítica / Baixa | A conexão principal da API utiliza estritamente o papel `app_api`, explicitamente criado sem o atributo `BYPASSRLS`. Teste estático de configuração e teste de conexão verificam `current_user = 'app_api'` e bloqueiam inicialização se houver elevação. |
| **R-H115-02** | **Vazamento de PII em logs de erro gerados por violações de RLS.** Erros de permissão do banco (SQLSTATE 42501) imprimindo parâmetros da query com dados sensíveis nos logs da aplicação. | Alta / Baixa | Sanitização e mascaramento rigoroso de logs implementados na Issue #20 (`H-007`); a camada de banco captura o erro 42501 e devolve resposta padronizada sem anexar fragmentos de consulta. |
| **R-H115-03** | **Enumeração de recursos via discrepância de códigos HTTP (403 Forbidden vs 404 Not Found).** Atacante descobre se um pedido ou profissional existe testando IDs e comparando respostas 403 (existe, sem acesso) com 404 (não existe). | Alta / Média | Aplicação rígida de resposta uniforme 404 `{ "code": "recurso_nao_encontrado" }` para recursos inexistentes E recursos pertencentes a terceiros, sem variação de tempo mensurável (anti-enumeração / ADR-014). |
| **R-H115-04** | **Regressão silenciosa em migrações futuras.** Uma nova migração cria uma tabela de negócio e esquece de executar `ENABLE ROW LEVEL SECURITY`. | Alta / Média | O teste automatizado de catálogo (CA-H115-02) faz parte do comando `pnpm test` e roda contra o schema completo em cada migração, impedindo merge de código sem RLS forçado. |
| **R-H115-05** | **Superadmin acumulando privilégios e violando segregação de funções.** Administrador com perfil superadmin contornando regras de dupla aprovação de estorno ou realizando tarefas operacionais. | Alta / Baixa | A matriz de permissões RBAC (`ADMIN_ROLE_PERMISSIONS`) e os triggers de banco vetam expressamente operações não concedidas ao papel `superadmin`, garantindo segregação estrita (RF-145). |

---

## 11. Perguntas ao líder com recomendação

Lista de perguntas numeradas de **910 a 929** (faixa oficial atribuída a este refino), cada uma com contexto, alternativas, recomendação fundamentada do PO e o impacto que destrava.

**910. Organização física e exportação da matriz de acesso em `packages/access-matrix`.**
Como os dados e regras da matriz de autorização devem ser estruturados e exportados dentro do pacote `packages/access-matrix`?
- (a) Arquivo canônico `src/matrix.ts` exportando uma estrutura de dados imutável `ACCESS_MATRIX` com tipagem estrita TypeScript, contendo uma lista de regras declarativas `AccessRuleDefinition[]`, acompanhado de funções puras de consulta `canAccess(role, resource, action, context)`.
- (b) Múltiplos arquivos JSON estáticos sem tipagem TypeScript, consumidos via `fs.readFileSync`.
- **Recomendação:** (a). Tipagem estrita em TypeScript garante segurança em tempo de compilação, validação automática por `tsc`, reuso direto tanto na API quanto nos scripts de teste de banco e zero dependência de leitura de disco em tempo de execução. Destrava a implementação de `packages/access-matrix`.

**911. Formato e detalhamento das regras declarativas na matriz de acesso.**
Qual granularidade deve compor cada entrada `AccessRuleDefinition` na matriz?
- (a) Tupla rica contendo: `role` (papel do principal), `resource` (entidade/recurso), `action` (ler, criar, atualizar, excluir, executar), `fields` (lista de campos permitidos na projeção), `forbiddenFields` (campos expressamente proibidos, ex.: e-mail), `condition` (predicado de contexto, ex.: `is_owner`, `is_eligible`, `has_opt_in`), e `expectedHttpCode` (código HTTP esperado, ex.: 200, 403, 404).
- (b) Apenas uma matriz booleana simples de `Role × Action` indicando `true` ou `false`.
- **Recomendação:** (a). Uma matriz booleana simples seria insuficiente para modelar projeções parciais de dados (ex.: profissional elegível vê rótulo, mas não vê telefone nem nome; participante vê nome, mas não vê e-mail). A tupla rica permite testes de contrato de dados exatos. Destrava o esquema da matriz.

**912. Padronização de resposta HTTP anti-enumeração para IDOR (404 uniforme).**
Confirmar a regra de que tentativas de acesso a recursos pertencentes a outro titular (IDOR) devem responder invariavelmente HTTP 404 em vez de HTTP 403.
- (a) Sim: responder HTTP 404 com `{ "code": "recurso_nao_encontrado" }` idêntico em tempo e payload ao recurso verdadeiramente inexistente, impedindo a enumeração da existência de IDs alheios.
- (b) Responder HTTP 403 com `{ "code": "acesso_negado" }` para distinguir erro de posse de erro de existência.
- **Recomendação:** (a). Segue a política institucional de anti-enumeração e segurança ofensiva do FastPro (ADR-014, `08` §5.3, e decisões prévias da Issue #45). Destrava CA-H115-05, CA-H115-06 e os testes de IDOR.

**913. Convenção de variáveis de contexto de sessão no PostgreSQL via `set_config`.**
Quais nomes de variáveis de configuração de sessão devem ser padronizados para injeção transacional do principal via `SET LOCAL`?
- (a) `app.principal_id` (UUID ou identificador do usuário), `app.principal_type` (`customer`, `professional`, `admin`, `anonymous`), `app.aal` (`aal1`, `aal2`), e `app.sid` (identificador da sessão).
- (b) Utilizar apenas `request.jwt.claim.sub` simulando PostgREST.
- **Recomendação:** (a). Alinhado com a arquitetura definida em `08` §4.2 e já utilizada nas migrações administrativas existentes no repositório, garantindo independência de formato e pleno controle pelo código da API. Destrava os adaptadores de banco e CA-H115-04.

**914. Comportamento do banco sob `app_api` na ausência de injeção de contexto.**
Qual deve ser a resposta do banco de dados caso uma consulta seja executada como `app_api` sem a emissão prévia de `SET LOCAL app.principal_id`?
- (a) *Default-deny* total: as políticas RLS tratam o principal como nulo e a consulta retorna 0 linhas (ou erro 42501 em mutações), garantindo que um esquecimento na API nunca resulte em vazamento de dados.
- (b) Acesso total aos dados por padrão.
- **Recomendação:** (a). É o pilar basilar de segurança do ADR-002: *fail-closed*. Se o contexto não for explicitamente injetado, o banco não entrega nenhuma linha. Destrava a redação das políticas RLS e CA-H115-04.

**915. Classificação e severidade de divergência encontrada pela suíte de paridade.**
Como o sistema de CI e testes deve reagir caso a suíte de paridade detecte que a API autoriza uma operação que o RLS do banco nega, ou vice-versa em caminho exposto?
- (a) Falha mandatória e bloqueante de severidade P1/Alta: o comando `pnpm test` aborta com código de saída diferente de zero, bloqueando pull requests e releases.
- (b) Apenas registrar um alerta informativo no log de auditoria, mantendo o build verde.
- **Recomendação:** (a). Divergência entre aplicação e banco é a causa primária do risco R-01; conforme estipulado em `11-ARQ-RISCOS-E-TESTES.md` (§R-01), falha em T-05/T-06 exige bloqueio categórico de release. Destrava o critério de qualidade de CI.

**916. Teste de catálogo RLS: escopo dos esquemas inspecionados.**
Quais esquemas do PostgreSQL devem ser submetidos à verificação compulsória de `FORCE ROW LEVEL SECURITY`?
- (a) Todos os esquemas de aplicação e negócio: `app`, `billing` e `ops` (excluindo apenas esquemas internos de infraestrutura como `pg_catalog`, `information_schema` e extensões).
- (b) Apenas o esquema `app`.
- **Recomendação:** (a). Tabelas de faturamento (`billing`) e tabelas operacionais/auditoria (`ops`) armazenam informações tão críticas quanto o domínio de pedidos; todas devem possuir RLS ativo e forçado. Destrava CA-H115-02.

**917. Revogação de privilégios públicos para as roles `anon` e `authenticated`.**
Confirmar se os testes de catálogo devem validar que as roles nativas do Supabase (`anon` e `authenticated`) possuem zero grants de tabela nos esquemas `app`, `billing` e `ops`.
- (a) Sim: validação estrita de que `anon` e `authenticated` não possuem permissões diretas de tabela, operando exclusivamente via canais Realtime ou rotas intermediadas pela API Node.
- (b) Não: permitir grants de leitura pública para tabelas selecionadas.
- **Recomendação:** (a). Garante que clientes mal-intencionados utilizando o token de chave anônima da Supabase não consigam consultar diretamente a API de dados (PostgREST) contornando a API do FastPro. Destrava CA-H115-03.

**918. Tratamento de entidades e rotas cujo desenvolvimento físico ainda está pendente (Chat, Seleção, Avaliações).**
Como a suíte de testes de paridade de H-115 deve tratar recursos que estão especificados na matriz, mas cujas tabelas ainda não foram aterrissadas por issues pendentes (#71, #84, #96)?
- (a) Execução modular: a matriz de acesso descreve todos os recursos do PRD; a suíte de testes executa asserções ativas sobre todos os recursos já implementados e marca os recursos pendentes com flag `deferred` (ou `skipIfTableMissing`), documentando a pendência e garantindo que os testes existentes passem com saída 0 no DEV.
- (b) Falhar a suíte inteira até que todas as 124 histórias do backlog sejam concluídas.
- **Recomendação:** (a). Permite entregar a suíte de paridade imediatamente para o núcleo já existente (identidade, pedidos, fotos, perfis, verificação, billing, admin), sem bloquear o avanço das frentes atuais da fábrica. Destrava a execução de testes em DEV.

**919. Varredura estática de PII e sentinelas na verificação de blindagem de dados.**
Como a suíte de testes deve comprovar que nenhum e-mail ou dado proibido de cliente vaza para profissionais (Invariante I-16 / T-11)?
- (a) Uso de fixtures com sentinelas sintéticos padronizados (ex.: `sentinela-cliente-email@fastpro.test`, `+5511999998888`) e validação via asserção recursiva de esquemas e busca por substring em toda a árvore de resposta JSON e colunas SQL retornadas.
- (b) Verificação manual amostral de tela.
- **Recomendação:** (a). Elimina subjetividade, garante verificação 100% automatizada e reprodutível e impede regressões acidentais em serializers da API. Destrava CA-H115-11.

**920. Proteção contra visualização direta de fotos e documentos no Storage.**
Qual política de acesso direto ao Supabase Storage deve ser conferida nos testes de paridade?
- (a) Nenhum bucket de mídia (`request-photos`, `identity-docs`) possui políticas públicas de leitura em `storage.objects`; o acesso ocorre exclusivamente através de URLs assinadas de curta duração geradas pela API Node após validação da matriz de autorização.
- (b) Tornar o bucket de fotos do pedido público.
- **Recomendação:** (a). Cumpre rigorosamente a decisão ADR-009 e os critérios FA-007/FA-008, impedindo raspagem descontrolada de fotos e garantindo que marcas d'água sejam sempre aplicadas. Destrava a auditoria de storage.

**921. Validação de MFA `aal2` para rotas administrativas no banco.**
As funções administrativas no banco (`private.admin_*`) devem checar ativamente o nível de MFA injetado?
- (a) Sim: as funções administrativas verificam se `current_setting('app.aal', true) = 'aal2'`, lançando exceção SQLSTATE 42501 caso o nível seja inferior, atuando como defesa em profundidade da checagem da API.
- (b) Delegar a validação de MFA exclusivamente à rota da API Node.
- **Recomendação:** (a). Alinhado ao princípio de autorização em duas camadas do ADR-002: mesmo que um invasor consiga forjar uma requisição na API sem validar o segundo fator, o banco rejeita a operação. Destrava CA-H115-15.

**922. Tratamento da proibição de leitura de documentos de identidade pelo próprio profissional (Decisão 170).**
Confirmar se a suíte de paridade deve validar que o profissional dono dos documentos de identidade recebe negação caso tente baixar ou visualizar os arquivos após o envio.
- (a) Sim: o profissional pode enviar (`POST`) e substituir documentos enquanto a verificação estiver pendente, mas não pode baixá-los nem inspecioná-los via API (decisão 170); a leitura é exclusiva da equipe de Verificação no âmbito de caso atribuído.
- (b) Permitir que o profissional baixe seus documentos a qualquer momento.
- **Recomendação:** (a). Preserva a integridade da decisão 170 já homologada na história #50 e validada em QA. Destrava CA-H115-10.

**923. Proibição de autoatendimento (Cliente e Profissional no mesmo `app_user`).**
Como a matriz e a suíte de paridade devem validar o caso em que um usuário tenta aceitar como profissional o pedido que ele mesmo criou como cliente?
- (a) Negação categórica: a tentativa de aceite devolve erro de regra de negócio na API e é bloqueada por trigger no banco (`app_user` cliente == `app_user` profissional), conforme Issue #30 (`H-017`) e Invariante I-19.
- (b) Permitir autoatendimento para testes.
- **Recomendação:** (a). Invariante de integridade central do produto; impede fraudes de consumo de trial, geração de avaliações fictícias e manipulação de métricas. Destrava CA-H115-05.

**924. Teste de isolamento de casos sensíveis (`access_case`) para administradores.**
Qual requisito deve ser exigido para que um administrador consiga ler documentos de identidade ou dados restritos de usuários?
- (a) Presença obrigatória de um registro em `app.admin_access_case` em estado `aberto`, com justificativa preenchida e identificador do colaborador, gerando registro correspondente em `ops.audit_event`.
- (b) Administrador autenticado com MFA lê livremente qualquer recurso sem justificativa.
- **Recomendação:** (a). Atende rigorosamente ao requisito do PRD RF-148 ("sem navegação livre") e critério FA-031, assegurando trilha de auditoria completa em conformidade com a LGPD. Destrava CA-H115-16.

**925. Teste da segregação do papel Auditor (Imutabilidade de auditoria).**
Confirmar que o papel `auditor` deve ser testado contra comandos de mutação em todas as tabelas de dados.
- (a) Sim: a suíte executa tentativas explícitas de `INSERT`, `UPDATE` e `DELETE` em `ops.audit_event` e tabelas de domínio operando com as credenciais do Auditor, comprovando que o banco rejeita 100% das escritas.
- (b) Apenas testar que a consulta `SELECT` funciona.
- **Recomendação:** (a). Prova a integridade e conformidade da segregação de funções exigida por compliance e auditoria externa (RF-154 e I-15). Destrava CA-H115-18.

**926. Verificação de funções `SECURITY DEFINER` com `search_path` vazio.**
Confirmar se o teste de catálogo deve varrer todas as funções `SECURITY DEFINER` e reprovar caso alguma possua `search_path` omitido ou vulnerável.
- (a) Sim: consulta automática em `pg_proc` validando que `prosecdef = true` exige impreterivelmente `proconfig` contendo `search_path=''`.
- (b) Teste opcional ou manual.
- **Recomendação:** (a). Evita vetores clássicos de injeção e sequestro de privilégios em PostgreSQL, conforme boas práticas de segurança consolidadas nas decisões da fábrica. Destrava CA-H115-19.

**927. Formato do script de execução dos testes de paridade no repositório.**
Como a suíte de testes de paridade deve ser integrada aos scripts do monorepo Turborepo?
- (a) Script dedicado em `packages/db/tests/authorization-parity.dbtest.mjs` (ou suíte em `packages/access-matrix`) acionável via `pnpm test` e integrado à esteira de CI, operando com conexões reais com rollback transacional (`tx()`) no banco de desenvolvimento.
- (b) Script isolado que só roda manualmente quando solicitado.
- **Recomendação:** (a). Garante que a paridade seja aferida continuamente a cada commit, prevenindo regressões silenciosas durante o desenvolvimento das próximas histórias. Destrava a engenharia de testes.

**928. Localização dos arquivos da suíte no monorepo.**
Onde devem ser organizados o módulo comparador e os executores de paridade?
- (a) O motor declarativo e os tipos em `packages/access-matrix/src/`; os testes de paridade de banco em `packages/db/tests/`; e os testes de rota HTTP da API em `apps/api/test/` ou integrados via adaptador.
- (b) Todos os arquivos centralizados na raiz do repositório.
- **Recomendação:** (a). Respeita rigorosamente a divisão de responsabilidades da arquitetura monorepo e as fronteiras de pacotes do FastPro. Destrava a organização do desenho pelo Arquiteto.

**929. Condição de transição e saída da Issue #124 no quadro.**
Confirmar o critério de transição de H-115 no quadro da fábrica:
- (a) A etapa de Product Owner se encerra com a aprovação deste refino e adoção das decisões 910 a 929 pelo líder; a etapa de Arquitetura desenhará o motor da matriz e os testes de paridade; o Desenvolvimento entregará a matriz completa e a suíte para os módulos concluídos, tornando-se o gate permanente de segurança para os releases subsequentes.
- (b) Reter H-115 em Product Owner até que todas as histórias de chat e faturamento estejam terminadas.
- **Recomendação:** (a). Conforme comprovado na verificação de fila, os alicerces de pedidos, perfis, verificação e administração já estão prontos; postergar H-115 privaria a fábrica do mecanismo central de defesa em profundidade e detecção de IDOR. Destrava o fluxo de avanço para Arquitetura.

---

## 12. Próximos passos

1. **Revisão pelo Líder (Orquestrador):** O líder valida a delimitação de escopo, confirma o modelo de paridade em duas camadas (API e RLS) e consolida a adoção das recomendações para as perguntas **910 a 929** no próximo registro consolidado de `11-DECISOES.md`.
2. **Transição de Quadro:** A Issue #124 é movimentada da coluna "Product Owner" para a coluna "Arquitetura" pelo Orquestrador.
3. **Desenho de Arquitetura:** O Arquiteto produz `docs/factory/162-DESENHO-H115.md` especificando:
   - A tipagem e interfaces exatas em `packages/access-matrix/src/`;
   - O contrato do executor de paridade e do comparador de divergências;
   - O plano de migração ou ajuste de políticas RLS em tabelas que requeiram refinamento de predicados;
   - A estratégia de fixtures com rollback no banco de desenvolvimento para os testes de catálogo e IDOR.
4. **Desenvolvimento (DEV):**
   - Implementação das regras e tipos em `packages/access-matrix`;
   - Implementação e execução da suíte de catálogo RLS (T-05), garantindo 100% de conformidade com *default-deny*;
   - Implementação da suíte de testes de paridade (T-06) e IDOR (T-02) cobrindo todos os módulos concluídos;
   - Geração de evidências reais com saída 0 em ambiente DEV.
5. **Code Review e QA:** Validação da ausência de divergências em caminhos expostos, conformidade estrita com o princípio do menor privilégio e blindagem absoluta de dados pessoais de clientes e profissionais.
