# Refino H-111 — Direitos do titular (dsr_case): acesso, correção e eliminação (Issue #120)

- **Issue:** #120 `[E13] Direitos do titular (dsr_case)` · **História:** H-111 · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner (primeira coluna do quadro).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-14.
- **EXEC-ID:** não atribuído (não informado pelo líder).
- **Natureza:** somente documento. Nenhum código, migração, teste, comando de banco de dados ou alteração no quadro foi realizado. O cartão permanece em Product Owner até decisão humana/Orquestrador.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[PENDENTE JURIDICO]` matéria dependente de parecer jurídico/DPO (L1, L2), com modelo proposto no DEV · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas:
- `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`.
- `docs/factory/quadro-status.md` (atualizado no repositório em 2026-11-14).
- `docs/factory/21-ISSUES-CRIADAS.md` (mapeamento H-111 para Issue #120).
- `docs/factory/14-BACKLOG.md` (linha H-111, H-109, H-110, H-113, Gate M4, BLQ-JUR L1 e L2).
- `docs/factory/04-PRD.md` (RF-140, RF-136 a RF-139, RF-141, RF-145 a RF-149, M13, M14).
- `docs/factory/05-CRITERIOS-ACEITE.md` (FA-020, FA-030).
- `docs/factory/08-ARQUITETURA.md` (§1.1, §4.2, §7.6, §13, §14, módulo `privacy`, `admin`, `audit`).
- `docs/factory/09-MODELO-DADOS.md` (§3.8 `dsr_case`, `contact_consent`, `contact_reveal_log`, `retention_policy`, `legal_hold`; §7 Matriz de dados sensíveis; §8 Classes de retenção RC-01 a RC-10; §10).
- `docs/factory/10-ADRS.md` (ADR-016, ADR-019).
- `docs/factory/11-ARQ-RISCOS-E-TESTES.md` (I-15, R-16, R-17, T-03, T-04).
- `docs/factory/11-DECISOES.md` (Rodadas até a 127; em especial Rodada 67 sobre remoção de histórico de fotos, Rodadas 73/75 sobre remoção de cópias de backup do escopo, e Rodada 127 autorizando início de #120 via agy).
- `docs/factory/79-REFINO-H109.md` e `docs/factory/82-DESENHO-H109.md` (mecanismo de retenção sem prazos, `legal_hold`, adaptadores de anonimização e exclusão).
- `docs/factory/103-REFINO-H110.md` e `docs/factory/105-DESENHO-H110.md` (expurgos operacionais).
- `docs/factory/117-REFINO-REMOCAO-HISTORICO-ACESSO.md` (#150 CONCLUÍDA; eliminação total de `media_access_log` e `media_access_daily`).
- `docs/factory/121-REFINO-REMOCAO-BACKUP.md` e `docs/factory/122-DESENHO-REMOCAO-BACKUP.md` (#151 CONCLUÍDA; distinção explícita de que backup e restauração de cópia de banco estão fora do escopo, enquanto direitos do titular `dsr_case` permanecem no produto).
- Modelos de referência de PO: `docs/factory/113-REFINO-H045.md` e `docs/factory/139-REFINO-H055.md`.

Limitações `[NÃO VERIFICADO]`:
- O texto da Issue #120 no GitHub não foi lido por comando de rede (este agente opera sem acesso a rede externa e não executa `gh`). O escopo e os critérios foram extraídos de forma exaustiva da linha H-111 do backlog, do PRD, dos critérios de aceite e das decisões técnicas e arquiteturais do repositório.
- Nenhum comando de banco de desenvolvimento foi executado (ambiente preservado; sem consultas interativas nem migrações rodadas).
- Não há qualquer menção ou dependência de backup de banco de dados (o backup de dados está expressamente fora do escopo do projeto conforme decisões 349 a 358 e Issue #151 concluída; direitos do titular e keep-alive não são backup).
- Nenhuma chamada a provedores externos de mapas ou geocodificação (Mapbox é terminantemente proibido conforme Rodada 74).

---

## 1. Verificação de fila

- `[VERIFICADO]` O quadro oficial em `docs/factory/quadro-status.md` lista a Issue #120 (`[E13] Direitos do titular (dsr_case)`) na coluna **Product Owner (5)**. A etapa de refino de PO é a etapa devida.
- `[VERIFICADO]` Concluídas no quadro e no histórico recente: #43, #44, #50, #52, #57, #58, #59, #36, #119, #141, #150, #151.
- `[VERIFICADO]` Dependências declaradas de H-111 (`14-BACKLOG.md` linha 266):
  1. **H-109 (#118):** `Concluído` no quadro. Entregou o mecanismo de retenção por classes (`retention_policy`), suspensão cautelar de expurgo (`legal_hold`), adaptadores de anonimização/exclusão no banco e o padrão de idempotência.
  2. **H-006 (#19):** `Concluído` no quadro. Entregou o registro imutável de auditoria (`audit.audit_event`, append-only).
  3. **H-005 (#18):** `Concluído` no quadro. Entregou infraestrutura base de banco, outbox, jobs e idempotência.
  4. **H-017 (#30):** `Concluído` no quadro. Entregou isolamento estrito de identidades (`app_user`), papéis e sessões.
  5. **H-033 (#46):** Em `QA` no quadro, com desenvolvimento entregue e migração `20261113250000_contact_create_phone_consent.sql` aplicada no DEV, entregando `app.contact_consent` e `app.contact_reveal_log`.
- `[VERIFICADO]` Bloqueios regulatórios registrados: **BLQ-JUR L1** (retenção e base legal) e **BLQ-JUR L2** (termos, privacidade, DPO). A ativação de expurgos com dados reais em produção depende dessas liberações; no ambiente de DESENVOLVIMENTO, entrega-se o mecanismo completo, esquema de dados, máquina de estados e rotas sob o modelo `[PROPOSTA]`.
- `[VERIFICADO]` Numeração contínua de decisões/perguntas: a última rodada de decisões consolidadas (Rodadas 124/125) alcançou a decisão 661. As perguntas deste refino iniciam estritamente em **663** e encerram em **682** (20 perguntas numeradas ao líder).

---

## 2. Objetivo

Estruturar e entregar a gestão centralizada dos direitos do titular de dados pessoais previstos na LGPD (Lei Geral de Proteção de Dados Pessoais — Lei 13.709/2018, em especial Art. 18), por meio da entidade `dsr_case` (Data Subject Rights Case) e seus serviços associados.

A funcionalidade viabiliza o exercício pleno dos três direitos essenciais do titular na plataforma FastPro:
1. **Acesso aos dados (Art. 18, II):** extração e compilação estruturada de todos os dados pessoais do titular sob custódia da aplicação (dados cadastrais, pedidos de serviço, participações, histórico de mensagens e registros de consentimento fornecidos), em formato padronizado e auditado, sem expor segredos técnicos, dados de outros titulares ou infraestrutura interna.
2. **Correção de dados (Art. 18, III):** solicitação formal de retificação e atualização de dados pessoais inexatos, incompletos ou desatualizados, permitindo correção direta assistida ou processada administrativamente.
3. **Eliminação / Anonimização de dados (Art. 18, IV e VI):** exclusão voluntária da conta mediante anonimização irreversível dos dados pessoais cadastrais (`app_user`, `professional_profile`), descarte de dados operacionais residuais e revogação de consentimentos, garantindo a preservação estrita e inegociável dos dados que a plataforma é legalmente obrigada ou legitimada a reter (Art. 16 da LGPD: cumprimento de obrigação legal ou regulatória, defesa de direitos, registros fiscais/financeiros em `billing.payment` e trilha de segurança imutável em `audit.audit_event`).

Resultado de negócio: conformidade da plataforma com o regime brasileiro de proteção de dados, segregação absoluta entre demandas de privacidade (`dsr_case`) e denúncias/disputas operacionais (`moderation_case`), rastreabilidade integral para fiscalização da ANPD e prestação de contas pelo Encarregado pelo Tratamento de Dados Pessoais (DPO).

---

## 3. Escopo (dentro de H-111)

1. **Esquema de banco e entidade `dsr_case`:**
   - Criação da tabela `app.dsr_case` (alinhada a `09-MODELO-DADOS.md` §3.8) contendo:
     - `id`: identificador universal único (UUID);
     - `protocol`: código legível de protocolo alfanumérico gerado no momento da abertura (ex.: `DSR-YYYYMMDD-XXXXXX`) para acompanhamento pelo titular;
     - `subject_user_id`: chave estrangeira para `app.app_user(id)` referente ao titular solicitante;
     - `kind`: tipo do direito exercido, restrito a `{acesso, correcao, eliminacao, bloqueio, confirmacao}`;
     - `status`: estado do caso no ciclo de vida, restrito a `{aberto, em_analise, deferido, indeferido_parcial, indeferido_total, concluido, cancelado}`;
     - `legal_basis_note`: fundamentação legal e técnica da decisão (obrigatória em indeferimento total/parcial e em deferimento de eliminação com retenção legal parcial);
     - `request_details`: metadados da solicitação estruturados em JSONB (campos específicos solicitados para correção, escopo do acesso, motivo informado);
     - `opened_at`: timestamp com fuso da formalização do pedido;
     - `closed_at`: timestamp com fuso do encerramento;
     - `deadline_at`: timestamp com fuso do prazo regulatório de resposta;
     - `assigned_to`: identificador do operador administrativo ou DPO responsável pela triagem/análise;
     - `outcome`: código padronizado do desfecho final `{extrato_disponibilizado, dados_corrigidos, conta_anonimizada, recusado_impedimento_legal, recusado_fraude_identidade, cancelado_pelo_titular}`;
     - `created_at`, `updated_at`.
2. **Restrições de integridade, gatilhos e segurança:**
   - Habilitação compulsória de Row Level Security (RLS) e `FORCE ROW LEVEL SECURITY` na tabela `app.dsr_case`.
   - Revogação total de privilégios para papéis públicos (`anon`, `authenticated`, `public`). Acesso somente via papéis restritos de aplicação (`app_system`, `app_api`) e funções `SECURITY DEFINER` dedicadas.
   - Gatilho imutável que impede alteração de `protocol`, `subject_user_id`, `kind` e `opened_at` após a criação.
   - Gatilho que impede transições inválidas de estado e exige `legal_basis_note` e `closed_at` ao transitar para `{deferido, indeferido_parcial, indeferido_total, concluido}`.
   - Restrição de unicidade parcial impedindo mais de um caso ativo do mesmo `kind` para o mesmo `subject_user_id` enquanto houver caso em `{aberto, em_analise}`.
3. **Autenticação reforçada (Step-up Authentication) e anti-engenharia social:**
   - Exigência mandatória de confirmação de segurança (reautenticação via link mágico ou código de desafio recente / step-up de 15 minutos) antes de permitir a abertura de solicitação de acesso ou eliminação, impedindo que dispositivos compartilhados ou sessões sequestradas executem extração ou destruição de conta.
4. **Fluxo de Acesso aos Dados (DSR-Acesso):**
   - Criação da rotina de extração estruturada de dados pessoais do titular:
     - Dados cadastrais do usuário (`app_user.email`, data de criação, estado da conta);
     - Se profissional: perfil profissional (`professional_profile`), categorias de serviço atendidas, raio de atuação, histórico de status de verificação documental (sem expor segredos de cifra do documento `document_enc`/`document_hmac`), planos e concessões de acesso vigentes/anteriores (`access_grant`, `subscription`);
     - Se cliente: pedidos de serviço de sua titularidade (`service_request`), avaliações publicadas sob rótulo anônimo e consentimentos concedidos (`contact_consent`);
     - Mensagens de chat de que o titular foi participante ativo (somente texto das mensagens enviadas/recebidas pelo titular, sem metadados privados de outros usuários);
     - Registros da trilha de revelação de contatos autorizados (`contact_reveal_log`) vinculados a ele.
   - Empacotamento do extrato em payload JSON canônico assinado.
   - Disponibilização do extrato via token seguro temporário de uso único (URL assinada de visualização/download válida por até 7 dias, após os quais o arquivo gerado é purgado).
5. **Fluxo de Correção de Dados (DSR-Correção):**
   - Recepção de solicitação formal de retificação cadastral (ex.: alteração de nome civil/social, retificação de e-mail com revalidação de posse, atualização de endereço de base).
   - Se os dados afetarem documentos de verificação de identidade de profissional, o fluxo vincula a alteração à fila de verificação (H-039) para análise de consistência documental, sem bypass de validação.
6. **Fluxo de Eliminação / Anonimização de Dados (DSR-Eliminação):**
   - Verificação mandatória de ausência de `legal_hold` ativo para o sujeito (`app.legal_hold` entregue pela H-109).
   - Verificação de ausência de pedidos em andamento (pedidos não finalizados, não cancelados ou com serviços em disputa).
   - Verificação e cancelamento automático de cobranças futuras de assinaturas ativas em `billing.subscription`.
   - Execução atômica e irreversível do expurgo cadastral:
     - `app_user.email`: anonimizado para marcador irreversível unívoco que não permita reutilização nem reconstituição (ex.: `anon_<hash_uuid>@anon.fastpro.internal`);
     - `app_user.state`: alterado para `'anonimizado'` / `'excluido'`;
     - `professional_profile`: campos de nome, telefone, base e identificadores pessoais apagados ou anonimizados;
     - Revogação compulsória e imediata de todas as sessões ativas (`app.app_session`) do titular;
     - Limpeza de rascunhos pendentes e fotos em quarentena vinculadas ao usuário;
     - Preservação estrita dos registros de transações de pagamento (`billing.payment`) para atendimento a obrigações legais tributárias e societárias (Art. 16, I da LGPD);
     - Preservação imutável de todas as linhas de `audit.audit_event` pré-existentes, preservando a cadeia criptográfica de blocos e hashes de segurança;
     - Preservação dos registros de consentimento de contato (`app.contact_consent`) marcados como revogados com indicação expressa de encerramento da conta, para fins de prova regulatória de conformidade.
7. **Trilha de Auditoria Integral:**
   - Registro automático e compulsório em `audit.audit_event` para cada evento relevante do ciclo de vida: `dsr.case_opened`, `dsr.case_assigned`, `dsr.status_changed`, `dsr.access_extracted`, `dsr.correction_applied`, `dsr.subject_anonymized`, `dsr.case_closed`, `dsr.case_rejected`.
   - Eventos de auditoria contêm apenas referências (`case_id`, `subject_user_id`, `kind`, `actor_ref`), nunca dados pessoais sensíveis em claro ou conteúdo do extrato.
8. **Endpoints e Contratos de API:**
   - Rota do titular autenticado:
     - `POST /v1/privacy/dsr-requests` (abertura de solicitação com step-up token);
     - `GET /v1/privacy/dsr-requests` (listagem do histórico de solicitações do próprio titular autenticado);
     - `GET /v1/privacy/dsr-requests/:id` (consulta de status, protocolo e link de download quando deferido);
     - `POST /v1/privacy/dsr-requests/:id/cancel` (cancelamento voluntário pelo titular antes do processamento).
   - Rota do operador administrativo / DPO (`apps/api/src/privacy/` e console admin):
     - `GET /v1/admin/privacy/dsr-cases` (listagem e filtros por status, kind e prazo);
     - `GET /v1/admin/privacy/dsr-cases/:id` (detalhe do caso, histórico de auditoria e pendências);
     - `POST /v1/admin/privacy/dsr-cases/:id/assign` (atribuição do operador);
     - `POST /v1/admin/privacy/dsr-cases/:id/process` (deferimento, geração de extrato ou execução de anonimização assistida);
     - `POST /v1/admin/privacy/dsr-cases/:id/reject` (indeferimento com exigência de base legal formal e notificação).

---

## 4. Fora de escopo

- **BACKUP DE DADOS:** totalmente fora do escopo. A remoção de cópias de backup, restauração e exportação de base de dados inteira foi consolidada pela Issue #151 (Rodadas 73 e 75, decisões 349 a 358). Não mencione e não projete backup. Direitos do titular (extrato de dados individuais e anonimização de conta) e keep-alive de infraestrutura não são backup.
- **Histórico de acesso a fotos:** a tabela `ops.media_access_log` e o resumo diário `ops.media_access_daily` foram definitivamente extintos do produto pela Issue #150 / Rodada 67. Nenhum log de acesso a fotos existe ou deve ser gerado, extraído ou tratado em DSR.
- **Parecer e homologação jurídica definitiva (BLQ-JUR L1, L2):** a definição legal externa dos textos regulatórios da política de privacidade, suboperadores e prazos legais definitivos é incumbência da assessoria jurídica do produto (L1 e L2). H-111 entrega todo o código, esquema, testes e contratos no DEV parametrizados sob o modelo `[PROPOSTA]`, permanecendo a ativação em produção dependente da liberação formal do Jurídico.
- **Mecanismos de expurgo operacional automático por TTL técnico:** pertencem a H-110 (`ops_purge`, Issue #119). H-111 trata estritamente de solicitações deliberadas de direitos do titular sob demanda.
- **Configuração de políticas genéricas de retenção programada por classe:** entregues pela história H-109 (`retention_policy`, Issue #118). H-111 apenas interage com o `legal_hold` e aciona os adaptadores de anonimização já projetados em H-109.
- **Moderação de conteúdo, denúncias e disputas de pedidos:** pertencem a `moderation_case` (Épico E10). O fluxo de DSR é estritamente segregado e autônomo, não tratando condutas de usuários nem mediação de conflitos.
- **Fila de aprovação de documentos de verificação cadastral:** pertence a H-039 (#52). Se uma DSR de correção exigir nova análise de documentos de identidade, o caso de DSR apenas encaminha a atualização para a fila de verificação competente.
- **Processamento de estorno bancário ou chargeback:** pertence a H-115 (Épico E12). Caso o titular solicite cancelamento de conta com saldo ou cobrança em aberto, o tratamento financeiro segue a esteira financeira própria.
- **Envio de e-mails reais em homologação:** envio real depende de domínio verificado no provedor Resend; no desenvolvimento utiliza-se o Mailpit local (decisão 15, doc 13).
- **Chamadas a provedores de mapa externos:** o Mapbox real permanece estritamente proibido (Rodada 74). Toda a operação é local e autossuficiente no Postgres/Supabase.

---

## 5. Fluxos e estados

### 5.1 Ciclo de vida e máquina de estados de `dsr_case`

```
 [ Titular / DPO ]
        │
        ▼
   (  aberto  ) ──────────────────────────┐
        │                                 │
        ▼                                 ▼
 (  em_analise  )                  ( cancelado )
        │                                 ▲
        ├──► ( indeferido_total )         │ (cancelamento pelo titular
        │                                 │  antes de ser concluído)
        ├──► ( indeferido_parcial )       │
        │                                 │
        └──► ( deferido ) ────────────────┤
                 │
                 ▼
          ( concluido )
```

Transições permitidas na máquina de estados:
1. `aberto` → `em_analise`: quando o caso é triado ou assumido por operador/DPO (`assigned_to`).
2. `aberto` → `cancelado`: quando o próprio titular desiste da solicitação antes do início da análise.
3. `em_analise` → `deferido`: quando a análise jurídica/técnica aprova o atendimento integral do pedido.
4. `em_analise` → `indeferido_parcial`: quando parte do pedido é atendida e parte é recusada por motivo legal/regulatório (ex.: dados cadastrais anonimizados, mas faturas de pagamento retidas por dever fiscal).
5. `em_analise` → `indeferido_total`: quando a solicitação é integralmente rejeitada com fundamentação em `legal_basis_note` (ex.: presença de `legal_hold`, suspeita de fraude de identidade, tentativa de apagar provas de litígio ativo).
6. `deferido` / `indeferido_parcial` → `concluido`: quando o payload de extrato é disponibilizado com link ou quando as rotinas de anonimização no banco terminam com sucesso e o protocolo é selado.
7. Qualquer outra transição (ex.: `concluido` → `aberto`, `indeferido_total` → `deferido`) é expressamente proibida e rejeitada por gatilho de integridade.

---

### 5.2 Fluxo detalhado: Abertura de DSR pelo Titular

1. O titular autenticado acessa a interface de privacidade da plataforma e seleciona o direito a exercer: Acesso, Correção ou Eliminação.
2. A aplicação exige step-up de autenticação (revalidação de credencial / confirmação em duas etapas recente há menos de 15 minutos).
3. A API valida se o titular já possui solicitação aberta ou em análise para o mesmo tipo (`kind`). Se houver, recusa com erro 409 `{code: "dsr_em_andamento", protocol: "..."}`.
4. A API gera o número de protocolo padronizado e persiste a linha em `app.dsr_case` com status `aberto`, `opened_at = now()` e `deadline_at = now() + interval '15 days'` `[PROPOSTA]`.
5. Emite evento de auditoria `dsr.case_opened` em `audit.audit_event`.
6. Enfileira notificação de confirmação de recebimento para o e-mail do titular (contendo protocolo, tipo do direito e prazo regulatório de resposta).

---

### 5.3 Fluxo detalhado: Atendimento de DSR-Acesso (Exportação de Dados Pessoais)

1. O operador/sistema assume o caso (`status = em_analise`).
2. O serviço de privacidade (`privacy-service`) dispara a função segura `private.dsr_extract_subject_data(p_user_id)`.
3. A função executa consultas somente-leitura nas tabelas de dados do titular:
   - `app.app_user`: e-mail, telefone (se houver), estado da conta, data de cadastro.
   - `app.professional_profile` (se profissional): dados de apresentação, serviços atendidos, raio cadastrado, notas médias públicas agregadas, histórico de transições de status de verificação.
   - `app.service_request`: pedidos criados pelo titular como cliente (descrições, urgências, datas, status, fotos anexadas identificadas por metadado — sem expor URLs temporárias expiradas).
   - `app.acceptance`: participações em pedidos como profissional.
   - `app.conversation` e `app.message`: mensagens de chat enviadas e recebidas pelo titular em seus pedidos/atendimentos (somente texto; sem metadados privados do interlocutor).
   - `app.contact_consent`: consentimentos concedidos e suas revogações.
   - `app.contact_reveal_log`: registros de revelação de telefone ocorridos.
   - `billing.payment` e `billing.subscription` (se profissional): histórico de faturas e planos contratados.
4. A função compila os dados em formato JSON padronizado e higienizado (sem hashes de senhas, chaves de criptografia, segredos internos, nem referências a infraestrutura).
5. O extrato é empacotado em arquivo criptografado assinado temporário e armazenado em bucket privado com retenção técnica de 7 dias.
6. A URL assinada e segura de visualização/download é vinculada ao caso, e o status transita para `deferido` e em seguida `concluido`.
7. O titular recebe notificação por e-mail de que seu relatório de dados está pronto para download seguro por 7 dias.

---

### 5.4 Fluxo detalhado: Atendimento de DSR-Correção

1. O titular submete os campos específicos que necessitam de retificação e a justificativa documental correspondente.
2. O caso é triado pelo operador administrativo (`em_analise`).
3. Se a correção referir-se a dados comuns de perfil (ex.: nome de exibição, descrição, telefone com revalidação de código), o operador aplica a atualização ou a aplicação executa a alteração assistida.
4. Se a correção envolver documento de identidade formal ou CPF/CNPJ de profissional aprovado:
   - O caso de DSR valida que uma alteração dessa natureza exige novo ciclo de verificação para evitar fraude de identidade ou transferência de titularidade de conta.
   - O registro é enviado para a fila de verificação de identidade (H-039), e o perfil retorna ao estado de análise documental.
5. Após confirmação da retificação, o caso é transitado para `deferido` e `concluido`, com registro em auditoria dos campos alterados (armazenando apenas o nome do campo alterado, sem logar o dado novo em claro no evento).

---

### 5.5 Fluxo detalhado: Atendimento de DSR-Eliminação / Anonimização de Conta

1. O titular submete o pedido de cancelamento definitivo de conta e eliminação de seus dados pessoais.
2. A API executa verificações de pré-condições bloqueantes:
   - **Verificação 1 (`legal_hold`):** consulta se existe linha ativa em `app.legal_hold` para o `subject_user_id`. Se existir, o caso é imediatamente colocado em `indeferido_total` com nota explicativa de impedimento legal/ordem judicial (Art. 16, II da LGPD), e nenhuma linha é alterada.
   - **Verificação 2 (Pedidos e atendimentos em andamento):** verifica se o titular possui pedidos de serviço abertos ou em execução ativa. Se houver, a eliminação é recusada com orientação para cancelamento/conclusão prévia do atendimento antes da exclusão.
   - **Verificação 3 (Assinatura recorrente ativa):** se o profissional possuir assinatura ativa com renovação automática no Mercado Pago, a rotina dispara a instrução de cancelamento da recorrência para impedir novas cobranças.
3. Não havendo impedimentos, a transação de anonimização irreversível é executada no banco:
   - Dispara a função `private.dsr_anonymize_subject(p_user_id, p_case_id, p_justificativa)`:
     - `app.app_user`: atualiza `email` para marcador determinístico e irreversível `anon-<UUID>@anon.fastpro.internal`, e `state` para `'anonimizado'`.
     - `app.professional_profile`: zera `document_enc`, descarta `document_hmac` de unicidade (ou substitui por hash cego descartado), limpa bio, dados de contato e pontos geográficos exatos.
     - `app.identity_document`: descarta os arquivos de documentos armazenados no bucket `identity-docs` por meio de chamada à fila de expurgo de objetos (`retention_object_queue` entregue pela H-109).
     - `app.app_session`: exclui todas as sessões ativas do titular, forçando logout imediato em todos os dispositivos.
     - `app.contact_consent`: marca todos os consentimentos vigentes com `revoked_at = now()` e `revoked_reason = 'dsr_eliminacao'`.
     - Preserva `billing.payment` com o histórico financeiro intacto (necessário para obrigações tributárias).
     - Preserva `audit.audit_event` integralmente (não altera e não remove nenhuma linha de auditoria preexistente).
4. O caso transita para `deferido` e `concluido` com `outcome = 'conta_anonimizada'`, registrando `closed_at = now()`.
5. Emite evento final `dsr.subject_anonymized` na auditoria.
6. Notificação final de encerramento da conta e confirmação de anonimização é enviada ao e-mail de contato anterior do titular (notificação de saída).

---

## 6. Regras de negócio e invariantes

| Ref. | Regra | Fonte | Como H-111 atende |
|---|---|---|---|
| **RN-H111-01** | Segregação estrita entre privacidade (`dsr_case`) e moderação (`moderation_case`). | RF-140; 09 §3.8; 08 §13 | Tabela própria `app.dsr_case`, APIs próprias, papéis administrativos e fluxos separados. |
| **RN-H111-02** | Autenticação reforçada (Step-up) mandatória para abertura de Acesso e Eliminação. | RF-140; 08 §1.1; 05 FA-030 | Validação de token de desafio/reautenticação com validade máxima de 15 minutos na abertura. |
| **RN-H111-03** | `legal_hold` suspende e bloqueia qualquer ação destrutiva ou expurgo. | ADR-016; 09 §3.8; H-109 | Verificação antes da execução da anonimização; presença de hold recusa a eliminação. |
| **RN-H111-04** | Auditoria imutável (append-only): nenhuma linha de `audit.audit_event` é apagada ou alterada. | RF-140; 09 §3; H-006; I-15 | `audit_event` é intocável. A anonimização do sujeito não faz UPDATE/DELETE na auditoria. |
| **RN-H111-05** | Preservação de registros fiscais e contábeis de pagamentos (`billing.payment`). | Art. 16, I LGPD; 09 §8 RC-06 | Pagamentos e notas não são apagados nem anonimizados em faturamento. |
| **RN-H111-06** | Preservação da trilha de consentimento e revelação de contatos. | Art. 16, II LGPD; 09 §8 RC-10 | `contact_consent` tem revogação registrada com timestamp; `contact_reveal_log` permanece íntegro. |
| **RN-H111-07** | O relatório de acesso não expõe segredos técnicos nem dados de terceiros. | RF-136 a RF-139; FA-030; I-16 | A função de extração filtra PII de terceiros e omite hashes de senha, tokens e chaves criptográficas. |
| **RN-H111-08** | Bloqueio de eliminação imediata com pedidos ou atendimentos em andamento. | RF-140; integridade operacional | Pedido aberto ou em execução exige encerramento ou cancelamento prévio antes da exclusão. |
| **RN-H111-09** | Eliminação cadastral é irreversível no plano da aplicação (anonimização com marcador). | ADR-016; H-109 | Substituição do e-mail por marcador unívoco `anon-<hash>@anon.fastpro.internal` e encerramento de sessão. |
| **RN-H111-10** | Prazo regulatório de resposta de 15 dias corridos `[PROPOSTA]`. | Art. 19, II LGPD; `[PENDENTE JURIDICO]` L1 | Campo `deadline_at` calculado na abertura com base no parâmetro configurável em `app_config`. |
| **RN-H111-11** | Unicidade de caso ativo por tipo: um único caso aberto/em análise por `kind` para o mesmo titular. | Prevenção de concorrência e DoS | Índice único parcial `(subject_user_id, kind) WHERE status IN ('aberto', 'em_analise')`. |
| **RN-H111-12** | Eventos de auditoria gerados em todas as fases da solicitação de DSR. | H-006; 08 §13; I-15 | Chamadas transacionais a `audit_append` em abertura, análise, decisão e conclusão. |
| **RN-H111-13** | Sem registro ou histórico de acesso a fotos (`media_access_log` eliminado). | Rodada 67; Issue #150 | A extração e o expurgo não referenciam e não processam logs de acesso a fotos. |
| **RN-H111-14** | Operação estritamente local e sem serviços externos proibidos. | Rodada 74; AGENTS.md | Provedores externos de mapas ou SMS proibidos; tudo roda localmente com banco Supabase/Postgres. |
| **RN-H111-15** | Descarte de mídias privadas de verificação no Storage via fila de expurgo. | H-109; 09 §8 RC-01 | Objetos em `identity-docs` enfileirados em `retention_object_queue` para deleção segura. |
| **RN-H111-16** | Backup de dados está fora do escopo do projeto: sem rotinas ou comandos de backup. | Rodadas 73 e 75; Issue #151 | Nenhuma menção a backup de banco de dados; direitos do titular não realizam cópia bruta de tabelas. |

---

## 7. Critérios de aceite (Given/When/Then e testáveis)

- **CA-H111-01 (Esquema da tabela `app.dsr_case`).**
  - **Dado** o esquema do banco de dados,
  - **Quando** a migração da H-111 for aplicada,
  - **Então** a tabela `app.dsr_case` existe com as colunas `id`, `protocol`, `subject_user_id`, `kind`, `status`, `legal_basis_note`, `request_details`, `opened_at`, `closed_at`, `deadline_at`, `assigned_to`, `outcome`, `created_at`, `updated_at`, com tipos e CHECKs estritos de `kind` e `status`.
  - *Prova:* consulta ao catálogo de tabelas e restrições no banco de dados.

- **CA-H111-02 (RLS e isolamento de papéis em `dsr_case`).**
  - **Dado** o papel `anon` ou `authenticated` tentando acesso direto via `SELECT`, `INSERT`, `UPDATE` ou `DELETE` na tabela `app.dsr_case`,
  - **Quando** o comando é executado no banco,
  - **Então** a operação é sumariamente recusada por permissão e RLS forçada (`permission denied`).
  - *Prova:* teste de privilégios de banco com papéis não administrativos.

- **CA-H111-03 (Abertura de DSR pelo titular com step-up válido).**
  - **Dado** um titular de conta autenticado com sessão válida e token de step-up gerado há menos de 15 minutos,
  - **Quando** envia requisição `POST /v1/privacy/dsr-requests` com `{kind: "acesso"}`,
  - **Então** a API retorna status HTTP 201 com `{protocol: "DSR-...", kind: "acesso", status: "aberto", deadline_at: "..."}`, a linha é inserida no banco e um evento de auditoria `dsr.case_opened` é gravado na mesma transação.
  - *Prova:* teste de rota de API com credencial autenticada e verificação de linha no banco e em `audit.audit_event`.

- **CA-H111-04 (Recusa de abertura sem step-up authentication).**
  - **Dado** um titular autenticado que tenta abrir solicitação de DSR sem fornecer token de step-up ou com token expirado/inválido,
  - **Quando** submete `POST /v1/privacy/dsr-requests`,
  - **Então** a API recusa com status HTTP 403 / 401 `{code: "step_up_obrigatorio"}` e nenhum caso é criado no banco.
  - *Prova:* teste de integração de rota simulando requisição sem reautenticação.

- **CA-H111-05 (Bloqueio de solicitações simultâneas duplicadas).**
  - **Dado** um titular que já possui um caso do tipo `acesso` com status `aberto` ou `em_analise`,
  - **Quando** tenta abrir uma segunda solicitação com o mesmo `kind`,
  - **Então** a API recusa com HTTP 409 `{code: "dsr_em_andamento", protocol: "..."}` e nenhuma segunda linha é criada.
  - *Prova:* teste de unicidade com tentativa consecutiva de abertura para o mesmo titular.

- **CA-H111-06 (Máquina de estados: transições permitidas e recusadas).**
  - **Dado** um caso de DSR em status `aberto`,
  - **Quando** o operador transita para `em_analise`, a transição é aceita; se tentar transitar direto de `concluido` para `aberto`,
  - **Então** o banco recusa a alteração por gatilho de integridade de estado (`violacao_maquina_estados`).
  - *Prova:* teste unitário de banco executando todas as transições válidas e forçando transições proibidas.

- **CA-H111-07 (Extração higienizada no DSR-Acesso).**
  - **Dado** um caso de DSR do tipo `acesso` deferido,
  - **Quando** a rotina de extração é executada para o titular,
  - **Então** o payload de dados gerado contém seu cadastro, histórico de pedidos, avaliações atribuídas e consentimentos, sem conter segredos técnicos, hashes internos de segurança, nem dados privados de terceiros.
  - *Prova:* teste de serviço validando o esquema JSON gerado e asserção de ausência de chaves de infraestrutura.

- **CA-H111-08 (Disponibilização do extrato com prazo de expiração de 7 dias).**
  - **Dado** a conclusão de um caso de DSR-Acesso,
  - **Quando** o titular consulta `GET /v1/privacy/dsr-requests/:id`,
  - **Então** recebe URL segura de download temporário com prazo de validade de 7 dias, após os quais o arquivo é tornado inacessível.
  - *Prova:* teste de rota de consulta e verificação de metadados de expiração da URL assinada.

- **CA-H111-09 (Execução de DSR-Eliminação com anonimização irreversível).**
  - **Dado** um titular com conta ativa, sem pedidos pendentes e sem `legal_hold`,
  - **Quando** o caso de `eliminacao` é deferido e concluído,
  - **Então** o e-mail em `app.app_user` é substituído pelo marcador `anon-<hash>@anon.fastpro.internal`, o perfil é limpo, todas as sessões em `app.app_session` são revogadas e o titular não consegue mais autenticar na plataforma.
  - *Prova:* teste de ponta a ponta de eliminação seguido de tentativa de autenticação com o e-mail original (recusada).

- **CA-H111-10 (Bloqueio estrito de eliminação sob `legal_hold` ativo).**
  - **Dado** um titular que possui um registro ativo em `app.legal_hold`,
  - **Quando** submete solicitação de DSR-Eliminação ou quando o operador tenta deferi-la,
  - **Então** a operação de eliminação é categoricamente bloqueada, o caso é indeferido com justificativa fundamentada de retenção legal obrigatória (Art. 16, II LGPD) e nenhuma linha do usuário é alterada.
  - *Prova:* teste com inserção de fixture com `legal_hold` e tentativa de anonimização.

- **CA-H111-11 (Preservação incondicional de `audit.audit_event`).**
  - **Dado** a execução completa de uma solicitação de DSR-Eliminação,
  - **Quando** se compara a contagem e os hashes das linhas de `audit.audit_event` pré-existentes relativas ao titular,
  - **Então** todas as linhas de auditoria permanecem rigorosamente inalteradas e intactas, comprovando que a anonimização de cadastro não viola o caráter append-only da auditoria.
  - *Prova:* contagem e verificação de integridade da tabela de auditoria antes e depois da execução do expurgo do titular.

- **CA-H111-12 (Preservação incondicional de `billing.payment`).**
  - **Dado** um profissional que possui pagamentos faturados registrados em `billing.payment` e solicita eliminação de conta,
  - **Quando** a eliminação é concluída,
  - **Então** os registros de pagamento permanecem intactos no banco de dados para fins de conformidade fiscal e comprovação contábil (Art. 16, I da LGPD).
  - *Prova:* asserção de persistência das linhas em `billing.payment` após anonimização do usuário.

- **CA-H111-13 (Cancelamento de assinatura recorrente na eliminação).**
  - **Dado** um profissional com assinatura ativa com renovação automática configurada (`billing.subscription.mode = 'cartao_recorrente'`),
  - **Quando** o caso de DSR-Eliminação é processado,
  - **Então** o registro de assinatura é marcado como cancelado imediatamente (`cancel_at_period_end = true` ou cancelamento imediato) e nenhuma nova renovação futura é disparada.
  - *Prova:* teste de integração verificando a atualização do estado da assinatura.

- **CA-H111-14 (Cancelamento voluntário pelo titular antes do início da análise).**
  - **Dado** um caso de DSR com status `aberto`,
  - **Quando** o próprio titular aciona `POST /v1/privacy/dsr-requests/:id/cancel`,
  - **Então** o status do caso é atualizado para `cancelado`, o encerramento é registrado e o caso não é mais processado.
  - *Prova:* teste de rota de cancelamento pelo próprio usuário criador.

- **CA-H111-15 (Indeferimento com exigência compulsória de base legal).**
  - **Dado** um operador administrativo registrando indeferimento parcial ou total de uma solicitação de DSR,
  - **Quando** tenta salvar a decisão sem preencher `legal_basis_note`,
  - **Então** a operação é rejeitada pelo banco (`nota_base_legal_obrigatoria`), impedindo decisões discricionárias sem fundamento normativo registrado.
  - *Prova:* tentativa de UPDATE para status indeferido com campo de nota nulo ou vazio (rejeitada).

- **CA-H111-16 (Isolamento de acesso: titular vê apenas seus casos).**
  - **Dado** o titular A autenticado na plataforma,
  - **Quando** requisita `GET /v1/privacy/dsr-requests` ou busca pelo ID de um caso pertencente ao titular B,
  - **Então** a API retorna apenas os casos do titular A; a consulta pelo ID do caso do titular B resulta em 404 Not Found uniforme (anti-enumeração).
  - *Prova:* teste de rota com dois usuários distintos validando o filtro estrito de posse.

- **CA-H111-17 (Ausência total de histórico de fotos em conformidade com #150).**
  - **Dado** o processamento de qualquer solicitação de DSR (Acesso, Correção ou Eliminação),
  - **Quando** as consultas e expurgos rodam,
  - **Então** nenhuma rotina busca, referencia ou tenta manipular `media_access_log` ou `media_access_daily`, operando sem falha em consonância com a exclusão definitiva do histórico de fotos (Issue #150).
  - *Prova:* varredura estática de código e testes garantindo ausência de símbolos do histórico de fotos.

- **CA-H111-18 (Execução local e autossuficiente sem chamadas externas).**
  - **Dado** a execução da suíte completa de testes de domínio, banco e rotas de DSR,
  - **Quando** os testes rodam no ambiente de desenvolvimento,
  - **Então** rodam de ponta a ponta sem qualquer chamada a serviços de rede externa, sem dependência de chaves de provedores externos de mapas ou SMS e sem conexão de produção.
  - *Prova:* execução com mock de e-mail (Mailpit local) e portas de serviço locais.

---

## 8. Matriz de dados e classes de retenção no exercício de direitos

Confronto com `09-MODELO-DADOS.md` §7, §8 e a história H-109:

| Classe | Descrição | No Acesso (DSR-Acesso) | Na Eliminação (DSR-Eliminação) | Base de Preservação |
|---|---|---|---|---|
| **RC-01** | Documentos de identidade e verificação (`document_enc`, bucket `identity-docs`) | Informa status histórico da análise; não expõe arquivos brutos nem chaves de cifra | Mídias apagadas no Storage; campos pessoais de documento descartados | Eliminação completa, exceto se houver `legal_hold` ativo |
| **RC-02** | Cadastro (`app_user`, e-mail, perfil) | Exportado integralmente em formato estruturado | Anonimizado irreversivelmente (`anon-<hash>@anon.fastpro.internal`) | Linha mantida apenas como âncora relacional por FK, sem dado em claro |
| **RC-03** | Pedidos, descrições, endereços e fotos do pedido | Exporta pedidos de sua autoria, rótulos públicos e referências | Endereço exato descartado; descrições e fotos de pedidos fechados expurgadas ou dissociadas | Mantém registro mínimo dissociado de titularidade para integridade |
| **RC-04** | Mensagens de chat (somente texto) | Exporta mensagens enviadas e recebidas pelo titular | Mensagens mantidas na conversa com remetente anonimizado, ou texto anonimizado conforme decisão jurídica | Preservação da integridade da comunicação para o outro participante |
| **RC-05** | Avaliações (`review`) | Exporta avaliações publicadas vinculadas à conta | Autor fixo já é "Cliente do FastPro"; vínculo pessoal é desfeito, nota pública permanece | Preservação da reputação do profissional e da idoneidade da plataforma |
| **RC-06** | Registros financeiros (`billing.payment`) | Exporta faturas e pagamentos realizados pelo profissional | **Sempre retido integralmente** | Obrigação legal tributária e contábil (Art. 16, I da LGPD) |
| **RC-07** | Auditoria (`audit.audit_event`) | **Não exporta** linhas internas de auditoria técnica do sistema | **Sempre retido integralmente** (append-only) | Segurança, prevenção a fraudes e dever de responsabilização (LGPD Art. 6º, X) |
| **RC-08** | Logs operacionais do servidor | Não exportado | Expurgado por rotina técnica de TTL curto | Não aplicável |
| **RC-09** | Sessões (`app_session`), desafios, rascunhos | Não exportado (dados transitórios de autenticação) | Sessões ativas excluídas imediatamente; rascunhos descartados | Revogação de acesso |
| **RC-10** | Consentimentos (`contact_consent`, `contact_reveal_log`) | Exporta histórico de consentimentos e revelações | Marcados como revogados com registro formal do encerramento da conta | Prova regulatória de cumprimento do consentimento (Art. 16, II LGPD) |

---

## 9. Dependências reais (conferidas no quadro oficial)

1. **H-109 (#118 — Mecanismo de retenção sem prazos):**
   - *Status no quadro:* `Concluído`.
   - *Relação:* Fornece a tabela e os adaptadores de `app.legal_hold`, a fila de expurgo de objetos em Storage `retention_object_queue` e o padrão de anonimização por marcador.
2. **H-006 (#19 — Auditoria append-only):**
   - *Status no quadro:* `Concluído`.
   - *Relação:* Fornece `audit.audit_event`, a função `audit.audit_append` e a garantia criptográfica de que a trilha de segurança nunca sofre mutação nem exclusão.
3. **H-017 (#30 — Exclusividade de papéis e identidade):**
   - *Status no quadro:* `Concluído`.
   - *Relação:* Fornece a base de `app.app_user`, segregação por papéis (`customer`, `professional`, `admin`) e modelo de autenticação.
4. **H-005 (#18 — Esqueleto transversal):**
   - *Status no quadro:* `Concluído`.
   - *Relação:* Fornece a infraestrutura de banco de dados, idempotência, jobs e padrões de transação segura.
5. **H-033 (#46 — Opt-in de telefone e consentimentos):**
   - *Status no quadro:* `QA` (desenvolvimento concluído e migração `20261113250000` aplicada no DEV).
   - *Relação:* Fornece `app.contact_consent` e `app.contact_reveal_log` que são consultados no DSR-Acesso e revogados no DSR-Eliminação.
6. **H-037 (#50 — Documentos de identidade) e H-039 (#52 — Fila de verificação):**
   - *Status no quadro:* Ambas `Concluído`.
   - *Relação:* Fornecem as entidades de documentos de identidade e o fluxo de análise cadastral que se articulam com a retificação de dados pessoais em DSR-Correção.
7. **H-110 (#119 — Expurgos operacionais):**
   - *Status no quadro:* `Concluído`.
   - *Relação:* Cuida de TTLs operacionais de dados transitórios (sessões órfãs, quarentena de mídia).
8. **H-150 (#150 — Remoção do histórico de fotos):**
   - *Status no quadro:* `Concluído`.
   - *Relação:* Extinguiu `media_access_log` e `media_access_daily`, assegurando que a extração de dados pessoais não dependa de tabelas inexistentes.
9. **H-151 (#151 — Remoção de backup do escopo do projeto):**
   - *Status no quadro:* `Concluído`.
   - *Relação:* Removeu cópias de backup e scripts associados do produto, reafirmando que o exercício de direitos do titular opera exclusivamente no plano transacional da aplicação ativa.

---

## 10. Riscos e mitigações

- **R1. Engenharia social e sequestro de conta para exfiltração de dados (DSR-Acesso).**
  - *Risco:* Um atacante que obtenha acesso efêmero à sessão do titular (ex.: dispositivo desbloqueado) solicita o download completo dos dados pessoais da vítima.
  - *Mitigação:* Exigência compulsória de autenticação reforçada (Step-up Authentication com novo desafio de verificação) no momento da abertura da solicitação, além de envio imediato de alerta de segurança para o e-mail cadastrado informando a requisição do extrato.
- **R2. Destruição de dados probatórios essenciais sob litígio (DSR-Eliminação maliciosa).**
  - *Risco:* Um usuário comete fraude ou ato lesivo e imediatamente solicita a eliminação da conta para apagar as evidências.
  - *Mitigação:* Integração mandatória com `app.legal_hold` (H-109). A presença de qualquer hold administrativo ou judicial suspende a eliminação. Além disso, a auditoria em `audit.audit_event` e os registros financeiros em `billing.payment` são preservados de forma imutável e perpétua.
- **R3. Conflito entre eliminação de conta e pedidos/atendimentos em andamento.**
  - *Risco:* Cliente ou profissional pede exclusão de conta enquanto há serviço contratado em andamento, gerando prejuízo a terceiro de boa-fé.
  - *Mitigação:* Guarda estrita que recusa o deferimento de eliminação enquanto houver pedido aberto, participação ativa em serviço não concluído ou pendência de pagamento.
- **R4. Vazamento de dados de terceiros na exportação de conversas de chat.**
  - *Risco:* A extração de mensagens de chat expor dados privados do interlocutor (telefone não consentido, endereço, metadados de sessão).
  - *Mitigação:* O extrato compila estritamente o texto das mensagens enviadas/recebidas e o papel do interlocutor ("Cliente" ou "Profissional"), sem expor qualquer dado cadastral do outro participante além do que foi legitimamente compartilhado no fluxo regular do chat.
- **R5. Ataques de negação de serviço (DoS) por abertura massiva de requisições de extrato.**
  - *Risco:* Titular ou script automatizado abre sucessivas requisições pesadas de extração de dados, sobrecarregando o banco e o Storage.
  - *Mitigação:* Unicidade estrita de caso ativo por tipo (índice parcial) e limitador de taxa (rate limiting) de abertura de DSR por usuário/IP.
- **R6. Inconsistência na anonimização de dados relacionais e quebra de integridade referencial.**
  - *Risco:* A tentativa de excluir ou anonimizar o registro de `app_user` disparar violação de chave estrangeira (FK) em tabelas que exigem integridade histórica (`audit_event`, `billing.payment`, `service_request`).
  - *Mitigação:* O padrão adotado é a anonimização de colunas com preservação da linha física por chave primária (o e-mail e dados pessoais recebem marcadores irreversíveis, a conta é desativada, mas o UUID é preservado como âncora imutável de FK).

---

## 11. Perguntas ao líder (Orquestrador)

Lista única de perguntas numeradas de **663 a 682** (20 itens). Conforme diretriz canônica, as perguntas de ordem jurídica e regulatória da LGPD estão marcadas como `[PENDENTE JURIDICO]`, trazendo o modelo `[PROPOSTA]` adotado no ambiente de DESENVOLVIMENTO para permitir a construção e os testes automatizados da história.

---

**663. [PENDENTE JURIDICO] Prazo regulatório de resposta ao titular (Art. 19 da LGPD).** A LGPD prevê resposta simplificada imediata ou declaração clara e completa em até 15 dias a contar da data do requerimento.
- (a) `[PROPOSTA]` Adotar 15 dias corridos para todas as solicitações de Acesso e Eliminação, gravado em `deadline_at` e configurável via `ops.app_config` (`privacy.dsr_deadline_days = 15`), com confirmação imediata do recebimento da solicitação em até 24 h.
- (b) Adotar 15 dias úteis.
- **Recomendação do PO:** (a). 15 dias corridos confere margem segura de atendimento e padroniza os cálculos de timestamp em banco (`now() + interval '15 days'`). Destrava CA-H111-01 e CA-H111-03.

**664. Formato e entrega do extrato de dados (DSR-Acesso).** Em qual formato o relatório de dados pessoais deve ser disponibilizado para download pelo titular?
- (a) `[PROPOSTA]` Arquivo JSON estruturado canônico (`fastpro-dsr-extrato-<protocolo>.json`), contendo metadados de autenticidade, acompanhado de visualização simplificada na interface web.
- (b) Arquivo PDF estático gerado por biblioteca no servidor.
- **Recomendação do PO:** (a). O formato JSON estruturado atende perfeitamente ao requisito de legibilidade e interoperabilidade sem onerar o consumo de CPU/memória com renderizadores pesados de PDF no plano gratuito da Vercel. Destrava CA-H111-07 e o desenho da API.

**665. Autenticação reforçada (Step-up) na abertura de DSR de Acesso e Eliminação.** Qual o mecanismo e tolerância de tempo exigidos para reautenticar o titular antes de autorizar a submissão do pedido?
- (a) `[PROPOSTA]` Revalidação por link mágico/código enviado ao e-mail cadastrado, gerando um token efêmero de step-up (`step_up_token`) válido por 15 minutos, exigido no payload da requisição `POST /v1/privacy/dsr-requests`.
- (b) Apenas a sessão ativa regular sem step-up adicional.
- **Recomendação do PO:** (a). Protege contra acesso oportunista em sessões deixadas abertas e evita solicitações fraudulentas de extração ou destruição de conta. Destrava CA-H111-03 e CA-H111-04.

**666. [PENDENTE JURIDICO] Tratamento das mensagens de chat na eliminação de conta.** Quando o titular de uma conta solicita a eliminação dos seus dados pessoais, como tratar as mensagens enviadas por ele nas conversas com outros usuários?
- (a) `[PROPOSTA]` Manter o texto histórico da mensagem na conversa para preservar o contexto e a integridade da relação contratual com o outro participante, substituindo a identificação do autor pelo rótulo impessoal `"Usuário excluído"` e desvinculando o ponteiro de perfil.
- (b) Apagar integralmente todas as mensagens enviadas pelo titular, deixando mensagens vazias ou marcadores de remoção na conversa.
- **Recomendação do PO:** (a). A exclusão sumária do texto de mensagens pode prejudicar a defesa de direitos ou a comprovação de acordos pelo outro participante do serviço (Art. 16, IV da LGPD). Destrava CA-H111-09 e a função de banco `private.dsr_anonymize_subject`.

**667. [PENDENTE JURIDICO] Tratamento das avaliações públicas (`review`) no cancelamento de conta de cliente.** Quando um cliente que avaliou profissionais solicita a eliminação de seus dados pessoais, como tratar as avaliações publicadas por ele?
- (a) `[PROPOSTA]` Manter as avaliações e as notas publicadas intactas, visto que o autor público já é fixado genericamente como `"Cliente do FastPro"` (decisão arquitetural preexistente), quebrando-se unicamente qualquer chave estrangeira que aponte para o cadastro original do cliente.
- (b) Excluir as avaliações e recalcular a média do profissional.
- **Recomendação do PO:** (a). A avaliação integra o patrimônio reputacional do profissional e a segurança dos futuros clientes. Como não expõe o nome nem o e-mail do autor, a dissociação cadastral é suficiente para o direito de eliminação. Destrava RN-H111-09 e o adaptador de anonimização.

**668. [PENDENTE JURIDICO] Retenção de registros de conexão (Marco Civil da Internet, Art. 15).** O Marco Civil da Internet exige a guarda de registros de acesso a aplicações de internet pelo prazo de 6 meses sob sigilo. Como compatibilizar essa obrigação com o pedido de eliminação da LGPD?
- (a) `[PROPOSTA]` Os registros de login e autenticação em `app.app_session` e `audit.audit_event` que contenham o IP (armazenado como HMAC seguro com sal) são retidos pelo prazo legal estrito de 6 meses para atendimento à ordem judicial expressa, não sendo expurgados pela rotina de DSR imediata, conforme exceção expressa do Art. 16, I da LGPD.
- (b) Apagar imediatamente todos os registros que contenham referências de conexão.
- **Recomendação do PO:** (a). A LGPD autoriza a conservação de dados para cumprimento de obrigação legal ou regulatória pelo controlador (Art. 16, I). Destrava a matriz da seção 8 e RN-H111-04.

**669. [PENDENTE JURIDICO] Retenção de faturamento e pagamentos (`billing.payment`).** Qual o prazo de retenção e tratamento dos registros de pagamentos em caso de eliminação de conta de profissional?
- (a) `[PROPOSTA]` Retenção integral dos registros de pagamentos efetuados e faturas pelo prazo de 5 anos (Código Tributário Nacional e Código de Defesa do Consumidor), desvinculando dados secundários não fiscais do profissional mas preservando o histórico contábil.
- (b) Anonimizar os valores de pagamento após o cancelamento da conta.
- **Recomendação do PO:** (a). Alterar valores ou comprovantes financeiros viola obrigações fiscais basilares da empresa. Destrava CA-H111-12 e RN-H111-05.

**670. [PENDENTE JURIDICO] Titular profissional com cadastro recusado ou retido por duplicidade que solicita eliminação.** Se um profissional teve seu cadastro recusado ou retido por duplicidade (Issue #53) e submete DSR de eliminação:
- (a) `[PROPOSTA]` A anonimização limpa os dados cadastrais em claro e os documentos em Storage, mas preserva o hash cego do documento (`document_hmac`) marcado como retido preventivamente para evitar reentrada e burla reiterada de segurança cadastral (exercício regular de direitos e antifraude, Art. 7º, IX e X da LGPD), registrando a justificativa em `legal_basis_note`.
- (b) Apagar também o hash do documento, permitindo que o profissional recusado faça novo cadastro imediato.
- **Recomendação do PO:** (a). A preservação do HMAC como lista de restrição cadastral antifraude é medida legítima de segurança do ecossistema. Destrava a integração com H-040 (#53).

**671. Cancelamento compulsório de assinatura ativa no pedido de eliminação.** Se o profissional solicitar eliminação de dados enquanto possui assinatura vigente no Mercado Pago com cobrança recorrente:
- (a) `[PROPOSTA]` A rotina de DSR-Eliminação cancela imediatamente a assinatura recorrente junto ao provedor de pagamento (`cancel_at_period_end = true` ou cancelamento imediato), impedindo renovações futuras, e informa o cancelamento formal no protocolo de encerramento.
- (b) A solicitação de DSR é recusada exigindo que o profissional cancele a assinatura manualmente na tela de cobrança antes de pedir a exclusão.
- **Recomendação do PO:** (a). Oferece experiência coerente e evita litígios decorrentes de cobrança pós-solicitação de cancelamento. Destrava CA-H111-13 e RN-H111-08.

**672. Prazo de validade do link de download do extrato (DSR-Acesso).** Qual deve ser o TTL da URL de download seguro disponibilizada ao titular?
- (a) `[PROPOSTA]` 7 dias corridos (168 horas), após os quais o arquivo é expurgado do bucket de entrega e o link perde a validade. Se o titular precisar de nova cópia, deve abrir novo requerimento de acesso.
- (b) 24 horas.
- **Recomendação do PO:** (a). 7 dias é um período razoável para o titular acessar sua caixa postal e efetuar o download com tranquilidade, sem manter arquivos exportados perpetuamente em repouso. Destrava CA-H111-08.

**673. [PENDENTE JURIDICO] Abertura de DSR por procurador ou via canal externo do DPO.** O FastPro deve permitir que um operador administrativo cadastre um `dsr_case` em nome de um titular (ex.: solicitação recebida por e-mail oficial do DPO ou notificação formal da ANPD)?
- (a) `[PROPOSTA]` Sim. O console administrativo/DPO disporá do endpoint `POST /v1/admin/privacy/dsr-cases` para abertura assistida, registrando obrigatoriamente a identificação do operador responsável (`opened_by_operator_id`) e o canal de origem (`canal = 'dpo_externo'`).
- (b) Não. Apenas o próprio usuário autenticado pode abrir DSR.
- **Recomendação do PO:** (a). Atende a requisições de titulares com dificuldade de acesso à conta ou representados legalmente por advogados/procuradores. Destrava a rota administrativa de abertura e o modelo de dados.

**674. Bloqueio cautelar de conta durante o processamento da eliminação.** Durante o intervalo entre o recebimento da solicitação de eliminação e o encerramento do processo:
- (a) `[PROPOSTA]` A conta é suspensa cautelarmente para novas contratações ou aceites de pedidos no ato da abertura (`account_state = 'em_processo_eliminacao'`), impedindo a criação de novos vínculos operacionais enquanto a exclusão é processada.
- (b) A conta segue ativa normalmente até o instante exato do deferimento.
- **Recomendação do PO:** (a). Evita que o titular assuma compromissos de serviço no exato momento em que seus dados estão sendo preparados para anonimização. Destrava RN-H111-08.

**675. Notificações transacionais por e-mail do andamento do DSR.** Quais eventos do caso de DSR disparam e-mail automático ao titular?
- (a) `[PROPOSTA]` Três e-mails padrão: (1) Confirmação de abertura com número de protocolo e prazo; (2) Aviso de conclusão com link de acesso seguro (no caso de DSR-Acesso); (3) Aviso de conclusão ou indeferimento fundamentado (no caso de DSR-Eliminação ou recusa).
- (b) Sem envio de e-mails, com acompanhamento exclusivo na tela da aplicação.
- **Recomendação do PO:** (a). Garante a formalidade do atendimento regulatório e tranquilidade jurídica à empresa. No desenvolvimento, os e-mails são capturados pelo Mailpit local (sem chamadas externas reais). Destrava a especificação de notificações da seção 3.

**676. Perfil de acesso administrativo para gestão de `dsr_case`.** No catálogo de papéis de administração (`08` §13 / `111-REFINO-H111-admin`), quem possui permissão para visualizar e decidir casos de DSR?
- (a) `[PROPOSTA]` Papel específico de `DPO` / `Encarregado` e papel `Superadmin`; operadores de Suporte comum possuem permissão apenas de visualização básica de status de protocolo; auditores possuem acesso somente-leitura.
- (b) Qualquer administrador do painel pode deferir ou indeferir DSRs.
- **Recomendação do PO:** (a). Respeita o princípio do menor privilégio e segregação de funções regulatórias. Destrava os requisitos de permissões da seção 3 e RLS.

**677. Dupla aprovação administrativa para deferimento de eliminação total.** A exclusão definitiva/anonimização de uma conta deve exigir dupla aprovação de administradores distintos (`approval_request` de `08` §13)?
- (a) `[PROPOSTA]` Aberturas automáticas do próprio titular autenticado com step-up válido dispensam dupla aprovação humana (execução automatizada assistida); aberturas manuais registradas pelo admin/DPO exigem confirmação/dupla aprovação antes de anonimizar.
- (b) Toda e qualquer eliminação exige dupla aprovação humana.
- **Recomendação do PO:** (a). Permite escalabilidade no autoatendimento do titular legítimo, mantendo a guarda de dupla aprovação apenas para ações administrativas manuais. Destrava o fluxo 5.5 e critérios de aceite.

**678. [PENDENTE JURIDICO] Tratamento de pedidos de serviço concluídos com dados de localização.** Como tratar os dados de localização de pedidos concluídos na eliminação da conta do cliente autor?
- (a) `[PROPOSTA]` As coordenadas exatas (`exact_point`) e o texto de endereço cifrado (`address_text_enc`) são eliminados/zerados; o ponto de casamento generalizado em grade (`match_point`) e o rótulo público generalizado (`public_label` ex.: "Bairro, Cidade - UF") são preservados para integridade histórica dos relatórios de atendimento do profissional, sem identificar a residência ou o titular.
- (b) Excluir completamente todos os registros geográficos do pedido.
- **Recomendação do PO:** (a). Preserva a comprovação dos serviços prestados pelo profissional sem reter dados que permitam a reidentificação do cliente. Destrava RN-H111-09 e o adaptador de expurgo de pedidos.

**679. Reutilização de e-mail de conta anonimizada no futuro.** Uma pessoa cujo e-mail foi anonimizado pode se cadastrar novamente no FastPro com o mesmo endereço de e-mail no futuro?
- (a) `[PROPOSTA]` Sim. Como o e-mail original foi substituído no banco por um identificador irreversível (`anon-<hash>@anon.fastpro.internal`), o endereço de e-mail original deixa de constar no índice único de `app_user.email`, permitindo que o titular inicie uma nova conta limpa no futuro caso deseje.
- (b) Não. O e-mail original deve entrar em uma lista de bloqueio permanente para impedir novos cadastros.
- **Recomendação do PO:** (a). O direito à eliminação deve devolver o titular ao estado anterior de não cliente, sem penalização de banimento eterno, salvo se houver registro em lista restritiva por fraude comprovada. Destrava RN-H111-09 e testes de ciclo de vida.

**680. Solicitação de DSR por titular com rascunho de pedido sem conta (`request_draft`).** Usuários que criaram rascunhos de pedidos de serviço sem possuir conta ativa formal:
- (a) `[PROPOSTA]` O rascunho não autenticado é automaticamente purgado pela rotina de TTL operacional da H-110 (30 dias de inatividade ou expurgo de quarentena); caso o usuário solicite eliminação antecipada com o cookie de rascunho em mãos, a rota de rascunho oferece o descarte imediato (`DELETE /v1/request-drafts`), não necessitando de processo formal em `dsr_case`.
- (b) Criar um `dsr_case` vinculado ao cookie de rascunho.
- **Recomendação do PO:** (a). Evita burocracia excessiva para dados meramente temporários de sessão técnica desprovidos de vínculo cadastral definitivo. Destrava a fronteira entre H-111 e H-110.

**681. [PENDENTE JURIDICO] Acesso aos registros de compartilhamento de endereço (`address_share`).** Os registros de quando o endereço exato foi compartilhado com profissionais no chat (RF-139) devem integrar o extrato de dados do DSR-Acesso?
- (a) `[PROPOSTA]` Sim. O relatório de acesso do titular deve conter o extrato dos profissionais com quem o endereço foi compartilhado e a data/hora do evento, demonstrando total transparência sobre a circulação do dado sensível.
- (b) Não exportar registros de compartilhamento interno.
- **Recomendação do PO:** (a). Alinhado ao Art. 18, VII da LGPD (informação das entidades públicas e privadas com as quais o controlador realizou uso compartilhado de dados). Destrava o escopo da seção 5.3 e a função de extração.

**682. Limite de taxa (Rate Limit) para requisições de Acesso aos Dados.** Qual o limite de requisições de extrato de dados para evitar abusos automatizados?
- (a) `[PROPOSTA]` Máximo de 1 solicitação de exportação por titular a cada 30 dias corridos; tentativas adicionais dentro da janela de 30 dias retornam o link do extrato previamente gerado (se ainda válido) ou informação do prazo de carência para novo download.
- (b) Sem limite de frequência.
- **Recomendação do PO:** (a). Evita custos desnecessários de infraestrutura e sobrecarga do banco, compatível com o princípio da razoabilidade do Art. 19 da LGPD. Destrava CA-H111-05 e os testes de abuso.

---

## 12. Próximos passos e Handoff

1. O Orquestrador/líder recebe e avalia este documento de refino em `docs/factory/144-REFINO-H111.md`.
2. As perguntas **663 a 682** trazem a posição recomendada do PO e os modelos `[PROPOSTA]` adotados para implementação e testes no ambiente de DESENVOLVIMENTO, aguardando validação final nas decisões consolidadas de `11-DECISOES.md`.
3. As questões de natureza jurídica/LGPD (`663, 666, 667, 668, 669, 670, 678, 681`) permanecem anotadas como `[PENDENTE JURIDICO]` para ratificação formal pelo DPO/Assessoria Jurídica antes de qualquer ativação em ambiente de PRODUÇÃO (liberação de BLQ-JUR L1 e L2).
4. **Handoff para a etapa de Arquitetura:**
   - A Arquitetura desenha o modelo físico da tabela `app.dsr_case`, a extensão de papéis, os gatilhos de máquina de estados, as funções de banco `private.dsr_extract_subject_data` e `private.dsr_anonymize_subject`, e os contratos de API de rotas do titular e do console administrativo.
5. **Início do Desenvolvimento:**
   - **O Desenvolvimento NÃO pode começar nesta rodada.** Ele deve aguardar obrigatoriamente a elaboração e aprovação do documento de Arquitetura correspondente (`docs/factory/145-DESENHO-H111.md`), a definição dos prefixos de migração e a validação do desenho pelo líder.
