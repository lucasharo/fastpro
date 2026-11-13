# Refino H-040 — Retenção por duplicidade (Issue #53)

- **Issue:** #53 `[E4] Retenção por duplicidade` · **História:** H-040 · **Épico:** E4 · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner.
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-13.
- **EXEC-ID:** não informado pelo líder.
- **Natureza:** somente documento. Nenhum código, migração, teste, chamada externa ou alteração no quadro. A Issue permanece na coluna Product Owner até o líder decidir a movimentação.
- **Perguntas ao líder:** numeração 476 a 495, faixa reservada a esta Issue (as faixas 370 a 389 e 390 a 403 já são de #52).
- **Etiquetas:** `[DECIDIDO n]` decisão registrada · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas: `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`, `docs/factory/quadro-status.md` (atualizado em 2026-11-13 12:30 UTC), `21-ISSUES-CRIADAS.md` (H-040 = #53), `14-BACKLOG.md` (H-035 e H-040), `04-PRD.md` (RF-046 a RF-050, RF-053, RF-147), `05-CRITERIOS-ACEITE.md` (FA-004, FA-005), `09-MODELO-DADOS.md` (§3.3, `professional_profile`), `123-REFINO-H039.md`, `124-DESENHO-H039.md`, `11-DECISOES.md` (Rodadas 76 e 80; decisões 273 e 275), `113-REFINO-H045.md` (formato), `72-REFINO-H035.md` e `75-DESENHO-H035.md` (retenção no cadastro).

Conferido nas migrações (somente leitura):
- `supabase/migrations/20261111420000_identity_professional_profile_document.sql`, linhas 56 a 59 (índice `professional_profile_document_hmac_vivo_key`) e linhas 152 a 179 (função de cadastro, que grava `retida_duplicidade`).

Limitações `[NÃO VERIFICADO]`:
- O texto da Issue #53 no GitHub não foi lido nesta rodada. O líder deve conferi-lo antes da Arquitetura.
- Nenhum banco foi consultado. A existência e o estado real dos índices e funções vêm só das migrações versionadas.
- A tela de recurso do profissional (H-041, #54) não foi lida além do que 124 e 123 dizem sobre ela.

## 1. Verificação de fila e dependências reais

- `[VERIFICADO]` Quadro: #53 está na coluna **Product Owner** (com #47, #57 e #51). A ordem de colunas está correta para esta etapa. Não está em Backlog.
- `[VERIFICADO]` Dependências declaradas no backlog para H-040: **H-035 (#48)** e **H-039 (#52)**.
- `[VERIFICADO]` **H-035 (#48)** está em Concluído. Já entregou o cadastro com `document_hmac` e a retenção automática no cadastro (ver §1.1).
- `[VERIFICADO]` **H-039 (#52)** está na coluna **QA**, não em Concluído. A nota da Rodada 80 (124) diz "#52 avança para Desenvolvimento", mas o quadro mostra QA. Ver §1.2 e pergunta 491.
- `[VERIFICADO]` H-037 (#50) e H-006 (#19) estão em Concluído. H-045 (#58) está em Concluído. H-044 (#57) está em Product Owner. H-041 (#54) está em Backlog. H-038 (#51) está em Product Owner.

### 1.1 O que H-035 já faz na retenção (fato novo)

`[VERIFICADO]` Na migração `20261111420000`:
- O índice único parcial `professional_profile_document_hmac_vivo_key` cobre `document_hmac` **exceto** perfis `recusada` ou `retida_duplicidade` (linhas 56 a 59). Logo, um perfil retido **não colide** com o índice.
- A função de cadastro checa se outro perfil não recusado tem o mesmo HMAC. Se tiver, grava o novo perfil como `retida_duplicidade` (linhas 152 a 160). Se a corrida ganhar o índice, também grava como retido (linhas 172 a 179).

Consequência: a premissa da decisão 374 e do desenho 124 (R2 de 123: "o índice pode recusar o segundo cadastro") **está superada no ponto do índice para o cadastro**. O que resta para H-040 é o que o cadastro não faz: aprovação de um retido com o original ainda vivo (ver §5, RN-H040-07), explicação, leitura pela Verificação e os testes de regressão. Ver pergunta 476.

### 1.2 Resposta à pergunta de início de Desenvolvimento

- **Desenvolvimento de #53 não pode começar agora.** Motivos:
  1. #53 está em Product Owner. WF-03 manda o cartão para **Arquitetura** antes de qualquer Desenvolvimento.
  2. A dependência declarada **H-039 (#52)** não está Concluída. Está em QA. A regra de fila proíbe iniciar uma parte que depende de outra história não concluída como se pudesse fechar sozinha. H-040 aprova, recusa e lê pelas funções que H-039 cria (`verification_case_decide`, `verification_case_appeal`, a leitura pela porta).
  3. Concluído é decisão humana. Enquanto o usuário não decidir #52, a dependência continua aberta.
- **Arquitetura de #53 pode ser preparada** pelo líder como desenho, mas recomendo que a Arquitetura só feche depois que o código de #52 estiver estável (QA aprovado e decisão humana registrada). Ver pergunta 490.

## 2. Objetivo

Quando um profissional tenta cadastrar um CPF ou CNPJ que já pertence a outro perfil vivo, o cadastro **não é recusado nem bloqueado**: vai para `retida_duplicidade`, com explicação e caminho de recurso, e só a Verificação decide por motivo registrado (RF-049, FA-004). Nenhum bloqueio definitivo é automático.

Resultado de negócio: evita que duas contas usem o mesmo documento para acessar o marketplace, sem punir por falso positivo sem análise humana.

## 3. Escopo (dentro de H-040)

1. Regra de detecção: mesmo `document_hmac` em outro perfil não recusado, na mesma transação do cadastro (já existe em H-035; H-040 confirma e cobre os casos de borda do §6).
2. Estado `retida_duplicidade` para o segundo cadastro, sem efeito sobre o primeiro (já existe; H-040 testa).
3. Regra de aprovação de um perfil retido enquanto o original está vivo (§5, RN-H040-07). Este é o item novo de H-040 no banco.
4. Explicação ao profissional sem revelar a existência de outro cadastro (§5, RN-H040-08).
5. Visão da Verificação sobre o caso retido: identificador curto do original e status, sem dado pessoal do outro perfil (pergunta 484). Usa a fila e o detalhe de H-039.
6. Evento de auditoria `retained` com motivo `duplicidade_suspeita`, sem CPF/CNPJ, sem HMAC e sem identificador do outro perfil em claro.
7. Testes de regressão de H-035 (cadastro e índice) e de H-039 (decisão e recurso de caso retido).

## 4. Fora de escopo

- Índice único de `document_hmac`: já está pronto em H-035, não é alterado nesta história (ver §1.1 e pergunta 476).
- Tela do profissional para ver estado e recurso: H-041 (#54). H-040 só entrega o backend e os textos.
- Recurso próprio: H-040 não cria rota nem regra de recurso separada. Usa o recurso de H-039 (um por caso, dec. 391 e 377).
- Verificação do documento pelo conteúdo (análise humana, não automática, sem base externa).
- Suspensão administrativa (`suspensa`), que é do admin (dec. 380).
- Liberação automática por tempo: não há job, cron ou prazo que libere caso retido (ver pergunta 485).
- Backfill de cadastros anteriores: nenhum (ver pergunta 494).
- Trial e pagamento de retido: regras de H-044 e H-049, tratadas só como consequência (perguntas 487 e 488).
- E-mail de decisão ou de retenção: E11, sem envio nesta fase (dec. 385).
- Chamada externa, Mapbox e cálculo de HMAC fora da API.

## 5. Regras de negócio

| Ref. | Regra | Fonte | Como H-040 atende |
|---|---|---|---|
| RN-H040-01 | Um documento (CPF ou CNPJ) vive em **um** perfil não recusado. Um perfil profissional por conta. | RF-049; 09 §3.3; I-02 | Índice de H-035; CA-H040-01 e CA-H040-03. `[AMBIGUIDADE]` "por conta" ou "por perfil" (pergunta 480) |
| RN-H040-02 | Duplicidade suspeita retém. Não recusa no cadastro, não bloqueia a conta, não suspende e não afeta pedidos. | RF-049; FA-004 | CA-H040-01, CA-H040-07 |
| RN-H040-03 | O cadastro retido é o **segundo**: o primeiro perfil vivo não muda de estado por causa dele. | [PROPOSTA] (pergunta 478) | CA-H040-03 |
| RN-H040-04 | Perfil recusado libera o documento: cadastro novo com o mesmo documento não é retido. | 09 §3.3; decisão H-035 | CA-H040-02 |
| RN-H040-05 | Retido não aceita trabalho (pedido, aceite, conversa), pela UI e pela API. | FA-004 | CA-H040-08 |
| RN-H040-06 | Liberação de retido só por decisão motivada da Verificação (`aprovada` ou `recusada`). Nenhuma liberação automática. | dec. 379; RF-049 | CA-H040-06, CA-H040-14 |
| RN-H040-07 | Aprovação de retido enquanto o original está vivo **não** é permitida. Só `recusada`. | [PROPOSTA] (pergunta 477) | CA-H040-05 |
| RN-H040-08 | A explicação ao profissional não revela outro cadastro, nem nome, nem identificador, nem a palavra "já existe". | 72, linha 90 (opção a); R3 de 75 | CA-H040-10 |
| RN-H040-09 | Recurso segue H-039: `recusada` e `retida_duplicidade` aceitam recurso, que volta o caso a `em_revisao` sem dono. | dec. 391, 400; CA-H039-14 | CA-H040-11 |
| RN-H040-10 | Retenção gera evento de auditoria sem dado pessoal e sem identificador do outro perfil em claro. | RF-147; 09 §7; H-006 | CA-H040-12 |
| RN-H040-11 | Trocar o documento durante a retenção não reabre nem libera o caso. | dec. 393 (por analogia); [PROPOSTA] (pergunta 493) | CA-H040-13 |

## 6. Fluxos e estados

### 6.1 Cadastro (já existente em H-035; confirmado por H-040)

1. Profissional envia cadastro com `document_hmac`.
2. Sistema procura outro perfil com o mesmo HMAC, com status diferente de `recusada`.
3. Não encontrou: perfil `pendente`. Encontrou: perfil `retida_duplicidade`. Corrida no índice: também `retida_duplicidade`.
4. Em ambos os casos, o profissional recebe a **mesma resposta** (corpo, status e tempo). `[PROPOSTA]` (75, linha 62, e R3).

### 6.2 Estados (sem novo estado)

`verification_status` já aceita `pendente`, `em_revisao`, `retida_duplicidade`, `aprovada`, `recusada`, `suspensa` (H-035 e 09 §3.3). H-040 não cria estado.

| De | Para | Quem | Condição |
|---|---|---|---|
| (cadastro) | `retida_duplicidade` | sistema | outro perfil não recusado com o mesmo HMAC |
| `retida_duplicidade` | `em_revisao` | sistema | recurso recebido (H-039) |
| `retida_duplicidade` | `aprovada` | Verificação | **só se não houver original vivo** (RN-H040-07; pergunta 477) |
| `retida_duplicidade` | `recusada` | Verificação | motivo registrado |

Qualquer outra transação de `retida_duplicidade` é recusada.

### 6.3 Fluxo da Verificação

1. Vê o caso retido na fila de H-039, com o identificador curto do caso e o do original (pergunta 484).
2. Abre o detalhe: status do original (vivo ou recusado), data de envio e motivo `duplicidade_suspeita`. Sem CPF/CNPJ, sem nome, sem HMAC.
3. Lê o documento pela porta de H-039, se precisar (mesma regra de atribuição e de `analyzed_at`).
4. Decide `recusada` ou, se o original não estiver vivo, `aprovada`. Ou aguarda, sem decidir, dentro da meta.

## 7. Critérios de aceite (numerados e testáveis)

Testes de banco usam dados sintéticos com marcador único, em transação desfeita, salvo nos testes de concorrência (Rodada 65).

- **CA-H040-01 (retenção).** Segundo cadastro com HMAC de perfil `pendente`, `em_revisao`, `aprovada` ou `suspensa` fica `retida_duplicidade`. Prova: dbtest com quatro originais.
- **CA-H040-02 (recusado libera).** Cadastro com HMAC de perfil `recusada` fica `pendente`. Prova: dbtest.
- **CA-H040-03 (primeiro intacto).** O perfil original mantém o status, `suspended_at` e o HMAC após a retenção. Prova: estado antes e depois.
- **CA-H040-04 (corrida).** Dois cadastros simultâneos com o mesmo HMAC: exatamente um fica `pendente` (ou o original) e o outro `retida_duplicidade`; nenhum erro de servidor. Prova: teste de concorrência com duas conexões.
- **CA-H040-05 (aprovação com original vivo).** Aprovar um retido enquanto o original está vivo é recusado com erro uniforme; nenhum estado muda. Prova: dbtest (se pergunta 477 = a).
- **CA-H040-06 (liberação motivada).** Retido vai a `aprovada` ou `recusada` só com motivo; a transição sem motivo é recusada. Prova: casos positivos e negativos.
- **CA-H040-07 (sem efeito colateral).** Retenção não suspende, não bloqueia o perfil e não altera pedidos existentes. Prova: estado antes e depois (como CA-H039-13).
- **CA-H040-08 (sem trabalho).** Retido não cria aceite, conversa ou mensagem, pela UI e pela API. Prova: rota e dbtest.
- **CA-H040-09 (sem trial).** Retido não ativa trial (FA-005). Prova: rota de trial, quando H-044 existir. `[NÃO VERIFICADO]` até H-044.
- **CA-H040-10 (mensagem neutra).** A resposta do cadastro retido é igual à do pendente (corpo, status, tempo). O texto ao profissional não contém CPF/CNPJ, identificador de outro perfil, nome, nem "já existe". Prova: comparação de respostas e varredura do texto.
- **CA-H040-11 (recurso).** Recurso em `retida_duplicidade` leva o caso a `em_revisao` sem dono e gera evento. H-040 não cria rota nova. Prova: herda CA-H039-14 e varredura de rotas.
- **CA-H040-12 (auditoria).** Evento `retained` com motivo `duplicidade_suspeita`, sem CPF/CNPJ, HMAC e identificador do original em claro. Prova: captura de evento e varredura de logs.
- **CA-H040-13 (troca de documento).** Troca de documento de um caso retido não reabre, não libera e não cria novo caso. Prova: dbtest (pergunta 493 = sim).
- **CA-H040-14 (liberação só por decisão).** Nenhum job, cron ou gatilho de tempo libera caso retido. Prova: catálogo de jobs e varredura.
- **CA-H040-15 (meta).** O prazo-meta de dois dias úteis é calculado (como CA-H039-15); nenhum alerta, bloqueio ou job. Prova: cálculo em datas de fronteira.
- **CA-H040-16 (visão da Verificação).** A fila e o detalhe mostram só identificador curto, status do original e data; nenhum dado pessoal do outro perfil. Prova: contrato da resposta.
- **CA-H040-17 (regressão).** Testes de H-035 (cadastro e índice) e de H-039 (decisão e recurso) continuam verdes. Prova: `corepack pnpm check:all` e `db:test` locais, com comando, contagem e código de saída registrados na Issue.
- **CA-H040-18 (execução local).** Sem chamada externa, sem Mapbox e sem alegação de CI verde.

## 8. Dependências

| Item | Estado (quadro) | Papel em H-040 | Bloqueia? |
|---|---|---|---|
| H-035 (#48) | Concluído | Cadastro, HMAC e índice | Não |
| H-039 (#52) | **QA** | Caso, decisão, recurso, leitura | **Sim, para Desenvolvimento** (pergunta 490) |
| H-037 (#50) | Concluído | Documento de identidade | Não |
| H-006 (#19) | Concluído | Auditoria | Não |
| H-038 (#51) | Product Owner | Certificação REG (indireto, RN-H040-07 e dec. 373) | Não para o refino; sim para aprovação completa com REG (pergunta 492) |
| H-041 (#54) | Backlog | Tela e recurso do profissional | Não para o backend; sim para o fechamento da história (pergunta 489) |
| H-044 (#57) | Product Owner | Trial (CA-H040-09) | Não para o backend |

## 9. Riscos

- **R1. Aprovação de retido com original vivo.** Viola a unicidade e pode gerar erro de servidor. Mitigação: RN-H040-07 e CA-H040-05.
- **R2. Premissa do desenho 124 superada.** Decisão 374 diz que o índice é de H-040, mas H-035 já o fez. Mitigação: §1.1; pergunta 476.
- **R3. Enumeração de documento.** Resposta diferente entre retido e pendente permite descobrir cadastro. Mitigação: CA-H040-10 e limite de tentativas (pergunta 495).
- **R4. Falso positivo.** A mesma pessoa com dois cadastros, ou homonímia de documento, fica retida sem prazo. Mitigação: meta de dois dias úteis sem bloqueio (pergunta 485).
- **R5. Ordem de execução.** Desenvolvimento antes de #52 Concluída gera retrabalho nas funções de decisão. Mitigação: §1.2; pergunta 490.
- **R6. Estado divergente.** Nota de 124 diz "#52 avança para Desenvolvimento"; quadro mostra QA. Mitigação: pergunta 491.
- **R7. Vazamento pelo texto ao profissional.** Mitigação: CA-H040-10 e RN-H040-08.
- **R8. Dados de teste no banco de desenvolvimento.** Mitigação: marcador único e transação desfeita (Rodada 65).

## 10. Ambiguidades

- `[AMBIGUIDADE]` "um CPF/CNPJ por conta" (pedido do líder) × "por perfil" (09 §3.3) × "identidade" (backlog H-040). Hoje `identity_id` é o próprio `document_hmac` (09 §3.3). Pergunta 480.
- `[AMBIGUIDADE]` "identidade" do backlog pode significar conta de acesso (e-mail) e não só documento. Pergunta 481.
- `[AMBIGUIDADE]` a decisão 374 atribui o índice a H-040, mas a migração de H-035 já o faz. Pergunta 476.
- `[AMBIGUIDADE]` `suspensa` conta ou não como original. Pergunta 482.

## 11. Perguntas ao líder

Lista única, numerada de 476 a 495. Cada item traz a recomendação do PO e a decisão que destrava. Nenhuma é enviada ao usuário.

**476. Índice de `document_hmac` e decisão 374.**
- **Recomendação:** registrar que H-035 já exclui `retida_duplicidade` do índice (migração `20261111420000`, linhas 56 a 59); H-040 não altera o índice para o cadastro. Superar a parte de 374 que atribui o índice a H-040. Destrava §1.1 e R2.

**477. Aprovação de retido com original vivo.**
- (a) Recusada com erro uniforme; só `recusada` enquanto o original estiver vivo.
- (b) Aprovar e suspender o original.
- (c) Aprovar os dois.
- **Recomendação:** (a). (c) viola o índice e a regra "um documento por perfil vivo"; (b) é decisão de admin (dec. 380). Destrava CA-H040-05 e R1.

**478. Qual cadastro é o "segundo".**
- **Recomendação:** o que chega depois, pela ordem de gravação do primeiro cadastro vivo. Destrava RN-H040-03.

**479. Liberação automática quando o original é recusado.**
- (a) Não; a Verificação decide o retido.
- (b) Sim; o retido vai a `pendente`.
- **Recomendação:** (a), por dec. 379. Destrava CA-H040-06 e §6.2.

**480. Unidade da regra: conta, perfil ou identidade.**
- **Recomendação:** um documento vivo por perfil, e como cada conta tem no máximo um perfil profissional, por conta. Confirmar que uma conta não tem mais de um perfil profissional. Destrava RN-H040-01.

**481. Detecção só por documento.**
- **Recomendação:** detecção só por `document_hmac`; "identidade" = documento (09 §3.3). E-mail não entra. Destrava §10 e CA-H040-01.

**482. Perfil `suspensa` conta como original.**
- **Recomendação:** sim, continua contando (09: "não recusados"). Destrava CA-H040-01.

**483. Texto ao profissional.**
- **Recomendação:** "Não foi possível concluir seu cadastro agora. Vamos revisar seu caso." (opção (a) de 72, linha 90), sem motivo detalhado de duplicidade no texto de primeiro nível; o motivo detalhado segue no recurso. Destrava CA-H040-10 e H-041.

**484. O que a Verificação vê do original.**
- **Recomendação:** identificador curto do perfil original e status (vivo ou recusado). Sem nome, e-mail, documento ou HMAC. Destrava CA-H040-16.

**485. Prazo de retenção.**
- **Recomendação:** sem prazo fixo; só a meta de dois dias úteis de H-039, sem alerta. Destrava CA-H040-15 e R4.

**486. Recurso de duplicidade.**
- **Recomendação:** usa o recurso de H-039 (um por caso, dec. 391). Sem prazo novo; prazo do recurso segue pendente do dono (dec. 377). Destrava CA-H040-11.

**487. Trial de profissional retido.**
- **Recomendação:** retido não ativa trial, como FA-005 já manda para não aprovado. Destrava CA-H040-09 e H-044.

**488. Assinatura de profissional retido.**
- **Recomendação:** não ativar plano pago enquanto retido; a cobrança segue a regra de aprovação. `[PROPOSTA]`. Destrava H-044 e H-049.

**489. Dependência de H-041 (#54).**
- **Recomendação:** H-040 entrega backend e textos; a tela e o recurso do profissional são de H-041. H-040 só fecha depois de H-041 ou com decisão registrada de entrega parcial. Destrava o fechamento e a ordem de #54.

**490. Ordem entre #53 e #52.**
- **Recomendação:** Arquitetura de #53 só depois de #52 em QA aprovado e conferido, e Desenvolvimento só depois de #52 Concluída por decisão humana. Destrava a movimentação de #53.

**491. Estado de #52.**
- **Recomendação:** prevalece o quadro (QA). Corrigir a nota de 124 (Rodada 80) ou registrar que a nota está desatualizada. Destrava a leitura de R6.

**492. Aprovação completa com REG (#51).**
- **Recomendação:** a retenção não depende de #51. A aprovação de retido com serviço REG segue fail closed (dec. 373) até #51 entregar a função. Destrava RN-H040-07 em conjunto com CA-H039-05.

**493. Troca de documento durante a retenção.**
- **Recomendação:** não reabre nem libera; o caso segue com a Verificação. Destrava CA-H040-13 e RN-H040-11.

**494. Cadastros anteriores à H-040.**
- **Recomendação:** sem retroatividade nem backfill. Os dados de teste no banco de desenvolvimento são sintéticos e marcados. Destrava §4.

**495. Limite de tentativas com o mesmo documento.**
- **Recomendação:** reutilizar o limite de tentativas já existente (anti-enumeração de H-015, #28, e a regra de 75, linha 72); nenhum limite novo nesta história. `[PROPOSTA]`. Destrava R3.

## 12. Próximos passos

1. Líder confirma o texto da Issue #53 no GitHub e responde as perguntas 476 a 495 em lista única.
2. Registrar as respostas em `docs/factory/11-DECISOES.md` com os mesmos números, em rodada nova (append-only).
3. Atualizar este refino com as respostas adotadas.
4. Mover #53 para Arquitetura somente depois de confirmar a coluna no quadro. Não mover por inferência.
5. Arquitetura desenha a aprovação de retido (regra de RN-H040-07), a visão da Verificação e a mensagem neutra. Desenvolvimento só começa após #52 Concluída.

## 13. Registro

- **Arquivo:** `D:\projetos\fastpro\docs\factory\131-REFINO-H040.md`.
- **Nenhum código, migração, teste, chamada externa ou alteração de quadro foi feito.** A Issue #53 permanece em Product Owner.
- **Sem alteração do backlog nem de outros documentos.**
