# Refino H-114 — Runbook de incidente e reconciliação (Issue #123)

- **Issue:** #123 `[E13] Runbook de incidente e reconciliação` · **História:** H-114 · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner (primeira coluna do quadro).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-14.
- **EXEC-ID:** não atribuído (não informado pelo líder).
- **Natureza:** somente documento. Nenhum código, migração, teste, comando de banco de dados ou alteração no quadro foi realizado. O cartão permanece em Product Owner até decisão humana/Orquestrador.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[PENDENTE JURIDICO]` matéria dependente de parecer jurídico/DPO (L1, L2), com modelo proposto no DEV · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes consultadas:
- `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`.
- `docs/factory/quadro-status.md` (atualizado no repositório em 2026-11-14).
- `docs/factory/21-ISSUES-CRIADAS.md` (mapeamento de H-114 para a Issue #123).
- `docs/factory/14-BACKLOG.md` (linhas H-114, E13, D-04 a D-07, D-09, H-047 a H-053 / Issues #60 a #66, H-005, H-006, H-008, H-010, H-045, H-046, H-092 a H-094, H-109, H-110).
- `docs/factory/04-PRD.md` (RF-058, RF-060, RF-140, RF-145 a RF-148, RF-151, RF-154, RNF-EMAIL, §4 Fora de escopo).
- `docs/factory/05-CRITERIOS-ACEITE.md` (FA-006, FA-030, FA-031, FA-032).
- `docs/factory/08-ARQUITETURA.md` (§1.1 Princípios, §4.2 Papéis e permissões, §7 Concorrência e idempotência, §8 Billing e reconciliação §8.8, §12 Notificações e cotas, §13 Segurança e acesso excepcional, §14 Observabilidade, §16 Infraestrutura).
- `docs/factory/09-MODELO-DADOS.md` (§3.8 `dsr_case`, §3.10 `access_grant` e pagamentos, §4 Auditoria imutável, §8 Classes de retenção, §10 Expurgos operacionais).
- `docs/factory/10-ADRS.md` (ADR-007 Billing e reconciliação diária, ADR-011 Notificações e cotas, ADR-012 RBAC e MFA, ADR-013 Observabilidade sem PII, ADR-016 Retenção e expurgo, ADR-020 Gestão de limites e custos gratuitos).
- `docs/factory/11-ARQ-RISCOS-E-TESTES.md` (§9 Plano de recuperação D-01 a D-09, §9b Casos B-01 a B-10, R-07, R-08, R-09, R-21, R-28, R-34, I-14, I-20, I-24, I-25).
- `docs/factory/11-DECISOES.md` (Rodadas até a 127; em especial Rodada 12 decisão 27 de cotas e habilitação de e-mails, Rodada 67 sobre remoção de histórico de acesso a fotos, Rodada 73 sobre remoção definitiva de backup de dados do projeto, Rodada 74 sobre proibição irrevogável de Mapbox, Rodadas 75/81 sobre fechamento da #151 e formalização das lápides D-01, D-02, D-03 e D-08, Rodada 83 sobre recusa de rotação de senhas de banco de desenvolvimento, Rodada 84 sobre veto a rediscussões de escopos extintos, e Rodada 127 autorizando início de #123 em Product Owner).
- `docs/factory/15-RASTREABILIDADE.md` e `docs/factory/16-MANIFESTO-ISSUES.md` (Item 125).
- Modelos e referências: `docs/factory/108-RUNBOOK-TTL-EXPURGOS.md` (modelo de runbook operacional), `docs/factory/113-REFINO-H045.md` (rigor e estrutura de PO), `docs/factory/144-REFINO-H111.md` e `docs/factory/145-REFINO-H122.md`.

Limitações `[NÃO VERIFICADO]`:
- O texto da Issue #123 no GitHub não foi lido por consulta a rede externa (este agente opera estritamente em ambiente sandbox sem comando de rede e sem chamada `gh`). O escopo, limites e invariantes foram reconstruídos a partir da linha H-114 do backlog, do plano de recuperação de arquitetura (§9) e das decisões canônicas consolidadas.
- Nenhum comando de banco de desenvolvimento (`db:migrate`, `db:test`, consultas SQL interativas) foi executado, preservando o estado do banco.
- **Backup de dados está estritamente FORA do escopo:** em estrito cumprimento às decisões 349 a 358 e à Issue #151 concluída, nenhuma menção, procedimento ou dependência de backup, dump, restauração de cópia ou exportação de banco de dados é introduzida neste refinamento. Direitos do titular (`dsr_case`) e keep-alive (`app_keepalive`) não são backup.
- **Mapbox é terminantemente PROIBIDO:** nenhuma instrução, procedimento ou chave faz referência ao Mapbox real (decisão da Rodada 74).
- **Senhas de banco de desenvolvimento NÃO são rotacionadas:** conforme decisão do usuário na Rodada 83 (pergunta 150), nenhuma rotação de credenciais de banco é proposta ou exigida.

---

## 1. Verificação de fila e status

- `[VERIFICADO]` O quadro oficial em `docs/factory/quadro-status.md` lista a Issue #123 (`[E13] Runbook de incidente e reconciliação`) na coluna **Product Owner (5)**. A etapa de refino de PO é a etapa canônica devida.
- `[VERIFICADO]` Issues Concluídas conferidas no quadro e no histórico recente: **#43, #44, #50, #52, #57, #58, #59, #36, #119, #141, #150, #151**.
- `[VERIFICADO]` Em Desenvolvimento e QA no quadro: #54, #55 (parte A), #56, #47 (Desenvolvimento); #37 (QA).
- `[VERIFICADO]` Dependência declarada em `14-BACKLOG.md` (linha 269):
  - **H-053 (Issue #66 — Reconciliação diária MP × livro):** atualmente em `Backlog (62)`.
  - A cadeia de pagamentos completa do épico E5 (#60 a #66) encontra-se em `Backlog (62)`:
    - #60 (H-047 — Checkout Mercado Pago Pix e cartão)
    - #61 (H-048 — Webhook MP idempotente)
    - #62 (H-049 — Concessão paga e início de período)
    - #63 (H-050 — Carência de 72 h)
    - #64 (H-051 — Adesão ao cartão e Pix manual)
    - #65 (H-052 — Cancelamento com acesso até o fim)
    - #66 (H-053 — Reconciliação diária MP × livro)
  - Em contrapartida, as histórias de base de billing e dados já estão **Concluídas**:
    - **H-045 (#58 — Acesso comercial derivado):** concluída, tabela `access_grant` e função `commercial_access` prontas no banco.
    - **H-046 (#59 — Planos e preços em centavos):** concluída, tabela `plan_price` pronta no banco.
    - **H-005 (#18 — Esqueleto de banco e outbox):** concluída.
    - **H-006 (#19 — Auditoria imutável):** concluída, `audit.audit_event` append-only operando.
    - **H-008 (#21 — Tick de jobs):** concluída.
    - **H-010 (#27 — Keep-alive e monitoramento de inatividade):** concluída, tabela `ops.app_keepalive`.
    - **H-094 (#58/86 — Cota do Resend e controle de limiares):** desenho consolidado, tabela `ops.rate_counter`.
    - **H-109 (#118) e H-110 (#119 — Expurgos operacionais e retenção):** concluídas.
- `[VERIFICADO]` Decisão 367 (`11-DECISOES.md` Rodada 75): a dependência direta entre H-114 e H-010 pelo motivo de backup foi expressamente removida. H-114 consome o keep-alive apenas como controle operacional de pausamento do projeto Supabase Free (cenário D-04).
- `[VERIFICADO]` Numeração contínua de decisões e perguntas ao líder: o refino anterior de H-122 encerrou na pergunta 702. As perguntas deste refino iniciam estritamente em **703** e encerram em **722** (20 perguntas numeradas ao líder).

---

## 2. Objetivo

Formalizar e estruturar o **Runbook Operacional de Resposta a Incidentes Técnicos, Segurança e Reconciliação de Dados** da plataforma FastPro (Issue #123 / História H-114), provendo procedimentos executáveis, determinísticos e auditáveis para os cenários críticos de recuperação de arquitetura (D-04, D-05, D-06, D-07 e D-09) e para os processos de reconciliação de dados entre a plataforma e serviços externos (Mercado Pago, Resend e Supabase Auth).

O runbook assegura que:
1. Incidentes de infraestrutura gratuita (pausa do banco Supabase Free, D-04) sejam detectados e contornados rapidamente sem corrupção ou perda de estado operacional.
2. Falhas em implantações ou migrações (D-05) sejam tratadas de forma controlada via compensação progressiva (expand-and-contract) sem quebras de serviço.
3. Rotações de chaves e segredos (D-06) ocorram com versionamento e tolerância a dupla chave, sem indisponibilidade de rotas e sem perda de capacidade de leitura de dados criptografados legados.
4. Violações ou suspeitas de comprometimento de contas administrativas (D-07) sejam neutralizadas de imediato com revogação forçada de sessões, redefinição de MFA com quórum e trilha de auditoria inviolável.
5. Incidentes de segurança e vazamentos de dados pessoais (D-09) sigam fluxo rigoroso de contenção técnica imediata, apuração de escopo e comunicação regulatória à ANPD e titulares `[PENDENTE JURÍDICO]`.
6. A reconciliação diária de pagamentos (H-053) compare o livro financeiro com os registros do provedor e notifique o operador humano do Financeiro, mantendo a invariante absoluta de **nunca alterar o acesso comercial de forma automática**.
7. As discrepâncias de cotas e filas de notificações e de contas entre Auth e Postgres sejam reconciliadas e sanadas sem duplicidade de disparos ou reenvio retroativo de mensagens obsoletas.

---

## 3. Escopo (dentro de H-114)

1. **Procedimento D-04 (Pausa e Indisponibilidade de Instância Supabase Free):**
   - Protocolo de detecção de congelamento/pausa da instância por inatividade de 7 dias.
   - Procedimento de restauração/unpause via console ou disparo externo de contingência.
   - Verificação pós-restauração da saúde do banco, execução do tick de jobs (`ops.job`), integridade dos gatilhos de auditoria e validação da tabela `ops.app_keepalive`.
2. **Procedimento D-05 (Falha de Migração e Desvio de Schema):**
   - Protocolo de contenção para migrações interrompidas ou que falhem durante a aplicação em staging/produção.
   - Diretrizes de rollback por compensação (expand-and-contract) evitando `DROP` destrutivo de colunas com dados vivos.
   - Diagnóstico e saneamento de desvios de checksum em `ops.schema_migration` e reconciliação segura de status `db:status`.
3. **Procedimento D-06 (Rotação Versionada de Segredos e Chaves Operacionais):**
   - Rotação de credenciais de integração com Mercado Pago (`MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`) e e-mail transacional (`RESEND_API_KEY`).
   - Rotação de chaves de criptografia de envelope AES-256-GCM (`ADDRESS_ENC_KEY`, chaves de cofre de telefone/contato `phoneVault`), com suporte a versionamento (`key_id`), janela de tolerância de dupla chave e rotina de re-encriptação progressiva.
   - Rotação de segredos de autenticação (peppers de HMAC e assinatura de cookies/sessões) sem derrubada abrupta e generalizada de usuários legítimos.
4. **Procedimento D-07 (Comprometimento de Credenciais e Acesso Administrativo):**
   - Ação imediata de isolamento: revogação forçada de sessões ativas do operador afetado (`admin.session`, atualização de status ou bloqueio de `app_user`).
   - Procedimento de reset de credencial e redefinição de segundo fator (`aal2` / MFA), exigindo dupla aprovação de outro administrador (`Superadmin` / `Auditor`).
   - Rastreamento forense e geração de relatório de atividades na trilha de auditoria append-only (`audit.audit_event`), apurando visualizações excepcionais de dados sensíveis ou ações indevidas.
5. **Procedimento D-09 (Resposta a Incidente de Segurança e Vazamento de Dados Pessoais):**
   - Vetores de detecção técnica: anomalias em volume de leitura de tabelas de PII, disparos anormais de erros RLS (SQLSTATE `42501`), vazamento inadvertido de dados em logs de produção, e alertas de raspagem.
   - Contenção técnica em minutos: revogação cautelar de credenciais, corte de rota afetada via `ops.app_config`, suspensão de contas comprometidas e isolamento do vetor de intrusão.
   - Avaliação técnica preliminar do escopo e severidade: volume de titulares expostos, classes de dados envolvidas (contatos, documentos de identidade, endereços exatos).
   - Fluxo de comunicação e notificação: protocolo interno para acionamento do DPO/Jurídico e modelo padronizado de notificação à ANPD e titulares `[PENDENTE JURÍDICO]`.
6. **Procedimento de Reconciliação Financeira MP × Livro (Antecipação e Contrato para H-053):**
   - Definição da matriz de discrepâncias entre eventos/pagamentos do gateway e o livro local (`access_grant`, `payment`, `subscription`).
   - Especificação do relatório diário para o Financeiro (`reconciliation_report`), categorizando divergências:
     - Pagamento aprovado no gateway sem registro correspondente no livro local (webhook perdido).
     - Concessão de acesso ativa sem cobrança regular confirmada no gateway.
     - Assinatura cancelada no gateway mas com concessão divergente no livro.
     - Valores monetários discrepantes entre o plano configurado e a liquidação no gateway.
   - **Regra de ouro e invariante:** nenhuma discrepância é corrigida automaticamente no acesso do usuário pelo job de conciliação; qualquer ajuste demanda decisão e intervenção manual fundamentada de operador do papel Financeiro (`access_adjustment`, RF-060, 08 §8.8).
   - Cobertura da fase atual (antes de #60 a #66): definição de dados sintéticos, simulações de relatórios e testes de tolerância para quando as histórias de pagamento forem desenvolvidas.
7. **Procedimento de Reconciliação Operacional de E-mails e Cotas (Resend):**
   - Monitoramento de cotas diárias (100/dia) e mensais (3.000/mês), rastreando limiares de 70% e 85%, corte de classe aos 90% e preservação do piso de 10% exclusivo para `auth` (H-094).
   - Reconciliação do contador de uso local (`ops.rate_counter`) contra os envios reais registrados no Resend, mitigando o consumo silencioso gerado pelo Supabase Auth/SMTP (risco R-5 de H-097).
   - Procedimento de destravamento de fila represada em `ops.email_outbox` após indisponibilidade temporária do provedor, com reavaliação de contexto e expurgo definitivo de mensagens obsoletas (proibição irrevogável de reenvio de aceites antigos).
8. **Procedimento de Reconciliação de Identidades (Auth × Postgres):**
   - Verificação periódica de integridade referencial entre o catálogo de usuários do Supabase (`auth.users`) e as entidades de domínio (`identity.app_user`, perfis profissionais e de clientes).
   - Detecção e saneamento de registros órfãos decorrentes de transações interrompidas durante a jornada de cadastro/login sem quebra de integridade referencial.
9. **Especificação de Exercício Sintético com Evidência:**
   - Procedimentos de simulação controlada para cada cenário (D-04 a D-07, D-09 e reconciliações) utilizando registros sintéticos com marcadores formais de teste, sem rede externa e sem envio real.

---

## 4. Fora de escopo

- **Backup de dados e rotinas de restauração de banco de dados:** terminantemente FORA DO ESCOPO do projeto FastPro em qualquer ambiente (decisão do usuário na Rodada 73, decisões 349 a 358 e Issue #151 concluída). Cópias, dumps, papéis de backup e scripts legados de backup não fazem parte desta história. Direitos do titular (`dsr_case`) e keep-alive (`app_keepalive`) não constituem backup.
- **Integração ou chamadas ao Mapbox:** terminantemente PROIBIDO em qualquer ambiente (decisão da Rodada 74). Nenhuma rotação de segredo ou contingência de Mapbox deve ser incluída.
- **Rotação de senhas do banco de desenvolvimento:** expressamente RECUSADA pelo usuário na Rodada 83 (pergunta 150).
- **Implementação dos fluxos de checkout e webhook do Mercado Pago (H-047 a H-052):** pertencem às Issues #60 a #65 do épico E5, em Backlog. H-114 define o runbook e os critérios de reconciliação, mas não implementa a cobrança.
- **Construção do motor executável do job de reconciliação de billing:** pertence estritamente a H-053 (#66). H-114 especifica o protocolo operacional, matriz de batimento e contrato de dados.
- **Implementação do motor e telas de direitos do titular (`dsr_case`):** pertence a H-111 (Issue #120).
- **Implementação de fluxos de estorno e chargeback manual na API/UI:** pertence a H-105 e H-106.
- **Contratação de planos pagos de infraestrutura (Vercel Pro, Supabase Pro):** condicionados aos Gates M4 / H-054. H-114 opera estritamente nos limites dos planos gratuitos vigentes.
- **Disparo de notificações reais ou e-mails a titulares durante testes:** testes utilizam apenas dados sintéticos e fakes locais, sem acionamento externo.

---

## 5. Fluxos e procedimentos operacionais

```
+---------------------------------------------------------------------------------------------------+
|                           RUNBOOK OPERACIONAL FASTPRO (H-114 / #123)                              |
+---------------------------------------------------------------------------------------------------+
|  [D-04] Supabase Pausado     --> Detecção Heartbeat --> Unpause Console --> Checagem Tick/Auditoria|
|  [D-05] Falha de Migração    --> Freeze Deploy --> Diagnóstico Checksum --> Rollback Compensatório |
|  [D-06] Rotação de Segredos  --> Chave Dupla (Key-ID) --> Deploy Novo Segredo --> Invalidação Antiga|
|  [D-07] Admin Comprometido   --> Kill Sessões (`aal2`) --> Reset MFA Dupla Aprov --> Trilha Audit  |
|  [D-09] Vazamento de Dados   --> Contenção RLS/Config --> Apuração Escopo --> Parecer DPO/ANPD    |
|  [Reconciliação MP x Livro]  --> Batimento Diário --> Relatório Financeiro --> Ajuste Humano Somente |
|  [Reconciliação de E-mails]  --> Alertas 70/85/90% --> Scrub de Obsoletos --> Destrave Fila Resend |
|  [Reconciliação Auth x Banco]--> Varredura de Órfãos --> Compensação de Cadastro                   |
+---------------------------------------------------------------------------------------------------+
```

### 5.1 Procedimento D-04: Projeto pausado / indisponível (Supabase Free)

O plano gratuito do Supabase suspende projetos inativos após 7 dias corridos sem conexões ativas.

1. **Sintoma / Detecção:**
   - Requisições da API falham com erros de conexão (DNS ou recusa TCP no pooler/banco de dados).
   - O indicador de keep-alive (`ops.app_keepalive`) registra última atualização com atraso superior a 24 horas.
2. **Ação Operacional de Descongelamento (Unpause):**
   - O operador acessa o console do Supabase e aciona "Restore project" / "Unpause".
   - O processo de restauração de contêiner leva tipicamente de 2 a 5 minutos.
3. **Verificação de Pós-Restauração:**
   - Conectar via ferramenta administrativa e conferir conectividade e permissões.
   - Verificar integridade da tabela de keep-alive:
     ```sql
     select last_ping_at, updated_at from ops.app_keepalive where id = 1;
     ```
   - Conferir se a extensão `pg_cron` (se ativa) retomou o agendamento de jobs em `cron.job`.
   - Conferir se o dispatcher de jobs da API (`registerOpsPurgeHandlers` e ticks) processa a fila de outbox represada sem gargalos ou deadlocks.
   - Validar integridade dos gatilhos de vedação e imutabilidade de `audit.audit_event` (`tgenabled = 'A'`).

### 5.2 Procedimento D-05: Migração malsucedida (Rollback por compensação)

Falha na execução de scripts de migração estrutural (`db:migrate`) em ambiente de staging ou desenvolvimento.

1. **Sintoma / Detecção:**
   - O comando de migração aborta com erro SQL (ex: violação de constraint, sintaxe, conflito de tipos).
   - `db:status` aponta migração com falha, checksum inconsistente ou estado pendente/divergente.
2. **Diretrizes de Rollback e Compensação:**
   - **Princípio Expand-and-Contract:** nenhuma migração em produção deve remover tabelas ou colunas diretamente na mesma versão em que o código novo é liberado.
   - Em caso de falha durante a execução de migração nova que não completou:
     - Se a migração foi transacional (DDL em bloco único), o Postgres reverte as alterações automaticamente.
     - Se o erro gerou resíduos ou alterou `ops.schema_migration`, criar imediatamente uma migração compensatória corretiva (`expand`), em vez de tentar editar arquivos de migração já registrados (evitando erro de checksum adulterado, conforme histórico da Rodada 88).
3. **Reconciliação de Schema:**
   - Garantir que o prefixo temporal da nova migração compensatória respeite a regra do monorepo (`maior prefixo existente + 10000`).
   - Reexecutar `corepack pnpm db:migrate` e confirmar `0 pendentes` com integridade de todos os testes regressivos (`corepack pnpm db:test`).

### 5.3 Procedimento D-06: Rotação de segredos operacionais e chaves de criptografia

Procedimento para substituição planejada ou emergencial de credenciais e chaves criptográficas.
*(Nota: não se aplica a senhas do banco de desenvolvimento, recusadas pela decisão 150 / Rodada 83, nem ao Mapbox, permanentemente proibido).*

1. **Chaves de Criptografia de Envelope AES-256-GCM (`ADDRESS_ENC_KEY`, chaves de cofre de contatos):**
   - **Suporte a Versionamento de Chaves:** as funções de decodificação devem suportar identificadores de versão (prefixo de versão no payload criptografado, ex: `v1:...`, `v2:...`).
   - **Passo 1 (Carga da Nova Chave):** configurar a nova chave como chave primária de escrita e manter a chave anterior como chave secundária de leitura no arquivo de configuração do ambiente (`.env.local` / secrets do provedor).
   - **Passo 2 (Deploy do Código):** implantar a versão da aplicação que lê ambas as versões e cifra novos registros apenas com a chave nova.
   - **Passo 3 (Re-encriptação progressiva / Backfill):** rotina em background lê registros cifrados com a chave antiga, decifra e recifra com a chave primária.
   - **Passo 4 (Desativação da Chave Antiga):** após conferência de que zero registros utilizam a chave legada, remover a chave antiga do ambiente.
2. **Tokens de Integração de Serviços (Mercado Pago e Resend):**
   - Gerar o novo token no painel do provedor externo.
   - Atualizar a variável de ambiente correspondente (`MP_ACCESS_TOKEN`, `RESEND_API_KEY`).
   - Realizar disparo de teste sintético para validar aceitação da credencial.
   - Revogar o token antigo no painel do provedor.
3. **Peppers de Autenticação e Hashes:**
   - A rotação de peppers de documento (HMAC de CPF/CNPJ) ou segredos de sessão exige revalidação progressiva na autenticação do usuário, mantendo suporte temporário ao hash anterior para migração em tempo de login.

### 5.4 Procedimento D-07: Comprometimento de conta administrativa

Suspeita ou confirmação de que credenciais ou dispositivo MFA de operador com perfil administrativo foram comprometidos.

1. **Ação Imediata de Contenção (T0 a T+5 min):**
   - **Revogação de Sessão em Massa:** executar a revogação forçada de todas as sessões ativas do identificador do usuário afetado:
     ```sql
     -- Exemplo conceitual de revogação imediata
     update identity.app_user
     set status = 'bloqueada', updated_at = now()
     where id = '<admin_user_id>';
     ```
   - Invalidação de todos os tokens de sessão emitidos (`aal2`), forçando desconexão imediata nas APIs protegidas.
2. **Redefinição de Fatores com Dupla Aprovação (T+5 min a T+30 min):**
   - A redefinição de fatores MFA e desbloqueio de contas administrativas exige aprovação cruzada (quórum de duas identidades com papéis `Superadmin` / `Auditor`, RF-145, FA-031).
   - Geração de novas sementes TOTP/MFA em canal seguro e auditado.
3. **Investigação e Auditoria Forense (T+30 min a T+2 h):**
   - Consultar a tabela imutável `audit.audit_event` filtrando as ações executadas pelo ator comprometido no intervalo suspeito:
     - Registros com ação `admin.access_case.created` ou `admin.access_case.viewed` (tentativa de visualizar mensagens de chat ou fotos de documentos de terceiros).
     - Tentativas de alteração de papéis em RBAC (`admin.role.assigned`).
     - Consultas não autorizadas à base de dados.
   - Em caso de acesso indevido comprovado a dados de titulares, acionar imediatamente o protocolo D-09.

### 5.5 Procedimento D-09: Resposta a incidente de segurança e vazamento de dados

Violação de confidencialidade, integridade ou disponibilidade envolvendo dados pessoais (LGPD Arts. 46 e 48).

1. **Vetores e Limiares de Detecção Técnica:**
   - Taxa anormal de requisições em rotas contendo dados de contato revelados (`/contacts`, `/reveal`).
   - Picos de rejeição por segurança de linha (SQLSTATE `42501` - violação de RLS) indicando tentativas de bypass ou exploração de permissões.
   - Vazamento acidental de dados pessoais em arquivos de logs públicos ou agregadores.
   - Notificação externa de segurança ou alerta de varredura.
2. **Contenção Técnica Imediata (Até 15 minutos do alerta):**
   - Isolar o vetor de vazamento:
     - Se o vazamento decorre de falha em rota específica, desativar a rota temporariamente via chave de controle de degradação em `ops.app_config` ou regras de proxy.
     - Se envolver credencial vazada de operador ou serviço, revogar a chave de imediato (procedimento D-06/D-07).
     - Bloquear imediatamente endereços IP maliciosos e invalidar sessões suspeitas.
3. **Avaliação Técnica e Classificação do Incidente (Até 24 horas):**
   - Delimitar o universo de titulares afetados (quantidade de clientes e profissionais).
   - Mapear a tipologia dos dados vazados:
     - Dados cadastrais gerais (nome público, slug).
     - Dados protegidos por consentimento (telefone, WhatsApp, endereço exato).
     - Dados altamente sensíveis (documentos de identificação, fotos de verificação, HMAC de documentos).
   - Mensurar o risco potencial aos direitos fundamentais e à segurança física/financeira dos titulares.
4. **Acionamento do DPO e Notificação Regulatória `[PENDENTE JURÍDICO]`:**
   - Encaminhar imediatamente o Relatório Técnico de Incidente ao Encarregado de Proteção de Dados (DPO) e assessoria jurídica (BLQ-JUR L1/L2).
   - Preparar a Notificação à Autoridade Nacional de Proteção de Dados (ANPD) e aos titulares afetados em consonância com o modelo regulatório padrão (ver seção 7 e 8).

### 5.6 Reconciliação Financeira Diária: Mercado Pago × Livro (`access_grant`)

Especificação operacional do processo de reconciliação que será automatizado pela história H-053 (#66), detalhando as diretrizes que o runbook já cobre previamente.

1. **Princípio Fundamental e Invariante de Negócio:**
   - **NUNCA alterar acesso automaticamente:** o processo de conciliação NUNCA concede, prorroga, suspende ou revoga direitos em `access_grant` de forma autônoma (RF-060, 08 §8.8). Toda discrepância gera registro e alerta para análise e intervenção de operador com perfil Financeiro.
2. **Janela e Periodicidade:**
   - Execução diária em lote (madrugada, horário UTC), cobrindo as transações liquidadas até 2 horas antes da execução (margem de segurança para acomodar atrasos de webhooks e eventuais retentativas do gateway a cada 15 min).
3. **Matriz de Discrepâncias:**
   - **Tipo 1 (Falta de Lançamento Local):** Pagamento confirmado como `approved` na API do Mercado Pago sem registro correspondente em `app.payment` / `access_grant` (falha na entrega ou processamento do webhook). Ação: Financeiro audita o ID de pagamento externo e aciona concessão manual via `access_adjustment`.
   - **Tipo 2 (Concessão Ativa sem Pagamento Válido):** Profissional usufrui de `access_grant` do tipo `paid` sem cobrança aprovada ou com pagamento estornado/rejeitado no gateway. Ação: Financeiro revisa o histórico e, se aplicável, executa revogação manual fundamentada.
   - **Tipo 3 (Divergência de Valor Monetário):** Valor gravado no pagamento diverge do valor vigente em `plan_price` na data de aquisição. Ação: Financeiro apura se houve cobrança indevida para aplicação de estorno ou ajuste.
   - **Tipo 4 (Status Recorrente Divergente):** Assinatura marcada como cancelada no Mercado Pago mas ativa localmente, ou vice-versa. Ação: Financeiro ajusta flag `cancel_at_period_end`.
4. **Atuação do Runbook ANTES das Histórias de Pagamento (#60 a #66):**
   - Como as histórias #60 a #66 estão em Backlog, o runbook define o contrato de dados do relatório sintético, as estruturas de log e as rotinas manuais de batimento financeiro com fixtures de teste, garantindo que a esteira de desenvolvimento tenha critérios de teste inequívocos quando iniciar a implementação de H-053.

### 5.7 Reconciliação Operacional de E-mails e Cotas (Resend)

1. **Gestão dos Limiares de Cota Gratuita (RNF-EMAIL, PRD §6.1, H-094):**
   - Limite diário: 100 mensagens (dia UTC).
   - Limite mensal: 3.000 mensagens (mês civil).
   - Nível de Alerta 1 (70%): 70 mensagens no dia ou 2.100 no mês.
   - Nível de Alerta 2 (85%): 85 mensagens no dia ou 2.550 no mês.
   - Corte de Classes Não-Críticas (90%): 90 mensagens no dia ou 2.700 no mês. Mensagens de classes `digest`, `lembrete` e `marketing` são suspensas/represadas.
   - Reserva Exclusiva para `auth` (10%): 10 mensagens no dia e 300 no mês são estritamente reservadas para códigos de login, verificação de e-mail e redefinição de credenciais.
2. **Mitigação do Descompasso do SMTP Auth (Risco R-5 de H-097):**
   - O Supabase Auth envia e-mails transacionais de autenticação do profissional diretamente via SMTP conectado ao Resend, consumindo a cota de 100/dia sem registrar nos contadores da aplicação (`ops.rate_counter`).
   - Runbook estipula conciliação diária entre os contadores de `ops.rate_counter` e o consumo real reportado pelo endpoint de uso do Resend, aplicando fator de ajuste compensatório nos limites diários locais para evitar estouro inesperado da cota.
3. **Desobstrução e Expurgo de Fila Represada:**
   - Em caso de restabelecimento pós-esgotamento de cota ou falha de conectividade do Resend:
     - As mensagens represadas em `ops.email_outbox` com status `adiado_cota` são reavaliadas na virada do dia UTC.
     - **Regra de Não-Retroatividade (Decisão 27, FA-029):** notificações de fatos operacionais obsoletos (ex: novos aceites ocorridos há mais de 24 horas em pedidos já selecionados ou cancelados) são sumariamente descartadas com status `descartado_obsoleto`. É terminantemente proibido o reenvio de aceites antigos ao cliente.

### 5.8 Reconciliação de Identidades (Auth × Postgres)

1. **Invariante de Isolamento:** a criação de usuário no Supabase Auth (`auth.users`) e no domínio de aplicação (`identity.app_user`) ocorre em chamadas separadas (não transacionais entre sistemas distintos, 67-DESENHO-H016).
2. **Procedimento de Saneamento:**
   - Rotina periódica identifica registros em `auth.users` que não possuem vínculo em `identity.app_user` após a janela de timeout de cadastro (15 minutos).
   - Registros órfãos identificados são expurgados com base nas rotinas de limpeza técnica de autenticação de H-011.

---

## 6. Regras de negócio e invariantes

| Ref. | Regra de Negócio / Invariante | Fonte Canônica | Atendimento em H-114 |
|---|---|---|---|
| **RN-H114-01** | **Backup e restore fora do escopo.** Em nenhum ambiente há backup, dump de banco, restauração de cópia ou rotina de exportação. | `11-DECISOES` Rodada 73/75, #151 | Escopo formal delimitado; nenhuma menção ou código de backup (CA-H114-01). |
| **RN-H114-02** | **Mapbox proibido.** Nenhuma contingência, rotação de segredo ou chamada ao Mapbox é permitida. | `11-DECISOES` Rodada 74 | Nenhum segredo de Mapbox no runbook (CA-H114-02). |
| **RN-H114-03** | **Sem rotação de senhas do banco de desenvolvimento.** A rotação de credenciais do banco foi vetada pelo usuário. | `11-DECISOES` Rodada 83 (decisão 150) | D-06 restrito a API keys e chaves de envelope (CA-H114-03). |
| **RN-H114-04** | **Reconciliação MP nunca corrige acesso automaticamente.** Discrepâncias geram relatório para o Financeiro; nenhuma alteração autônoma de `access_grant`. | 08 §8.8; RF-060; ADR-007 | Exigência de intervenção humana fundamentada (CA-H114-04). |
| **RN-H114-05** | **Dupla aprovação para mitigação admin.** Ações de desbloqueio ou redefinição de MFA após comprometimento exigem dois operadores (`Superadmin`/`Auditor`). | RF-145, RF-151; FA-031 | Procedimento D-07 estruturado com quórum (CA-H114-05). |
| **RN-H114-06** | **Trilha de auditoria imutável.** Nenhuma ação de contingência, expurgo ou resposta a incidente apaga ou altera registros de `audit.audit_event`. | 09 §4; H-006; I-15 | Todas as ações operacionais geram evento append-only (CA-H114-06). |
| **RN-H114-07** | **Rollback por compensação (expand-and-contract).** Falhas de deploy/migração são tratadas por migrações corretivas progressivas, nunca por `DROP` destrutivo. | 11 §9 (D-05); 08 §16 | Padrão formalizado no runbook (CA-H114-07). |
| **RN-H114-08** | **Versionamento de chaves criptográficas.** Chaves de encriptação de envelope (`ADDRESS_ENC_KEY`, `phoneVault`) operam com identificador de versão e tolerância de leitura. | 11 §9 (D-06); 08 §1.1 | Rotação sem downtime nem perda de leitura (CA-H114-08). |
| **RN-H114-09** | **Contenção técnica rápida de vazamento.** Bloqueio de rota ou revogação de chaves em caso de incidente deve ocorrer em até 15 minutos do alerta confirmado. | 11 §9 (D-09); PRD §3 | Procedimento técnico padronizado (CA-H114-09). |
| **RN-H114-10** | **Comunicação de incidente dependente de jurídico.** Modelos de comunicação à ANPD e titulares são `[PROPOSTA]` no DEV e demandam validação jurídica (L1/L2). | RF-140; `14-BACKLOG` H-114 | Marcação de pendência jurídica explícita (CA-H114-10). |
| **RN-H114-11** | **Prioridade estrita de cotas de e-mail.** Classe `auth` nunca é bloqueada por mensagens de marketing ou digest; reserva de 10% intocável. | RNF-EMAIL; ADR-022; H-094 | Procedimento de conciliação de e-mail (CA-H114-11). |
| **RN-H114-12** | **Sem reenvio de aceites antigos.** Desobstrução de fila de e-mail descarta mensagens de aceites obsoletos sem reenvio retroativo ao cliente. | `11-DECISOES` Rodada 12 (decisão 27) | Regra de descarte por obsolescência (CA-H114-12). |
| **RN-H114-13** | **Compatibilidade pré-pagamentos.** O runbook opera com fixtures sintéticas antes da implementação das histórias de billing (#60 a #66). | `14-BACKLOG` E5, H-114 | Especificação de isolamento sintético (CA-H114-13). |
| **RN-H114-14** | **Detecção de órfãos Auth x Postgres.** Contas desemparelhadas entre `auth.users` e o banco são saneadas sem quebra de integridade referencial. | 67-DESENHO-H016; H-011 | Rotina de identificação e compensação (CA-H114-14). |
| **RN-H114-15** | **Zero dependência de cron externo.** O runbook baseia-se no tick da aplicação e no `pg_cron` nativo sem depender de serviços externos pagos. | 08 §1.1, §16; ADR-020 | Operação de recovery 100% autônoma (CA-H114-15). |
| **RN-H114-16** | **Redação de PII em relatórios de incidente.** Logs, dumps de depuração e relatórios de conciliação não devem expor CPF, e-mail completo ou telefone. | ADR-013; 08 §14 | Sanitização mandante de dados (CA-H114-16). |
| **RN-H114-17** | **Exercitabilidade sintética de todos os procedimentos.** Cada cenário de recuperação (D-04 a D-07, D-09) possui procedimento de teste validável em ambiente DEV. | `14-BACKLOG` H-114 | Tabela de testes sintéticos sem rede (CA-H114-17). |
| **RN-H114-18** | **Documentação unificada e versionada.** O runbook é entregue como documento canônico versionado em `docs/factory/`. | AGENTS.md; Roles PO | Artefato documental único e rastreável (CA-H114-18). |

---

## 7. Critérios de aceite (testáveis)

Todos os critérios de aceite devem ser validados em ambiente de desenvolvimento local, utilizando fixtures sintéticas devidamente identificadas por marcadores formais de teste, sem rede externa, sem Mapbox e sem comandos destrutivos.

- **CA-H114-01 (Ausência Total de Referências a Backup).**
  - **Dado** o documento do runbook H-114 e seus artefatos operacionais associados,
  - **Quando** submetido a varredura automatizada de termos prohibited (`backup`, `pg_dump`, `restore_db`, `dump_s3`, `app_backup_reader`),
  - **Então** nenhum termo relacionado a backup de dados é encontrado como procedimento ativo do produto, respeitando as decisões da Rodada 73 e Issue #151.

- **CA-H114-02 (Conformidade com a Proibição do Mapbox).**
  - **Dado** o runbook de incidente e contingência,
  - **Quando** verificados os procedimentos de rotação de chaves e contingência externa,
  - **Então** não há nenhuma menção a tokens, APIs ou serviços do Mapbox, em estrito cumprimento à decisão da Rodada 74.

- **CA-H114-03 (Procedimento D-04 — Pausa do Supabase Free e Validação de Tick).**
  - **Dado** um cenário simulado em que o banco de dados permaneceu inativo e foi reativado (unpause),
  - **Quando** executado o checklist de verificação pós-restauração D-04,
  - **Então** o procedimento valida com sucesso: (1) leitura da tabela `ops.app_keepalive`; (2) enfileiramento e consumo de jobs pelo tick em `ops.job`; (3) estado dos gatilhos de vedação em `audit.audit_event` (`tgenabled = 'A'`).

- **CA-H114-04 (Procedimento D-05 — Rollback de Migração por Compensação).**
  - **Dado** uma migração com erro induzido em ambiente de testes,
  - **Quando** aplicado o procedimento D-05,
  - **Então** o rollback é executado via criação de migração compensatória (`expand-and-contract`), o checksum em `ops.schema_migration` é regularizado e `corepack pnpm db:status` retorna zero migrações pendentes sem exclusão manual de registros de auditoria.

- **CA-H114-05 (Procedimento D-06 — Rotação de Chave Criptográfica sem Downtime).**
  - **Dado** um conjunto de registros sintéticos de teste contendo endereços cifrados com a chave primária `KEY_V1`,
  - **Quando** introduzida a nova chave primária `KEY_V2` mantendo `KEY_V1` como chave de tolerância na configuração,
  - **Então** a aplicação: (1) decifra com sucesso os registros legados utilizando `KEY_V1`; (2) cifra todas as novas requisições com `KEY_V2`; (3) rotina de re-encriptação migra os dados antigos para `KEY_V2` permitindo a retirada segura de `KEY_V1`.

- **CA-H114-06 (Procedimento D-06 — Rotação de Chaves de API de Provedores).**
  - **Dado** a necessidade de rotação emergencial do token do Mercado Pago ou do Resend,
  - **Quando** atualizada a variável de ambiente em ambiente seguro e emitido disparo sintético,
  - **Então** a transição é comprovada sem descarte de webhooks pendentes e sem indisponibilidade de rota na API.

- **CA-H114-07 (Procedimento D-07 — Revogação Imediata de Sessão de Administrador).**
  - **Dado** um operador administrativo com sessão ativa autenticada em segundo fator (`aal2`),
  - **Quando** acionado o procedimento de contenção D-07,
  - **Então** a sessão do operador é sumariamente revogada, qualquer chamada subsequente com o token anterior retorna `401 Unauthorized` ou `403 Forbidden`, e um evento de auditoria `admin.session.revoked` é registrado imutavelmente.

- **CA-H114-08 (Procedimento D-07 — Reabilitação de MFA com Dupla Aprovação).**
  - **Dado** um administrador com credenciais invalidadas por suspeita de comprometimento,
  - **Quando** solicitada a redefinição de segundo fator,
  - **Então** o sistema exige que dois operadores distintos com permissões de governança (`Superadmin`/`Auditor`) confirmem o desbloqueio, recusando autoaprovação e registrando os dois aprovadores em `audit.audit_event`.

- **CA-H114-09 (Procedimento D-09 — Contenção Técnica de Vazamento em até 15 Minutos).**
  - **Dado** a identificação simulada de vazamento de dados pessoais em determinada rota da API,
  - **Quando** aplicado o procedimento de contenção técnica imediata,
  - **Então** a rota é isolada ou protegida via alteração atômica em `ops.app_config` ou regra de proxy, cessando o vazamento de PII sem exigir redesdobramento completo da aplicação.

- **CA-H114-10 (Procedimento D-09 — Relatório de Apuração de Escopo e Modelo ANPD).**
  - **Dado** o encerramento da fase de contenção de um incidente simulado de dados,
  - **Quando** compilado o relatório de incidente conforme o formulário padronizado do runbook,
  - **Então** o documento apresenta: (1) contagem de titulares impactados; (2) classes de dados expostas; (3) medidas de mitigação adotadas; (4) minuta de comunicação à ANPD e aos titulares marcada expressamente como `[PENDENTE JURIDICO]` (L1/L2).

- **CA-H114-11 (Reconciliação MP × Livro — Invariante de Não-Autocorreção).**
  - **Dado** um lote sintético contendo 3 discrepâncias intencionais entre o gateway e o livro (pagamento aprovado no MP sem `payment` local; concessão ativa sem pagamento correspondente; valor divergente),
  - **Quando** executada a rotina de batimento do runbook,
  - **Então** as 3 divergências são registradas no relatório do Financeiro com status de alerta, e nenhuma linha da tabela `app.access_grant` é alterada ou inserida de forma autônoma pelo processo.

- **CA-H114-12 (Reconciliação MP × Livro — Operabilidade Antes das Histórias #60 a #66).**
  - **Dado** que as histórias de billing #60 a #66 estão em Backlog,
  - **Quando** exercitado o procedimento com tabelas mínimas ou mocks sintéticos de gateway,
  - **Então** o runbook prova a lógica de batimento, os formatos de payload e as ações operacionais do Financeiro sem depender de credenciais reais ou do sandbox do Mercado Pago.

- **CA-H114-13 (Reconciliação de E-mails — Limiares de Alerta e Preservação de Auth).**
  - **Dado** o volume diário de envios atingindo 70%, 85% e 90% da cota do Resend (100/dia),
  - **Quando** processada a fila de saída,
  - **Então** o runbook demonstra: (1) emissão dos alertas em 70 e 85 mensagens; (2) bloqueio e adiamento das classes não-críticas (`digest`, `lembrete`) ao atingir 90 mensagens; (3) passagem irrestrita de mensagens da classe `auth` até o teto de 100 mensagens.

- **CA-H114-14 (Reconciliação de E-mails — Descarte de Mensagens Obsoletas Pós-Incidente).**
  - **Dado** mensagens de aceite represadas na fila `ops.email_outbox` decorrentes de interrupção de serviço que ultrapassaram a janela de vigência (pedido cancelado ou já selecionado),
  - **Quando** restaurada a conectividade com o provedor,
  - **Então** a rotina de desobstrução descarta as mensagens obsoletas com marcação `descartado_obsoleto` e não efetua nenhum envio retroativo de aceites ao cliente (Decisão 27).

- **CA-H114-15 (Reconciliação de E-mails — Compensação de Consumo do SMTP Auth).**
  - **Dado** envios realizados diretamente pelo Supabase Auth (SMTP) consumindo cota externa sem contabilização local,
  - **Quando** executada a reconciliação diária de cotas com o relatório da API do Resend,
  - **Então** o contador local em `ops.rate_counter` é ajustado pelo delta apurado, prevenindo surpresas de esgotamento de cota antes do final do dia UTC.

- **CA-H114-16 (Reconciliação de Identidades — Tratamento de Usuários Órfãos).**
  - **Dado** um registro sintético inserido em `auth.users` sem correspondente em `identity.app_user` após 15 minutos de inatividade,
  - **Quando** executada a varredura de reconciliação de identidades,
  - **Então** o registro órfão é sinalizado para expurgo seguro pelas rotinas operacionais de autenticação, impedindo o bloqueio de novos cadastros com o mesmo e-mail.

- **CA-H114-17 (Sanitização e Redação de PII em Artefatos de Diagnóstico).**
  - **Dado** qualquer saída de relatório, log ou dump gerado durante a execução de um procedimento do runbook,
  - **Quando** inspecionado o conteúdo gerado,
  - **Então** e-mails são redigidos (ex: `u***@d***.com`), números de telefone/WhatsApp e CPF/CNPJ aparecem mascarados e payloads de requisições sensíveis não são expostos em texto pleno.

- **CA-H114-18 (Auditoria Compulsória de Todas as Ações Operacionais).**
  - **Dado** a execução de qualquer um dos procedimentos operacionais (D-04, D-05, D-06, D-07, D-09 ou reconciliações manuais),
  - **Quando** consultada a tabela `audit.audit_event`,
  - **Então** existe registro formal imutável contendo o identificador do operador (`actor`), papel utilizado, motivo da ação, timestamp e parâmetros técnicos não-sensíveis.

- **CA-H114-19 (Execução 100% Local e Sintética em DEV).**
  - **Dado** o conjunto completo de testes de verificação do runbook H-114,
  - **Quando** executado em ambiente de desenvolvimento,
  - **Então** todos os cenários são exercitados com relógio controlado (`p_now`), sem necessidade de chaves externas reais, sem acesso à internet e sem geração de custos.

- **CA-H114-20 (Entrega Documental Canônica do Runbook).**
  - **Dado** o fechamento da história H-114,
  - **Quando** verificados os arquivos versionados do repositório,
  - **Então** o runbook operacional completo e estruturado para consumo de Arquitetura e Engenharia é entregue em `docs/factory/`, contendo procedimentos detalhados passo a passo para cada incidente e reconciliação.

---

## 8. Casos D-04 a D-07, D-09 e reconciliações operacionais

Matriz comparativa detalhada baseada em `11-ARQ-RISCOS-E-TESTES.md` §9 e nas invariantes de governança do produto:

| Identificador | Cenário Operacional | Fixture / Dado Sintético em DEV | Procedimento de Resposta e Validação | Resultado Esperado e Invariantes | Cobertura em H-114 |
|---|---|---|---|---|---|
| **D-04** | Instância Supabase Free pausada por inatividade (7 dias) | Simulação de indisponibilidade com `app_keepalive` defasado >24h | Unpause manual via console; validação de `ops.app_keepalive`; reativação do tick | Projeto reativado sem perda; tick processa outbox; auditoria íntegra | Total |
| **D-05** | Migração de banco falha durante o deploy | Migração sintética com erro forçado de constraint | Interrupção do pipeline; criação de migração compensatória expand-and-contract | Rollback sem `DROP` destrutivo; checksum regularizado; zero pendências | Total |
| **D-06** | Rotação emergencial ou periódica de chaves de criptografia | Chave primária `KEY_V1` e registros cifrados sintéticos | Inserção de `KEY_V2`; leitura híbrida; rotina de re-encriptação progressiva | Leitura garantida sem indisponibilidade; dados novos em V2; V1 removida após backfill | Total |
| **D-06b** | Rotação de credenciais de gateway/e-mail (MP/Resend) | Tokens sintéticos em variáveis de ambiente | Substituição atômica no ambiente; teste sintético; revogação do token anterior | Zero webhooks perdidos; continuidade imediata de envios e consultas | Total |
| **D-07** | Comprometimento de credenciais ou MFA de administrador | Sessão ativa simulada em `admin.session` com `aal2` | Invalidação de sessão em lote; bloqueio de usuário; redefinição de MFA com quórum duplo | Sessão desconectada em <5 min; redefinição exige 2 Superadmins; rastro em `audit_event` | Total |
| **D-09** | Incidente de segurança com suspeita de vazamento de PII | Injeção de requisições anômalas em rotas de contatos/perfil | Bloqueio imediato da rota via `ops.app_config`; apuração de escopo; elaboração de minuta ANPD | Vazamento cessado em <15 min; relatório de escopo preciso; minuta `[PENDENTE JURÍDICO]` | Total |
| **Rec-MP** | Reconciliação diária MP × Livro de Acesso (`access_grant`) | Fixtures com 3 discrepâncias: webhook perdido, falta de pagamento, valor divergente | Execução da rotina de batimento; emissão do `reconciliation_report` ao Financeiro | **NENHUMA alteração automática no livro**; relatório para decisão do Financeiro | Total conceitual (precede #60 a #66) |
| **Rec-Email** | Reconciliação de cotas do Resend e desobstrução de fila | Fila `email_outbox` com 100 itens represados e consumo externo | Ajuste do contador local; liberação com corte de classes não-críticas; descarte de obsoletos | Classe `auth` preservada; aceites obsoletos descartados sem reenvio tardio | Total |
| **Rec-Auth** | Reconciliação de usuários órfãos entre Auth e Postgres | Registro criado em `auth.users` sem correspondente em `app_user` | Varredura de desemparelhamento após 15 min; expurgo seguro pela rotina de H-011 | Eliminação de órfãos sem violação de integridade referencial; liberação de e-mail | Total |

---

## 9. Dependências reais (conferidas no quadro oficial)

Análise detalhada das dependências no quadro oficial `docs/factory/quadro-status.md` em 2026-11-14:

1. **Dependências Satisfeitas / Concluídas:**
   - **H-005 (Issue #18 — Infraestrutura transversal e outbox):** `Concluído`. Provê infraestrutura de jobs, outbox e transacionalidade base.
   - **H-006 (Issue #19 — Trilha de auditoria imutável):** `Concluído`. Provê a tabela `audit.audit_event` append-only com gatilhos de vedação e imutabilidade, essencial para os procedimentos D-07, D-09 e conciliações.
   - **H-008 (Issue #21 — Tick de jobs operacionais):** `Concluído`. Garante o motor de execução periódica de jobs no monorepo.
   - **H-010 (Issue #27 — Monitoramento e keep-alive):** `Concluído`. Tabela `ops.app_keepalive` pronta, utilizada no procedimento D-04.
   - **H-045 (Issue #58 — Acesso comercial derivado):** `Concluído`. Tabela `app.access_grant` e função `commercial_access` prontas no banco, alvo da conciliação do livro.
   - **H-046 (Issue #59 — Planos e preços em centavos):** `Concluído`. Tabela `app.plan_price` pronta para conferência de valores de batimento.
   - **H-109 (Issue #118 — Mecanismo de retenção sem prazos):** `Concluído`. Provê a estrutura de `retention_policy` e suspensão cautelar (`legal_hold`).
   - **H-110 (Issue #119 — Expurgos operacionais por TTL):** `Concluído`. Provê a infraestrutura de limpeza de desafios, sessões expiradas e webhooks antigos (`ops.app_config`).
   - **Issue #150 (Remoção do histórico de fotos):** `Concluído`. Eliminação definitiva de registros obsoletos de acesso a mídia.
   - **Issue #151 (Remoção definitiva de backup do escopo):** `Concluído`. Formalização das lápides D-01, D-02, D-03 e D-08, desobrigando qualquer rotina de backup.

2. **Relação com as Histórias de Billing em Backlog (#60 a #66):**
   - No backlog canônico, H-114 declara dependência técnica direta de **H-053 (Issue #66 — Reconciliação diária MP × livro)**.
   - As histórias #60 a #66 encontram-se em `Backlog (62)`.
   - **Impacto no Workflow:** a história H-114 é um **Runbook Operacional e Documental**. Ela NÃO desenvolve o código do gateway nem o processador de pagamentos. Ela estabelece antecipadamente as regras operacionais, os procedimentos manuais, a matriz de batimento e os protocolos de contingência que orientarão o desenvolvimento de H-053 quando esta for puxada do Backlog.
   - Dessa forma, H-114 pode ser refinada, desenhada e ter seus procedimentos exercitados em nível de simulação documental e de dados sintéticos sem a necessidade de esperar o encerramento prévio de #60 a #66.

3. **Bloqueios Jurídicos Registrados:**
   - **BLQ-JUR L1 / L2 (Retenção, Privacidade e Termos):** a minuta de comunicação externa de incidentes à ANPD e aos titulares no cenário D-09 possui natureza `[PENDENTE JURIDICO]`. Em ambiente de desenvolvimento, entrega-se o modelo formalizado como proposta técnica, com a validação final condicionada à liberação jurídica antes do lançamento em produção (Gate M4).

---

## 10. Riscos e mitigações

- **R1. Conflito entre reconciliação e acesso em tempo real.** Se um job de conciliação alterasse o acesso comercial, poderia revogar indevidamente o acesso de profissional em meio a um atendimento crítico.
  - *Mitigação:* Invariante absoluta RN-H114-04: o job de conciliação apenas emite relatórios e alertas; nenhuma alteração em `access_grant` ocorre sem intervenção humana expressa e fundamentada.
- **R2. Indisponibilidade prolongada por congelamento do Supabase Free.** A pausa de 7 dias pode surpreender a operação em fases de baixo uso ou ensaio fechado.
  - *Mitigação:* Procedimento D-04 estabelece checklist de monitoramento do heartbeat de `ops.app_keepalive` e processo de restauração documentado em menos de 5 minutos.
- **R3. Erro de integridade em migração compensatória (D-05).** Tentativas de corrigir migrações com edição manual de arquivos geram quebra permanente de checksum em `ops.schema_migration`.
  - *Mitigação:* Procedimento D-05 proíbe estritamente a edição de migrações já aplicadas; toda correção é feita por nova migração com prefixo temporal incremental.
- **R4. Perda de dados em rotação de chave de criptografia (D-06).** Alterar chaves de envelope sem suporte a leitura legada impede a abertura de endereços e contatos antigos.
  - *Mitigação:* Exigência mandante de versionamento de chaves (`key_id`) e processo em 4 passos com janela de tolerância de dupla chave e rotina de backfill progressivo.
- **R5. Reação lenta a comprometimento administrativo (D-07).** Morosidade na invalidação de sessões de admin pode permitir extração indevida de PII ou adulteração de cadastros.
  - *Mitigação:* Comando padronizado de revogação forçada em lote no nível do banco, derrubando sessões ativas em menos de 5 minutos, com auditoria compulsória.
- **R6. Notificação precipitada ou incorreta de incidente de dados (D-09).** Comunicar vazamentos sem apuração técnica prévia pode gerar pânico injustificado ou passivo regulatório.
  - *Mitigação:* Fluxo em fases: contenção imediata em 15 min, apuração técnica de escopo em 24h e envio de relatório ao DPO/Jurídico antes de qualquer comunicação à ANPD (`[PENDENTE JURIDICO]`).
- **R7. Esgotamento da cota de e-mail bloqueando autenticação (Resend).** Volume alto de notificações não-críticas consumindo os 100 envios/dia e impedindo o login dos usuários.
  - *Mitigação:* Monitoramento de limiares com corte progressivo de classes não-críticas aos 90% e reserva intocável de 10% exclusivamente para a classe `auth` (RN-H114-11).
- **R8. Reenvio inadvertido de aceites antigos (E-mails zumbis).** Destravar filas de e-mail represadas e disparar notificações de pedidos antigos que já foram concluídos.
  - *Mitigação:* Regra de descarte por obsolescência: itens represados são reavaliados e descartados sumariamente se o fato gerador perdeu a relevância operacional.
- **R9. Descompasso do consumo do Resend pelo SMTP Auth.** Disparos do Supabase Auth consumirem a cota silenciosamente sem registrar em `ops.rate_counter`.
  - *Mitigação:* Rotina de batimento entre a API do Resend e o banco local compensa diariamente o delta de consumo no contador de controle.
- **R10. Contaminação do banco de testes com resíduos operacionais.** Execuções de simulação de incidentes deixarem dados sujos no banco compartilhado de desenvolvimento.
  - *Mitigação:* Uso obrigatório de marcadores sintéticos padronizados (`[TESTE-H114]`) e respeito às diretrizes de isolamento de testes da decisão 261.
- **R11. Vazamento acidental de PII em artefatos de incidentes.** Relatórios de vazamento ou auditoria exporem dados pessoais em canais abertos.
  - *Mitigação:* Mascaramento e redação compulsória de e-mails, telefones e CPFs em todos os modelos de log e relatórios de conformidade.
- **R12. Tentativa indevida de reintroduzir rotinas de backup.** Confusão de papéis tentar incluir dumps ou scripts de restauração de banco de dados.
  - *Mitigação:* Vedação explícita em conformidade com as decisões da Rodada 73 e Issue #151 concluída (RN-H114-01).

---

## 11. Perguntas ao líder (Orquestrador)

Lista única de perguntas numeradas estritamente de **703 a 722** (20 perguntas), sem envio direto ao usuário, contendo as alternativas, a recomendação do Product Owner e a decisão que destravam:

**703. Monitoramento de Pausa do Supabase Free (D-04).** Como deve ser realizada a verificação de congelamento por inatividade do banco gratuito?
- (a) Heartbeat interno periódico via `ops.app_keepalive` consumido pela API, emitindo alerta operacional quando a defasagem superar 24 horas.
- (b) Consulta HTTP externa automatizada a cada 6 dias disparada por ferramenta de monitoramento gratuita.
- (c) Apenas verificação humana reativa quando ocorrerem falhas de conexão de clientes.
- **Recomendação:** (a), pois mantém a operação autônoma dentro da infraestrutura já implementada (H-010). Destrava o protocolo operacional D-04 e CA-H114-03.

**704. Ação de Descongelamento do Supabase (D-04).** Qual o fluxo oficial para reativação da instância em caso de pausa confirmada?
- (a) Acesso manual ao console do Supabase pelo operador/líder com acionamento do botão "Restore Project".
- (b) Script de contingência automatizado via API administrativa do Supabase com chave mestra.
- **Recomendação:** (a), alinhado à governança de custo zero e menor privilégio, evitando armazenar tokens mestres de gestão de infraestrutura. Destrava o passo a passo de recuperação de D-04.

**705. Política de Rollback de Migrações em Produção e Staging (D-05).** Diante de uma falha de migração com erro em lote, qual a estratégia prioritária?
- (a) Criação estrita de nova migração compensatória corretiva (`expand-and-contract`), preservando a linearidade do histórico em `ops.schema_migration`.
- (b) Execução manual de script de rollback (`down`) com reabertura de versão anterior e exclusão do registro de schema.
- **Recomendação:** (a), que evita inconsistências de checksum e desvios de status conhecidos no monorepo (`db:status`). Destrava o procedimento D-05 e CA-H114-04.

**706. Bloqueio Preventivo em Falha de Deploy de Banco (D-05).** Ao identificar falha de migração, o que o pipeline de deploy deve fazer imediatamente?
- (a) Interromper imediatamente o pipeline de integração contínua (fail-fast), emitir alerta crítico e impedir o roteamento de tráfego para a nova versão da API.
- (b) Prosseguir com a versão anterior sem intervenção, aguardando intervenção manual assíncrona.
- **Recomendação:** (a), prevenindo discrepâncias entre os contratos do código e o schema do banco. Destrava o protocolo de contenção de D-05.

**707. Janela de Tolerância para Rotação de Chaves Criptográficas (D-06).** Durante a rotação de `ADDRESS_ENC_KEY` e cofres de contato, qual o tempo de permanência da chave anterior como chave de leitura?
- (a) Janela fixa de 7 dias após o deploy, durante a qual rotina em lote realiza o backfill de recifragem dos dados antigos.
- (b) Manutenção permanente da chave anterior em lista histórica de leitura até que consulta no banco confirme zero registros utilizando a versão antiga.
- **Recomendação:** (b), pois garante risco zero de perda de legibilidade de registros raramente acessados. Destrava o procedimento de encriptação versionada de D-06 e CA-H114-05.

**708. Rotação de Tokens de API de Provedores (D-06).** Qual o procedimento para troca de credenciais de integração do Mercado Pago e Resend?
- (a) Atualização da variável de ambiente no servidor, teste imediato de conectividade com credencial sintética e revogação do token anterior no painel do provedor em até 1 hora.
- (b) Revogação imediata no painel antes da configuração do novo token.
- **Recomendação:** (a), evitando janelas de indisponibilidade ou falhas na recepção de webhooks legítimos. Destrava o procedimento D-06b e CA-H114-06.

**709. Escopo da Revogação em Comprometimento Administrativo (D-07).** Ao confirmar credencial de operador comprometida, qual o alcance do bloqueio inicial?
- (a) Revogação sumária de todas as sessões ativas do usuário (`admin.session` e status de `app_user`), sem afetar os demais administradores.
- (b) Derrubada global de todas as sessões administrativas da plataforma por precaução.
- **Recomendação:** (a), contendo o agente malicioso com precisão cirúrgica sem paralisar a operação dos demais operadores legítimos. Destrava o protocolo de resposta D-07 e CA-H114-07.

**710. Quórum de Desbloqueio e Reset de MFA Administrativo (D-07).** Quem pode redefinir o segundo fator (`aal2`) e reativar um administrador bloqueado por segurança?
- (a) Exigência de dupla aprovação cruzada por dois operadores com perfil `Superadmin` (ou um `Superadmin` e um `Auditor`), vedada expressamente a autoaprovação.
- (b) Um único operador com perfil `Superadmin`.
- **Recomendação:** (a), em perfeita consonância com o princípio de segregação de funções e dupla aprovação de ações sensíveis (RF-145, RF-151, FA-031). Destrava CA-H114-08.

**711. Limiar Técnico de Ativação do Protocolo de Vazamento (D-09).** Quais eventos disparam a formalização imediata de um Incidente Grave de Dados?
- (a) Qualquer exposição não autorizada de dados pessoais protegidos por sigilo/consentimento (documentos de identidade, fotos de verificação, telefone/WhatsApp ou endereço exato), independentemente da quantidade.
- (b) Somente vazamentos confirmados que atinjam mais de 100 titulares.
- **Recomendação:** (a), em estrita observância aos deveres de zelo e boas práticas da LGPD (Art. 46), assegurando contenção rápida antes da propagação do dano. Destrava os gatilhos do procedimento D-09.

**712. Mecanismo de Contenção Técnica de Emergência (D-09).** Como deve ser efetuado o isolamento imediato de uma rota ou funcionalidade sob ataque ou vazamento?
- (a) Atualização atômica de chave de emergência na tabela `ops.app_config` (ex: `feature.reveal_phone.enabled = false`), fazendo a API responder com `503 Servico Indisponivel` seguro.
- (b) Novo commit no repositório com deploy emergencial da aplicação comentando as rotas.
- **Recomendação:** (a), permitindo resposta técnica em segundos sem depender do tempo de build e deploy da plataforma. Destrava a regra de contenção rápida e CA-H114-09.

**713. Modelo de Notificação de Incidente à ANPD e Titulares (D-09).** Como tratar as minutas de comunicação externa enquanto pende aprovação jurídica formal?
- (a) Estruturar o modelo completo no runbook marcado como `[PROPOSTA]` / `[PENDENTE JURIDICO]`, condicionando o uso real em produção à validação do DPO (L1/L2).
- (b) Omitir os modelos do runbook até a emissão do parecer jurídico.
- **Recomendação:** (a), garantindo que a equipe de engenharia tenha modelos prontos para testes e auditoria prévia sem violar a autoridade do Jurídico. Destrava CA-H114-10.

**714. Formato do Relatório de Batimento Financeiro MP × Livro (H-053).** Onde e como a rotina diária de conciliação deve registrar os achados?
- (a) Registro estruturado em tabela dedicada de auditoria operacional (`ops.reconciliation_report`), complementado por log estruturado sem PII e alerta no painel do Financeiro.
- (b) Apenas envio de e-mail diário com anexo CSV para a equipe financeira.
- **Recomendação:** (a), mantendo a rastreabilidade interna imutável no banco de dados e sem depender de cota de e-mail do Resend para alertas operacionais internos. Destrava o modelo de dados de conciliação e CA-H114-11.

**715. Invariante de Não-Autocorreção do Acesso Comercial (H-053).** Confirmar que sob nenhuma hipótese a conciliação altera `access_grant` diretamente?
- (a) Confirmado. O job é estritamente de conferência e alerta. Toda ação corretiva é manual, via `access_adjustment`, operada por usuário do papel Financeiro com justificativa auditada.
- (b) Permitir que pagamentos aprovados no gateway há mais de 24 horas gerem concessão automática pelo job.
- **Recomendação:** (a), preservando a invariante canônica de arquitetura (08 §8.8, RF-060) e prevenindo concessões errôneas decorrentes de instabilidade de APIs externas. Destrava a regra RN-H114-04.

**716. Atuação do Runbook H-114 ANTES das Histórias de Pagamento (#60 a #66).** O que a história H-114 deve entregar no tocante a pagamentos nesta fase?
- (a) Especificação formal dos contratos de batimento, regras de discrepância, procedimentos manuais e suíte de testes sintéticos com fixtures locais, deixando a implementação do job de código para H-053 (#66).
- (b) Pausar o refinamento de H-114 até que as histórias #60 a #66 sejam totalmente desenvolvidas.
- **Recomendação:** (a), permitindo o avanço contínuo do projeto conforme instrução expressa da Rodada 127 ("não parar nunca, mais agentes"), preparando a governança operacional com antecedência. Destrava a aprovação deste refino.

**717. Tolerância Temporal na Reconciliação do Mercado Pago.** Qual o atraso tolerado entre o evento no provedor e o batimento para evitar falsos positivos de conciliação?
- (a) Transações ocorridas nas últimas 2 horas são ignoradas no lote diário, aguardando o ciclo seguinte para acomodar eventuais retentativas de webhooks (janela de 15 min do MP).
- (b) Avaliação em tempo real de todas as transações até o instante exato da execução.
- **Recomendação:** (a), evitando alarmes falsos para pagamentos recém-aprovados cujo webhook ainda esteja em trânsito de reentrega. Destrava a regra de amostragem da conciliação.

**718. Descompasso de Cota de E-mail via SMTP do Supabase Auth.** Como reconciliar o consumo da cota de 100/dia do Resend consumido pelo Supabase Auth sem passar por `ops.rate_counter`?
- (a) Consulta diária ao endpoint de estatísticas da API do Resend no início do tick, ajustando o contador de `ops.rate_counter` pelo delta de envios externos detectados.
- (b) Desconsiderar o delta e confiar apenas no contador interno.
- **Recomendação:** (a), blindando a plataforma contra o risco R-5 de H-097 (estouro silencioso da cota gratuita por e-mails de autenticação). Destrava CA-H114-15.

**719. Tratamento de Notificações Represadas Pós-Incidente.** Qual a política mandatória para mensagens de aceite acumuladas em `ops.email_outbox` após período de indisponibilidade?
- (a) Descarte sumário (`descartado_obsoleto`) de mensagens cujo fato gerador ocorreu há mais de 12 horas ou cujo pedido não esteja mais aberto a aceites, sem nenhum reenvio de aceites antigos ao cliente (Decisão 27).
- (b) Disparo em lote de todas as mensagens acumuladas assim que a conexão for restabelecida.
- **Recomendação:** (a), respeitando a decisão irrevogável do usuário de não reenviar aceites antigos e não poluir a caixa do cliente com notificações extemporâneas. Destrava CA-H114-14 e RN-H114-12.

**720. Saneamento de Usuários Órfãos no Supabase Auth.** Quando uma conta em `auth.users` for detectada sem correspondente em `identity.app_user`, qual a ação?
- (a) Expurgo automático do registro em `auth.users` após janela de tolerância de 15 minutos, liberando o e-mail para nova tentativa legítima pelo usuário.
- (b) Manutenção eterna do registro órfão, bloqueando novas tentativas com o mesmo e-mail.
- **Recomendação:** (a), em consonância com as práticas de saneamento de cadastros incompletos estabelecidas em H-011 e 67-DESENHO-H016. Destrava o procedimento de reconciliação de identidades e CA-H114-16.

**721. Localização e Nomenclatura do Artefato Final do Runbook.** Onde o documento executável do runbook deve ser persistido pela Arquitetura/Engenharia?
- (a) Arquivo único consolidado em `docs/factory/147-RUNBOOK-INCIDENTE-RECONCILIACAO.md`, seguindo o precedente do `108-RUNBOOK-TTL-EXPURGOS.md`.
- (b) Divisão em múltiplos arquivos em pasta de infraestrutura.
- **Recomendação:** (a), garantindo facilidade de consulta centralizada pelos operadores e aderência ao padrão documental da fábrica. Destrava a organização de entrega da Arquitetura.

**722. Liberação para Início do Desenvolvimento.** A história H-114 pode iniciar o desenvolvimento de suas rotinas documentais e suíte de testes sintéticos imediatamente após o desenho da Arquitetura?
- (a) Sim, o Desenvolvimento pode construir a documentação canônica e os testes sintéticos no monorepo de forma isolada, enquanto as regras de pagamento permanecem preparadas para quando H-053 (#66) for desenvolvida.
- (b) Não, todo o desenvolvimento deve ficar bloqueado aguardando o épico de pagamentos (#60 a #66).
- **Recomendação:** (a), assegurando que os procedimentos vitais de D-04, D-05, D-06, D-07, D-09 e conciliação de e-mails estejam homologados desde já no produto. Destrava o fluxo WF-03.

---

## 12. Próximos passos e Handoff

1. **Submissão do Refino:** este documento canônico foi gravado em `docs/factory/146-REFINO-H114.md`.
2. **Consolidação das Perguntas:** o Orquestrador/Líder avalia as perguntas **703 a 722** e registra as respostas formais em `docs/factory/11-DECISOES.md`.
3. **Movimentação do Quadro:** após a consolidação das decisões, o cartão da Issue #123 (`[E13] Runbook de incidente e reconciliação`) avança da coluna **Product Owner** para a coluna **Arquitetura**.
4. **Handoff para Arquitetura:** o Especialista de Arquitetura produzirá o desenho técnico em `docs/factory/147-RUNBOOK-INCIDENTE-RECONCILIACAO.md` e detalhará a suíte de testes e validação sintética de cada procedimento operacional.
5. **Critério de Início do Desenvolvimento:**
   - O Desenvolvimento pode iniciar imediatamente após a conclusão do desenho de Arquitetura, concentrando-se na entrega documental dos protocolos D-04, D-05, D-06, D-07, D-09, conciliação de cotas do Resend e estruturação dos testes sintéticos locais.
   - A automação de código da reconciliação do Mercado Pago aguardará a execução da história de origem H-053 (Issue #66).
