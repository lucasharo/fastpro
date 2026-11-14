# Desenho técnico H-041 — Estado da verificação visível ao profissional (Issue #54)

- **Issue:** #54 `[E4] Estado da verificação visível` · **História:** H-041 · **Épico:** E4 · **Workflow:** WF-03 (Feature) · **Etapa:** Arquitetura.
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-14. **EXEC-ID:** não informado.
- **Natureza:** somente documento. Nenhum código, migração, banco, chamada externa (Mapbox proibido) ou quadro foi alterado.
- **Entradas:** `136-REFINO-H041.md` (CA-H041-01 a 18, RN-H041-01 a 09), Rodada 120 de `11-DECISOES.md` (decisões 543 a 562; adotadas as recomendadas, com 543, 544, 545, 546, 549, 550, 557, 559 e 561 explícitas), `124-DESENHO-H039.md`, `134-DESENHO-H040.md`, migração `20261113200000_verification_create_case_queue.sql` (leitura de `verification_case_appeal`), cabeçalhos de `packages/domain/src/verification/professional-status-message.ts` e `apps/api/src/professional-profile-route.ts`.
- **Etiquetas:** `[DECIDIDO n]` decisão registrada · `[VERIFICADO]` lido no repositório · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` o DEV confere antes de codar · `[PERGUNTA n]` ao líder (§11).
- **Limites da leitura:** não li o texto da Issue no GitHub, não consultei banco, não li os corpos das migrações da #53 (`20261113280000`, `20261113310000`) nem o código completo de `professional-status-message.ts`. Orçamento de turnos curto.

## 1. Fatos e decisões que moldam o desenho

| Ref. | Efeito |
|---|---|
| 543, H040-530, 483 | `pendente`, `em_revisao` e `retida_duplicidade` viram o mesmo estado público `em_analise`, mesmo texto, mesmo corpo HTTP. |
| 544, 545 | Retenção e recusa por `duplicidade_suspeita` não mostram motivo de duplicidade. |
| 546 | `suspensa` é visível, sem recurso. |
| 549 | Pedir revisão só em `recusada`. |
| 391, 392, 550 | Um recurso por caso; a rota é de H-041 e reutiliza `private.verification_case_appeal` (#52). |
| 557 | Sem casca web: módulo de apresentação, textos em domínio puro, rota e contrato prontos e testados. |
| 559 | Desenvolvimento só depois da #53 Concluída. |
| 561 | Textos são modelo `[PROPOSTA]` usado no DEV; dono aprova antes de produção. |
| 562 | `sem_envio` visível, com ação para a tela de documentos (H-037). |

Fatos `[VERIFICADO]`:
- Última migração existente: `20261113310000_verification_fix_duplicate_original_rule.sql`.
- `private.verification_case_appeal(p_professional uuid, p_now timestamptz) returns table (out_code text)`: trava o caso `for update`; ordem das checagens: sem caso (`sem_caso`), `appeal_status <> 'nenhum'` (`recurso_ja_usado`), status fora de `recusada`/`retida_duplicidade` (`nao_elegivel`); efeito: caso `em_revisao`, `appeal_status='pendente'`, sem dono; evento `appeal_received` (papel `profissional`) e auditoria. Execute só a `app_system`.
- `app.verification_case` guarda `status`, `reason_code`, `explanation_to_professional` (até 500), `appeal_status`, `decided_at`; `app.professional_profile` guarda `verification_status`, `verified_at`, `suspended_at`.
- Pela #53 (`134`, princípio 1.3), perfil retido pelo cadastro **não** é espelhado em `em_revisao`: o caso pode estar `pendente` ou `em_revisao` enquanto o perfil está `retida_duplicidade`, e um perfil recusado com original vivo também não é espelhado no recurso. Logo, **o caso é a fonte do estado público quando existe** (dec. 371), não o perfil.
- `professional-status-message.ts` (#53) já exporta `ESTADO_PUBLICO_EM_ANALISE`, `TEXTO_EM_ANALISE`, `estadoPublicoDoProfissional(estadoInterno): string` e `mensagemAoProfissional(estadoInterno): MensagemProfissional | null`. H-041 consome esse arquivo e **não o altera** (dec. 560); se a correção de QA da #53 mudar os nomes, H-041 segue o arquivo final.
- Rota existente de profissional: `/v1/professional/profile` em `apps/api/src/professional-profile-route.ts` (`handleProfessionalProfileGet`/`Put`, porta `ProfessionalProfilePort`). Não há rota de estado da verificação.

## 2. Visão geral

```
GET  /v1/professional/verificacao          -> private.professional_verification_state(profissional)      (STABLE, só leitura)
POST /v1/professional/verificacao/recurso  -> private.professional_verification_appeal(profissional, now)
                                                 |-- trava o caso; só 'recusada' com appeal_status='nenhum'
                                                 '-- chama private.verification_case_appeal (#52): efeitos, evento e auditoria já prontos
Domínio puro (packages/domain/src/verification/): tabela de textos, mapeamento, view-model da tela
Apresentação (apps/web/public): renderizador sem texto próprio, sem casca; recebe o view-model do domínio
```

Princípios: (1) nenhuma tabela ganha grant; só funções `security definer`, `search_path = ''`, `execute` só a `app_system`; (2) a função de leitura é `STABLE` e não recebe relógio; (3) a **tradução para vocabulário público acontece no banco e de novo no domínio** (defesa em profundidade: nenhum valor interno nem `duplicidade_suspeita` sai da função); (4) uma única tabela de textos, em domínio; (5) nenhuma chamada a outro perfil: a função só lê o perfil e o caso do próprio profissional, sem consultar `document_hmac` (zero superfície de vazamento de duplicidade).

## 3. Migração e rollback (nomes)

- **Migração:** `supabase/migrations/20261113320000_verification_create_professional_state.sql`. Prefixo `[PROPOSTA]`: maior que `20261113310000`. O DEV reconfere o prefixo livre na hora de criar (#55 e outras podem ter usado). Aplicar com `npx supabase` no banco de desenvolvimento. Idempotente (`create or replace`). Sem tabela nova, sem coluna nova, sem gatilho, sem `cron`/`ops.job`, sem catálogo de auditoria novo (o recurso usa a ação `verification.case.appeal_received` que já existe em #52; a leitura não audita, CA-H041-10).
- **Rollback:** `supabase/rollbacks/20261113320000_verification_create_professional_state.down.sql`: `drop function` das duas funções (assinaturas completas). Não altera dado nem desfaz eventos de recurso já gravados (append-only). Seguro a qualquer momento: nenhuma função de #52 ou #53 é tocada.

## 4. Funções `private`

Padrão: `security definer`, `set search_path = ''`, `revoke all ... from public, anon, authenticated, service_role, app_api`, `grant execute ... to app_system` (assinatura completa). O ator é a sessão do profissional validada na API; a função recebe `p_professional uuid` já resolvido pela sessão (nunca vindo do corpo ou da URL).

### 4.1 Leitura do estado visível

`private.professional_verification_state(p_professional uuid) returns table (out_state text, out_reason_code text, out_explanation text, out_decided_at timestamptz, out_appeal text)` · `stable`.

- `p_professional` nulo: `22023 entrada_invalida`. Perfil inexistente: **zero linhas** (o adaptador responde `404 nao_encontrado`, corpo uniforme).
- Vocabulário de saída: `out_state` ∈ {`sem_envio`, `em_analise`, `aprovada`, `recusada`, `suspensa`}; `out_appeal` ∈ {`indisponivel`, `disponivel`, `recebido`, `analisado`} `[PERGUNTA 631]`.
- Regras, em ordem de precedência (a primeira que casar vence):
  1. Perfil com `verification_status = 'suspensa'`: `suspensa`; motivo, explicação e data nulos; `out_appeal = 'indisponivel'` (dec. 380 e 546).
  2. Existe caso (`app.verification_case` do profissional):
     - caso `pendente`, `em_revisao` ou `retida_duplicidade`: `em_analise`; `out_appeal = 'recebido'` se `appeal_status = 'pendente'`, senão `'indisponivel'`; motivo, explicação e data nulos (mesmo corpo nos três estados, CA-H041-02);
     - caso `aprovada`: `aprovada`; data = `coalesce(case.decided_at, profile.verified_at)`; `out_appeal = 'indisponivel'`;
     - caso `recusada`: `recusada`; data = `case.decided_at`; `out_reason_code = case.reason_code` **exceto** `duplicidade_suspeita` e `aprovado` (viram nulo; só os códigos de §6.2 saem); `out_explanation = case.explanation_to_professional` **só se** `reason_code <> 'duplicidade_suspeita'` `[PERGUNTA 624]`; `out_appeal = 'disponivel'` se `appeal_status = 'nenhum'`, `'analisado'` se `'decidido'`, `'recebido'` se `'pendente'` (não ocorre com caso `recusada`, mas coberto);
     - caso `suspensa`: tratado como regra 1.
  3. Sem caso e sem documento de identidade `recebido` (`app.identity_document.status = 'recebido'`, `purge_requested_at is null`): `sem_envio` (inclui perfil retido pelo cadastro sem envio de documento: resposta idêntica à de `pendente` sem envio, neutra).
  4. Sem caso e com documento `recebido` (legado ou corrida): mapeia o status do perfil: `pendente`, `em_revisao`, `retida_duplicidade` viram `em_analise`; `aprovada` vira `aprovada` com `verified_at`; `recusada` vira `recusada` sem motivo e `indisponivel`.
- **Nunca lê** `document_hmac`, `document_type`, `app.verification_case_event`, `assigned_to`, `decided_by`, `version` nem outro perfil. Sem `for update`, sem escrita, sem `audit_append` (CA-H041-10).
- **Sem ramo por duplicidade:** a retenção só aparece como caso `pendente`/`em_revisao`/`retida_duplicidade` ou perfil retido, e todos caem em `em_analise` sem distinção.

### 4.2 Recurso do profissional

`private.professional_verification_appeal(p_professional uuid, p_now timestamptz) returns table (out_code text)` · `volatile`.
1. Nulo: `22023`. Trava `app.verification_case ... where professional_id = p_professional for update` (mesmo lock de #52; reentrante).
2. Sem caso: `sem_caso`. Caso com `status <> 'recusada'` (inclui `retida_duplicidade`, `pendente`, `em_revisao`, `aprovada`, `suspensa`): `nao_elegivel` (dec. 549: só `recusada`; recurso de retido não é oferecido, e a restrição fica **fora** de `verification_case_appeal`, que continua aceitando `retida_duplicidade` para outros chamadores). `appeal_status <> 'nenhum'`: `recurso_ja_usado`.
3. Elegível: `return query select out_code from private.verification_case_appeal(p_professional, p_now)` e devolve o código (`ok` esperado; qualquer outro é repassado).
4. Perfil suspenso: `nao_elegivel` (conferido antes do passo 3).

Efeito já coberto por #52 (CA-H039-14): `appeal_status='pendente'`, caso `em_revisao` sem dono, evento `appeal_received` e auditoria. Nenhuma notificação (dec. 385).

## 5. Rotas (nível de contrato)

Ambas em `apps/api/src/professional-verification-route.ts`, mesmo padrão de `professional-profile-route.ts` (`[NÃO VERIFICADO]` o nome da validação de sessão do profissional e o mecanismo de CSRF/origem; o DEV segue o que a rota de perfil usa).

| Método e caminho | Sessão | Entrada | Sucesso | Erros |
|---|---|---|---|---|
| `GET /v1/professional/verificacao` | profissional (H-016), sem prova recente (dec. 556) | nenhuma (profissional vem da sessão) | `200 { estado, motivo?, explicacao?, decididoEm?, recurso: { situacao } }`; `Cache-Control: no-store` | `401` sem sessão; `404 { code: 'nao_encontrado' }` se a sessão não tem perfil profissional (mesmo corpo para qualquer negação); `500` genérico sem detalhe |
| `POST /v1/professional/verificacao/recurso` | profissional; CSRF e cabeçalhos de origem como nas rotas de profissional | nenhum corpo (dec. 553a); corpo recebido é ignorado | `200 { recurso: 'recebido' }`; `no-store` | `401`; `404 nao_encontrado` (sem perfil); `409 { code: 'recurso_indisponivel' }` para `sem_caso`, `nao_elegivel` e `recurso_ja_usado` (mesmo corpo para os três) |

- `motivo` é o código da lista de §6.2; `explicacao` é texto puro; `decididoEm` é ISO 8601 UTC. Lista branca por esquema de resposta (CA-H041-11); campos de §6.3 do refino nunca montados.
- Nenhum identificador de caso ou perfil na URL, no corpo ou na resposta: não há como apontar para dado de outro profissional. A "negação uniforme" de CA-H041-09 vale para a ausência de perfil e para sessão que não é de profissional.
- Admin e Superadmin: sessão de console não é aceita por estas rotas (a validação de profissional recusa; `401`).
- Corpo, explicação e estado **não entram em log** do servidor. Sem limitador novo: reutiliza o limite existente das rotas de profissional `[NÃO VERIFICADO]` (dec. 495); o POST é naturalmente idempotente (segundo pedido devolve 409).

## 6. Domínio, textos e apresentação

### 6.1 Domínio (`packages/domain/src/verification/`, lógica pura)

Arquivos novos (nenhum arquivo da #53 é alterado):
- `professional-verification-state.ts`: `ESTADOS_PUBLICOS_VERIFICACAO`, `SITUACOES_RECURSO`, `MOTIVOS_VISIVEIS` (lista de §6.2), tipo `EstadoVerificacaoProfissional`, função `montarEstadoVisivel(linha)` que revalida o que o banco devolveu: descarta motivo fora da lista (inclui `duplicidade_suspeita`), descarta explicação acima de 500 caracteres ou com motivo vedado, e garante a regra "motivo e explicação só em `recusada`". Para `em_analise` reutiliza `estadoPublicoDoProfissional` de `professional-status-message.ts` (#53).
- `professional-verification-texts.ts`: **única fonte de frases** (dec. 561, modelo `[PROPOSTA]`): textos de §6.2 e §6.3, rótulos de botões e mensagens de estado de tela. Sem frase fora deste arquivo (CA-H041-14).
- `professional-verification-screen.ts`: `construirTela(estado | erro | carregando)` devolve o view-model `{ tipo, titulo, texto, motivoTexto?, explicacao?, dataRotulo?, acao?, aviso? }`; `tipo` ∈ {`carregando`, `sem_envio`, `em_analise`, `aprovada`, `recusada`, `suspensa`, `recurso_recebido`, `erro`, `recurso_indisponivel`}. Sem DOM, sem acesso a rede.
- `professional-verification-port.ts`: `ProfessionalVerificationPort` (`lerEstado(profissional)`, `pedirRecurso(profissional, agora)`) e erros de domínio (`recurso_indisponivel`).
- `index.ts` (barril existente): só ganha as exportações novas, sem lógica.

### 6.2 Motivos legíveis e textos (modelo, dec. 561)

| Código | Texto |
|---|---|
| `documento_ilegivel` | O documento enviado não está legível. |
| `documento_divergente` | Os dados do documento não conferem com o cadastro. |
| `tipo_nao_aceito` | O tipo de arquivo enviado não é aceito. |
| `certificacao_insuficiente` | A certificação enviada não atende ao serviço escolhido. |
| `outro` | Veja a explicação abaixo. |
| `duplicidade_suspeita`, `aprovado` | nunca exibidos (recusa mostra só o texto neutro de recusa) |

### 6.3 Textos de estado (modelo)

`sem_envio` "Você ainda não enviou seus documentos. Envie para começar a análise." (ação: ir à tela de documentos). `em_analise` usa `TEXTO_EM_ANALISE` da #53. `aprovada` "Seu cadastro foi aprovado." mais a data. `recusada` "Seu cadastro não foi aprovado." mais motivo e explicação; ação "Pedir revisão" só com `recurso = disponivel`. `suspensa` "Sua conta está com restrição. Entre em contato com o suporte." Recurso recebido: "Seu pedido de revisão foi recebido." Recurso analisado `[PERGUNTA 631]`: "Seu pedido de revisão já foi analisado." Carregando: "Carregando sua situação". Erro: "Não foi possível carregar sua situação. Tente de novo." Recurso indisponível (409): "Não é possível pedir revisão agora." Sem prazo, selo, garantia ou promessa de tempo (RN-H041-05 e 08).

### 6.4 Apresentação (sem casca web, dec. 557)

- `apps/web/public/profissional-situacao.js` `[PROPOSTA; PERGUNTA 628]`: função `renderizarSituacao(raiz, tela)` que constrói elementos com `createElement` e `textContent` (nunca `innerHTML` com conteúdo vindo da API, CA-H041-12); região `aria-live="polite"` para mudanças de estado; estado por texto e não só por cor; foco visível; botão desabilitado após recurso; layout de uma coluna legível em 375 px. **Não contém frases:** só recebe o view-model do domínio (teste de varredura). Sem página HTML, sem navegação, sem login: a casca web do profissional é história própria.
- Estados: carregando, sem envio, em análise, aprovada, recusada (com e sem recurso), suspensa, recurso recebido, erro, recurso indisponível; sem sessão: o chamador redireciona ao login (H-016), sem texto próprio.
- `[NÃO VERIFICADO]` como as páginas existentes (`profissional-documentos.js`) obtêm textos do domínio; o DEV segue o mesmo caminho (módulo gerado ou copiado pelo build) e registra qual.

## 7. Adaptador e arquivos (barris só listados)

- `apps/api/src/verification/pg-professional-verification-store.ts`: `PgProfessionalVerificationStore implements ProfessionalVerificationPort`; chama as duas funções pelo papel `app_system`, parâmetros posicionais, `p_now` do `Clock`; mapeia `out_code` para `ok` ou `recurso_indisponivel`; zero linhas vira `nao_encontrado`; nenhum log de corpo.
- `apps/api/src/professional-verification-route.ts`: as duas rotas de §5, com esquema de resposta por lista branca.
- Edições mínimas de composição: `apps/api/src/verification/verification-composicao.ts` (injeção do store; barril de composição) e o registro de rotas em `apps/api/src/app.ts` (ou onde `professional-profile-route.ts` é registrado). **Risco de arquivo comum com #55 (H-042)** (refino R7): não executar as duas em paralelo sem exclusividade, ou registrar a rota em arquivo próprio de composição.
- Barris (só listados, sem lógica): `packages/domain/src/verification/index.ts`, `apps/api/src/verification/index.ts`.
- Testes: `packages/db/tests/verification-estado-profissional.dbtest.mjs`, `packages/db/tests/verification-estado-profissional-migration.test.mjs` (estático), `packages/domain/src/verification/professional-verification-{state,texts,screen}.test.ts`, `apps/api/src/professional-verification-route.test.ts`, `apps/web/tests/profissional-situacao.test.*` (extensão conforme o padrão existente).

## 8. Plano de testes (T41-xx por CA)

Dados sintéticos com marcador único e transação desfeita (`rollback`); sem concorrência real, exceto T41-07b.

| T | Prova | CA |
|---|---|---|
| T41-01 | Tabela de sete fixtures (sem envio, `pendente`, `em_revisao`, `retida_duplicidade`, `aprovada`, `recusada`, `suspensa`): a função devolve exatamente um estado de §4.1; pelo menos uma por regra de precedência 1 a 4 (incl. caso `pendente` com perfil retido, e perfil suspenso com caso `aprovada`) | CA-01 |
| T41-02 | Três fixtures (`pendente`, `em_revisao` e retido pelo cadastro) com documento e caso: linha de saída idêntica; na rota, corpo `200` byte a byte igual; retido sem documento igual ao `pendente` sem documento (`sem_envio`) | CA-02 |
| T41-03 | Varredura de todos os textos de `professional-verification-texts.ts`, das respostas de fixtures retidas e recusadas por duplicidade e das mensagens de erro: sem "duplic", "já existe", "outro cadastro", `duplicidade_suspeita`, UUID, CPF/CNPJ; teste estático de que a função SQL não menciona `document_hmac` | CA-03 |
| T41-04 | Recusada com `duplicidade_suspeita`: resposta sem `motivo` e sem `explicacao`, estado `recusada`, texto neutro; comparação estrutural com recusa comum (só motivo/explicação ausentes) | CA-04 |
| T41-05 | Aprovada: texto, `decididoEm`, sem selo, garantia, prazo (varredura) | CA-05 |
| T41-06 | dbtest com e sem documento `recebido`: `sem_envio` sem caso; ação para tela de documentos no view-model; novo envio após recusa não reabre o caso (sem mudança em #52) | CA-06 |
| T41-07 | Recusada com `appeal_status='nenhum'`: `POST` `200 recebido`, caso `em_revisao` sem dono, `appeal_status='pendente'`, um evento `appeal_received`, uma auditoria; segundo `POST` `409 recurso_indisponivel`; `GET` seguinte devolve `em_analise` com `recurso.situacao='recebido'` | CA-07 |
| T41-07b | Duas conexões, dois `POST` simultâneos: um `200`, outro `409`; um único evento (rollback fora da transação, cenário de Rodada 65) | CA-07 |
| T41-08 | Caso retido (`pendente`, `em_revisao` e `retida_duplicidade`) com `POST`: `409 recurso_indisponivel`, sem evento, sem mudança de estado, resposta igual a de qualquer inelegível; retido por cadastro e retido manual com original vivo e não vivo | CA-08 |
| T41-09 | Rotas: sem sessão `401`; sessão de console `401`; sessão sem perfil `404` de corpo idêntico em GET e POST; profissional A nunca recebe dado de B (duas sessões, corpo próprio) | CA-09 |
| T41-10 | Contagem e soma (hash de linhas) de `app.verification_case`, `app.verification_case_event`, `app.professional_profile` e `audit.audit_event` iguais antes e depois de N leituras; função é `STABLE` (consulta ao catálogo `provolatile`) | CA-10 |
| T41-11 | Esquema da resposta por lista branca com fixtures completas: nenhum campo de §6.3 do refino; chaves exatamente as de §5 | CA-11 |
| T41-12 | Explicação com `<script>` e 500/501 caracteres: domínio descarta acima de 500; renderizador usa `textContent`; teste estático de ausência de `innerHTML` em `profissional-situacao.js` | CA-12 |
| T41-13 | Varredura de textos e campos: sem prazo-meta, "dois dias úteis", data prevista | CA-13 |
| T41-14 | Teste de tabela dos textos e dos nove estados de tela; nenhuma frase fora de `professional-verification-texts.ts` (varredura do JS de apresentação e do `screen.ts`) | CA-14 |
| T41-15 | Marcação: estado por texto, `aria-live`, botão com rótulo, foco; classes de largura 375 px; contraste conforme tokens existentes; navegador real `[NÃO VERIFICADO]` | CA-15 |
| T41-16 | Valor de `commercial_access` (H-045) e demais dados de acesso iguais antes e depois de GET e de POST recusado; nenhuma função de guarda tocada (estático: diff só nos arquivos listados em §7) | CA-16 |
| T41-17 | Estático e catálogo: nenhum `cron`, `ops.job`, gatilho de tempo, e-mail ou envio; consulta a `cron.job` sem entradas novas; migração sem `create trigger` | CA-17 |
| T41-18 | Estático da migração: `security definer`, `search_path = ''`, `execute` só a `app_system`, sem grant a `anon`, `authenticated`, `service_role`, `app_api`; aplicar, rollback e reaplicar em banco descartável de dev; regressão: `verification-case*.dbtest.mjs`, `verification-duplicidade*`, `identity-professional-profile-document*`, `admin-rbac`; `corepack pnpm check:all` e `db:test` com comando, contagem e código de saída na Issue; sem chamada externa nem Mapbox; sem alegar CI | CA-18 |

## 9. Segurança e impacto

- **Anti-enumeração:** a função não olha nenhum outro perfil nem `document_hmac`; `pendente`, `em_revisao` e `retida_duplicidade` convergem para o mesmo corpo; `duplicidade_suspeita` e a explicação associada são removidos no banco e no domínio; recurso de retido recebe a mesma resposta de qualquer inelegível. Tempo de resposta não é medido (mesmo caminho de código, uma leitura simples); risco residual baixo, como em `134` §6.
- **Privilégio mínimo:** sem grant de tabela; só `execute` a `app_system`; profissional resolvido pela sessão, nunca por parâmetro de rota.
- **Mínimo de dado:** sem identificador de caso, analista, perfil ou documento; sem HMAC, CPF/CNPJ; só um código de motivo da lista, a explicação já filtrada por #52 e a data da decisão.
- **Fail closed:** erro em qualquer passo do recurso desfaz a transação inteira; a leitura não grava nada.
- **Impacto:** nenhuma função, tabela ou gatilho existente muda; #52 e #53 apenas consumidas; #55 (H-042) e #68 (H-055) continuam donas das guardas de acesso (esta história não nega nem libera nada); #56 (selo) fora; E11 sem aviso.
- **Documentação a atualizar no Desenvolvimento:** `09` (funções novas e vocabulário público), `08` (rotas do profissional), `05` (nota de FA-004: motivo detalhado não mostrado), `14-BACKLOG.md` (critério "retida exibida" vira "estado neutro", dec. 543), `11-DECISOES.md` (rodada de desenho).

## 10. Ordem de execução

1. **Pré-condição de Desenvolvimento:** #53 Concluída por decisão humana (dec. 559). Arquitetura pode seguir agora; este desenho não exige nada da #53 em tempo de execução além do arquivo `professional-status-message.ts` e do estado final dos casos retidos.
2. Conferência dos `[NÃO VERIFICADO]`: nome da validação de sessão do profissional e CSRF, limitador existente, caminho de textos para `apps/web/public`, estado final de `professional-status-message.ts` e dos corpos de `verification_case_appeal` após `20261113280000`/`310000`, prefixo de migração livre.
3. Migração, rollback e dbtests (T41-01 a T41-08, T41-10, T41-16 a T41-18 parte de banco).
4. Domínio e testes (T41-03, 04, 05, 11 a 14).
5. Adaptador, rota e teste de rota (T41-07, 09, 11); composição com exclusividade de arquivos frente a #55.
6. Renderizador e testes de marcação (T41-12, 14, 15).
7. Regressão e validação local (T41-18); registrar comando, contagem e código de saída na Issue; atualizar documentação (§9). Mover a Issue só pelo líder.

## 11. Perguntas ao líder (lista única, a partir de 623)

**623. Estado público lido do caso, não do perfil.** Pela #53 o perfil retido ou recusado com original vivo não é espelhado, então o caso é a fonte quando existe (precedência de §4.1: suspensa do perfil; depois caso; depois perfil).
- **Recomendação:** sim. É a única leitura correta sem alterar #52 ou #53. Destrava §4.1.

**624. Suprimir também a explicação na recusa por `duplicidade_suspeita`.** O complemento livre de H-039 pode citar a causa mesmo sem a palavra.
- (a) Suprimir motivo e explicação (só o texto neutro). (b) Mostrar a explicação.
- **Recomendação:** (a), conservador, alinhado a 545 e RN-H041-02. Destrava CA-H041-04.

**625. Restrição de recurso em `recusada` fora da função de #52.** `verification_case_appeal` aceita também `retida_duplicidade`; a restrição de 549a vai numa função-envelope nova (`professional_verification_appeal`), sem editar #52.
- **Recomendação:** sim (o envelope, não a edição de #52). Destrava §4.2 e CA-H041-08.

**626. Caminhos das rotas.** `GET /v1/professional/verificacao` e `POST /v1/professional/verificacao/recurso`, no padrão `/v1/professional/profile`.
- **Recomendação:** confirmar. Destrava §5.

**627. Sessão que não é de profissional e perfil ausente.** `401` para sem sessão ou sessão de console; `404 nao_encontrado` de corpo único para sessão de profissional sem perfil.
- **Recomendação:** sim. Destrava CA-H041-09 (adaptado: não há id de caso na rota).

**628. Incluir o renderizador `apps/web/public/profissional-situacao.js`** (sem página, sem casca, sem frases próprias) além do domínio.
- (a) Incluir. (b) Só domínio e rota; renderizador fica para a casca web.
- **Recomendação:** (a), pelo precedente da dec. 557 ("módulo de apresentação"); custo baixo e dá prova de acessibilidade. Destrava §6.4 e CA-H041-12 e 15.

**629. Prefixo da migração.** `20261113320000`; reservar o número até o início do Desenvolvimento para evitar choque com #55.
- **Recomendação:** o líder reserva `20261113320000` para #54 e confirma o prefixo de #55. Destrava §3.

**630. Data da aprovação.** `decididoEm` = `case.decided_at`, com `profile.verified_at` como reserva.
- **Recomendação:** sim. Destrava CA-H041-05.

**631. Novo valor `analisado` em `recurso.situacao`** (contrato do refino tem só `indisponivel`, `disponivel`, `recebido`). Depois de o recurso ser decidido e o caso continuar recusado, o profissional veria só a ausência do botão.
- (a) Acrescentar `analisado` com o texto "Seu pedido de revisão já foi analisado." (b) Manter três valores.
- **Recomendação:** (a). Desvio pequeno do contrato do refino; sem efeito em outras histórias. Destrava §4.1 e §6.3.

**632. Segurança de `p_professional` nas funções.** Como o recurso e a leitura ficam sob `app_system`, a garantia de "só o próprio profissional" depende da sessão na API. 
- **Recomendação:** aceitar, no padrão de #52 e #53, com teste de rota por sessão (T41-09). Alternativa (validação de sessão dentro da função) exigiria nova função de sessão do profissional, fora do escopo. Destrava CA-H041-09.

## 12. Próximos passos

1. Líder responde 623 a 632 em lista única; registrar em `11-DECISOES.md` com os mesmos números (rodada nova, append-only).
2. Líder confere a coluna no quadro e decide a movimentação de #54 (não alterada aqui). Desenvolvimento só após #53 Concluída (dec. 559).
3. DEV resolve os `[NÃO VERIFICADO]` de §10 item 2 antes de escrever a migração.

## 13. Registro

- **Arquivo:** `D:\projetos\fastpro\docs\factory\141-DESENHO-H041.md`.
- Nenhum código, migração, teste, banco, chamada externa ou alteração de quadro foi feito. A Issue #54 permanece na coluna em que o líder a deixou.
