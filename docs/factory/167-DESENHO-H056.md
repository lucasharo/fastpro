# Desenho H-056 — Fotos a elegíveis com marca d'água (Issue #69)

EXEC-ID: EXEC-ARQ-69-20261120 | Workflow: WF-03 | Etapa: Arquitetura | Branch: feature/init
Fontes: `157-REFINO-H056.md` (perguntas 830 a 849), `153-DESENHO-H055.md` e `162-DESENHO-H058.md` (estrutura e padrões), `08-ARQUITETURA.md` §10.3, `10-ADRS.md` ADR-009.
Código e migrações lidos: `apps/api/src/media/*` (galeria, composição, redutor, `ReduceGate`), `packages/db/src/media-gallery.ts` (`SupabaseReducedPhotoReader`), `packages/domain/src/media/gallery.ts` (`fotoReduzidaValida`), `apps/api/src/requests/discovery-route.ts` e `discovery-composicao.ts`, `packages/db/src/discovery-rate-limit.ts`, `packages/db/src/professional-access.ts`, migrações `20261112120000`, `20261112140000`, `20261112190000`, `20261113010000`, `20261113230000`, `20261113420000`, `20261119100000`, `20261120100000`, `20261120310000`.
Este documento é só desenho: nenhum código, migração, banco, quadro ou `11-DECISOES.md` foi alterado.
Etiquetas: `[VERIFICADO]` lido no repositório · `[PROPOSTA]` decisão deste desenho, vetável · `[AMBIGUIDADE]` conflito resolvido aqui · `[NÃO VERIFICADO]` a confirmar no passo 0 da fatia indicada.

---

## 0. Fatos verificados no repositório (Grep/Read)

| Item | Resultado |
|---|---|
| `app.media_asset` | `[VERIFICADO]` colunas `id`, `status` (`pending/ready/rejected`), `request_id` (preenchida na publicação, `20261113010000`), `sort_order integer`, `ready_bytes` (1..750000), `ready_width`, `ready_height` (1..1280), `purge_requested_at`. Versão reduzida em `request-photos/p/<uuid>`. |
| `ReducedPhotoReaderPort.readReduced(id)` + `SupabaseReducedPhotoReader` | `[VERIFICADO]` único leitor de `p/<uuid>`; devolve `null` se 404 do Storage, lança `QuarantineStorageError` em falha. Já montado por `portasGaleriaMidia`, mas essa montagem exige o conjunto de ambiente da mídia (inclui `DATABASE_URL_APP_API` e `DRAFT_IP_HMAC_KEY`, ligados ao rascunho); H-056 NÃO reaproveita essa montagem, só a classe do leitor (A-6). |
| `fotoReduzidaValida(bytes, bytesDeclarados)` | `[VERIFICADO]` confere tamanho exato, teto 750 000 e assinatura JPEG `ff d8 ff`. Reuso obrigatório antes de qualquer composição. |
| `private.professional_access_guard(uuid,text,timestamptz)` | `[VERIFICADO]` modos `descoberta_aceite` (elegível + acesso comercial vigente, inclusive carência) e `participacao` (só elegível, sem exigir acesso vigente). Fail closed, nunca levanta exceção, só `app_system`. |
| `private.request_detail_professional(uuid,uuid,timestamptz)` | `[VERIFICADO]` (`20261113230000`, grant a `app_system`; existência já exigida pela migração `20261120310000`). Devolve zero linhas quando: guarda falha, pedido inexistente, status diferente de `publicado`, prazo encerrado ou sem casamento de serviço/raio. Reuso como regra única de "elegível antes do aceite" (A-2). |
| `private.request_acceptance_active(uuid,uuid)` | `[VERIFICADO]` em `20261120310000`: troca o stub `select false` por `exists(aceite status='ativo')`. `app.acceptance` já existe em `20261120100000` (vagas, `status in ('ativo','retirado','removido_por_seguranca')`). |
| `private.request_owner_get(uuid,uuid)` | `[VERIFICADO]` (`20261113230000`, grant `app_system`): padrão de leitura do dono. |
| Rota/composição da #68 | `[VERIFICADO]` `discovery-route.ts` (ordem: método, sessão 401, perfil 403, limite 429, serviço; cabeçalhos `no-store`/`no-referrer`; 503 fixo) e `discovery-composicao.ts` (monta só com `DATABASE_URL_APP_SYSTEM` + fábrica do cliente; pendências só com nome). Padrão a copiar. |
| `PgDiscoveryRateLimit` | `[VERIFICADO]` política fixa `DISCOVERY_RATE_LIMIT` e prefixo de chave fixo: precisa ser parametrizada para uma segunda política (fatia 3). |
| `ReduceGate` | `[VERIFICADO]` `entrar()` devolve vaga ou `null` após `waitMs`; `maxConcurrent` configurável. Instância própria para a marca d'água (A-7). |
| `sharp` | `[VERIFICADO]` `apps/api/package.json` `sharp 0.35.5`; `image-reducer-sharp.ts` já carrega sob demanda, uma thread, sem cache. |
| `WATERMARK_*` | `[VERIFICADO]` nenhuma ocorrência no `.env.example` nem em `apps/api/src`: nomes novos. |
| `media_access_log` | Eliminado (#150, `117-REFINO-REMOCAO-HISTORICO-ACESSO.md`). Nada a criar. |
| Migrações em `supabase/migrations` | `[VERIFICADO]` última: `20261120430000`. Faixa reservada `20261120500000` a `20261120599999`. |
| Rotas de foto após a publicação para o dono | `[VERIFICADO]` `/v1/media/photos*` é do rascunho (cookie do rascunho). Não existe rota do dono para fotos de pedido já publicado: criada aqui (decisão 841). |
| Pasta de testes SQL | `[NÃO VERIFICADO]` `supabase/` só tem `migrations`, `rollbacks`, `seed`; o padrão de teste de banco (`db:test`) é conferido no passo 0 da fatia 1 (Glob em `packages/db/tests` e scripts do `package.json`). |

---

## 1. Resumo da arquitetura

Três etapas, sem cache e sem tabela nova:

```
(1) GET  /v1/professional/requests/:id/photos                 sessão -> perfil -> limite -> banco (lista) -> 200 {photos} | 404 uniforme
(2) GET  /v1/professional/requests/:id/photos/:photoId/view?variant=preview|full
                                                              sessão -> perfil -> limite 60/min -> banco (acesso) -> token HMAC 60 s
                                                              -> 200 {view_url, expires_in:60} | 404 uniforme
(3) GET  /v1/media/watermarked-photos/:token                  token (HMAC, exp) -> limite por usr -> banco (reconfere acesso)
                                                              -> leitor Storage -> fotoReduzidaValida -> gate -> sharp (overlay) -> JPEG
Dono:
(1') GET /v1/requests/:id/photos            e   (2') GET /v1/requests/:id/photos/:photoId/view
     mesmo token, modo "dono": a rota (3) entrega o JPEG reduzido SEM marca.
```

Regras de ouro: (a) a autorização mora no banco (funções `private.request_photo_*`, só `app_system`); (b) o JPEG derivado nunca é gravado; (c) nenhuma tabela nem contador de acesso por foto; (d) toda recusa de profissional é `404 {code:"foto_nao_encontrada"}` idêntico; (e) o identificador impresso na marca vem do token assinado pelo servidor, nunca de parâmetro do cliente.

---

## 2. Decisões

### 2.1 Perguntas 830 a 849 (todas "adotada pelo líder", recomendação do PO)

| Nº | Decisão adotada | Observação de arquitetura |
|---|---|---|
| 830 | (a) `GET /v1/professional/requests/:id/photos` | Lista fechada; não altera `ELIGIBLE_PROFESSIONAL_KEYS` de `GET /v1/professional/requests/:id`. |
| 831 | (a) `GET .../photos/:photoId/view` com JSON `{ view_url, expires_in: 60 }` | `view_url` é caminho relativo `/v1/media/watermarked-photos/<token>`. Sem 307. |
| 832 | (a) `GET /v1/media/watermarked-photos/:token`, sem cookie | Ver A-3 (reconferência no banco) e A-4 (CT-16 reinterpretado). |
| 833 | (a) token `base64url(payload).base64url(hmac)` HMAC-SHA-256, `node:crypto`, chave `WATERMARK_TOKEN_SECRET` | Comparação com `timingSafeEqual`. Sem JWT. |
| 834 | (a) `FP-XXXX-XXXX` derivado por HMAC-SHA-256 do `professional_id` com `WATERMARK_ID_SALT` | 8 símbolos de alfabeto base32 sem ambíguos (40 bits). Ver A-8. |
| 835 | (a) mosaico, -30 graus, opacidade 18-22 por cento | Ver A-5 (glifos vetoriais próprios, sem fonte). |
| 836 | (a) `variant=preview` (largura máx. 320) e `full` (padrão, máx. 1 280) | `withoutEnlargement: true`. |
| 837 | (a) nunca persistir derivado | Sem porta de escrita no Storage no serviço (R8). |
| 838 | (a) 404 uniforme `{ code: "foto_nao_encontrada" }` | Mesmo corpo para: inelegível, fora do raio, prazo, pedido ou foto inexistente, foto de outro pedido, UUID malformado. |
| 839 | (a) cabeçalhos: `Content-Type: image/jpeg`, `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Content-Disposition: inline` | Acrescentar `Cross-Origin-Resource-Policy: same-site` (A-9, `[PROPOSTA]`). Sem `ETag`, sem `Last-Modified`, sem nome de arquivo. |
| 840 | (a) participante com aceite ativo mantém acesso; não participante perde em `p_now >= acceptance_deadline_at` | Ver A-1 para a regra exata. |
| 841 | (a) dono: `GET /v1/requests/:id/photos` e `:photoId/view`, imagem reduzida sem marca | Funções próprias do dono (A-1). |
| 842 | (a) `WATERMARK_TOKEN_SECRET` e `WATERMARK_ID_SALT` | Ambas com mínimo de 32 caracteres, checadas na subida; entram no `.env.example` só com o nome. Distintas entre si. |
| 843 | (a) JPEG `{ quality: 80, mozjpeg: true, chromaSubsampling: '4:2:0' }` | Sem `withMetadata`: sharp descarta EXIF/ICC (defesa extra; o EXIF já foi removido na H-028). |
| 844 | (a) 503 `{ code: "renderizacao_indisponivel" }` em timeout de 5 s, falta de vaga no gate ou erro do sharp | Contador operacional de nome fixo, sem identificador. Falha do Storage e do banco: 503 fixo `{ code: "indisponivel" }` (padrão da galeria). |
| 845 | (a) 60 por minuto por profissional na rota `view`, 429 `{ code: "muitas_requisicoes" }` com `Retry-After` | Política própria `photo_view` (A-10). A rota de lista usa a mesma política, para impedir enumeração. |
| 846 | (a) sem log por foto | Teste negativo obrigatório (fatia 5). Os contadores de limite de taxa (`rl_*`) existem para barrar excesso e não guardam foto nem pedido. |
| 847 | (a) `packages/domain/src/media/watermark.ts`; API em `apps/api/src/requests/photo-view-route.ts`, `photo-view-service.ts` e `photo-watermark-service.ts` | Ver §5 (mapa de arquivos): a rota de mídia (3) fica em `apps/api/src/media/watermarked-photo-route.ts` por ser `/v1/media/...`; a composição em `apps/api/src/requests/photo-view-composicao.ts`. |
| 848 | (a) `private.request_photo_access(p_request_id, p_professional_id, p_photo_id, p_now)` retorna boolean | Mais três funções de apoio (A-1). |
| 849 | (a) fronteira: H-056 não detecta raspagem (H-057/#70) nem cria aceite (H-058/#71) | Ver §10. |

### 2.2 Decisões de arquitetura (`[PROPOSTA]`, vetáveis)

| Nº | Decisão |
|---|---|
| A-1 | Funções de banco (uma migração, §3). Regra de acesso do profissional, em ordem: (i) participante: `request_acceptance_active(request, prof)` verdadeiro, mais `professional_access_guard(prof,'participacao',now)` verdadeiro e `service_request.status in ('publicado','selecionado')`; acesso vale mesmo com `p_now >= acceptance_deadline_at`. (ii) não participante: `exists(select 1 from private.request_detail_professional(prof, request, now))` (já aplica guarda `descoberta_aceite`, `status='publicado'`, prazo e casamento serviço/raio). Qualquer outra situação: negado. A regra (i) usa status `publicado/selecionado` como leitura de "até o encerramento do pedido" (RF-031); pedido `concluido` ou `cancelado` encerra o acesso `[PROPOSTA]`; aceite `retirado` ou `removido_por_seguranca` não é participante. |
| A-2 | A foto só é elegível se `m.request_id = p_request_id and m.id = p_photo_id and m.status='ready' and m.purge_requested_at is null`. Foto cruzada de outro pedido = negado, igual a inexistente. |
| A-3 | A rota (3) reconfere o acesso no banco a cada entrega (`request_photo_target`), usando o `usr` do token. Custo: uma consulta leve. Ganho: suspensão, perda de acesso ou retirada do aceite valem em até segundos, não em até 60 s, e foto removida/purgada nunca é servida por token ainda vivo. |
| A-4 | `[AMBIGUIDADE]` O refino pede, em CT-16, que "token de P1 na sessão de P2" seja recusado, mas 832 define a rota (3) sem cookie. Resolução: o token é portador (bearer) de 60 s; a marca impressa é SEMPRE a do `usr` do token (quem emitiu). CT-16 vira: "token emitido para P1, usado por qualquer pessoa, devolve a imagem marcada com o identificador de P1 e nunca de outro". O vínculo ao emissor está na marca, não na sessão. |
| A-5 | Marca sem dependência de fonte: o texto `FP-XXXX-XXXX` é desenhado por tabela própria de glifos 5x7 (`0-9`, `A-Z`, `-`) convertida em retângulos SVG, e não por `<text>`. Motivo: o `libvips/librsvg` da função serverless pode não ter fonte instalada e imprimir quadrados vazios, o que anularia a marca (risco R-A). Estilo: duas passadas por glifo, branco opacidade 0,22 e escuro (preto) opacidade 0,18 deslocado 1 px, para a marca aparecer sobre fundo claro e escuro. Repetição por `<pattern patternTransform="rotate(-30)">` cobrindo largura x altura inteiras (mosaico, com linhas alternadas deslocadas meia célula). Escala: célula `c = max(1, round(largura/400))` pixels (1 280 -> 3, 320 -> 1); passo horizontal = largura do texto + 4 caracteres, vertical = 5 alturas de texto. `[NÃO VERIFICADO]` suporte de `<pattern>` com `patternTransform` pelo librsvg da build do sharp 0.35.5: validar no teste da fatia 2; se falhar, plano B = gerar o tile em PNG raster via `sharp({create})` + `composite` com `tile: true` e `rotate`. |
| A-6 | Composição própria da H-056 (`montarFotosPedido`), independente de `MEDIA_UPLOAD_ENABLED` do rascunho: papel `app_system` (`DATABASE_URL_APP_SYSTEM`) para banco, `SUPABASE_URL` + chave secreta do Storage (mesmos nomes de `MEDIA_ENV_STORAGE`) para o leitor, `WATERMARK_TOKEN_SECRET`, `WATERMARK_ID_SALT`, `SITE_URL` não necessária (só GET). Sem qualquer item, as rotas não existem (404 uniforme) e a pendência lista só nomes. |
| A-7 | `ReduceGate` próprio da marca: `maxConcurrent = 2`, `waitMs = 1000`, instância única por módulo da borda. Timeout total de renderização 5 s (`AbortController` e `Promise.race`; ao estourar, liberar a vaga). `limitInputPixels` do sharp = 1 280 x 1 280 (entrada já é a reduzida). |
| A-8 | Identificador opaco: `FP-` + 8 símbolos do alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` tomados dos primeiros 40 bits de `HMAC-SHA-256(WATERMARK_ID_SALT, professional_id)`, em dois grupos de 4. Reversão (do código para o profissional) é função pura recalculada sobre a lista de profissionais; ferramenta de busca fica fora de H-056 (pendência para H-057/#70 ou runbook, §10). Trocar o salt invalida o mapeamento: o salt é estável e não rotaciona sem decisão. |
| A-9 | Cabeçalho extra `Cross-Origin-Resource-Policy: same-site` na entrega (a galeria usa `same-origin`; aqui a imagem é carregada por `<img>` do site de front que pode estar em outro subdomínio). Se o front e a API forem de mesma origem, o dev pode usar `same-origin`: conferir na fatia 4 com `SITE_URL`. |
| A-10 | Limites: lista e `view` do profissional compartilham a política `photo_view` (60/min por profissional, janela 60 s, balde 10 s); entrega (3) tem política própria `photo_deliver` (120/min por `usr` do token, aplicada só depois de o HMAC e a validade serem aprovados, para token inválido não gerar escrita no banco). Chave do balde = HMAC do identificador, mesmo molde da #68. `PgDiscoveryRateLimit` passa a receber a política (e o prefixo da chave) por parâmetro, com o valor atual como padrão (sem mudar a #68). |
| A-11 | Token: payload JSON canônico `{v:1,m:'p'|'o',pid,rid,usr,var:'p'|'f',exp}` (`exp` em segundos Unix = emissão + 60). Validação na entrega: formato, `v`, tamanho (<= 400 bytes), HMAC, `exp >= now` com o relógio injetado. Recusas de token (formato, assinatura, expirado) respondem todas `404 {code:"foto_nao_encontrada"}` idêntico, sem 403, para não revelar se o link existiu. A distinção `link_expirado/link_invalido` do refino não é exposta (decisão 838/RF-137 prevalece); o motivo vai só para contador operacional de nome fixo. |
| A-12 | Dono: a sessão identifica o dono; `request_photo_owner_*` confere `service_request.customer_user_id = sessão` (sem exigir perfil profissional). O token do dono tem `m:'o'` e a rota (3) entrega o JPEG reduzido sem sobreposição. A marca não se aplica ao dono. Vazamento de token do dono vale 60 s; risco aceito (as fotos são dele). |
| A-13 | Lista de fotos: `{ photos: [{ id, sortOrder, width, height }] }`, ordenada por `sort_order`, `id`. Pedido sem foto pronta, mas com acesso autorizado: `200 {photos: []}`. A lista nunca inclui chave de bucket, bytes ou nome. |
| A-14 | `UUID` malformado em `:id` ou `:photoId` = o mesmo 404. Corpo e `HEAD`/`POST`: só `GET` (outro método = 404 uniforme, como a #68). Parâmetro `variant` fora de `preview|full` = `400 {code:"parametro_invalido"}`; `variant` repetido ou parâmetro extra = 400 (só depois de sessão e perfil). |

---

## 3. Banco (migração única reservada)

Arquivo: `supabase/migrations/20261120500000_media_create_request_photo_view_access.sql`; reversão: `supabase/rollbacks/20261120500000_media_create_request_photo_view_access.down.sql` (padrão do repositório: `drop function`). Idempotente (`create or replace`), sem alterar tabela, dado, cron ou política. Bloco `do $$` inicial exige as dependências (mensagem clara, `42P01`): `private.professional_access_guard(uuid,text,timestamptz)`, `private.request_detail_professional(uuid,uuid,timestamptz)`, `private.request_acceptance_active(uuid,uuid)`, `app.media_asset`, `app.service_request`, `app.acceptance`.

Todas: `language plpgsql`, `stable`, `security definer`, `set search_path = ''`, `set lock_timeout = '5s'`; `revoke all ... from public, anon, authenticated, service_role, app_api, app_backup_reader`; `grant execute ... to app_system`. Nenhuma lança exceção por negação: nulos, UUID ausente ou qualquer negação devolvem zero linhas ou `false`.

1. `private.request_photo_access(p_request_id uuid, p_professional_id uuid, p_photo_id uuid, p_now timestamptz) returns boolean`: regras A-1 e A-2. `p_photo_id` nulo = só o acesso ao pedido (usado pela lista). Nulo em qualquer outro parâmetro = `false`. Fonte única da regra; as demais a chamam.
2. `private.request_photo_list(p_professional_id uuid, p_request_id uuid, p_now timestamptz) returns table (out_id uuid, out_pos integer, out_width smallint, out_height smallint)`: zero linhas = negado; uma linha com `out_id` nulo = autorizado e sem foto pronta; senão uma linha por foto, ordenada. Mesmo desenho de `media_list`.
3. `private.request_photo_target(p_professional_id uuid, p_request_id uuid, p_photo_id uuid, p_now timestamptz) returns table (out_bytes integer, out_width smallint, out_height smallint)`: zero linhas = negado; senão os dados declarados (`ready_bytes`, `ready_width`, `ready_height`) para `fotoReduzidaValida` e para dimensionar a marca.
4. `private.request_photo_owner_list(p_customer_id uuid, p_request_id uuid)` e `private.request_photo_owner_target(p_customer_id uuid, p_request_id uuid, p_photo_id uuid)`: mesmos formatos de 2 e 3, exigindo `customer_user_id = p_customer_id`; sem guarda comercial; qualquer status do pedido (foto não purgada).

Contagens: nenhuma função escreve. Nenhuma tabela nova. Nenhuma coluna nova. `app.media_asset` e `app.service_request` não mudam.

Teste de banco: cenários S1 a S12 do §7 (tabela de acesso) contra o banco de desenvolvimento via `npx supabase`, sem Docker; funções chamadas com `p_now` fixo.

---

## 4. Contratos e rotas

### 4.1 Rotas e códigos

| Rota | Sucesso | Erros (ordem de avaliação) |
|---|---|---|
| `GET /v1/professional/requests/:id/photos` | `200 {photos:[{id,sortOrder,width,height}]}` | método != GET: 404; sem cookie ou sessão inválida: `401 sessao_necessaria`; sem perfil profissional: `403 perfil_profissional_obrigatorio`; UUID inválido ou negado no banco: `404 foto_nao_encontrada`; limite: `429 muitas_requisicoes` + `Retry-After`; falha interna: `503 indisponivel`. |
| `GET /v1/professional/requests/:id/photos/:photoId/view?variant=` | `200 {view_url, expires_in:60}` | idem; mais `400 parametro_invalido` (variant). |
| `GET /v1/media/watermarked-photos/:token` | `200 image/jpeg` | token inválido/expirado/negado/foto ausente: `404 foto_nao_encontrada`; `429 muitas_requisicoes`; `503 renderizacao_indisponivel` (gate, timeout, sharp); `503 indisponivel` (banco, Storage, leitura divergente). |
| `GET /v1/requests/:id/photos` e `.../:photoId/view` | `200` (mesmo formato; token `m:'o'`) | `401`, `404 foto_nao_encontrada` (não é dono, não existe), `429`, `503`. Perfil profissional NÃO é exigido. |

Ordem do limite: depois de sessão e perfil e antes do banco (padrão #68). Toda resposta JSON: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `Content-Type: application/json; charset=utf-8`. Sem CORS. Sem log de cookie, token, id de pedido, id de foto.

### 4.2 Contratos TypeScript (domínio, `packages/domain/src/media/watermark.ts`)

```ts
export const PHOTO_VIEW_TTL_S = 60 as const;
export type PhotoVariant = 'preview' | 'full';
export type PhotoTokenMode = 'professional' | 'owner';

export interface PhotoTokenClaims {
  readonly mode: PhotoTokenMode; readonly photoId: string; readonly requestId: string;
  readonly userId: string; readonly variant: PhotoVariant; readonly expSeconds: number;
}
export interface PhotoTokenCodec {
  sign(claims: Omit<PhotoTokenClaims, 'expSeconds'>, nowMs: number): string;
  verify(token: string, nowMs: number): PhotoTokenClaims | null; // null para qualquer defeito
}
export function createPhotoTokenCodec(secret: string): PhotoTokenCodec; // exige >= 32 caracteres
export function watermarkIdOf(professionalId: string, salt: string): string; // 'FP-XXXX-XXXX'
export function parsePhotoVariant(valor: string | null): PhotoVariant | null;

export interface PhotoViewRow { readonly id: string; readonly sortOrder: number; readonly width: number; readonly height: number }
export interface PhotoViewStorePort {            // implementado em packages/db (PgPhotoViewStore, só app_system)
  list(professionalId: string, requestId: string, nowMs: number): Promise<readonly PhotoViewRow[] | null>;
  target(professionalId: string, requestId: string, photoId: string, nowMs: number): Promise<PhotoTarget | null>;
  ownerList(customerId: string, requestId: string): Promise<readonly PhotoViewRow[] | null>;
  ownerTarget(customerId: string, requestId: string, photoId: string): Promise<PhotoTarget | null>;
  access(requestId: string, professionalId: string, photoId: string | null, nowMs: number): Promise<boolean>; // 848
}
export interface PhotoTarget { readonly bytes: number; readonly width: number; readonly height: number }

export interface WatermarkComposerPort {         // implementado em apps/api (sharp)
  compose(input: Uint8Array, opts: { variant: PhotoVariant; label: string | null; signal: AbortSignal }):
    Promise<{ ok: true; jpeg: Uint8Array } | { ok: false; kind: 'unavailable' | 'invalid' }>;
}
```

`label: null` = sem marca (dono): o compositor só devolve o JPEG original (preview ainda redimensiona; full devolve os bytes lidos sem reprocessar, após `fotoReduzidaValida`).

### 4.3 Serviço (`photo-view-service.ts`, `photo-watermark-service.ts`)

- `photo-view-service`: `listarFotos`, `emitirLink` (profissional e dono): validam UUIDs, chamam o store, montam `view_url` com `codec.sign(...)` e `clock.nowMs()` injetado (um instante por requisição).
- `photo-watermark-service.entregarFoto(token)`: `verify` -> limite `photo_deliver` por `usr` -> `store.target/ownerTarget` (reconfere, A-3) -> `reader.readReduced(photoId)` -> `fotoReduzidaValida(bytes, target.bytes)` (divergência ou `null` = 503 `indisponivel`, nunca serve) -> `gate.entrar()` (nulo = 503 `renderizacao_indisponivel`) -> `composer.compose` com timeout 5 s -> libera vaga em `finally` -> resposta binária com os cabeçalhos de 839 (+ A-9) e `Content-Length`.
- Variante `preview` no dono: redimensiona sem marca.

---

## 5. Mapa de arquivos (novos, salvo indicação)

| Arquivo | Conteúdo |
|---|---|
| `packages/domain/src/media/watermark.ts` + export em `packages/domain/src/index.ts` | codec do token, `watermarkIdOf`, tabela de glifos 5x7, `buildWatermarkSvg(width, height, label)` (puro, determinístico), `parsePhotoVariant`, constantes e portas (§4.2). |
| `packages/db/src/photo-view-store.ts` + export em `packages/db/src/index.ts` | `PgPhotoViewStore` (SQL posicional, só `private.request_photo_*`; qualquer resposta fora do formato vira erro interno; nunca devolve texto de banco). |
| `packages/db/src/discovery-rate-limit.ts` (alterar) | parametrizar política e prefixo (padrão = #68). |
| `apps/api/src/media/watermark-composer-sharp.ts` | `WatermarkComposerPort` com sharp (carga preguiçosa como `image-reducer-sharp.ts`). |
| `apps/api/src/requests/photo-view-route.ts`, `photo-view-service.ts`, `photo-view-composicao.ts` | rotas (1)/(2)/(1')/(2') e montagem. |
| `apps/api/src/requests/photo-watermark-service.ts` e `apps/api/src/media/watermarked-photo-route.ts` | entrega (3). |
| `apps/api/src/app.ts` e `apps/api/src/composicao.ts` (alterar) | registrar as rotas na ordem certa: rotas `/v1/professional/requests/:id/photos...` e `/v1/requests/:id/photos...` ANTES das rotas genéricas de detalhe `/v1/professional/requests/:id` e `/v1/requests/:id` (cuidado com casamento por prefixo; teste de regressão de rota). |
| `.env.example` (alterar) | linhas `WATERMARK_TOKEN_SECRET=` e `WATERMARK_ID_SALT=` vazias, com comentário de 32 caracteres mínimos. |
| `supabase/migrations/20261120500000_...sql` e rollback | §3. |

Pacote novo: nenhum. `sharp` já é dependência de `apps/api`; nenhuma dependência nova.

---

## 6. Segurança e privacidade

1. Silêncio uniforme (838, A-11): mesma resposta byte a byte para toda negação do profissional. Teste compara corpo e cabeçalhos entre causas diferentes. A diferença de tempo entre causas não é alvo de controle.
2. Sem original: nenhuma rota lê a chave do bucket de quarentena nem `request-photos` fora de `p/<uuid>`; o leitor usado é só `SupabaseReducedPhotoReader`. Nenhum cabeçalho `Content-Disposition: attachment`.
3. PII: respostas JSON não trazem nome, e-mail, telefone, endereço, coordenada, chave de bucket nem bytes. A imagem não traz EXIF (H-028; sharp sem `withMetadata`). O nome do cliente (`first_name`) não aparece aqui.
4. Segredos: `WATERMARK_TOKEN_SECRET` e `WATERMARK_ID_SALT` só lidos na composição; nunca registrados; erros do token nunca citam o conteúdo.
5. Identificador impresso vem do `usr` do token, derivado no servidor; o cliente não escolhe (R7).
6. Sem log por foto (#150, 846); contadores operacionais de nome fixo (`foto_ok`, `foto_404`, `foto_503_gate`, `foto_503_timeout`, `leitura_divergente`, `token_invalido`) sem identificador.
7. Raspagem: fica só o freio de taxa (A-10) e a marca. Detecção por contador e sinal pertencem a H-057 (#70).
8. Guarda fail closed: erro na consulta de acesso = 503 `indisponivel` (nunca serve por engano); negação = 404.
9. Sem Mapbox, sem e-mail, sem backup/exportação, sem Docker.

---

## 7. Matriz de acesso a testar (banco e serviço)

| Cenário | Esperado |
|---|---|
| S1 elegível, pedido `publicado`, dentro do prazo, serviço e raio compatíveis | autorizado |
| S2 verificação pendente/recusada, suspenso ou e-mail não verificado | negado |
| S3 acesso comercial vencido após carência | negado (pré-aceite) |
| S4 em carência (72 h) e cancelada com acesso até o fim do período | autorizado |
| S5 fora do raio ou serviço não atendido | negado |
| S6 não participante, `p_now >= acceptance_deadline_at` | negado |
| S7 participante ativo, prazo vencido, pedido `selecionado` | autorizado; marca presente |
| S8 participante `retirado` ou `removido_por_seguranca` | negado |
| S9 participante ativo com acesso comercial vencido | autorizado (guarda `participacao`) |
| S10 foto de outro pedido, foto `pending/rejected`, `purge_requested_at` preenchido | negado |
| S11 pedido `concluido` ou `cancelado` | negado ao profissional; dono vê (se foto não purgada) |
| S12 UUID nulo ou inexistente | negado sem exceção |

Fixtures sintéticas com relógio injetado; `p_now` explícito; nenhum dado real; o banco usado é o de desenvolvimento.

---

## 8. Fatias de Desenvolvimento (ordem obrigatória, cada uma com testes e `check:all` local)

| Fatia | Escopo | Testes |
|---|---|---|
| 1 | Passo 0: Glob dos testes de banco e leitura de `private.professional_eligible` só se preciso. Migração `20261120500000` + rollback; aplicar com `npx supabase`. Funções §3. | Banco: S1 a S12; grants (só `app_system`); `rollback` reverte e reaplica; sem tabela nova. |
| 2 | Domínio `watermark.ts`: codec do token, `watermarkIdOf`, glifos, `buildWatermarkSvg`, `parsePhotoVariant`. Compositor sharp (`watermark-composer-sharp.ts`) com plano B do A-5 se `<pattern>` falhar. | Unidade: token (ida e volta, 1 byte adulterado, segredo errado, expirado por `nowMs`, tamanho, `v`, tipos); id (determinismo, formato, sem PII, outro salt diferente); SVG (determinístico, dimensões, só os caracteres permitidos); sharp: JPEG válido, `preview` <= 320 px e < 60 KB, `full` <= 1 280 px, diferença média de pixel sobre fundo claro e escuro acima de limiar, sem EXIF, proporção da marca em 320 e 1 280, `label:null` sem marca. |
| 3 | `PgPhotoViewStore`; parametrizar `PgDiscoveryRateLimit`; serviço e rotas (1), (2), (1'), (2') com composição `photo-view-composicao`. | Rotas com fakes: 401, 403, 404 uniforme (todas as causas, corpo e cabeçalhos idênticos), 400 variant, 429, 503, UUID malformado, método errado; token emitido com TTL 60; lista fechada de chaves sem PII; adaptador: resposta fora do formato lança erro interno; limite compartilhado entre lista e view; regressão da #68 (`discovery` segue passando). |
| 4 | Entrega (3): `photo-watermark-service`, rota de mídia, gate, timeout, cabeçalhos, leitura divergente. Registro em `app.ts`/`composicao.ts` sem quebrar rotas de detalhe. | Token inválido/expirado/adulterado = 404 sem tocar banco/Storage/sharp (contadores de chamada); reconferência de acesso (A-3); leitura `null`/tamanho divergente = 503 e nada servido; gate cheio = 503 `renderizacao_indisponivel`; timeout 5 s com relógio e compositor falsos; cabeçalhos exatos de 839; dono sem marca; limite `photo_deliver`; regressão de rotas (`/v1/professional/requests/:id` e `/v1/requests/:id` continuam a funcionar). |
| 5 | Teste negativo de persistência e privacidade: nenhuma tabela de log criada, sem escrita de objeto no bucket (fake do Storage só tem `readReduced`; porta de escrita não é injetada), varredura de PII em JSON, cabeçalhos e EXIF. `.env.example`, pendências da composição, documentação (`docs/factory` do produto: seção de ambiente e contadores). | CT-17, CT-21, CT-24 do refino; `check:all` completo. |
| 6 (QA, não Dev) | Caminho feliz por API (regra do dono do projeto): profissional elegível lista, emite link, baixa JPEG com marca; dono baixa sem marca; token vencido 404. | Ver §9. |

---

## 9. Correspondência com critérios do refino

CA-H056-01..05 e 14: fatias 1 e 3. CA-06: fatia 3. CA-07, 08, 16, 17: fatias 2 e 4. CA-09, 10: fatia 2 (codec) e 4 (rota). CA-11, 18: fatia 5. CA-12, 13: fatia 1 (S6, S7). CA-15: fatias 3 e 5. CA-19: fatias 1, 3, 4. CA-20: fatia 4. CA-21: todas (sem rede externa; `fetch` do Storage e sharp isolados por portas falsas nos testes automáticos; um teste real do sharp roda localmente).
Diferenças deliberadas frente ao refino: (i) `link_expirado` e `link_invalido` viram o mesmo 404 uniforme (A-11); (ii) CT-16 reinterpretado (A-4); (iii) a rota (3) reconfere acesso (A-3); (iv) o corpo de erro do dono usa o mesmo código `foto_nao_encontrada`.

---

## 10. Dependências reais e fronteiras

| Item | Estado confirmado | Efeito |
|---|---|---|
| #40 (reduzir foto), #42 (galeria e leitor), #44 (publicação e `request_id`), #45 (detalhe), #55 (guarda), #58 (acesso comercial), #68 (descoberta e `has_photos`), #141, #150 | `[VERIFICADO]` migrações e código existem no repositório | Base pronta. Sem bloqueio. |
| **#71 (H-058, aceite)** | `[VERIFICADO]` em desenvolvimento no quadro, mas `app.acceptance` (`20261120100000`) e `private.request_acceptance_active` real (`20261120310000`) JÁ existem nas migrações do repositório. `[NÃO VERIFICADO]` se já foram aplicadas no banco de desenvolvimento | A regra A-1(i) (participante) usa `request_acceptance_active`. A migração da H-056 falha no bloco 0 se a #71 não estiver aplicada. Início das fatias 2 a 5 não depende da #71; a fatia 1 (banco) só pode ser aplicada depois que `20261120100000` e `20261120310000` estiverem aplicadas no banco de desenvolvimento. Cenários S7 a S9 só rodam depois disso. Não depende de a #71 estar concluída no quadro, só aplicada. |
| #70 (H-057, raspagem) | Backlog, consome H-056 | Fora de H-056. H-056 só entrega o ponto de emissão (rota 2) onde H-057 conectará o contador. |
| #76 (H-065, chat) | Backlog | Sem relação; chat não leva fotos (decisões 32 e 33). |
| Ordem de migrações | Faixa `20261120500000` a `20261120599999` reservada para esta Issue; outras Issues do dia usam faixas próprias | Usar uma só migração. |

Pendências registradas (não são tarefas desta Issue): ferramenta de reversão do código `FP-XXXX-XXXX` para o profissional (H-057 ou runbook); chave do front que consumirá `view_url` (Issue de tela); produção (sem configuração de produção nesta Issue).

---

## 11. Riscos e mitigações

| Id | Risco | Mitigação |
|---|---|---|
| R-A | Texto SVG sem fonte na função serverless imprime quadrados ou nada | Glifos vetoriais próprios (A-5); teste de pixel sobre fundo claro e escuro; plano B raster. |
| R-B | `<pattern patternTransform>` não suportado pelo librsvg do sharp | Teste na fatia 2 decide; plano B documentado. |
| R-C | Egress de 5 GB/mês (R-37) | `preview` 320 px (< 60 KB), `full` só sob clique, `no-store`, limites 60/min e 120/min. |
| R-D | CPU e memória do sharp por invocação (S-06, S-09, R-31) | Gate com 2 vagas, 5 s de timeout, `limitInputPixels`, 1 thread, sem cache, 503 limpo. |
| R-E | Token vazado em fórum | Vale 60 s; a marca identifica o emissor; reconferência de acesso a cada entrega. |
| R-F | Colisão do código de 40 bits entre profissionais | Probabilidade desprezível na escala do projeto; a reversão lista todos os candidatos e o pedido ajuda a desempatar. |
| R-G | Reintrodução de log de acesso por foto | Teste negativo da fatia 5; revisão de código verifica ausência de `insert`. |
| R-H | Conflito de rotas genéricas com as novas (`/v1/requests/:id` vs `/v1/requests/:id/photos`) | Registrar as novas antes; teste de regressão (fatia 4). |
| R-I | #71 ainda não aplicada no banco de desenvolvimento quando a fatia 1 for aplicar | Passo 0 da fatia 1 confere via `npx supabase`; se faltar, executar fatias 2 e 3 (puras) primeiro e adiar a aplicação. |
| R-J | Regra de participante com status `publicado/selecionado` pode divergir do que o líder considera "até o encerramento" | Marcado `[PROPOSTA]` em A-1; troca é uma linha na função. |
| R-K | Dois segredos novos podem ficar ausentes e as rotas desaparecem | Pendência com nome na composição, 404 uniforme e teste da composição. |

---

## 12. Perguntas ao líder

Nenhuma bloqueante. Pontos vetáveis (adotados pela recomendação deste desenho, para o registro em `11-DECISOES.md` pelo líder): A-1 (status `publicado/selecionado` para participante), A-4 (CT-16 reinterpretado), A-9 (CORP `same-site`), A-11 (404 uniforme também para token inválido/expirado).
