# Refino H-073 — Acesso excepcional a conversa (Issue #83, WF-03, Product Owner)

- **Issue:** #83 · **História:** H-073 ("[E7] Acesso excepcional a conversa") · **Workflow:** WF-03 · **Coluna:** Product Owner · **Data:** 2026-11-11 · **Papel:** Product Owner
- **Decisão:** REFINADO_PO. Pronto para Arquitetura. D-H073-1 (aviso ao participante) e D-H073-2 (quem autoriza) afetam o contrato; as demais têm recomendação.
- **Rastro:** 14-BACKLOG (H-073; dependências H-102 #111 e H-006 #19); 04-PRD RF-148, RF-154, RF-140; 05-CRITERIOS-ACEITE FA-031; 08-ARQUITETURA §4.3 (linha Conversa), §13 (`access_case`, `sensitive_access_log`); 09-MODELO-DADOS (`access_case`, `sensitive_access_log`, RC-04); 03-JORNADAS (linha "Acesso excepcional a conversa"); 54-DESENHO-H102 §1 (`approval_request`/`approval_vote`), §3 (guarda admin), §4 (404/403); 53-REFINO-H102 §2; 52-DESENHO-H014 §4.2 e §4.3 (janela de 30 min e confirmação por código).
- **Natureza:** SOMENTE documento. Nenhum código, migração, teste, chave ou e-mail foi criado.
- **Etiquetas:** `[APROVADO]` decisão do usuário (RF-148, FA-031) · `[DELEGADO]` adotado por decisão anterior · `[PROPOSTA]` deste refino.

---

## 1. Critérios de aceite (Given/When/Then)

- **CA-H073-01 `[APROVADO]` (RF-148; FA-031; 08 §13 "sem navegação livre").** Dado um admin sem caso autorizado aberto para a conversa, quando tenta abri-la ou listar conversas de outros, então é negado e não recebe mensagens, participantes nem metadados. A resposta de negação segue H-102 §4 (403 `permission_denied` para papel sem permissão).

- **CA-H073-02 `[APROVADO]` (RF-148 "caso com justificativa").** Dado um admin com a permissão de abrir caso sensível (`case.open_sensitive`, 54-DESENHO-H102 §1), quando abre um caso, então informa uma conversa, uma justificativa em texto e o caso fica pendente de aprovação. Sem justificativa, ou sem conversa indicada, o caso é recusado. O caso não libera nada ainda.

- **CA-H073-03 `[APROVADO]` (FA-031 "autorizado por outra pessoa"; 08 §13 `[PROPOSTA]`).** Dado um caso pendente, quando outro admin, diferente do solicitante, o aprova, então o caso passa a ativo. Dado que a aprovação seja do próprio solicitante, do mesmo aprovador repetido, de aprovador sem a permissão de autorização (D-H073-2), vencida ou já usada, então é negada e o caso continua sem efeito.

- **CA-H073-04 `[PROPOSTA]` (08 §13 "validade curta").** Dado um caso ativo, quando o admin lê a conversa indicada, então a leitura é liberada somente dentro de 30 min contados da aprovação (sem renovação). Dado a leitura de qualquer outra conversa, então é negada.

- **CA-H073-05 `[APROVADO]` (FA-031 "sem acesso fora da janela").** Dado um caso vencido, revogado ou fechado, quando o admin tenta ler a conversa, então é negado, sem conteúdo nem metadados. No instante exato do vencimento, a leitura já é negada (limite estrito).

- **CA-H073-06 `[APROVADO]` (FA-031 "log"; RF-154; H-006).** Dado cada leitura liberada, quando o conteúdo é entregue, então um registro (quem, qual conversa, qual caso, instante) é gravado na mesma transação da leitura. Se a gravação falhar, a leitura não acontece. O registro não contém texto das mensagens, e-mail nem telefone. Não há UPDATE nem DELETE nesse registro.

- **CA-H073-07 `[PROPOSTA]` (aviso ao usuário; RF-140 `[PENDENTE JURÍDICO]`).** Dado uma leitura excepcional, quando ocorre, então o aviso às pessoas da conversa segue a regra vigente (D-H073-1). Enquanto a regra não estiver definida, a leitura fica registrada e não há aviso automático. Nenhum e-mail é enviado durante o desenvolvimento.

- **CA-H073-08 `[PROPOSTA]` (reaproveitamento da confirmação; D-H073-3).** Dado que abrir o caso e aprovar o caso exigem confirmação recente do segundo fator (TOTP) na sessão admin, quando a confirmação tem mais de 30 min, então a ação é negada até nova confirmação. Sem nova confirmação, nada muda.

---

## 2. Fora de escopo

- **Console admin, telas de abertura e aprovação de caso:** H-103.
- **Consulta à auditoria pelo Auditor:** H-104.
- **Dupla aprovação genérica de estorno e suspensão:** H-105. H-073 usa o modelo de aprovação de H-102 e só acrescenta o próprio tipo de ação (D-H073-2).
- **Documentos de identidade:** RF-148 cita documentos, mas a história H-073 trata só de conversa; documentos seguem a tarefa atribuída de H-037 e H-039 (D-H073-4).
- **Moderação de denúncias:** H-090.
- **Envio real de aviso por e-mail:** fora do desenvolvimento (regra do projeto).

---

## 3. Pontos de atenção para Arquitetura e QA

- **Dependências concluídas:** H-102 (#111: sessão admin de 8 h, papéis, aprovação de dupla) e H-006 (#19: auditoria append-only na mesma transação).
- **Admin não é membro da conversa:** a leitura excepcional precisa de caminho próprio, controlado no banco e na API (FA-031 "negar na API"); a RLS por participação não é afrouxada.
- **Registro de leitura:** 09 define `sensitive_access_log`; a Arquitetura decide se é tabela própria ou entrada de `audit_event`, desde que o registro seja na mesma transação (CA-H073-06).
- **Confirmação recente:** H-014 (step-up) guarda `recent_auth_at` em `app_session` (cliente e profissional). A sessão admin é outra (54 §3, CA-H102-07): o guarda admin não lê cookie de cliente. Reaproveita-se a regra (30 min), não o código (D-H073-3).
- **Testes T-08 (11-ARQ):** sem caso nega; caso libera só a conversa indicada; leitura registrada; caso vencido nega no instante exato; autoaprovação e aprovação dupla do mesmo aprovador negadas; leitura sem registro não ocorre.
- **Relógio:** usar o relógio injetado (padrão de H-011 a H-014), com teste de limite exato.
- **Evidência:** `corepack pnpm check:all` local, com comando, contagem e código de saída na Issue.

---

## 4. Dúvidas ao Orquestrador (não bloqueantes; alternativas e recomendação)

- **D-H073-1 — aviso ao participante da conversa.** O pedido diz "avisado conforme a regra vigente", mas não encontrei regra de aviso para leitura excepcional em 03, 04, 05, 08 e 09. O mais próximo é RF-140 (direitos de titular), `[PENDENTE JURÍDICO]` L1/L2. *Alternativas:* (a) sem aviso automático até decisão jurídica; (b) aviso após o fim do caso, com texto neutro; (c) aviso imediato. *Recomendação:* (a) para o MVP, com registro completo; pedir ao usuário a regra vigente se ela existir em outro documento.

- **D-H073-2 — quem autoriza.** *Alternativas:* (a) admin com nova permissão `case.authorize_sensitive`, diferente do solicitante; (b) só Superadmin; (c) qualquer papel com `case.open_sensitive`. *Recomendação:* (a), com aprovação de uma pessoa além do solicitante (modelo de 54 §1). Atenção: 54 diz que H-105 amplia `action_type`; para evitar conflito, recomendo que H-073 acrescente só `acesso_conversa`, com migração própria, e que H-105 acrescente os seus.

- **D-H073-3 — confirmação recente.** *Alternativas:* (a) exigir novo TOTP com janela de 30 min ao abrir e ao aprovar (exige H-102 expor essa checagem); (b) aceitar só a sessão admin já válida (aal2 de login, 8 h). *Recomendação:* (a), por ser ação de alta sensibilidade e seguir o padrão de step-up do projeto.

- **D-H073-4 — documentos de identidade.** *Alternativas:* (a) fora de H-073, cobertos por H-037 e H-039 (tarefa atribuída); (b) incluir na história. *Recomendação:* (a); registrar isso no critério de RF-148.

- **D-H073-5 — validade e resposta sem caso.** *Alternativas:* validade de 15 ou 30 min; resposta sem caso como 403 `permission_denied` (H-102) ou 404. *Recomendação:* 30 min a partir da aprovação, sem renovação; resposta 403 `permission_denied`, sem detalhe sobre o caso.

- **D-H073-6 — escopo do caso.** *Alternativas:* (a) uma conversa por caso; (b) várias conversas do mesmo caso. *Recomendação:* (a), pelo "mínimo necessário" de FA-031.
