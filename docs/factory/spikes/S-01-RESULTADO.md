# S-01 — Resultado: sessão Supabase para o cliente verificado pelo nosso desafio

- **Issue:** #5 ("[Spike] Sessão Supabase para usuário verificado pelo desafio"). **Data:** 2026-11-10. **Branch:** `feature/init`. **Workflow:** WF-03 adaptado a spike, coluna Arquitetura.
- **Refs:** ADR-005 (10), 08 §5.1 e §5.4, RF-035 a RF-039, D8, plano 19 (S-01). **Bloqueia/libera:** H-011, H-012, H-013, H-014 (e H-016 no que toca ao Auth).
- **Escopo executado:** somente leitura de documentação oficial. Nenhum usuário criado, nenhum e-mail enviado, nada alterado no Auth nem no banco. Os passos 2 a 6 do plano (criar usuário, `generateLink`, `verifyOtp`, medir `exp`, revogar) **não foram executados** (exigem criar usuário) e ficam como prova local obrigatória na H-003/H-011.

## Resumo em linguagem simples

O Supabase Auth cria uma sessão real (token de acesso curto mais token de renovação) para um usuário que nós mesmos verificamos, e permite incluir nosso identificador de sessão no token; mas no plano gratuito ele não limita a sessão a 7 dias, então o limite de 7 dias e a revogação precisam ser impostos pela nossa API (como o ADR-005 já previa).
Falta provar na prática (localmente, sem custo) a criação e a revogação da sessão, e cuidar do limite de requisições por IP, que pode afetar todos os clientes se a API chamar o Supabase de um IP só.

## 1. Fontes (lidas em 2026-11-10)

A ferramenta WebFetch não estava disponível; as páginas foram baixadas com `curl` (GET), na versão Markdown (sufixo `.md`) quando existia.

| Tema | URL |
|---|---|
| Sessões, refresh token, limite de duração, reuso | https://supabase.com/docs/guides/auth/sessions |
| Magic link e OTP por e-mail (`verifyOtp`, `token_hash`) | https://supabase.com/docs/guides/auth/auth-email-passwordless |
| Limites de taxa do Auth, repasse de IP | https://supabase.com/docs/guides/auth/rate-limits |
| JWT e verificação | https://supabase.com/docs/guides/auth/jwts |
| Campos do JWT (`session_id`, `aal`, `amr`) | https://supabase.com/docs/guides/auth/jwt-fields |
| Chaves de assinatura (importar chave própria, legado) | https://supabase.com/docs/guides/auth/signing-keys |
| Hooks e planos | https://supabase.com/docs/guides/auth/auth-hooks |
| Hook de token de acesso personalizado | https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook |
| SMTP padrão e personalizado | https://supabase.com/docs/guides/auth/auth-smtp |
| Checklist de produção (Auth) | https://supabase.com/docs/guides/security/production-checklist |
| MAU e cota | https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users |
| Referência `admin.generateLink`, `admin.signOut` | https://supabase.com/docs/reference/javascript/auth-admin-generatelink e `.../auth-admin-signout` |
| Código de `admin.signOut` e escopos (SDK) | https://raw.githubusercontent.com/supabase/supabase-js/master/packages/core/auth-js/src/GoTrueAdminApi.ts |
| Contrato HTTP do servidor Auth (`/logout`, `/verify`, `/admin/generate_link`, rotas `/admin/*`) | https://raw.githubusercontent.com/supabase/auth/master/openapi.yaml |

## 2. O que o Supabase garante (VERIFICADO na documentação)

| Item | Resultado | Fonte |
|---|---|---|
| O que é a sessão | Token de acesso (JWT) mais token de renovação (string única); linha em `auth.sessions`; claim `session_id` (UUID) em todo JWT | sessions |
| Duração do token de acesso | Padrão **1 h**, configurável; recomendado 5 min a 1 h; **não ir abaixo de 5 min**, e menos ainda de 2 min (carga e deriva de relógio). A proposta do plano (900 s) está dentro da faixa | sessions |
| Token de renovação | **Nunca expira**, uso único; cada troca devolve novo par | sessions |
| Reuso | Aceita reuso em **10 s** e o pai do token ativo; fora disso a sessão inteira é terminada e todos os tokens dela revogados | sessions |
| Duração da sessão | Por padrão **indefinida**; várias sessões por usuário, em quantos dispositivos forem | sessions |
| Limitar duração (time-box 7 dias, inatividade, sessão única) | **Somente plano Pro ou superior.** Não vale para o Free. Mesmo no Pro, não é proativo: a duração real é o limite mais o `exp` do JWT | sessions |
| Logout | `signOut` com escopo `global`, `local` ou `others`; as sessões saem de `auth.sessions` | sessions; openapi `/logout` |
| JWT depois do logout | Continua válido até o `exp`; para negar antes é preciso checar o `session_id` contra `auth.sessions` ou contra tabela própria | sessions |
| Limpeza | Sessões vencidas por time-box/inatividade são apagadas depois de 24 h | sessions |
| Hook de token de acesso personalizado | **Disponível em Free e Pro**; função Postgres ou HTTP; roda em toda emissão, inclusive `token_refresh`; pode **acrescentar claims** (as obrigatórias, incluindo `session_id`, não podem sair) e pode **devolver erro** (ex.: 403) que bloqueia a emissão; payload limitado a 20 KB | auth-hooks; custom-access-token-hook |
| Obter sessão para usuário que verificamos nós | `admin.generateLink({type:'magiclink', email})` devolve `hashed_token` (e `email_otp`, `action_link`) **sem enviar e-mail**; `verifyOtp({token_hash, type:'email'})` troca por sessão. `POST /verify` aceita `token_hash`. | passwordless; openapi `/admin/generate_link`, `/verify` |
| E-mail | O link/OTP nativo expira em **1 h** por padrão; o mesmo ajuste (`Email OTP expiration`) vale para todos os links de e-mail; recomendado ≤ 3600 s. O SMTP padrão do Supabase envia **2 e-mails/h** e só a membros da equipe; com SMTP próprio, 30/h iniciais ajustáveis | passwordless; smtp; rate-limits |
| Limites de taxa (por IP, balde de 30) | Entrar/cadastrar (`/otp`, `/magiclink`, `/user` etc.): 30 por 5 min; **`/verify`: 30 por 5 min**; `/token` (inclui renovação): 150 por 5 min; novo OTP para o mesmo usuário: 60 s | rate-limits |
| Repasse de IP | Cabeçalho `Sb-Forwarded-For`, aceito só com chave **secreta** (`sb_secret`), e **precisa ser habilitado** em projetos novos | rate-limits |
| Cota de usuários ativos | Free: **50.000 MAU** (sem cobrança de excedente no Free) | MAU |
| Revogação por API | `admin.signOut(jwt, scope)` exige o **JWT do usuário** (não o id); escopo padrão `global`. O contrato HTTP do servidor Auth **não lista** rota admin para encerrar sessão por `sid` ou por usuário | GoTrueAdminApi.ts; openapi |
| Chave própria (Caminho 3) | É possível importar chave privada ou segredo como chave de assinatura; o segredo legado só é extraível enquanto não migrado | signing-keys |

## 3. O que precisa de cuidado para sustentar 7 dias

1. **Os 7 dias são nossos.** Free não tem time-box. O limite absoluto fica em `app_session.expires_at`, checado em toda requisição (confirma 08 §5.1 item 6 e o passo 6 do plano). Como o token de renovação do Supabase nunca expira, ele **não pode ficar solto no navegador**: a API guarda/renova a sessão e recusa renovar após `expires_at` ou revogação.
2. **Defesa em profundidade:** o hook de token de acesso, em `token_refresh`, pode consultar `app_session` e devolver 403 se a sessão expirou ou foi revogada, e acrescentar o `sid`. Ligação sugerida: `app_session.auth_session_id = claims.session_id` (o `session_id` do Supabase é obrigatório e não sai do token).
3. **Revogação.** "Sair" tem o JWT em mãos (`signOut(jwt,'local')`). "Sair de todos" e revogação administrativa **não têm rota admin por usuário**: a revogação efetiva é marcar `app_session.revoked_at` (checado a cada requisição, janela máxima = vida do JWT, 15 min na proposta) e, além disso, apagar as linhas de `auth.sessions` por SQL com papel de serviço **[NÃO VERIFICADO]** se isso for permitido.
4. **Concorrência de renovação.** Reuso só é tolerado por 10 s: a API deve serializar a renovação por `sid` (um lock), senão duas abas podem derrubar a sessão inteira.
5. **Limite por IP vira limite global.** `verifyOtp` (`/verify`, 30/5 min) e renovação (`/token`, 150/5 min) chamados pelo servidor saem de poucos IPs (função na Vercel). Habilitar o repasse de IP (`Sb-Forwarded-For` com chave secreta) ou aceitar que picos de login/renovação de muitos clientes retornem 429. Com renovação a cada 15 min, 150/5 min equivale a ≈ 750 renovações simultâneas por IP; avaliar no volume do MVP.
6. **Expiração de 1 h do link nativo** não conflita com os 15 min do desafio próprio porque o `hashed_token` é gerado e consumido **no mesmo pedido do servidor**, depois de validar nosso desafio (256 bits, 15 min, 5 tentativas). Nunca devolver `hashed_token`, `email_otp` nem `action_link` ao navegador, e não registrá-los em log.
7. **E-mail.** `generateLink` não envia mensagem; o envio do cliente continua pelo `EmailProviderPort` (ADR-005, ADR-020). O SMTP padrão do Supabase (2/h, só equipe) não serve para profissional/admin em produção: SMTP próprio é pré-requisito (S-11).
8. **Dispositivos.** Sessões por dispositivo são o comportamento padrão (uma linha por login); "sessão única por usuário" é opção Pro e vem desligada, então vários dispositivos funcionam no Free.
9. **Mesmo e-mail em profissional e cliente.** Ambos seriam o mesmo usuário do Auth; o vínculo é por `app_user.auth_user_id` (ADR-006). Garantir que o desafio do cliente não crie sessão com privilégios de profissional (papel vem de `app_user`/claims nossos, não do Auth).

## 4. Decisão (proposta ao Orquestrador)

**Caminho 1 (preferido) é viável pela documentação**: `createUser` (e-mail confirmado) mais `generateLink` mais `verifyOtp` dá uma sessão Supabase real, revogável, com `session_id` e com `sid` por hook (disponível no Free). **Condição:** confirmar na prova local (H-003/H-011) os quatro pontos do §5. Se algum falhar, adotar **Caminho 3** (JWT assinado pela API com chave importada, `sub`, `role='authenticated'`, `sid`), com Realtime por consulta periódica (ADR-005/010), sem mudar a stack. Em qualquer caminho, os 7 dias absolutos e a revogação são impostos por `app_session`, como no ADR-005 e 08 §5.1.

## 5. Impacto em H-011 e H-012 (e vizinhas)

- **H-011 (desafio):** só depois de validar nosso desafio chama `createUser` idempotente e `generateLink`; resposta ao cliente segue uniforme (202). Incluir teste: nenhum campo do Auth (`hashed_token`, `email_otp`, `action_link`) aparece em resposta ou log (H-007).
- **H-012 (consumo por POST):** o POST valida o desafio, obtém a sessão via `verifyOtp` e grava `app_session` (`expires_at = agora + 7 d`, `auth_session_id`); tokens do Supabase em cookie HttpOnly gerido pela API ou mantidos no servidor. GET continua sem efeito.
- **H-013:** o caminho do código de 6 dígitos usa o mesmo mecanismo de sessão; nossos 6 dígitos não são os do Supabase (o `email_otp` nativo não é usado).
- **H-014:** checar `expires_at`/`revoked_at` em cada requisição; "sair de todos" por `revoked_at`; hook com 403 em `token_refresh`; lock de renovação.
- **Configuração:** `jwt_expiry` ≈ 900 s `[PROPOSTA]` (≥ 5 min); repasse de IP habilitado; SMTP próprio antes de produção.

## 6. Riscos

| # | Risco | Mitigação |
|---|---|---|
| R1 | Limite por IP (30/5 min em `/verify`) atingido com tráfego concentrado no servidor | Habilitar `Sb-Forwarded-For`; medir; fallback Caminho 3 |
| R2 | Renovação simultânea derruba a sessão (reuso fora de 10 s) | Lock por `sid` na API |
| R3 | JWT vale até 15 min após logout | Checagem de `app_session` por requisição; aceito para leitura, obrigatório em ações críticas |
| R4 | Vazamento de `hashed_token` ou do token de renovação | Nunca ao navegador nem a logs; cookie HttpOnly; varredura de PII/segredo (H-007) |
| R5 | Depender de hook em Postgres (grants a `supabase_auth_admin`, RLS) | Teste pgTAP; erro do hook bloqueia login, então manter função simples |
| R6 | Mudança de política/limites do plano gratuito | Registrar versão; reler antes da Onda 1 |

## 7. NÃO VERIFICADO

- Criação real de sessão por `createUser` + `generateLink` + `verifyOtp`, `exp` real, conteúdo das claims e reuso do `token_hash` (falha esperada) — **não executados**.
- `generateLink` para e-mail inexistente: o contrato HTTP cita "no such user" (404) e o plano usa `createUser` antes; comportamento exato não confirmado.
- Se o hook roda de fato na renovação com o `sid` consultável na prática e se o erro 403 bloqueia a renovação como descrito.
- Se `/verify` chamado pelo servidor respeita `Sb-Forwarded-For` e quantas chamadas por IP o Free realmente aceita; se os limites do Free diferem dos da tabela geral.
- Permissão de apagar linhas de `auth.sessions` por SQL e se o `exp` mínimo/máximo configurável de `jwt_expiry` no Free é irrestrito.
- Importação de chave de assinatura própria e aceitação por Storage/Realtime no Free (Caminho 3); coberto em parte por S-05.
- Duração de 7 dias de ponta a ponta (apenas inferida de que o Free não impõe limite).

## 8. Decisões adotadas em 2026-11-10

Decisões delegadas pelo Orquestrador (recomendações do PO em `25-REFINO-S01.md` §4 e deste spike). As seções 1 a 7 acima permanecem como fonte, sem alteração.

| # | Decisão | Origem | Efeito |
|---|---|---|---|
| D1 | Sem Docker nem Supabase CLI nesta máquina: a prova dos passos 2 a 6 (criar usuário, `generateLink`, `verifyOtp`, medir `exp`, revogar) será feita contra o projeto de **desenvolvimento** na nuvem, com usuários sintéticos criados e removidos, quando a execução for autorizada na H-011. Substitui a prova local da §1 de 25 (dúvida D-S01-1). | D-S01-1 | Prova pendente (ver §9) |
| D2 | Revogação imediata por `sid` em **cada requisição** da API (`app_session.revoked_at`), mais `signOut` do Supabase quando houver o JWT; janela de até `jwt_expiry` só fora da API (Realtime, Storage). | D-S01-2 | H-014 |
| D3 | Renovação **absoluta** de 7 dias: o uso não prorroga `expires_at`; só o token de acesso renova. | D-S01-3 | H-012, H-014 |
| D4 | `jwt_expiry` = **900 s** (valor final confirmado em H-014). | D-S01-4 | Configuração |
| D5 | Renovação **serializada por `sid`** (lock), por causa da tolerância de reuso de 10 s. | §3 item 4 | H-014 |
| D6 | Novo desafio **não revoga** sessões existentes; "sair de todos" é o meio explícito. | D-S01-6 | H-011, H-014 |
| D7 | Expiração de sessão **não altera dados** (pedidos, conversas, avaliações, rascunhos); só `app_session` muda. | D-S01-7 | H-014 |

Esclarecimentos de desenho (decorrem do já documentado, sem mudar as fontes):

- **Refresh token fora do JavaScript (Q7):** o token de renovação do Supabase fica no servidor ou em cookie HttpOnly gerido pela API; nunca acessível ao navegador (§3 item 1, R4).
- **Criação do usuário no Auth (Q2):** `createUser` e `generateLink` ocorrem só depois de o desafio próprio ser validado (§5, H-011/H-012), nunca no envio do desafio; assim a resposta 202 segue uniforme e nenhuma conta é criada para e-mail arbitrário (RF-039).
- **Caminho:** Caminho 1 como padrão; Caminho 3 como fallback se a prova pendente falhar (§4).

## 9. Situação do spike

**Concluído para desenho (APROVADO_ARQUITETURA).** O desenho de H-011 a H-014 pode prosseguir sobre o Caminho 1.

**Prova pendente, critério de aceite de H-011 e H-012** (executar no projeto de desenvolvimento, com usuários sintéticos removidos ao final, sem imprimir tokens ou segredos): itens da §7 (NÃO VERIFICADO), em particular (a) sessão real por `createUser` + `generateLink` + `verifyOtp`, `exp` e claims com `session_id`; (b) reuso do `token_hash` falha; (c) hook de `sid` e bloqueio 403 em `token_refresh`; (d) `Sb-Forwarded-For` e limites reais de `/verify` e `/token`; (e) revogação por `app_session` e por `signOut`, com janela medida (CA-S01-10 a CA-S01-13); (f) recusa de renovação após `expires_at` (CA-S01-03/04). Se qualquer item crítico falhar, aplicar o Caminho 3 sem mudar a stack. A H-011 e a H-012 só fecham com esta evidência registrada.
