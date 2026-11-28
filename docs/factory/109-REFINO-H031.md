# Refino H-031 — Publicação idempotente com 7 dias (Issue #44)

- **Issue:** #44 `[E3] Publicação idempotente com 7 dias` · **História:** H-031 · **Workflow:** WF-03 · **Etapa:** Product Owner (primeira coluna; nada de arquitetura nem código neste documento).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-13.
- **EXEC-ID:** não atribuído por este agente (não informado pelo líder).
- **Natureza:** somente documento. Nenhum código, migração ou teste foi criado ou executado. O cartão permanece em Product Owner até o líder movê-lo, após este refino.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido no repositório ou documento · `[PROPOSTA]` deste refino, a validar · `[PREMISSA]` depende de outra história · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Situação e dependências

1. `[VERIFICADO]` Quadro local (`docs/factory/quadro-status.md`, atualizado em 2026-11-12 15:23 UTC): #44 em Product Owner; #43 em Aguardando aprovação; #36 e #37 em Arquitetura (a #37 espera a #36 pela correção de fluxo).
2. `[VERIFICADO]` Backlog (14-BACKLOG, H-031): dependências H-030 (#43), H-012 (#25) e H-015 (#28). #25 e #28 estão em Concluído. #43 ainda não está Concluída.
3. `[DECIDIDO]` Correção de fluxo (11-DECISOES, "Correção de fluxo (2026-11-12)"): cadeia #43 → #44 → #36 → #37. A #44 só entra em Desenvolvimento depois que a #43 for concluída por decisão humana. O refino (Product Owner e Arquitetura) pode avançar antes.
4. `[DECIDIDO]` Decisão 102: H-031 é condição de construção da #36. O desenho da #36 (97-DESENHO-H023) já foi aprovado para Arquitetura.
5. `[VERIFICADO]` Migração mais recente de rascunho: `20261112150000_draft_expand_review_confirmation.sql` (confirmação expressa, `confirmed_at` e `content_rev`). Não existe ainda tabela `service_request` no repositório (97 §0.2 e busca em `supabase/migrations`).

---

## 1. Objetivo

Permitir que o cliente, depois de identificar-se, confirmar o e-mail e confirmar expressamente o pedido, **publique** o rascunho confirmado como um pedido novo, com ID próprio, admissão de aceites aberta e prazo fixo de 7 dias corridos para aceites, sem nunca publicar de forma automática e sem criar um segundo pedido quando a ação for repetida.

Resultado de negócio: o pedido passa a existir para os profissionais (a descoberta da #36 e da H-055 passam a enxergá-lo), e o cliente tem uma única ação explícita para colocá-lo no ar.

---

## 2. Escopo (dentro da #44)

1. Ação de publicar sobre o rascunho confirmado (`confirmed_at` preenchido, `status = 'aberto'`), com `content_rev` reconferido na mesma transação.
2. Criação do pedido (`app.service_request`) com **novo ID**, status `publicado`, `published_at`, `acceptance_deadline_at = published_at + 7 dias corridos` (imutável) e vínculo ao cliente dono da sessão.
3. Marcação do rascunho como `publicado` na mesma transação (decisão 60 deixou `aberto` até H-031).
4. Exigência de e-mail verificado e de sessão autenticada (H-014) na publicação.
5. Limite de taxa de publicação (RF-021), sem expor o detalhe do limite.
6. Idempotência por `Idempotency-Key` (H-005) e unicidade de pedido por rascunho (repetição, retry e duas abas).
7. Aviso de possível duplicidade, que nunca bloqueia (decisão 62; ADR-015), com confirmação expressa adicional.
8. Passo de geocodificação permanente que a publicação aciona, conforme o contrato de H-021 (68-DESENHO-H021, §3.1, passo 3), com porta simulada em teste.
9. Colunas, índices e restrições de `service_request` que a descoberta da #36 lê (ver §8 e §11).
10. Interface mínima do botão "Publicar pedido" na tela de revisão, com estados de §7 (a decidir, ver Q7).

## 3. Fora de escopo

- **Aceite de trabalho** (H-058 a H-064, #71 a #75): nesta história nenhum aceite é criado e nenhum contador de vagas existe. A admissão só fica "aberta" como estado de dados.
- **Painel do cliente** (H-034, #47): lista de pedidos, tela pós-publicação com orientação de voltar ao FastPro.
- **Telefone e WhatsApp** (H-033, #46): nenhum campo de telefone é gravado ou exibido. Republicação não herda opt-in.
- **Visibilidade de localização** (H-032, #45): a resposta da publicação não contém coordenada nem endereço exato.
- **Notificações** (E11, #102 a #109): nenhum e-mail é enviado ao publicar. Envio segue desligado até o lançamento (regra de projeto).
- **Descoberta por raio** (H-023, #36) e **cobertura** (H-024, #37): consumidores do pedido, não parte desta história.
- **Republicação** (H-082, #92) e **uma republicação ativa por cadeia** (H-083, #93): nesta história só se prepara o esquema (Q10).
- **Avaliação, cancelamento, seleção, conclusão** (E6 a E10).

---

## 4. Atores e pré-condições

- **Cliente visitante com conta**: a identificação por link (H-013, #26) e a sessão de 7 dias (H-014, #27) já existem.
- **Pré-condições da publicação**, todas verificadas no banco e não só na tela:
  - rascunho vivo (`aberto`, prazo de rascunho não vencido, ver §5, RN-13);
  - `confirmed_at` preenchido e `content_rev` igual ao lido pelo cliente;
  - e-mail do rascunho confirmado e e-mail verificado da conta (`email_verified_at`), que devem coincidir (Q3);
  - sessão autenticada do dono do rascunho (Q2 e Q3);
  - serviço do rascunho ativo no catálogo (`service.active`), senão a publicação recusa como campo faltando (regra já aplicada em `decideReview`, 90 §2.1);
  - endereço geocodificado de forma permanente ou geocodificação concluída nesta mesma chamada (RN-09).
- **Profissional**: não participa desta história.

---

## 5. Regras de negócio

| ID | Regra | Origem |
|---|---|---|
| RN-01 | Publicação só por ação explícita do cliente (um POST com `content_rev` e `Idempotency-Key`). Nunca automática: nem ao confirmar, nem ao validar o e-mail, nem ao fechar a aba, nem por job. | RF-014; FA-002; decisão 61 |
| RN-02 | Exige e-mail verificado (rascunho e conta) e sessão autenticada. Sem e-mail verificado nada é publicado, inclusive por chamada direta de API. | RF-035; FA-002; H-016 CA-05 (32-REFINO-H016); H-037 D-H037-3 não se aplica aqui |
| RN-03 | Cada publicação cria um pedido com **novo ID**. Não reaproveita o ID do rascunho. | RF-015; FA-002 |
| RN-04 | `published_at` é o instante da transação. `acceptance_deadline_at = published_at + 7 dias corridos`, gravado uma vez e imutável (trigger bloqueia qualquer UPDATE dessa coluna). O prazo não muda com o número de aceites nem com eventos. | RF-015; RF-072; I-07; 09 §3.4 |
| RN-05 | Admissão aberta = `status = 'publicado'` **e** instante atual anterior a `acceptance_deadline_at`. Não há coluna separada de admissão. | RF-015; I-05; decisão 60 |
| RN-06 | Repetição não cria segundo pedido: mesma `Idempotency-Key` e mesmo corpo devolvem a resposta guardada; mesma chave com corpo diferente, 422; chave em andamento, 409. Além disso, no máximo um pedido por rascunho (restrição de unicidade). | RF-088; FA-035; C-14; H-005 |
| RN-07 | Publicar move o rascunho para `publicado` na mesma transação do pedido. Se algo falhar, nem pedido nem estado do rascunho mudam (tudo ou nada). | RF-088; FA-035; decisão 60 |
| RN-08 | Aviso de duplicidade: mesmo serviço, **mesmo cliente verificado**, centro do ponto exato a até 100 m, e pedido ativo (`publicado` ou `selecionado`) ou criado nas últimas 24 h. Compara só com pedidos do próprio cliente. Não bloqueia. Quando há aviso, a resposta é 409 com código de duplicidade e só a publicação com confirmação expressa adicional segue (Q1). | decisão 62; ADR-015; RF-092 (princípio) |
| RN-09 | Geocodificação permanente: a publicação chama o passo de H-021 uma vez por endereço; teto de 3 endereços por rascunho/pedido; repetição do mesmo texto reaproveita o resultado sem nova cobrança; falha do provedor não consome o teto e deixa o rascunho intacto. Em teste, a porta é simulada. A chamada real é BLQ-EXEC. | 68-DESENHO-H021 §3.1–3.4; I-28; G-02 a G-06 |
| RN-10 | Nenhuma coordenada, ponto exato, identificador interno ou hash sai na resposta da publicação. Só ID, status, prazo e confirmação. | I-16; 08 §4.3; decisão 107 (distância não sai do banco) |
| RN-11 | Publicar não envia e-mail, não cria aceite, não cria conversa e não altera contador de vagas. | E11 e E6 fora de escopo; regra de projeto (e-mail desligado) |
| RN-12 | Resposta de publicação e textos de tela nunca afirmam "publicado" antes da confirmação do servidor. Texto só depois do 201/200. | decisão 61; 90 §5.3 |
| RN-13 | Rascunho vencido (prazo de 7 dias renovado a cada salvamento e confirmação; teto absoluto de 30 dias) não publica: a resposta é o 404 uniforme. | 90 §2.2 (renovação), R10; DRAFT_ABSOLUTE_MAX_DAYS |
| RN-14 | Limite de publicação por cliente e por IP-HMAC; excesso responde 429 com `Retry-After` e sem detalhe do limite. | RF-021; FA-003; §1 e CA-10 de H-025 (71-REFINO-H025) |
| RN-15 | Fotos: publicar leva as fotos confirmadas para o pedido; fotos ainda em processamento ou em quarentena bloqueiam a publicação (Q14). | H-026/H-027 (media_asset, 20261112120000); decisão 30 |

---

## 6. Fluxo principal e alternativos

**Fluxo principal (publicar):**
1. O cliente, na tela de revisão, vê o pedido confirmado (`confirmed_at` preenchido, mensagem "Pedido confirmado. Ainda não foi publicado.") e aciona "Publicar pedido" (Q7).
2. O cliente envia a ação com a versão que viu (`content_rev`) e uma chave de idempotência.
3. O servidor confere, sem custo e antes de qualquer chamada paga: sessão, rascunho vivo, `confirmed_at`, `content_rev` igual, e-mail verificado, serviço ativo, campos completos, limite de taxa, endereço válido.
4. Obtém o ponto permanente do endereço (RN-09) ou reaproveita o existente.
5. Verifica duplicidade (RN-08) com o ponto obtido. Havendo aviso e sem confirmação expressa, responde 409 de duplicidade e nada é criado.
6. Numa transação: cria o pedido com novo ID, prazo, status `publicado`, vínculo ao rascunho e ao cliente; marca o rascunho `publicado`; grava a resposta da chave de idempotência.
7. Responde 201 com ID, status, `published_at` e `acceptance_deadline_at`. A tela mostra "Pedido publicado" e o prazo.

**Alternativos:**
- **A1 Repetição com a mesma chave e mesmo corpo** (retry de rede ou clique duplo): devolve a resposta guardada, sem novo pedido e sem nova chamada paga.
- **A2 Duas abas, chaves diferentes:** a segunda vê o rascunho já `publicado` (Q9). Recomendação: devolver o pedido já criado do mesmo rascunho, sem criar outro.
- **A3 Aviso de duplicidade:** 409 de duplicidade com os dados mínimos do pedido próprio (ID, data, serviço); o cliente escolhe "Revisar" ou "Publicar mesmo assim" (Q1). Nunca bloqueia.
- **A4 Conteúdo alterado depois de confirmar:** o gatilho do banco já desfez a confirmação; a publicação responde 409 `conteudo_alterado` e a tela recarrega a revisão.
- **A5 Falha no provedor de geocodificação:** 503 com `Retry-After`; rascunho intacto; nada cobrado.
- **A6 Endereço não encontrado:** 422 com o texto preservado; o cliente corrige o endereço; nenhuma nova cobrança para o mesmo texto.
- **A7 Limite de endereços por pedido (3):** 422 `geocode_limit`, sem custo.
- **A8 Geocodificação em andamento para o mesmo endereço (outra publicação):** 409 com `Retry-After: 2`.

---

## 7. Estados da interface (tela de revisão, ação de publicar)

| Estado | Gatilho | Texto (sem "publicado" antes da hora) | Foco e acessibilidade |
|---|---|---|---|
| Confirmado, pronto para publicar | `confirmed_at` preenchido e sem erro | "Pedido confirmado. Ainda não foi publicado." e botão "Publicar pedido" | foco no título ao entrar |
| Publicando | ação em curso | botão desabilitado, texto "Publicando seu pedido…" | `aria-busy`; Enter repetido não envia de novo |
| Publicado | 201 ou 200 da repetição | "Pedido publicado." com prazo "Aceites até [data]" | foco no título; `role="status"` |
| Aviso de duplicidade | 409 de duplicidade | "Você já tem um pedido parecido publicado recentemente." com "Revisar" e "Publicar mesmo assim" | foco no primeiro botão; `role="alert"` |
| Conteúdo alterado | 409 `conteudo_alterado` | "Seu pedido mudou. Confira de novo antes de publicar." | recarrega a revisão; foco no título |
| Sessão ausente ou expirada | 401 | "Entre de novo para publicar." (link para o acesso) | foco no título |
| Não publicado, limite | 429 | "Muitas tentativas. Tente de novo mais tarde." (sem número) | foco no botão |
| Endereço não encontrado | 422 `endereco_nao_encontrado` | "Não encontramos esse endereço. Corrija e tente de novo." | foco no campo de endereço |
| Limite de endereços | 422 `geocode_limit` | "Este pedido já usou o número máximo de endereços. Mantenha o endereço atual." | foco no campo |
| Processando endereço | 409 com `Retry-After` | "Ainda processando o endereço. Tente de novo em instantes." | foco no botão |
| Rascunho vencido | 404 | "Seu pedido expirou. Refaça o pedido." | foco no título |
| Indisponível | 503 | "Não foi possível publicar agora. Seus dados continuam salvos. Tente de novo." | foco no botão |

Todos os estados têm texto visível, não dependem só de cor e funcionam por teclado (regra de acessibilidade do projeto, herdada de #43).

---

## 8. Dados e contrato (o que a #44 cria)

Requisito de forma, sem SQL. Divergência de nome vai ao Architect (ver Q5).

**`app.service_request` (criada pela #44):**
- identidade: `id` (novo, uuid), `origin_draft_id` (único, ligação ao rascunho, Q8);
- dono: `customer_user_id` (conta do cliente, de `app.app_user`);
- serviço e estado: `service_id` (referência ao catálogo), `status` com valores `publicado | selecionado | concluido | cancelado` (09 §3.4; a #44 só grava `publicado`);
- datas: `published_at`, `acceptance_deadline_at` (imutável, trigger de bloqueio de UPDATE), `created_at`;
- conteúdo: `urgency`, `description`, `address_text` (texto, sem coordenada), `first_name` (C2);
- localização: `geocode_point_id` referenciando `app.geocode_point(id)`, **único** (um pedido, um ponto, 97 §3.2);
- contador: `acceptances_count` inicial 0 e `wave2_opened_at` nulo (09 §3.4; o contador só muda em E6);
- versão: `version` (concorrência otimista, 09 §3.4);
- cadeia (Q10): `is_republication` (padrão falso), `chain_id` e `republished_from_id` nulos, sem índice nesta história.

**Restrições e índices:**
- `status` sem valor fora da lista; check `wave2_opened_at` nulo ou posterior a `published_at`;
- índice `(service_id, status, acceptance_deadline_at)` (09 §6): é o índice que a descoberta da #36 usa no ramo online;
- `geocode_point_id` único;
- proibir UPDATE de `acceptance_deadline_at` e de `published_at` (o segundo é recomendação deste refino, não está em 09).

**Alterações em rascunho e chaves:**
- o rascunho recebe o estado `publicado` (o check de `confirmed_at` já aceita `publicado`, migração 20261112150000);
- nenhuma coluna de coordenada é adicionada ao rascunho (I-28, decisão 29).

**Permissões:** a publicação roda só por função do banco (papel de aplicação). A tabela não recebe escrita direta. A leitura do dono usa função de dono. A leitura da descoberta é interna (#36).

---

## 9. Critérios de aceite (testáveis)

- **CA-01 (RN-01).** Dado um rascunho confirmado, quando o cliente só confirma o e-mail, abre a revisão ou fecha a aba, então nenhum pedido existe. Verificação: contagem de pedidos antes e depois, zero criados.
- **CA-02 (RN-02).** Dado um rascunho com e-mail não verificado, quando alguém chama a publicação diretamente, então é recusado (409 `email_nao_confirmado` ou 422 conforme o desenho) e nada é criado.
- **CA-03 (RN-03).** Dado um rascunho confirmado, quando publicado, então o pedido tem ID diferente do ID do rascunho e o rascunho passa para `publicado`.
- **CA-04 (RN-04).** Dado um pedido publicado às T, então `acceptance_deadline_at` é T + 168 h exatas. Uma alteração direta dessa coluna falha.
- **CA-05 (RN-05 e I-05).** Dado um pedido publicado com prazo futuro, então a admissão está aberta; no instante exato do prazo, ou depois, a admissão está fechada (limite aberto).
- **CA-06 (RN-06).** Dado um mesmo pedido enviado duas vezes com a mesma chave, então existe um único pedido e a segunda resposta é idêntica à primeira; com outra chave, existe ainda um único pedido por rascunho.
- **CA-07 (RN-06).** Dado a mesma chave com corpo diferente, então 422; dado a mesma chave enquanto a primeira ainda está em andamento, então 409.
- **CA-08 (RN-07).** Dado uma falha forçada depois da criação do pedido e antes da marcação do rascunho, então nada persiste: nem pedido, nem rascunho alterado, nem chave gravada.
- **CA-09 (RN-08).** Dado um pedido ativo do mesmo cliente, mesmo serviço, a 60 m, então a primeira tentativa responde o aviso de duplicidade e nada é criado; com confirmação expressa, o pedido é criado. Dado outro cliente no mesmo ponto, então não há aviso (nunca vaza informação de outro cliente).
- **CA-10 (RN-09).** Dado um endereço novo, então exatamente uma chamada ao provedor (porta simulada), com a flag permanente; repetição do mesmo texto não chama de novo; o quarto endereço diferente no mesmo pedido responde `geocode_limit` sem chamar o provedor.
- **CA-11 (RN-09, A5).** Dado falha do provedor, então 503 com `Retry-After`, rascunho intacto e contador do teto não consumido.
- **CA-12 (RN-10).** Dado qualquer resposta de publicação, então o corpo contém só os campos previstos, sem coordenada, sem ponto, sem endereço exato e sem identificador interno do ponto.
- **CA-13 (RN-11).** Dado uma publicação bem-sucedida, então nenhuma mensagem de e-mail é enfileirada e nenhum aceite ou conversa é criado.
- **CA-14 (RN-12).** Dado a tela antes da resposta do servidor, então a palavra "publicado" não aparece como afirmação; só depois do 201 ou 200.
- **CA-15 (RN-13).** Dado um rascunho vencido ou além do teto de 30 dias, então a publicação responde o 404 uniforme e não cria pedido.
- **CA-16 (RN-14).** Dado excesso de publicações por cliente ou por IP, então 429 com `Retry-After`, sem número do limite no corpo.
- **CA-17 (RN-15).** Dado uma foto em processamento, então a publicação não cria o pedido e responde o estado definido em Q14.
- **CA-18 (RN-04 e 8).** Dado uma publicação, então o índice `(service_id, status, acceptance_deadline_at)` e a unicidade de `geocode_point_id` existem.
- **CA-19 (estados).** Dado cada estado de §7, então há texto visível, foco no lugar indicado e nenhum botão de publicar aparece no estado "Ainda não foi publicado" sem a ação de §6.

Evidências previstas (locais, sem declarar CI verde): testes de banco no Postgres local, testes de integração das rotas, teste de navegador para os estados de §7. Comando e código de saída serão registrados pelo DEV na Issue.

---

## 10. Casos de borda

1. **Confirmação, depois alteração em outra aba, depois publicação:** o gatilho desfaz a confirmação; a publicação recusa (A4).
2. **Duas abas com chaves diferentes:** ver A2 e Q9.
3. **Clique duplo rápido:** a tela desabilita o botão; o servidor responde a repetição pela chave (A1).
4. **Relógio e fronteira do prazo:** o prazo é gravado no instante da transação; testes usam relógio fixo.
5. **Sessão expira entre confirmar e publicar:** 401 e volta ao acesso; o rascunho continua confirmado (renovação do rascunho em 90 §2.2).
6. **Rascunho vence entre a leitura e a publicação:** responde 404 (RN-13), sem criar pedido.
7. **Mudança de serviço para inativo no catálogo entre confirmar e publicar:** recusa como campo faltando (regra de `decideReview`).
8. **Endereço igual ao de outro pedido do mesmo cliente com mesmo serviço:** aviso de duplicidade (RN-08), não bloqueio.
9. **Endereço novo depois de confirmar:** muda `content_rev`; a publicação recusa e pede nova confirmação; se o endereço novo for geocodificado antes da recusa, o custo é registrado e contado no teto (Q13 sobre quando a geocodificação roda).
10. **Fotos:** foto em processamento bloqueia (Q14); foto removida após confirmar muda `content_rev` (critério herdado de 90 §3.3; verificar se já foi implementado em #39 e #42, ver §14).
11. **Pico de publicações do mesmo cliente:** limite de RN-14; a chave de idempotência não conta como nova publicação.
12. **Falha depois da criação e antes da resposta:** a repetição com a mesma chave devolve o pedido criado (sem nova cobrança, porque a geocodificação está em transação própria, 68 §3.1).
13. **Taxa (cobrança do provedor):** por endereço, no máximo 3 por pedido (RN-09); porta simulada em dev. A chamada real é BLQ-EXEC (Q11).
14. **Republicação:** fora de escopo; o esquema deixa as colunas nulas (Q10) para não reabrir a tabela em #92.

---

## 11. O que a #36 espera da #44

A #36 (97-DESENHO-H023, §0.2, §3.2 e §4.3) só consome, sem reescrever:

| Item | Exigência |
|---|---|
| Tabela `app.service_request` | existe, com `id`, `service_id`, `status`, `acceptance_deadline_at`, `geocode_point_id` |
| `geocode_point_id` | referencia `app.geocode_point(id)` e é único por pedido (um pedido, um ponto) |
| Estados lidos | `publicado` é o único estado de admissão aberta; `selecionado`, `concluido` e `cancelado` existem como valores válidos (a #36 os filtra) |
| Prazo | `acceptance_deadline_at` gravado e imutável; a #36 compara com o instante de execução |
| Índice | `(service_id, status, acceptance_deadline_at)` para o ramo online (09 §6) |
| Ponto do pedido | o centro de célula vem de `geocode_point` com `subject_kind = 'request'` e `state = 'ok'` e `match_*` preenchidos; a #44 garante que a publicação só cria pedido com ponto `ok` |
| Modalidade | ver Q4: a #36 não lê modalidade do pedido; a regra usa o serviço e a modalidade declarada pelo profissional |
| Sem dado pessoal | a #36 não recebe nome, e-mail, telefone nem endereço exato do pedido |

Teste de integração que a #36 exige da #44: pedido publicado com ponto `ok` aparece na descoberta dentro do raio e some depois do prazo (T-D07 da #36).

---

## 12. Conflitos e hipóteses

1. **Modelo de localização diverge.** `09-MODELO-DADOS` §3.4 descreve `service_request` com `exact_point`, `match_point`, `geocode_mode` e `address_text_enc`. O repositório (#34, #35) e os desenhos 68 e 97 usam tabela `geocode_point` e `geocode_point_id`. Hipótese deste refino: adotar `geocode_point_id` e atualizar 09 (Q5).
2. **Quem chama a geocodificação permanente.** `68-DESENHO-H021` §3.1 põe a chamada paga no fluxo de publicação da H-031, não na revisão. Hipótese: a #44 chama o passo; a revisão só lê o que já existe. Confirma-se em Q13.
3. **Estado "aguardando geocodificação".** 68 §5 e o código de 202 pedem um estado intermediário. O rascunho só tem `aberto`, `aguardando_email`, `descartado` e `publicado` (`DRAFT_STATUSES`). Hipótese: não criar estado novo; a publicação responde 202 e o cliente repete (Q6).
4. **Sessão na publicação.** 90 (linhas de §5 e §7) e 68 exigem sessão de H-014. Confirmado como exigência; a relação com step-up de 30 min não foi verificada (Q2).
5. **Aviso de duplicidade.** Decisão 62 põe o aviso na #44, e não na #43. O aviso precisa do ponto exato, que só existe depois da geocodificação. Por isso não cabe na #43 (decisão 62 confirma).
6. **Duplicidade e distância.** ADR-015 pede 100 m sobre o ponto exato. O mecanismo (PostGIS ou fórmula no banco) depende da decisão S-02, não verificada nesta rodada (Q17).
7. **Modalidade do pedido.** Decisão 102 cita "pedidos com serviço, modalidade e status", mas 09 e 97 não têm coluna de modalidade no pedido (Q4).
8. **Teto de geocodificação.** Decisão 29 e H-021 fixam teto de 3 endereços por rascunho. Esse teto é contado por pedido ou por rascunho? Recomendação: por rascunho, até a publicação (Q12 agrupa valores).

---

## 13. Perguntas abertas

Numeração local deste documento (Q1 a Q17). O líder consolida e renumera na sequência contínua da sessão. Cada pergunta traz recomendação e a decisão que destrava.

1. **Confirmação após aviso de duplicidade.** Alternativas: (a) campo booleano explícito no corpo da publicação; (b) segundo envio com um token de reconhecimento de 5 min devolvido no 409. Recomendação: (b), porque o token prova que o aviso foi exibido e não pode ser enviado por código que nunca mostrou o aviso. Destrava: RN-08 e CA-09.
2. **Sessão e step-up na publicação.** Alternativas: (a) sessão comum de 7 dias (H-014); (b) step-up de 30 min (`recent_auth_at`). Recomendação: (a), porque publicar não é ação financeira; o step-up fica reservado a ações críticas. Não verifiquei 08 §5.4 (ver §14). Destrava: RN-02.
3. **Vínculo entre sessão e rascunho.** Alternativas: (a) exigir que o e-mail confirmado no rascunho seja o e-mail verificado da conta da sessão; (b) aceitar qualquer sessão com posse do cookie. Recomendação: (a), porque evita publicar em nome de outra pessoa. Destrava: RN-02 e CA-02.
4. **Modalidade gravada no pedido.** Alternativas: (a) não gravar; a regra usa só o serviço e a declaração do profissional; (b) coluna `modality` no pedido, nula ou derivada. Recomendação: (a), salvo se o requisito do pedido exigir modalidade própria (não verifiquei o requisito do pedido). Destrava: §8 e §11.
5. **Modelo de localização do pedido.** Alternativas: (a) `geocode_point_id` (implementado) e atualizar 09 §3.4; (b) manter `exact_point` no pedido, o que contraria I-28 e a tabela de #34. Recomendação: (a). Destrava: esquema de `service_request`.
6. **Estado de rascunho para geocodificação pendente (202).** Alternativas: (a) novo estado `aguardando_geocodificacao` (migração de check); (b) sem estado novo; 202 e repetição pelo cliente. Recomendação: (b), para não ampliar a máquina de estados do rascunho. Destrava: 68 §5.
7. **Onde mora o botão "Publicar pedido".** Alternativas: (a) #44, na tela de revisão; (b) #47, junto da tela pós-publicação. Recomendação: (a), porque a ação é da #44 e #47 trata só do painel. Destrava: §7 e CA-19.
8. **Vínculo um pedido por rascunho.** Alternativas: (a) coluna `origin_draft_id` única em `service_request`; (b) coluna `published_request_id` no rascunho. Recomendação: (a), porque a regra de unicidade fica na tabela do pedido. Destrava: RN-06.
9. **Segunda aba com chave diferente.** Alternativas: (a) 409 `ja_publicado` com o ID do pedido; (b) devolver 200 com o pedido já criado; (c) 404 uniforme. Recomendação: (b), porque o pedido é único por rascunho e a resposta fica idempotente. Destrava: A2 e CA-06.
10. **Colunas de cadeia agora ou depois.** Alternativas: (a) criar `is_republication`, `chain_id` e `republished_from_id` nulos agora, sem índice; (b) criar só em H-082. Recomendação: (a), para não reabrir a tabela em #92. Destrava: §8.
11. **Chamada real ao provedor de mapa.** Alternativas: (a) manter porta simulada em teste e chamada real como BLQ-EXEC (cartão e limite na conta); (b) liberar a chamada real agora. Recomendação: (a), é decisão do dono e já está registrada em H-021. Destrava: CA-10 em ambiente real.
12. **Valores de limite de publicação e de duplicidade.** Alternativas: (a) PROPOSTA deste refino: 5 publicações por hora por cliente e 20 por dia por IP-HMAC; duplicidade de ADR-015 (100 m, 24 h), em `app_config`; (b) outros valores. Recomendação: (a), a validar contra 08 §10.2 (não lido). Destrava: RN-14 e CA-16.
13. **Quando a geocodificação roda.** Alternativas: (a) só na publicação (desenho 68 §3.1); (b) também na revisão, para avisar o cliente antes. Recomendação: (a), porque a revisão não deve gerar custo sem ação explícita. Destrava: §10, item 9.
14. **Fotos na publicação.** Alternativas: (a) bloquear enquanto houver foto em processamento (`fotos_em_processamento`, 409) e ligar só as fotos confirmadas; (b) publicar sem as fotos em processamento. Recomendação: (a), para o pedido não nascer sem foto que o cliente viu. Destrava: RN-15 e CA-17.
15. **Prazo "dia corrido".** Alternativas: (a) 168 h absolutas em instante de transação; (b) dia corrido no calendário de Brasília. Recomendação: (a); no Brasil não há horário de verão desde 2019 (conhecimento geral, não verificado no repositório), então as duas formas coincidem. Destrava: RN-04.
16. **`published_at` imutável.** Alternativas: (a) bloquear alteração de `published_at` além de `acceptance_deadline_at`; (b) só o prazo. Recomendação: (a). Destrava: §8.
17. **Mecanismo de distância da duplicidade.** Alternativas: (a) PostGIS (`ST_DWithin`), se S-02 aprovou; (b) fórmula de esfera no banco sobre o ponto exato, se S-02 caiu no fallback. Recomendação: seguir o resultado de S-02, que o Architect confirma. Destrava: RN-08 e CA-09.

---

## 14. O que NÃO verifiquei

- Não li `96-REFINO-H023.md`; usei o resumo de CA-01 a CA-13 e as decisões 101 a 108 transcritos em 97-DESENHO-H023.
- Não li `89-REFINO-H030.md` e `90-DESENHO-H030.md` na íntegra; usei buscas dirigidas (estados, confirmação, `content_rev`, 409, 422, sem publicação).
- Não li `08-ARQUITETURA.md` (§5.1, §5.4, §10.2), portanto as relações com step-up e com limites de taxa são hipóteses (Q2, Q12).
- Não li `09-MODELO-DADOS.md` inteiro; usei buscas (`service_request`, `request_draft`, prazo, índices, papéis).
- Não li `04-PRD.md` na íntegra; usei buscas (RF-012, RF-014, RF-015, RF-019, RF-021, RF-035, RF-072, RF-088, RF-092) e os critérios FA-002, FA-003, FA-035.
- Não li as decisões 70 a 75 (desenho de H-030, rodada 23); só as decisões 59 a 69, 101 a 108 e 60 a 62, lidas nas rodadas 21, 22, 31, 44, 48 e 50.
- Não li `68-DESENHO-H021` §5 (estado de geocodificação pendente, breaker) e §2.1 (contrato permanente completo); só §2.3, §2.4, §3.1 e §3.2.
- Não li `74-DESENHO-H025` nem `71-REFINO-H025` além das linhas de CA.
- Não li o código de `draft-hash.ts`, `draft-gate.ts`, `draft-nonce.ts`, `compose.ts` nem as migrações de confirmação (20261112150000) e de media (20261112120000, 20261112190000) por completo.
- Não verifiquei se #39 e #42 já incrementam `content_rev` nas mudanças de foto (RN-15, §10 item 10).
- Não verifiquei S-02 (PostGIS ou fallback).
- Não consultei o GitHub Project; a fonte usada foi o quadro local `docs/factory/quadro-status.md`, conforme a regra do projeto.
- Não executei testes, builds ou migrações. Não escrevi código.
- Não fiz commit: o agente não tem shell nesta sessão (ver §15).

---

## 15. Próximos passos e entrega

1. Este refino vai ao líder, que decide as perguntas Q1 a Q17 em lista única e numerada na sessão.
2. Após as respostas, o cartão sai do Product Owner para Arquitetura (ordem de colunas: Product Owner → Arquitetura → Desenvolvimento → Code Review → QA → Aguardando aprovação).
3. O Architect deve fechar §8 (esquema) e §11 (contrato com a #36); o desenho da #36 espera isso e não o contrário.
4. O Desenvolvimento da #44 só começa depois que a #43 for concluída por decisão humana (correção de fluxo de 2026-11-12).
5. Commit: `git add docs/factory/109-REFINO-H031.md` e `git commit -m "docs(H-031): refino da publicacao idempotente (#44)"` com os dois trailers exigidos. **Não commitado por este agente (sem shell).** O líder faz o commit.
