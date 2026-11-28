# Refino H-103 — Console admin por papel (Issue #112, WF-03, Product Owner)

- **Issue:** #112 · **História:** H-103 ("[E12] Console admin por papel") · **Workflow:** WF-03 · **Coluna de origem:** Product Owner (não movimentada; sem escrita no quadro nesta etapa) · **Data:** 2026-11-11 · **Papel:** Product Owner
- **Decisão:** REFINADO_PO. Pronto para Arquitetura. BK-11 está coberta por delegação do usuário (ver §0); nenhuma decisão humana pendente bloqueia o refino.
- **Dependência:** H-102 (RBAC e MFA no admin), informada como concluída pelo líder; não conferida no quadro nesta sessão.
- **Rastro:** 14-BACKLOG (linha H-103; BK-11; E12); 04-PRD RF-145, RF-146 (ausente; proposta em AMB-08), RF-148, RF-150, RF-153, RF-154; 05-CRITERIOS-ACEITE FA-031, FA-033; 07-AMBIGUIDADES AMB-08; 11-DECISOES (Rodada 3); 19-PLANO-TECNICO-DEV §10.1; 21-ISSUES-CRIADAS (H-103 = #112); 53-REFINO-H102.
- **Etiquetas:** `[APROVADO]` decisão do usuário · `[DELEGADO]` adotado por delegação, revogável · `[PROPOSTA]` deste refino · `[VERIFICADO]` conferido nos arquivos citados · `[NÃO VERIFICADO]` fora do alcance desta leitura.

---

## 0. Verificação da BK-11

- `[VERIFICADO]` 11-DECISOES, Rodada 3 (2026-11-09): o usuário pediu para seguir as recomendações do líder ("pode seguir com as suas recomendações"). Essa rodada adota como `[DELEGADO]` as recomendações de AMB-01 a AMB-20.
- `[VERIFICADO]` AMB-08 (07-AMBIGUIDADES) tem recomendação "A como base de trabalho, revogável se a original for encontrada". BK-11 (a) é a mesma opção.
- `[VERIFICADO]` 19-PLANO-TECNICO-DEV §10.1 registra BK-11 (a) como diretriz já adotada.
- Conclusão: a BK-11 não exige nova pergunta. A base de papéis é AMB-08 A, revogável pelo usuário.
- Ressalva para o líder: 11-DECISOES não cita "BK-11" pelo nome, e a issue no quadro pode ainda ter o rótulo `block:decisao` (16-MANIFESTO). Recomendo registrar BK-11 como resolvida por delegação ao consolidar.

## 1. Objetivo

Oferecer um console administrativo mínimo em que cada conta vê apenas as telas dos próprios papéis (RF-145, FA-031). O console é a casca de navegação e de permissão. Cada tela tem a função entregue pela história dona (§2). H-103 não entrega essas funções.

## 2. Escopo por papel

Base: AMB-08 A `[DELEGADO]`. Funções detalhadas por história dona `[PROPOSTA]`.

| Papel | Telas que vê no console | O que faz nelas | História dona |
|---|---|---|---|
| Verificação | Fila de verificação | Aprova, recusa, retém por duplicidade, explica, recebe recurso (RF-147) | H-039 |
| Moderador | Denúncias e contestações | Decide com fundamento, registra, aceita recurso (RF-149, RF-132) | H-090 |
| Financeiro | Cobranças e estornos | Lê o relatório de reconciliação (H-053); participa da dupla aprovação acima de R$ 200 (RF-151); estorno só após L3 | H-105, H-053, H-106 |
| Suporte | Casos e correção de conclusão | Corrige conclusão com auditoria; não reabre aceites (RF-150) | H-079 |
| Auditor | Trilha de auditoria | Só lê; não altera nada (RF-154) | H-104 |
| Superadmin | Papéis e convites; catálogo; suspensão permanente | Concede e revoga papéis (H-102); gerencia catálogo (H-107); suspensão com dupla aprovação (RF-152) | H-102, H-107, H-105 |

Regras transversais `[PROPOSTA]`:
- O menu é montado só com as telas dos papéis ativos da conta.
- Ocultar a tela não basta: a API nega a operação de outro papel (FA-031).
- Não existe tela de chat nem de documento de identidade no console. O acesso excepcional é outra história (H-073, RF-148, "sem navegação livre").
- Não existe tela de e-mail nem interruptor de envio (decisão 23, FA-031).
- Promoções (RF-153) ficam fora do MVP. Nenhuma tela para elas.

Estados `[PROPOSTA]`:
- Vazio (fila sem itens): "Nenhuma pendência no momento."
- Erro de carregamento: "Não foi possível carregar esta tela. Tente novamente."
- Textos finais e layout não estão no PRD. Usar tokens aprovados do design system (FA-033). Responsividade e acessibilidade ficam para a Arquitetura.

## 3. Critérios de aceite (Given/When/Then)

- **CA-H103-01** `[PROPOSTA]` (AMB-08 A). Dado uma conta só com papel Verificação, quando abre o console, então vê só a fila de verificação, sem denúncias, cobranças, trilha ou papéis.
- **CA-H103-02** `[PROPOSTA]`. Dado uma conta só com papel Moderador, quando abre o console, então vê só denúncias e contestações.
- **CA-H103-03** `[PROPOSTA]`. Dado uma conta só com papel Financeiro, quando abre o console, então vê cobranças e estornos e não vê a fila de verificação.
- **CA-H103-04** `[PROPOSTA]`. Dado uma conta só com papel Suporte, quando abre o console, então vê casos e correção de conclusão.
- **CA-H103-05** `[APROVADO]` (RF-154, FA-031). Dado uma conta só com papel Auditor, quando abre a trilha, então lê os eventos e não há botão de alteração. Dado uma chamada direta de alteração, então a API nega e nada muda.
- **CA-H103-06** `[PROPOSTA]` (menor privilégio, RF-145). Dado uma conta Superadmin, quando abre o console, então vê papéis, convites, catálogo e suspensão, e não vê a fila de verificação nem as denúncias sem papel específico.
- **CA-H103-07** `[PROPOSTA]`. Dado uma conta com dois papéis, quando abre o console, então vê a união das telas desses dois papéis e nenhuma outra.
- **CA-H103-08** `[PROPOSTA]` (CA-H102-03, D-H102-2). Dado uma conta com um papel que não tem a tela, quando acessa a rota diretamente, então recebe a resposta definida em H-102 e nenhum dado.
- **CA-H103-09** `[PROPOSTA]` (CA-H102-08). Dado um papel revogado, quando a pessoa faz a próxima requisição, então a tela some do menu e a rota é negada.
- **CA-H103-10** `[APROVADO]` (RF-148, FA-031). Dado qualquer papel sem caso autorizado, quando procura chat ou documento de identidade no console, então não encontra nenhuma entrada.
- **CA-H103-11** `[PROPOSTA]`. Dado uma tela cuja história dona não está entregue, quando o console é montado, então a tela não aparece para nenhum papel.
- **CA-H103-12** `[PROPOSTA]` (CA-H102-05, CA-H102-06). Dado uma conta sem MFA concluído (aal2), quando tenta abrir qualquer tela do console, então não abre nenhuma.
- **CA-H103-13** `[PROPOSTA]` (backlog H-103: "decisão de RF-146 registrada"). Dado H-103 concluída, quando se consulta 11-DECISOES, então a base AMB-08 A para RF-146 está registrada com referência a este refino.

## 4. Fora de escopo

- Conteúdo e regras das telas: H-039, H-090, H-053, H-079, H-104, H-105, H-107 e H-073.
- Estorno efetivo: H-106, bloqueada até L3 (BLQ-JUR L3).
- Painel operacional: H-108 (não é papel de acesso).
- Matriz detalhada de telas de RF-146: artefato próprio do Architect e PO, com base em AMB-08 A.
- Promoções (RF-153): fora do MVP.
- Recuperação de MFA perdido: D-H102-6 em H-102.
- Layout visual e textos finais das telas: não definidos no PRD.

## 5. Dependências e pontos de atenção

- Telas dependem das histórias donas. Na primeira entrega, o console pode mostrar só telas já entregues (CA-H103-11).
- `[VERIFICADO]` 14-BACKLOG cita "BK-13" na coluna de risco de H-103, mas a tabela de dúvidas só tem BK-1 a BK-11. Referência a corrigir pelo líder.
- `[VERIFICADO]` 16-MANIFESTO lista H-103 como #114; o número real no quadro é #112 (21-ISSUES-CRIADAS). #114 é H-105.
- `[PROPOSTA]` Porte G no backlog. Pode ser dividido por papel se a Arquitetura quiser.
- Testes: CA-H103-01 a 13 viram testes de API por papel e de banco, no conjunto T-08 (11-ARQ-RISCOS-E-TESTES).

## 6. Dúvidas não bloqueantes (com recomendação)

- **D-H103-1 — quem abre caso de acesso excepcional.** Alternativas: (a) Suporte abre e outro papel autoriza; (b) Moderador abre e Superadmin autoriza. *Recomendação:* (a). H-073 decide o detalhe.
- **D-H103-2 — o que é "cobranças" no papel Financeiro.** Alternativas: (a) só leitura do relatório de reconciliação; (b) também ajustes manuais. *Recomendação:* (a). Ajustes manuais não existem no MVP.
- **D-H103-3 — tela sem história entregue.** Alternativas: (a) não aparece; (b) aparece com texto "em breve". *Recomendação:* (a), para não criar tela sem função.
- **D-H103-4 — Superadmin e telas de outros papéis.** Alternativas: (a) só as próprias telas; (b) acesso a tudo. *Recomendação:* (a), por menor privilégio (RF-145).

---

## Resumo em linguagem simples

O painel de administração passa a mostrar a cada pessoa apenas as partes que o seu papel pode usar: verificação de perfis, denúncias, estornos, suporte, trilha de auditoria ou gestão de equipe. Quem não tem um papel não vê nada, e a regra vale também para quem tenta acessar direto pelo endereço. O conteúdo de cada parte é entregue por outras tarefas. Esta tarefa cria a estrutura e garante que cada um veja só o seu.
