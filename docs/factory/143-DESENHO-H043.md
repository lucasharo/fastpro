# Desenho técnico H-043 — Perfil público e selo verificado (Issue #56)

- **Issue:** #56 `[E4] Perfil público e selo verificado` · **História:** H-043 · **Épico:** E4 · **Workflow:** WF-03 (Feature) · **Etapa:** Arquitetura.
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-14. **EXEC-ID:** não informado.
- **Natureza:** somente documento. Nenhum código, migração, banco, chamada externa (Mapbox proibido) ou quadro foi alterado.
- **Entradas:** `138-REFINO-H043.md` (CA-H043-01 a 18, RN-H043-01 a 15, perguntas 583 a 602), Rodada 124 de `11-DECISOES.md` (583 a 602 adotadas como recomendadas), `141-DESENHO-H041.md` (padrão de função `private`, estado público neutro, módulo sem casca), `134-DESENHO-H040.md` (retido não é público; princípio "caso é a fonte"), lista de `supabase/migrations` (última: `20261113310000_verification_fix_duplicate_original_rule.sql`).
- **Etiquetas:** `[DECIDIDO n]` decisão registrada · `[VERIFICADO]` lido nesta rodada · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` o DEV confere antes de codar · `[PERGUNTA n]` ao líder (§11).
- **Limites da leitura:** orçamento curto de turnos. Não li o texto da Issue no GitHub, não consultei banco, não abri as migrações de `professional_service`, `service`, `service_group` nem `professional-profile-route.ts`. Nomes de colunas dessas tabelas e do limitador de requisições são `[NÃO VERIFICADO]` e listados em §10 (passo 2).

## 1. Fatos e decisões que moldam o desenho

| Ref. | Efeito |
|---|---|
| 583a, 601a | Rota `GET /v1/public/professionals/:slug`; só slug, nunca UUID. |
| 584a, 598a | 404 uniforme `professional_not_found`; leitura por função `private`, sem grant de tabela. |
| 585a (adotada na Rodada 124 por 583 a 602) | Perfil aprovado continua público mesmo com acesso comercial expirado; a guarda de pedidos é da #55. |
| 586, 587 | Texto de limitação do selo é modelo `[PROPOSTA]` no DEV; revisão jurídica antes de produção; sem pergunta ao usuário agora. |
| 590a | Reputação `count: 0`, `average: null`, rótulo "Ainda sem avaliações"; nenhuma tabela de avaliação criada. |
| 592a | Serviço regulamentado sem certificação (#51) não é exibido como verificado (ver §4.2 e `[PERGUNTA 658]`). |
| 593a, 596a, 599a | Cache curto, limite de taxa, `noindex` no DEV. |
| 594a | Nenhum telefone, WhatsApp ou e-mail. |
| 597 (ajustado pelo líder) | Módulo de apresentação **sem casca web** (sem página HTML nem navegação). |
| 134 §1.3, 141 §1 | Perfil retido (`retida_duplicidade`) nunca é público; o status do perfil já basta, e o caso é conferido por defesa em profundidade. |

Fatos `[VERIFICADO]`:
- Último prefixo existente: `20261113310000`. Reservados: `20261113320000` (#54) e `20261113400000` (#55). Esta história usa **`20261113410000`** `[PROPOSTA]`.
- `app.professional_profile` tem `public_name` (2 a 80), `slug` (`^[a-z0-9][a-z0-9-]{0,99}$`, único), `verification_status`, `verified_at`, `suspended_at`, `document_*` (refino §0).
- `app.professional_service` guarda os serviços por modalidade (`presencial` e `online`); `app.professional_area` é privada e **não é lida** por esta história (CA-11 da H-036).
- Padrão de função (#52, #53, #54): `security definer`, `set search_path = ''`, `revoke all ... from public, anon, authenticated, service_role, app_api`, `grant execute ... to app_system`.
- Não existe rota pública de perfil hoje. A rota privada é `GET /v1/professional/profile`.

## 2. Visão geral

```
GET /v1/public/professionals/:slug   (sem sessão; cookie ignorado)
   -> limite de taxa por IP -> valida slug (formato) -> PublicProfilePort.lerPorSlug
        -> private.professional_public_profile(p_slug)     (STABLE, só leitura, retorna jsonb ou null)
   -> domínio: montarPerfilPublico(jsonb)   (reconstrói por lista fechada; acrescenta textos do selo e da reputação)
   -> 200 { corpo fechado }  |  404 { code: 'professional_not_found' }  |  429
Domínio puro (packages/domain/src/public-profile/): lista fechada, textos, view-model da tela
Apresentação (apps/web/public): renderizador e CSS só com tokens; sem frases próprias; sem casca
```

Princípios: (1) nenhuma tabela ganha grant; (2) a função monta o JSON por **construção positiva** (`jsonb_build_object` com as chaves da lista fechada), nunca por `to_jsonb(linha)` nem `select *`; (3) a lista fechada é revalidada no domínio e no contrato (defesa em profundidade); (4) um único texto do selo e da reputação, em domínio; (5) a função não lê `document_*`, `professional_area`, e-mail nem telefone: a superfície de vazamento é zero por não leitura, não por filtro.

## 3. Migração e rollback (nomes)

- **Migração:** `supabase/migrations/20261113410000_profile_create_public_profile_read.sql` `[PROPOSTA]`. Prefixo maior que qualquer existente e que os reservados `20261113320000` (#54) e `20261113400000` (#55). O DEV reconfere o prefixo livre na hora de criar. Aplicar com `npx supabase` no banco de desenvolvimento. Idempotente (`create or replace`). Sem tabela, coluna, gatilho, `cron`, `ops.job` nem registro de auditoria novos (leitura pública não audita; sem dado pessoal no log).
- **Índice:** nenhum novo. `[NÃO VERIFICADO]` o DEV confirma no catálogo que `slug` já tem índice único (CA-H043-16); se não tiver, a migração o cria (`create unique index if not exists`) e o rollback o remove.
- **Rollback:** `supabase/rollbacks/20261113410000_profile_create_public_profile_read.down.sql`: `drop function if exists private.professional_public_profile(text)` (e o índice, só se a migração o criou). Não altera dado. Seguro a qualquer momento: nenhuma função de #52, #53 ou #54 é tocada.

## 4. Função `private` de leitura

### 4.1 Assinatura e regras

`private.professional_public_profile(p_slug text) returns jsonb` · `stable` · `security definer` · `set search_path = ''` · `revoke all` de todos os papéis · `grant execute ... to app_system` `[PERGUNTA 652]`.

Regras, em ordem:
1. `p_slug` nulo, vazio ou fora de `^[a-z0-9][a-z0-9-]{0,99}$`: devolve **`null`** (não levanta erro; vira 404 uniforme, `[PERGUNTA 656]`).
2. Resolve o perfil por `slug` (igualdade exata, índice único). Sem linha: `null`.
3. Visível **somente se todas** as condições forem verdadeiras: `verification_status = 'aprovada'` e `suspended_at is null` e `app.app_user.status = 'ativo'` e (não existe caso em `app.verification_case` para o profissional, ou o caso tem `status = 'aprovada'`) `[PERGUNTA 657]`. Qualquer falha (pendente, em revisão, retida, recusada, suspensa, usuário bloqueado, caso aberto): `null`. A função **não distingue** os motivos nem os devolve.
4. Visível: monta e devolve exatamente a lista fechada de §4.2.

Acesso comercial (H-045) **não** é consultado `[DECIDIDO 585]`.

### 4.2 Lista fechada de chaves do retorno

```
{
  "publicName": text,
  "slug": text,
  "verified": true,
  "services": [ { "groupName": text, "items": [ { "name": text, "modalities": ["presencial"|"online", ...] } ] } ],
  "rating": { "average": null, "count": 0 }
}
```

- `verified` é sempre `true` quando há retorno (o retorno só existe para aprovado). Não existe `verified: false`.
- `services`: serviços ativos do profissional `[NÃO VERIFICADO: coluna de ativo/arquivado de professional_service e nomes de service e service_group]`, agrupados por grupo do catálogo, grupos e itens em ordem alfabética (`groupName`, `name`), `modalities` ordenadas (`online`, `presencial`). Sem `id` de serviço, sem `regulated`, sem certificação, sem preço. Lista vazia `[]` é válida `[DECIDIDO 600]`.
- `rating`: constantes `average: null`, `count: 0` (nenhuma tabela de avaliação é lida ou criada, `[DECIDIDO 590]`). A função não conhece o rótulo textual.
- **Nunca lidos nem devolvidos:** `user_id`, e-mail, telefone, `document_type`, `document_enc`, `document_hmac`, `verification_status`, `verified_at`, `suspended_at`, `commercial_access`, `professional_area` (base, raio, ponto), endereço, cidade/UF `[PERGUNTA 650]`, tipo PF/PJ `[PERGUNTA 650]`.
- `[PROPOSTA]` Chaves em camelCase no JSON (contrato `packages/contracts`), conforme CA-H043-02.

## 5. Rota pública (nível de contrato)

`apps/api/src/public-profile-route.ts`: `GET /v1/public/professionals/:slug`. Sem autenticação; **não lê cookie** de sessão e **não emite `Set-Cookie`**; qualquer corpo ou query string é ignorada.

| Situação | Status | Corpo | Cabeçalhos |
|---|---|---|---|
| Aprovado e visível | `200` | `{ publicName, slug, verified: true, verificationBadge: { label, disclaimer }, services, rating: { average: null, count: 0, label }, recentReviews: [] }` | `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600` `[DECIDIDO 593]`; `X-Robots-Tag: noindex, nofollow` no DEV; `X-Content-Type-Options: nosniff`; `Content-Type: application/json; charset=utf-8` |
| Slug inexistente, mal formado, não aprovado, retido, suspenso, bloqueado | `404` | `{ "code": "professional_not_found" }` (byte a byte igual em todos os casos) | `Cache-Control: no-store`; mesmos cabeçalhos de robôs e `nosniff` |
| Limite excedido | `429` | `{ "code": "muitas_requisicoes" }` | `Retry-After`; `no-store` |
| Falha interna | `500` | `{ "code": "erro_interno" }`, sem detalhe | `no-store` |

- **Limite de taxa:** 60 requisições por minuto por IP `[DECIDIDO 596]`, aplicado **antes** de qualquer leitura de banco. `[NÃO VERIFICADO]` limitador já existente nas rotas; se existir, reutiliza. IP vem do cabeçalho de proxy confiável já usado pela API (nunca de cabeçalho arbitrário do cliente). Risco residual: limitador em memória por instância (ver §9).
- **Robôs (`noindex`):** diretiva calculada por uma constante de configuração `[PROPOSTA]` (`noindex, nofollow` por padrão; `index, follow` só no lançamento M4, por decisão humana). A mesma constante alimenta o renderizador (`meta robots`) quando existir casca web `[PERGUNTA 655]`.
- **Corpo montado no domínio:** a rota nunca repassa o JSON do banco; ela entrega o resultado de `montarPerfilPublico` (§6.1).
- **Registro (log):** sem corpo, sem slug de 404 em nível de erro, sem IP em claro além do que o limitador exigir `[NÃO VERIFICADO]`.
- **Sem chamada externa:** nenhuma dependência de rede além do banco.

## 6. Domínio, textos e apresentação

### 6.1 Contrato e domínio

Contrato (`packages/contracts/src/public-profile.ts`, no padrão de `catalog.ts`): `PUBLIC_PROFILE_FIELDS` (lista fechada de §4.2 e §5), `PUBLIC_PROFILE_FORBIDDEN_FIELDS` (denylist da §4.2, mais `phone`, `whatsapp`, `email`, `userId`, `user_id`, `radius_m`, `base_point`, `geocode_point_id`, `commercial_access`), tipo `PublicProfileResponse` e função de validação que **rejeita** qualquer chave fora da lista (recursivo).

Domínio (`packages/domain/src/public-profile/`, lógica pura, sem DOM, sem rede):
- `public-profile-fields.ts`: `montarPerfilPublico(linha)`: reconstrói o objeto **só com as chaves permitidas** (descarta o restante, não o repassa), valida tamanhos (`publicName` 2 a 80, `slug` conforme o padrão, `modalities` ∈ {`presencial`,`online`}), força `rating.count = 0` e `average = null` enquanto a E10 não existir, acrescenta `verificationBadge`, `rating.label` e `recentReviews: []` a partir dos textos. Entrada inesperada: devolve erro de domínio (a rota responde `500` genérico, nunca vaza o conteúdo).
- `public-profile-texts.ts`: **única fonte de frases** `[PROPOSTA, dec. 586]`: rótulo do selo, texto de limitação, "Ainda sem avaliações", estado vazio de serviços, "Perfil não encontrado ou indisponível", rótulos de modalidade, mensagens de carregando e erro. Nenhuma frase fora deste arquivo (varredura).
- `public-profile-screen.ts`: `construirTelaPerfil(perfil | naoEncontrado | erro | carregando)` devolve o view-model `{ tipo, titulo, selo?, servicos?, reputacao?, aviso? }`; `tipo` ∈ {`carregando`, `perfil`, `perfil_sem_servicos`, `nao_encontrado`, `erro`}. Aceita também reputação com notas (fixture sintética da E10): média com **1 casa decimal** e autor fixo "Cliente do FastPro", sem nome nem e-mail (CA-H043-10); essa ramificação só é exercitada por teste (a API ainda devolve `count: 0`).
- `public-profile-port.ts`: `PublicProfilePort` (`lerPorSlug(slug): Promise<LinhaPerfil | null>`).
- `index.ts` (barril): só exportações.

### 6.2 Selo com texto de limitação (modelo `[PROPOSTA]`, dec. 586)

- **Rótulo visível:** "Identidade verificada" (com ícone decorativo, `aria-hidden`).
- **Texto de limitação (modelo, a validar pelo jurídico antes de produção, BLQ-JUR L7):** "Identidade verificada: este profissional apresentou documento oficial (CPF ou CNPJ) validado pela equipe do FastPro. O selo atesta apenas a conferência de identificação cadastral e não constitui garantia de qualidade, certificação técnica, recomendação ou cobertura securitária sobre os serviços prestados."
- **Proibido** em qualquer texto do perfil (varredura de teste): "Profissional Garantido", "Qualidade Certificada", "Super Profissional", "Seguro FastPro", "garantia FastPro", e qualquer afirmação positiva de qualidade, certificação ou seguro. As palavras "garantia", "certificação" e "securitária" só aparecem **negadas**, dentro do texto de limitação exato.
- Reputação sem notas: "Ainda sem avaliações" (sem estrelas preenchidas, estado por texto e não só por cor).
- Estado vazio de serviços: "Este profissional ainda não cadastrou serviços para exibição."
- Não encontrado: "Perfil não encontrado ou indisponível." (mesma tela para todos os casos).

### 6.3 Apresentação (sem casca web, dec. 597 ajustado)

- `apps/web/public/profissional-perfil.js`: `renderizarPerfilPublico(raiz, tela)`: elementos por `createElement` e `textContent` (nunca `innerHTML` com conteúdo da API); `<h1>` com o nome, `<h2>` por seção (selo, serviços, reputação); serviços em `<ul>` por grupo, modalidade em texto; o texto de limitação dentro de `<details>/<summary>` nativo (teclado e leitor de tela sem JavaScript extra) `[PROPOSTA]`; região `aria-live="polite"` para carregando e erro; foco visível; sem frases próprias (só recebe o view-model).
- `apps/web/public/profissional-perfil.css`: somente `var(--...)` de `tokens.css` (cor, espaçamento, tipografia, raio); sem hexadecimal nem `rgb()`; uma coluna fluida de 320 px a 1280 px; sem rolagem horizontal; `:focus-visible` explícito.
- Sem página HTML, sem navegação, sem botão "Solicitar serviço" e sem login: a casca web e o chamado à ação (dec. 595) pertencem a história própria `[PERGUNTA 650]`. `[NÃO VERIFICADO]` como `profissional-documentos.js` obtém textos do domínio; o DEV segue o mesmo caminho e registra qual.
- Nenhum recurso externo: sem fonte, imagem, script, mapa ou CDN de terceiros (CA-H043-17).

## 7. Adaptador e arquivos (barris só listados)

- `apps/api/src/public-profile/pg-public-profile-store.ts`: `PgPublicProfileStore implements PublicProfilePort`; chama `private.professional_public_profile($1)` pelo papel `app_system`; `null` vira "não encontrado"; sem log de corpo.
- `apps/api/src/public-profile-route.ts`: a rota de §5 e o esquema de resposta por lista fechada.
- `apps/api/src/public-profile/public-profile-composicao.ts`: injeção do store e do limitador (arquivo de composição **próprio**, para não disputar arquivo com #54/#55).
- Edição mínima compartilhada: **uma linha** de registro da rota no ponto onde `professional-profile-route.ts` é registrado (`apps/api/src/app.ts` ou equivalente `[NÃO VERIFICADO]`). Esse é o único arquivo em comum com #54 e #55 (ver §10).
- `packages/contracts/src/public-profile.ts` e sua exportação no barril de contratos.
- `packages/domain/src/public-profile/{public-profile-fields,public-profile-texts,public-profile-screen,public-profile-port}.ts`.
- `apps/web/public/profissional-perfil.js` e `profissional-perfil.css`.
- Barris (só listados, sem lógica): `packages/domain/src/public-profile/index.ts`, `apps/api/src/public-profile/index.ts`, barril de `packages/contracts`.
- Testes: `packages/db/tests/profile-public-profile.dbtest.mjs`, `packages/db/tests/profile-public-profile-migration.test.mjs` (estático), `packages/domain/src/public-profile/public-profile-{fields,texts,screen}.test.ts`, `packages/contracts/src/public-profile.test.ts`, `apps/api/src/public-profile-route.test.ts`, `apps/web/tests/profissional-perfil.test.*` (extensão conforme o padrão existente).

## 8. Plano de testes (T43-xx por CA)

Dados sintéticos com marcador único e transação desfeita (`rollback`). Perfis de teste têm telefone, e-mail, documento e área privada preenchidos (valores marcadores) para provar a não exposição.

| T | Prova | CA |
|---|---|---|
| T43-01 | Rota, requisição sem cookie nem cabeçalho de sessão para perfil aprovado: `200`; com cookie de sessão qualquer: mesma resposta e sem `Set-Cookie` | CA-01 |
| T43-02 | Fixture aprovada com serviços: chaves do corpo **exatamente** as de §5 (comparação de conjunto de chaves em todos os níveis); `verified === true`; `verificationBadge` com rótulo e texto; `rating.label` "Ainda sem avaliações" | CA-02 |
| T43-03 | Varredura recursiva de chaves do corpo contra `PUBLIC_PROFILE_FORBIDDEN_FIELDS`; varredura da **string serializada** em busca dos valores marcadores de e-mail, documento, HMAC, UUID do usuário, base e raio; teste estático de que a função SQL não menciona `document_`, `professional_area`, `email`, `phone`, `commercial_access`; contrato rejeita chave extra injetada | CA-03 |
| T43-04 | Perfil com telefone preenchido: ausente do corpo (JSON) e do HTML renderizado; domínio descarta chave `phone` mesmo que a função a devolvesse (fixture maliciosa); estático: nenhuma coluna de telefone na função | CA-04 |
| T43-05 | Teste de texto do selo: rótulo exato; texto de limitação exato (snapshot) e contém "não constitui garantia"; nenhuma frase proibida de §6.2; marcação com `<details>/<summary>` e rótulo acessível | CA-05 |
| T43-06 | Cinco fixtures (`pendente`, `em_revisao`, `retida_duplicidade`, `recusada`, `suspensa`): `404`, corpo e cabeçalhos **idênticos** byte a byte entre si e ao do slug inexistente; função devolve `null` nos cinco; perfil `aprovada` com `suspended_at` preenchido também `null` | CA-06 |
| T43-07 | Perfil `aprovada` com `app_user.status = 'bloqueado'`: `404` idêntico; perfil `aprovada` com caso aberto (`em_revisao`) por fixture: `404` idêntico (fail closed) | CA-07 |
| T43-08 | Slug aleatório inexistente, vazio, com maiúscula, com 101 caracteres, com caracteres especiais e com `UUID`: todos `404` idêntico; nenhum `400` nem `500` | CA-08 |
| T43-09 | Perfil aprovado sem avaliações: `rating.count = 0`, `average = null`, rótulo; renderizador mostra "Ainda sem avaliações" | CA-09 |
| T43-10 | Fixture sintética de avaliações no view-model: média com 1 casa decimal (ex.: `4.5`), autor "Cliente do FastPro", sem e-mail nem nome; ordenação mais recente primeiro | CA-10 |
| T43-11 | Profissional com serviços presenciais, online e ambos em dois grupos: agrupamento por grupo, ordem alfabética, modalidade em texto; perfil aprovado com zero serviços: `200` com `services: []` e mensagem de estado vazio | CA-11 |
| T43-12 | Prova negativa de localização: chaves e serialização sem base, raio, ponto, logradouro, bairro, cidade ou UF `[PERGUNTA 650]` | CA-12 |
| T43-13 | Marcação do renderizador: `<h1>` único, `<h2>` por seção, listas semânticas, ícone `aria-hidden`, `aria-live`, foco por teclado no `<summary>`, estado por texto; verificação estática de contraste dos pares de tokens usados (≥ 4,5:1); ausência de `innerHTML`; navegador real `[NÃO VERIFICADO]` | CA-13 |
| T43-14 | Varredura do CSS e do JS: nenhuma cor hexadecimal, `rgb()`, `hsl()` ou valor de espaçamento fora de `var(--...)`; `check:all` sem violação de tokens | CA-14 |
| T43-15 | Estático: regras de 320 px e 1280 px (sem largura fixa maior que 320 px, sem `white-space: nowrap` em texto longo, `overflow-wrap`); inspeção em navegador `[NÃO VERIFICADO]` | CA-15 |
| T43-16 | Cabeçalhos do `200` exatamente os de §5; `404`, `429` e `500` com `no-store`; catálogo mostra índice em `slug`; `explain` com `enable_seqscan = off` usa o índice; teste do limitador: a 61ª requisição no minuto devolve `429` com `Retry-After`; sem consulta ao banco quando limitado | CA-16 |
| T43-17 | Varredura de `apps/web/public/profissional-perfil.*` e da rota: nenhuma URL `http(s)://` externa, nenhum `mapbox`, nenhum `import` de rede, nenhum `fetch` no domínio | CA-17 |
| T43-18 | Estático da migração: `security definer`, `search_path = ''`, `execute` só a `app_system`, sem grant a `anon`, `authenticated`, `service_role`, `app_api`, `stable`, sem `create trigger`, `cron` ou `ops.job`; aplicar, rollback e reaplicar em banco descartável de dev; regressão: `identity-professional-profile*`, `profile-*`, `verification-case*`, `verification-duplicidade*`, `admin-rbac`; `corepack pnpm check:all` e `db:test` com comando, contagem e código de saída na Issue; sem chamada externa, sem alegar CI | CA-18 |
| T43-19 | Imutabilidade: contagem e soma (hash) de `app.professional_profile`, `app.professional_service`, `app.verification_case` e `audit.audit_event` iguais antes e depois de N leituras (a função é `STABLE`, consulta a `provolatile`) | Complementar (RN-H043-01) |
| T43-20 | `noindex`: `X-Robots-Tag` presente em `200`, `404` e `429` com a configuração padrão; troca para `index, follow` só pela constante de configuração (teste de configuração) | Complementar (dec. 599) |

## 9. Segurança e impacto

- **Anti-enumeração:** uma só resposta de negação, igual em corpo, status e cabeçalhos para inexistente, mal formado, não aprovado, retido, recusado, suspenso, bloqueado ou com caso aberto. A função devolve `null` sem diferenciar. Residual: diferença de tempo entre "achou e visível" e "não achou" não é medida; mesmo caminho de código com uma leitura simples, risco baixo (como em `134` §6).
- **Raspagem:** sem contato direto no perfil, limite por IP e ausência de listagem (não existe rota que liste perfis ou busque por prefixo; só igualdade exata de slug). O slug é adivinhável, o que é aceito por ser público por natureza. Limitador em memória por instância é fraco em ambiente com várias instâncias; no DEV é aceito e declarado, e o limite definitivo fica para o gateway no lançamento `[PERGUNTA 654]`.
- **Cache:** o `200` pode ser servido por cache de borda por até cerca de 15 minutos (`s-maxage=300` mais `stale-while-revalidate=600`). Um perfil suspenso ou bloqueado ainda pode aparecer nesse intervalo. Aceito no DEV; reavaliar `s-maxage` antes de produção `[PERGUNTA 653]`. `404`, `429` e `500` não são cacheados, para que uma aprovação nova apareça de imediato.
- **Privilégio mínimo:** sem grant de tabela; só `execute` a `app_system`; função só leitura; nenhuma tabela privada (`professional_area`, `document_*`) é lida.
- **Mínimo de dado:** sem identificador interno, sem contato, sem documento, sem localização; só nome público, slug, selo, serviços e reputação zerada.
- **Fail closed:** qualquer dúvida (slug inválido, caso aberto, erro de validação de saída) vira `404` ou `500` genérico, nunca dado parcial.
- **Texto do selo:** modelo `[PROPOSTA]`; texto exato fica numa única constante, trocável sem tocar na rota; revisão jurídica (BLQ-JUR L7) antes de produção.
- **Impacto:** nenhuma função, tabela ou gatilho existente muda; #52, #53 e #54 apenas consumidas por leitura do estado do perfil e do caso; #55 (guarda de elegibilidade) não é tocada; E10 (avaliações) liga depois trocando a fonte de `rating` e `recentReviews` na função e no store, sem mudar a casca web; #51 (certificações) acrescentará indicador próprio, sem reaproveitar o selo.
- **Documentação a atualizar no Desenvolvimento:** `09` (função nova e lista fechada), `08` (rota pública, cache e limite), `11-DECISOES.md` (rodada de desenho).

## 10. Ordem de execução

1. **Pré-condição de Desenvolvimento:** #53 (H-040) **concluída** por decisão humana. Esta história depende dela só pelo significado de "retido não é público", já coberto pelo status do perfil; a regra é mantida por coerência com a ordem acordada para #54 e #55. Arquitetura pode seguir agora.
2. **Exclusividade de arquivos:** não executar em paralelo com #54 (H-041) nem #55 (H-042) nos arquivos de composição da API (`apps/api/src/app.ts` ou equivalente e barris de `apps/api/src/verification`). Esta história usa composição própria (`public-profile-composicao.ts`); a única edição comum é o registro de uma linha da rota. Mesmo assim, serializar: o DEV só toca o arquivo de registro depois de #54 e #55 terminarem seu Desenvolvimento, ou pede exclusividade ao líder.
3. Conferência dos `[NÃO VERIFICADO]` antes de codar: colunas e filtro de ativo em `professional_service`, `service`, `service_group`; índice de `slug`; nome da coluna e valores de `app.app_user.status`; limitador existente e IP confiável; arquivo de registro de rotas; caminho de textos para `apps/web/public`; barril de `packages/contracts`; prefixo de migração livre (`20261113410000` ou maior).
4. Migração, rollback e dbtests (T43-03 parte de banco, 06, 07, 08, 11, 16 parte de catálogo, 18 e 19).
5. Contrato e domínio, com testes (T43-02, 03, 04, 05, 09, 10, 11, 12, 20).
6. Adaptador, rota, limitador e teste de rota (T43-01, 06, 07, 08, 16, 20); composição própria.
7. Renderizador e CSS com testes de marcação, tokens e chamadas externas (T43-13, 14, 15, 17).
8. Regressão e validação local (T43-18): comando, contagem e código de saída na Issue; atualizar a documentação (§9). Mover a Issue só pelo líder.

## 11. Perguntas ao líder (lista única, a partir de 650)

**650. Localidade "Cidade - UF", rótulo PF/PJ e chamado "Solicitar serviço" ficam fora desta versão?** A lista fechada pedida não os contém, e as recomendações 588a, 589a e 595a do refino os incluíam. Não há fonte pública de cidade verificada (a base é privada, CA-11 da H-036) e o botão exige a casca web.
- (a) Fora: CA-H043-12 vira prova negativa (nenhuma localização no corpo); 589 e 595 voltam quando houver fonte de cidade e casca web. (b) Incluir cidade, tipo e botão nesta história.
- **Recomendação:** (a). Mantém o contrato fechado e a privacidade da base. Destrava §4.2, CA-H043-12 e T43-12.

**651. Texto do selo no corpo da API ou só `verified: true`?** CA-H043-02 pede `verificationBadge` com rótulo e texto; o banco só devolve `verified`.
- (a) O domínio acrescenta `verificationBadge` e `rating.label` a partir da constante única. (b) A API devolve só `verified: true`; a tela busca o texto no domínio.
- **Recomendação:** (a). Cumpre CA-H043-02 literalmente e mantém uma única fonte do texto. Destrava §5 e §6.1.

**652. Papel com `execute` na função.** O refino (598a) cita `app_system` e `app_api`; as funções de #52, #53 e #54 dão `execute` só a `app_system`.
- (a) Só `app_system`. (b) `app_system` e `app_api`.
- **Recomendação:** (a), mantendo o padrão do repositório. O DEV confere qual papel a rota pública usa (`[NÃO VERIFICADO]`). Destrava §4.1 e T43-18.

**653. Cache de borda e perfil suspenso.** `s-maxage=300` mais `stale-while-revalidate=600` pode manter um perfil suspenso visível por cerca de 15 minutos.
- (a) Aceitar no DEV e reavaliar antes de produção. (b) Reduzir já para `public, max-age=30, s-maxage=60`.
- **Recomendação:** (a), conforme 593a já adotada; `404` sempre `no-store`. Destrava §5 e CA-H043-16.

**654. Limite de taxa sem limitador compartilhado.** Se não houver limitador reutilizável, um limitador em memória vale por instância.
- (a) Reutilizar o existente; se não houver, limitador em memória declarado como limite do DEV, com o definitivo no gateway do lançamento. (b) Exigir limitador compartilhado (banco ou cache) já agora.
- **Recomendação:** (a): sem custo e sem serviço novo. Destrava §5 e T43-16.

**655. Diretiva de robôs.** `X-Robots-Tag: noindex, nofollow` na resposta e, quando houver casca, `meta robots` com a mesma constante de configuração, trocada para `index, follow` só no lançamento M4.
- **Recomendação:** confirmar. Destrava dec. 599 e T43-20.

**656. Slug mal formado: `404` uniforme em vez de `400`.** O `400` revelaria o formato esperado e distinguiria do inexistente.
- **Recomendação:** `404` uniforme. Destrava CA-H043-08.

**657. Perfil `aprovada` com caso aberto (`pendente`, `em_revisao`, `retida_duplicidade`) responde `404`.** Defesa em profundidade para qualquer inconsistência entre perfil e caso (134 §1.3); em condições normais não ocorre.
- **Recomendação:** sim (fail closed). Destrava §4.1 passo 3 e T43-07.

**658. Serviço regulamentado sem certificação (#51).** Interpretação de 592a: o serviço é **listado normalmente**, sem qualquer marca de certificação ou de "verificado" (o selo é só de identidade), e o contrato não leva o campo `regulated`.
- (a) Listar sem indicador. (b) Ocultar serviços regulamentados até a #51.
- **Recomendação:** (a). Destrava §4.2 e CA-H043-11.

**659. Serviços sem identificador público.** O corpo traz só `groupName`, `name` e `modalities`, sem `id` nem slug de serviço, pois não há ação por serviço nesta versão (650). `[NÃO VERIFICADO]` se o catálogo já tem slug público.
- **Recomendação:** sem identificador agora. Destrava §4.2.

**660. Prefixo da migração.** `20261113410000` (maior que os reservados `20261113320000` da #54 e `20261113400000` da #55), com rollback `supabase/rollbacks/20261113410000_profile_create_public_profile_read.down.sql`.
- **Recomendação:** o líder reserva o número. Destrava §3.

**661. Entrega de apresentação sem página.** Renderizador `apps/web/public/profissional-perfil.js` e CSS só com tokens, sem HTML nem navegação (ajuste do líder sobre 597a).
- **Recomendação:** confirmar, pelo precedente de #54. Destrava §6.3 e CA-H043-13 a 15.

## 12. Próximos passos

1. Líder responde 650 a 661 em lista única e registra em `11-DECISOES.md` com os mesmos números (rodada nova, append-only).
2. Líder confere a coluna no quadro e decide a movimentação de #56 (não alterada aqui). Desenvolvimento só após #53 concluída e sem concorrência com #54 e #55 nos arquivos de composição da API.
3. DEV resolve os `[NÃO VERIFICADO]` de §10 passo 3 antes de escrever a migração.

## 13. Registro

- **Arquivo:** `D:\projetos\fastpro\docs\factory\143-DESENHO-H043.md`.
- Nenhum código, migração, teste, banco, chamada externa ou alteração de quadro foi feito. A Issue #56 permanece na coluna em que o líder a deixou.
