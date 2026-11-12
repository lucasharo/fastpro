# FastPro — Refino H-107 (Issue #116): gestão de catálogo e promoções

- **Issue:** #116 ("[E12] Gestão de catálogo e promoções", H-107) · **Workflow:** WF-03 (refinamento) · **Coluna:** Product Owner · **Data:** 2026-11-11 · **Papel:** Product Owner
- **Fontes lidas:** `14-BACKLOG` (H-107, H-018, H-102, BK-9, BK-11); `04-PRD` (RF-001..004, RF-055, RF-145, RF-153, RF-154); `05-CRITERIOS-ACEITE` (FA-001); `06-CATALOGO-PROPOSTO` (legenda e contagem de grupos); `07-AMBIGUIDADES` (AMB-08, AMB-18); `11-ARQ-RISCOS-E-TESTES` (A-8 e pendências de L4); `11-DECISOES` (D1/D2, decisão 47); `52-REFINO-H018` e `53-DESENHO-H018` (permissão `catalog.manage`, funções de escrita); `08-ARQUITETURA` §10; `09-MODELO-DADOS` (`plan_price`).
- **Legenda:** [DECIDIDO] vem de requisito aprovado ou decisão registrada · [VERIFICADO] confirmado em arquivo · [PROPOSTA] recomendação do PO · [NÃO VERIFICADO] depende de Architect ou de fonte externa.

## 1. Objetivo
Permitir que o administrador responsável mantenha o catálogo público (grupos, serviços, sinônimos e marcas de modalidade e regulamentado) pela tela administrativa, com auditoria de cada mudança. Promoções não entram no MVP como oferta aplicada: a regra é que nenhuma promoção se aplica sozinha. [DECIDIDO RF-003, RF-153 (APROVADO); VERIFICADO 08 §10 e 09 (`sem promoção no MVP`)]

## 2. Quem gerencia e o que pode alterar
- **Papel:** Superadmin, com a permissão `catalog.manage`. [DECIDIDO: AMB-08 A delegado pela decisão 47, revogável; permissão definida em `53-DESENHO-H018`]
- **Não podem alterar:** Visitante, Cliente, Profissional e os demais papéis de admin (Verificação, Moderador, Financeiro, Suporte, Auditor). [PROPOSTA]

| Objeto | Pode criar | Pode alterar | Pode desativar/reativar | Observação |
|---|---|---|---|---|
| Grupo | sim | nome, posição | sim | Seed de 25 grupos [PROPOSTA] (H-018) |
| Serviço | sim | nome, grupo, modalidade (presencial, online, ambos), marca de regulamentado | sim | Um grupo por serviço [DECIDIDO, `53-DESENHO-H018`] |
| Sinônimo | sim | termo | sim | Termo único por serviço, sem acento e sem caixa [DECIDIDO RF-002, FA-001] |
| Promoção | **não no MVP** | — | — | Ver pergunta P-H107-1 |

- Não existe exclusão física. Desativar oculta o item; o registro permanece. [VERIFICADO `53-DESENHO-H018`: sem DELETE no sistema]
- Conselho profissional entra **inativo** até parecer de L4. [DECIDIDO, `53-DESENHO-H018`]

## 3. Estados
- **Item (grupo, serviço ou sinônimo):** `ativo` (aparece na navegação e no autocomplete) ou `inativo` (oculto, reativável). [PROPOSTA]
- **Tela:** lista vazia, busca sem resultado, carregando, erro ao salvar (nada muda; o texto digitado permanece). [PROPOSTA]
- **Promoção:** inexistente no MVP. [VERIFICADO 08 §10, 09]

## 4. Critérios de aceite (Given/When/Then)

**CA-01 Permissão** [DECIDIDO]
- Dado um administrador sem o papel Superadmin, quando tenta criar, alterar ou desativar grupo, serviço ou sinônimo pela tela ou pela API, então a operação é negada e nada muda.
- Dado uma chamada sem sessão, então a resposta é 401; com sessão sem permissão, 403. [PROPOSTA, mesma regra de H-102]

**CA-02 MFA** [DECIDIDO RF-145]
- Dado um Superadmin sem verificação em dois fatores (sessão sem `aal2`), quando tenta qualquer alteração no catálogo, então é negado.

**CA-03 Criar grupo ou serviço** [PROPOSTA]
- Dado um Superadmin com `aal2`, quando cria um serviço com nome, grupo, modalidade (presencial, online ou ambos) e marca de regulamentado, então o serviço aparece na lista administrativa e na busca pública (se ativo).
- Dado o mesmo cadastro sem nome ou sem grupo, então é recusado com erro por campo.

**CA-04 Sinônimo duplicado** [PROPOSTA]
- Dado um serviço que já tem o sinônimo "Obra", quando o Superadmin adiciona "OBRA" ou "óbra", então é recusado por duplicidade (comparação sem acento e sem caixa).
- Dado um sinônimo vazio ou só com espaços, então é recusado.

**CA-05 Desativar e reativar** [PROPOSTA]
- Dado um serviço ativo, quando o Superadmin o desativa, então ele some do autocomplete e da navegação pública (FA-001), e o registro continua no banco.
- Dado um item desativado, quando é reativado, então volta a aparecer.

**CA-06 Alteração de modalidade ou regulamentado** [PROPOSTA]
- Dado um serviço presencial, quando o Superadmin muda para online, então a nova modalidade é gravada e aparece na auditoria com valor anterior e posterior.
- Dado a mudança, então ela não altera pedidos já publicados (ver pergunta P-H107-3).

**CA-07 Auditoria obrigatória** [DECIDIDO RF-154; campos PROPOSTA]
- Dado qualquer criação, alteração ou desativação, quando é concluída, então existe um evento de auditoria com ator, objeto, valor anterior, valor posterior, data e hora.
- Dado uma falha ao gravar a auditoria, então a alteração também não é gravada.

**CA-08 Ordem da navegação** [PROPOSTA]
- Dado grupos com posições trocadas pelo Superadmin, quando um visitante abre as categorias, então vê a nova ordem sem login.

**CA-09 Seed não desfaz trabalho do administrador** [DECIDIDO, `53-DESENHO-H018`]
- Dado um serviço renomeado ou desativado pelo administrador, quando a semente é carregada de novo, então a mudança permanece.

**CA-10 Sem promoção aplicada sozinha** [DECIDIDO RF-055, RF-153; regra PROPOSTA]
- Dado o MVP sem promoção cadastrada, quando um cliente consulta os planos, então vê os valores aprovados (R$ 29,90; R$ 80,70; R$ 149,40; R$ 238,80) e nenhum desconto.
- Dado qualquer registro de promoção (somente se P-H107-1 for aprovada), quando é salvo, então nenhum valor de `plan_price` muda e nenhuma cobrança é afetada sem ativação separada.

**CA-11 Estados de tela** [PROPOSTA]
- Dado uma busca administrativa sem resultado, então a tela mostra "Nenhum item encontrado" e não quebra.
- Dado falha ao salvar, então a tela mostra o erro, mantém o texto digitado e não grava nada parcial.

## 5. Fora de escopo
- Autocomplete e exposição pública de sinônimos: H-019.
- Elegibilidade de profissional para serviço online (alcance nacional): AMB-18, H-023.
- Verificação de certificação e fila de verificação de REG: H-038, H-039.
- Desconto, promoção aplicada a plano, cobrança e checkout: H-046, H-047, RF-055.
- Console geral de papéis e telas admin: H-103.
- Importação ou exportação em lote do catálogo.
- Os 10 grupos originais (não recebidos, D2): não bloqueiam; ver A-8 e H-018.

## 6. Dependências
- **H-018** (tabelas, semente, funções de escrita, permissão `catalog.manage`): informado pelo líder como concluído. [NÃO VERIFICADO no quadro nesta sessão]
- **H-102** (RBAC e MFA `aal2` em `/admin/*`): informado como concluído. [NÃO VERIFICADO no quadro nesta sessão]
- **H-019**: consome o que H-107 alterar; não bloqueia o refinamento.

## 7. Dúvidas não bloqueantes (com recomendação do PO)

**P-H107-1 (pergunta única para o líder: confirmar escopo).** RF-153 diz "promoções futuras" e 08 §10 diz "fora do MVP". H-107 cria tabela e tela de promoção agora, ou só registra a regra "nenhuma promoção se aplica sozinha"?
- Recomendação: só a regra (CA-10). A tabela e a tela de promoção vão para item futuro. Decisão que destrava: fechar o escopo de CA-10.

**P-H107-2 (não bloqueante).** Trocar a marca de regulamentado (ou o item para não regulamentado) exige dupla aprovação?
- Recomendação: no MVP, aprovação simples com auditoria (CA-07). Dupla aprovação para remover a marca de regulamentado, por ser ação de risco jurídico (L4). Architect confirma se cabe no modelo de `approval_request`.

**P-H107-3 (não bloqueante, Architect confirma).** Pedido já publicado guarda referência ao serviço ou só o texto? [NÃO VERIFICADO]
- Recomendação: desativar ou mudar modalidade não altera pedido publicado; vale só para novos pedidos e para a busca. Coerente com a regra de republicação de H-082.

**P-H107-4 (não bloqueante).** Tela admin: layout e acessibilidade. O PRD não traz exigência. [NÃO VERIFICADO]
- Recomendação: desktop primeiro; campos com rótulo; operação só por teclado; mensagens de erro ligadas aos campos.

**Nota.** Se AMB-08 A for revogada (decisão 47), o papel de CA-01 muda; os critérios permanecem.

## 8. Entrega
- Refinamento pronto para Arquitetura após a resposta do líder sobre P-H107-1. Os demais pontos podem seguir como propostas.
- Não alterei GitHub, Project, Issue ou código.
