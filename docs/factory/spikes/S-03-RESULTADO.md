# S-03 Resultado — Mercado Pago: tarifas, recorrência, Pix e webhook (Issue #6, WF-03, Arquitetura)

- **Data:** 2026-11-10 · **Branch:** `feature/init` · **Refino:** `30-REFINO-S03.md` (f7341d1).
- **Ambiente:** API do Mercado Pago com a credencial cadastrada em `.env.local` (lida só por código, nunca impressa). `GET /users/me` devolveu `tags` com `test_user` e `site_id=MLB`: conta de teste. Os prefixos do token e da chave pública são `APP_USR` (ver achado A1). Nada foi cobrado, nenhum deploy, nenhuma URL pública.
- **Segredos:** nenhum token, chave, número de cartão, e-mail de usuário de teste ou código Pix neste documento. Os 4 planos criados foram inativados ao fim (`status` devolvido: `cancelled`).
- **Scripts:** chamadas de teste em arquivos temporários fora do repositório; só a verificação local de assinatura ficou versionada em `docs/factory/spikes/s03/verify_signature.py` (dados sintéticos).
- **EXEC-ID:** não gerado (`execctl.py` não acionado neste spike).

## Resultado por critério

| CA | Resultado | Evidência (resumo, sem segredo) |
|---|---|---|
| 00 credencial | PARCIAL | Variáveis reais no `.env.local`: `MERCADO_PAGO_ACCESS_TOKEN` e `MERCADO_PAGO_PK`. **Não existe** variável de segredo de webhook. Os nomes `MP_*` do refino não existem; usar os nomes reais. A guarda `MP_ENV` não foi implementada (a conta é de teste por `tags`). |
| 01 recorrência por ciclo | **VERIFICADO (plano)** | `POST /preapproval_plan` com 1, 3, 6 e 12 meses (`frequency_type=months`) e valores 29,90 / 80,70 / 149,40 / 238,80: os 4 retornaram HTTP 201, `status=active`, com frequência e valor ecoados em `auto_recurring`. **Nenhum ciclo foi recusado**, então o fallback de ADR-007 não é acionado no nível de plano. Adesão com cartão: ver CA-02 e A2. |
| 02 cartão aprovado/recusado/pendente | **NÃO VERIFICADO** | Token de cartão de teste foi gerado com a chave pública (HTTP 201). `POST /v1/payments` com os 3 nomes de titular de teste (aprovado, recusado, pendente) retornou **HTTP 401 "Unauthorized use of live credentials"** nos 3. Estados e data de aprovação não foram observados em pagamento criado pelo spike. Em pagamentos antigos da conta aparecem `status=approved`, `status_detail=accredited` e o campo `date_approved` (ver CA-10). |
| 03 Bricks / cartão fora do servidor | **NÃO VERIFICADO** | Sem página com Bricks nem origem pública. Observado apenas: a tokenização (`/v1/card_tokens`) aceita a chave pública, ou seja, o servidor não precisa ver o número. Escopo PCI segue NÃO VERIFICADO. |
| 04 Pix avulso | **NÃO VERIFICADO** | `POST /v1/payments` com `payment_method_id=pix`: HTTP 401, mesmo erro de credencial. Sem QR, vencimento ou simulação de aprovação observados. |
| 05 Pix em recorrência | NÃO VERIFICADO | `POST /preapproval` com `payment_method_id=pix`: HTTP 400 `User bad request` (sem detalhe; pode ser regra do meio de pagamento ou restrição da conta de teste, não distinguido). Mantida a recomendação do refino: Pix manual por ciclo (RF-058). |
| 06 webhook com `x-signature` | **VERIFICADO só a lógica local; entrega real NÃO VERIFICADO** | `verify_signature.py` (payload simulado, segredo sintético): assinatura válida passa; segredo errado, `data.id` alterado, `x-request-id` alterado e cabeçalho ausente são rejeitados. Manifesto usado: `id:<data.id em minúsculas>;request-id:<x-request-id>;ts:<ts>;` com HMAC-SHA256 hex em `v1`. Formato conforme documentação oficial conhecida; **URL e data da conferência não registradas** (nenhuma fonte consultada nesta sessão). Entrega real: NÃO VERIFICADO, motivo: sem URL pública e sem segredo de webhook cadastrado. |
| 07 estado vem do recurso | NÃO VERIFICADO | Depende de webhook real e de pagamento criado. `GET /v1/payments/{id}` e `GET /preapproval/{id}` existem; a política de usar o recurso segue como requisito de DEV. |
| 08 reenvio, duplicado, fora de ordem | **Lógica local simulada; comportamento do MP NÃO VERIFICADO** | Simulação local: mesmo evento duas vezes gera 1 registro e 1 efeito; evento antigo após novo não regride o estado. Intervalo de reenvio do Mercado Pago (15 min citado) NÃO VERIFICADO. |
| 09 cancelamento | PARCIAL | Assinatura não pôde ser criada (A2). Cancelamento observado só em **plano**: `PUT /preapproval_plan/{id}` com `status=inactive` retornou 200 e `status=cancelled`. Cancelamento de assinatura (`PUT /preapproval/{id}`, `status=cancelled`) NÃO VERIFICADO. |
| 10 tarifas | **Campo identificado; tabela NÃO VERIFICADA** | A resposta de pagamento traz `fee_details[]` com `type=mercadopago_fee`, `amount` (BRL) e `fee_payer=collector`. Há 2 pagamentos antigos (28/09/2026, **não criados por este spike**, origem desconhecida) com esse campo preenchido. São dados da conta de teste, **não são tarifa de produção** e não foram usados para calcular percentual ou margem. Tabela oficial pendente (12-TODO #12; H-054 segue bloqueado). Nenhum valor de tarifa deve entrar em fixture ou cálculo. |
| 11 fixtures / produção | PARCIAL | Fixtures: só dados sintéticos no script de assinatura. Credencial de produção não usada; nenhum meio de pagamento real cadastrado. |

## Idempotência

- `POST /preapproval_plan` com a mesma `X-Idempotency-Key` duas vezes: **dois planos distintos** (ids diferentes). O cabeçalho **não** dá idempotência na criação de plano; a checagem de existência fica do nosso lado.
- `POST /v1/payments` com a mesma chave: NÃO VERIFICADO (bloqueado por A1).

## Achados

- **A1 (bloqueia CA-02, 04, 07 e parte de 09):** a credencial cadastrada tem prefixo `APP_USR` (formato de credencial de produção), embora o usuário seja de teste. Criação de pagamento recusada com 401 "Unauthorized use of live credentials". Criar plano, ler `users/me`, tokenizar cartão e listar pagamentos funcionou. **Dúvida ao Orquestrador (D-S03-9):** cadastrar as credenciais **de teste** da aplicação de teste (seção "Credenciais de teste" do painel, vendedor de teste e comprador de teste distintos) no `.env.local`. Não foi contornado.
- **A2:** `POST /preapproval` com cartão de teste: Mastercard de teste devolveu 400 `Unsupported_credit_card_for_recurring_payment`; Visa de teste e assinatura sem cartão (pending) devolveram 400 `User bad request` (sem detalhe). Possível causa, não confirmada: e-mail do comprador precisa ser de um usuário de teste real. Assinatura com periodicidade foi verificada no nível de **plano** (CA-01), não de assinatura aderida.
- **A3:** não foi usado `free_trial` do Mercado Pago (RF-057: o teste grátis é do app).

## Decisões

- **Bricks:** decisão do usuário mantida (checkout Bricks para cartão e Pix, tokenização no navegador). A tokenização por chave pública funciona. Renderização do Bricks sem origem pública e Pix no Bricks: NÃO VERIFICADO. Recomendação (D-S03-3): trocar o texto de H-047/ADR-007 de "checkout hospedado" para "checkout Bricks".
- **Assinaturas:** a API de **planos** (`preapproval_plan`) aceita os 4 ciclos (1, 3, 6, 12 meses) com os valores aprovados. Recomendação: recorrência no cartão por plano/ciclo, Pix manual por ciclo. A adesão com cartão **não** foi verificada, então a decisão final de ADR-007 fica **condicional** à repetição do teste com credenciais de teste (A1).
- **Webhook:** implementar verificação conforme o manifesto acima, `provider_event` único por (tipo, id do recurso, estado), consultar o recurso na API antes de conceder e nunca regredir estado por ordem de chegada. Falta URL pública (S-09) e segredo.
- **Libera:** H-046 (preços já aprovados). **Não libera** H-047, H-048, H-049, H-051, H-052 até A1/A2 serem resolvidos e o webhook ter entrega real. H-054 segue bloqueado.

## NÃO VERIFICADO (lista e motivo)

Estados de pagamento (A1); Pix (A1); idempotência de pagamento (A1); assinatura aderida e cancelamento (A1/A2); webhook real, reenvio e intervalo (sem URL pública, sem segredo); Bricks no navegador (sem origem pública); escopo PCI; tabela oficial de tarifas (usuário ou atendimento); conferência do formato `x-signature` na documentação oficial (sem fonte consultada com URL e data).

## Resumo em linguagem simples

Na conta de teste do Mercado Pago, criamos planos de pagamento a cada 1, 3, 6 e 12 meses sem recusa, mas as cobranças de teste foram barradas porque a chave cadastrada é do tipo "real". Pix, cartão aprovado/recusado, cancelamento e avisos automáticos ficam sem confirmação até cadastrarmos as chaves de teste e termos um endereço público; nenhuma taxa foi inventada.
