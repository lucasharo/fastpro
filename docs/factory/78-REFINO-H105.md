# Refino H-105 — Dupla aprovação para estorno e suspensão (Issue #114, WF-03, Product Owner)

- **Issue:** #114 · **História:** H-105 ("[E12] Dupla aprovação para estorno e suspensão") · **Workflow:** WF-03 · **Coluna:** Product Owner · **Data:** 2026-11-11 · **Papel:** Product Owner
- **Decisão:** REFINADO_PO com uma pergunta única ao líder (P-a) que define os papéis aprovadores. A mecânica (sem autoaprovação, limite, validade, auditoria) segue pronta para Arquitetura. P-b e P-e também afetam o contrato.
- **Rastro:** 14-BACKLOG (H-105 e H-106, BLQ-JUR L3); 04-PRD RF-063, RF-145, RF-149, RF-151, RF-152, RF-154; 05-CRITERIOS-ACEITE FA-031 e FA-032; 07-AMBIGUIDADES AMB-02 (C) e AMB-08; 11-ARQ-RISCOS-E-TESTES I-18 e T-08; 11-DECISOES rodada 18 (decisão 47, base AMB-08 A); 08-ARQUITETURA (linha de dupla aprovação); 54-DESENHO-H102 §1 e R-10; 60-DESENHO-H073 e 57-REFINO-H073 (guarda de autoaprovação e D-H073-2); migrações `20261111190000_admin_create_staff` e `20261111300000_admin_approval_acesso_conversa`.
- **Natureza:** SOMENTE documento. Nenhum código, migração, teste, Issue ou Project foi alterado.
- **Etiquetas:** `[DECIDIDO]` decisão já registrada em documento aprovado · `[VERIFICADO]` conferido no texto ou no código do repo · `[PROPOSTA]` recomendação deste refino · `[NÃO VERIFICADO]` não confirmado.

---

## 1. Objetivo

Estorno acima de R$ 200,00 e suspensão permanente de conta só produzem efeito depois de aprovação de pessoas diferentes de quem pediu. Assim, nenhum administrador consegue, sozinho, movimentar valor acima do limite nem tirar uma conta do ar de forma definitiva. `[DECIDIDO]` RF-151, RF-152, FA-032 e FA-031 ("suspensão permanente… sem autoaprovação").

`[VERIFICADO]` A base de aprovação (`approval_request` e `approval_vote`) já existe por H-102 (migração `20261111190000`). H-105 só amplia os tipos de ação e a regra de quantidade de votos.

## 2. Quem pede e quem aprova

Regras já decididas:
- `[DECIDIDO]` Quem pede nunca aprova o próprio pedido (RF-151, FA-032, FA-031).
- `[DECIDIDO]` O mesmo aprovador não conta duas vezes (FA-032; I-18).
- `[DECIDIDO]` Estorno ≤ R$ 200,00: um Financeiro autorizado. Estorno > R$ 200,00: dois aprovadores independentes (RF-151).
- `[DECIDIDO]` Exatamente R$ 200,00 conta como "até" e exige uma aprovação (FA-032; 08-ARQUITETURA §13).
- `[VERIFICADO]` O aprovador precisa estar com status ativo na equipe admin (trigger `approval_vote_guard`). A checagem de papel do aprovador é feita pela API, como em H-073.
- `[VERIFICADO]` A tabela atual aceita só `papel_superadmin` e `mfa_reenroll`, com `required_approvals = 1`. H-105 precisa de dois votos distintos para os novos casos. Isso é impacto de dados, não decisão de produto.
- `[PROPOSTA]` Pedido de estorno e pedido de suspensão ficam fora da equipe Superadmin. A Superadmin tem no máximo duas pessoas (R-3 de 60-DESENHO-H073), o que tornaria a dupla aprovação frágil se dependesse dela.
- `[PROPOSTA]` Papéis (ver P-a): estorno pedido por Financeiro e aprovado por Financeiros distintos. Suspensão pedida por Suporte (AMB-02 C: decisão caso a caso por Suporte) e aprovada por dois Moderadores distintos do solicitante.

## 3. O que a aprovação libera

- **Estorno:** a aprovação completa só torna o pedido apto para a execução que fica em H-106. H-105 não chama o Mercado Pago e não movimenta dinheiro. `[PROPOSTA]` Enquanto L3 estiver pendente, o pedido aprovado não tem efeito financeiro (ver P-e).
- **Suspensão permanente:** com a segunda aprovação válida, a conta passa ao estado de suspensão permanente. Esse estado já impede aceite e seleção (RF-050, RF-080, T-04). `[NÃO VERIFICADO]` Nome exato do estado no modelo de dados; a Arquitetura confirma em 09-MODELO-DADOS.
- **Fora do efeito:** suspensão temporária ou cautelar não entra neste fluxo (P-d).

## 4. Prazo de validade da aprovação

- `[VERIFICADO]` Pedidos de aprovação administrativa expiram em 24 h (constraint `approval_request_validade_24h`; 60-DESENHO-H073 T-H073-02 e T-H073-24).
- `[PROPOSTA]` Aplicar 24 h também a estorno e suspensão (P-c). Regras:
  - Voto após o vencimento é negado.
  - Pedido vencido fica "expirado", sem efeito, e o solicitante é avisado.
  - Para tentar de novo, é preciso um novo pedido.
  - Um pedido consumido não aceita novo voto.

## 5. Trilha de auditoria

- `[DECIDIDO]` RF-154: cada evento registra ação, ator, objeto, estado anterior e posterior, data e hora, para suspensão e estornos.
- `[VERIFICADO]` O catálogo de auditoria (migração `20261110140000`) já tem "Suspensão de profissional" e "Estorno de pagamento", ambos com `approval_request_id`.
- `[PROPOSTA]` Eventos mínimos: pedido aberto; voto registrado; voto negado (com motivo: autoaprovação, voto repetido, sem permissão, aprovador inativo, vencido); pedido expirado; pedido consumido; efeito aplicado.
- `[PROPOSTA]` Cada evento é gravado na mesma transação da ação, em registro append-only (H-006). A consulta é feita pelo Auditor (H-104). O pedido exige motivo em texto curto. Os eventos guardam identificadores, não dados pessoais além do necessário.

## 6. Critérios de aceite (Given/When/Then)

- **CA-H105-01 `[DECIDIDO]`** Dado estorno de R$ 150,00 pedido por Financeiro A, quando Financeiro B autorizado aprova, então o pedido fica aprovado com uma aprovação só.
- **CA-H105-02 `[DECIDIDO]`** Dado estorno de R$ 200,00 exatos (20000 centavos), quando um Financeiro distinto aprova, então fica aprovado com uma aprovação.
- **CA-H105-03 `[DECIDIDO]`** Dado estorno de R$ 200,01 (20001 centavos), quando só um aprovador vota, então permanece pendente; quando um segundo aprovador distinto vota, então fica aprovado.
- **CA-H105-04 `[DECIDIDO]`** Dado pedido de estorno ou suspensão feito por A, quando A tenta aprovar, então é negado (403) e nenhum voto é gravado.
- **CA-H105-05 `[DECIDIDO]`** Dado pedido com um voto de B, quando B vota de novo, então é negado e o pedido segue com um voto.
- **CA-H105-06 `[DECIDIDO]`** Dado papel sem permissão de aprovação (ex.: Auditor ou Suporte no caso de estorno), quando chama a API diretamente, então é negado (403), e não apenas oculto na tela.
- **CA-H105-07 `[PROPOSTA]`** Dado suspensão permanente pedida por Suporte, quando um Moderador distinto aprova, então permanece pendente; quando um segundo Moderador distinto aprova, então a conta fica suspensa de forma permanente e não aceita trabalho nem seleção.
- **CA-H105-08 `[PROPOSTA]`** Dado pedido pendente, quando passam 24 h (mais 1 segundo), então o voto é negado, o pedido fica expirado e nada é alterado.
- **CA-H105-09 `[PROPOSTA]`** Dado aprovador que deixou de estar ativo antes do segundo voto, quando vota, então é negado e o pedido não avança.
- **CA-H105-10 `[PROPOSTA]`** Dado 20 votos simultâneos de aprovadores distintos no mesmo pedido, quando processados, então há exatamente um efeito e o pedido é consumido uma única vez.
- **CA-H105-11 `[PROPOSTA]`** Dado qualquer decisão (aprovado, negado, expirado, efeito aplicado), quando ocorre, então há um evento de auditoria com ator, objeto, estado anterior e posterior e data/hora (RF-154), gravado na mesma transação.
- **CA-H105-12 `[PROPOSTA]`** Dado estorno totalmente aprovado, quando H-105 é executada, então nenhuma chamada ao Mercado Pago e nenhuma alteração de pagamento ocorrem.

## 7. Fora de escopo

- Execução do estorno no Mercado Pago, estorno concluído e chargeback manual: **H-106** (bloqueada por BLQ-JUR L3).
- Retenção automática de 50% (RF-063): nunca automatizada.
- Política de reembolso e prazos (L3): jurídico.
- Suspensão temporária ou cautelar e moderação por denúncia (RF-149, AMB-02): fora, salvo P-d.
- Reenrolamento de MFA e recuperação de Superadmin (pendências de H-102): fora.
- Telas do console (H-103) e consulta de auditoria (H-104): fora; aqui só se grava o evento.

## 8. Dependências e riscos

- H-102 (#111): base de aprovação presente no repo `[VERIFICADO]`; conclusão informada pelo Orquestrador `[NÃO VERIFICADO]` no quadro.
- H-073 (#83): usa o mesmo modelo e acrescenta `acesso_conversa` com permissão própria. H-105 acrescenta os seus tipos sem quebrar a guarda existente (54-DESENHO-H102 R-10).
- R-3 de 60-DESENHO-H073: poucos Superadmins. Por isso, não usar Superadmin como único aprovador de estorno ou suspensão.
- BLQ-JUR L3: afeta só o efeito financeiro. Fluxo de aprovação e suspensão não dependem de L3 `[PROPOSTA]`.

## 9. Perguntas para o líder

Lista única, sem numeração final (o líder atribui os números contínuos da sessão).

- **P-a (bloqueante para o desenho dos papéis).** Quem pede e quem aprova estorno e suspensão? Estorno: (1) Financeiro pede e Financeiros distintos aprovam; (2) Financeiro pede e aprovação mista Financeiro + Superadmin. Suspensão: (1) Suporte pede e dois Moderadores distintos aprovam; (2) Suporte pede e Superadmin + Moderador aprovam. **Recomendação:** estorno (1) e suspensão (1), sem depender de Superadmin (R-3).
- **P-b (bloqueante para o fluxo de estorno ≤ R$ 200,00).** Estorno de até R$ 200,00 exige uma segunda pessoa? (1) Sim, um aprovador distinto do solicitante (leitura de FA-032). (2) Não, o Financeiro efetiva sozinho. **Recomendação:** (1), por coerência com "sem autoaprovação".
- **P-c (não bloqueante).** Validade de 24 h para estorno e suspensão? (1) 24 h, como H-102 e H-073. (2) Outro prazo. **Recomendação:** (1).
- **P-d (não bloqueante).** Só a suspensão permanente exige dupla aprovação? (1) Sim, pela letra de RF-152. (2) Também a cautelar. **Recomendação:** (1).
- **P-e (decide o escopo de H-105 frente a L3).** Com o fluxo de estorno aprovado, H-105 para antes da execução? (1) Sim: H-105 entrega aprovação e auditoria, e H-106 executa quando L3 fechar. (2) Não: H-105 espera L3. **Recomendação:** (1), pois suspensão e aprovação não dependem de L3.
- **P-f (não bloqueante).** "Independentes" significa apenas pessoas distintas? (1) Sim. (2) Também sem vínculo de equipe ou de grupo. **Recomendação:** (1), sem regra de equipe além de pessoa distinta.

## 10. Estado para a próxima etapa

- Pronto para Arquitetura na mecânica (seções 4, 5, 6 e 7), com impacto de dados das seções 2 e 3.
- Aguarda P-a (papéis) e P-e (escopo frente a L3) antes de fechar o desenho.
