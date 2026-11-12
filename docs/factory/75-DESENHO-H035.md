# H-035 — Desenho: cadastro profissional com CPF/CNPJ cifrado

- **Issue:** #48 · **Etapa:** Arquitetura (WF-03) · **Data:** 2026-11-11 · **Entrada:** `72-REFINO-H035.md` (CA-01 a CA-13, dúvidas 1 a 7 aceitas).
- **Fontes conferidas:** `09 §3.3, §7`; `10-ADRS.md` (SD-11); `.env.example`; migração `20261111400000_identity_create_professional_account.sql`; `packages/db/src/challenges-crypto.ts`; `apps/api/src/professional-route.ts`; `packages/domain/src/identity/session.ts`.
- **Etiquetas:** [DECIDIDO] · [VERIFICADO] conferido no código ou documento · [PROPOSTA] · [NÃO VERIFICADO].

## 0. Estado real do código

- [VERIFICADO] `app.professional_profile` existe (H-016) só com `user_id`, `verification_status` (6 valores, default `pendente`), `verified_at`, `suspended_at`, `suspension_reason`, `created_at`, `updated_at`. RLS forçada, sem políticas, `grant select, insert` só a `app_system`. Faltam `public_name`, `slug`, `document_type`, `document_enc`, `document_hmac`, `identity_id` (09 §3.3).
- [VERIFICADO] Não existe tabela `verification_case` em nenhuma migração. O refino a cita como [PROPOSTA]; **este desenho não a cria** (pertence à fila de H-039). O estado de H-035 fica em `professional_profile.verification_status`. [PROPOSTA]
- [VERIFICADO] `.env.example` já lista `DOCUMENT_HMAC_KEY`, `DATA_ENC_KEY_V1` e `DATA_ENC_KEY_ACTIVE_VERSION` (só nomes). [NÃO VERIFICADO] se existem no `.env.local`.
- [VERIFICADO] Padrão de cifra reutilizável: AES-256-GCM, `versão(1)|nonce(12)|tag(16)|texto`, com AAD, em `challenges-crypto.ts` (chave própria `AUTH_CHALLENGE_KEY`, não reutilizar).
- [VERIFICADO] Sessão: cookie `__Host-fp_sess`, `SessionRepositoryPort.authenticate(hash, nowMs)` devolve `userId`; rotas validam Origin/Sec-Fetch-Site antes do corpo (`session-route.ts`).

## 1. Campos, validação, cifra e comparação

**Colunas novas** (migração nova, idempotente, com rollback em `supabase/rollbacks/`; numeração posterior a `20261111410000`) em `app.professional_profile`: [PROPOSTA]

| Coluna | Tipo | Regra |
|---|---|---|
| `public_name` | text, null até o cadastro | 2 a 80 caracteres após trim [PROPOSTA]; sem nome do Auth |
| `slug` | text | único (índice único parcial onde não nulo); gerado do nome, sufixo curto aleatório em colisão |
| `document_type` | text | CHECK `CPF`/`CNPJ` |
| `document_enc` | bytea | blob versionado (abaixo) |
| `document_hmac` | text (hex) | HMAC-SHA-256 do documento normalizado |
| `identity_id` | uuid | **não criar nesta história.** 09 diz "= `document_hmac` resolvido"; só H-039/H-040 definem a resolução. [PROPOSTA] |

- Colunas nulas porque perfis de H-016 já existem sem documento. CHECK: `document_type`, `document_enc` e `document_hmac` todos nulos ou todos preenchidos.
- **Unicidade entre não recusados:** índice único parcial em `document_hmac where verification_status <> 'recusada' and document_hmac is not null`. [PROPOSTA] Conflito: o perfil retido por duplicidade (R2) **também** tem o mesmo `document_hmac` e não é `recusada`; o índice rejeitaria a gravação. Solução: perfil em `retida_duplicidade` **não entra** no índice (`where verification_status not in ('recusada','retida_duplicidade')`). Então a unicidade vale entre `pendente`, `em_revisao`, `aprovada` e `suspensa`. H-039 deve manter essa invariante ao tirar um perfil da retenção. [PROPOSTA]
- **Validação (domínio puro, `packages/domain/src/identity/professional-document.ts`):** remove máscara (`.`, `-`, `/`, espaços); exige só dígitos; CPF com 11 e CNPJ com 14; rejeita sequências repetidas (ex.: 11111111111); confere os dois dígitos verificadores. [PROPOSTA] CNPJ alfanumérico (norma de 2026) fica fora: [NÃO VERIFICADO] se vale hoje; ver dúvida D2.
- **HMAC:** `HMAC-SHA-256(DOCUMENT_HMAC_KEY, "doc1|" + tipo + "|" + dígitos)`. Chave de 32 bytes em base64, distinta da de cifra. Tipo entra na mensagem para CPF e CNPJ nunca colidirem. [PROPOSTA] A comparação é feita pelo banco, por igualdade de texto (hex), sem comparar o número em memória.
- **Cifra (`document_enc`):** AES-256-GCM, formato `versão_da_chave(1)|nonce(12)|tag(16)|texto`; AAD = `doc1|<user_id>|document_enc` (amarra o blob ao dono). Chave escolhida por `DATA_ENC_KEY_ACTIVE_VERSION` entre `DATA_ENC_KEY_V<n>`; a versão vai no primeiro byte, o que permite rotação sem reescrever tudo. [PROPOSTA] Reaproveitar a lógica de `challenges-crypto.ts` por extração, sem copiar a chave.
- **Decifragem:** nenhuma rota de H-035 decifra. O número completo só é lido por H-039, com `sensitive_access_log` (09 §7). [DECIDIDO]
- **Exibição:** a resposta traz `document_type` e os 2 últimos dígitos (`***.***.***-09`), calculados no momento do cadastro e **não armazenados**; a leitura posterior devolve só o tipo. Para evitar guardar a máscara, o GET não mostra os dígitos. [PROPOSTA] (dúvida 2 aceita com ajuste: ver D1)

## 2. Fluxo de cadastro do documento

1. Rota recebe sessão de profissional com `email_verified_at` preenchido [PROPOSTA: ver D3] e perfil sem documento.
2. Domínio normaliza e valida; erro devolve 422 por campo, sem eco do valor.
3. Calcula HMAC e cifra **na API**; o SQL nunca recebe o número em claro. O segredo não vai ao banco.
4. Função `private.professional_profile_set_document(p_user_id, p_public_name, p_slug, p_type, p_enc, p_hmac, p_now)`, sem `security definer`, mesma postura de H-016 (execução só por `app_system`), em uma transação: [PROPOSTA]
   - trava a linha do perfil (`for update`); se já tem documento, devolve `ja_cadastrado` (idempotência do envio duplo, CA-11);
   - procura outro perfil com o mesmo `document_hmac` fora de `recusada`;
   - se não existe: grava e mantém `pendente` → resultado `pendente`;
   - se existe: grava com `verification_status = 'retida_duplicidade'`, `suspension_reason` **não** usado; o motivo vai a evento de auditoria `professional.document_duplicate` com o `user_id` do novo e do existente (o evento é interno, nunca devolvido). [PROPOSTA] Verificar se o tipo de evento existe no catálogo de `20261110140000`; hoje só há `professional.suspended` [VERIFICADO], então a migração acrescenta o tipo.
   - corrida: dois cadastros simultâneos do mesmo documento. O índice parcial garante que só um fica ativo; quem perde pega violação `23505`, e a função repete a checagem e grava como retido. [PROPOSTA]
5. Resposta: sucesso e duplicidade devolvem o **mesmo corpo e status** (R3, dúvida 1 aceita): `201 {"status":"received","verification":"pending"}` (a máscara dos 2 últimos dígitos entra igual nos dois casos). O profissional vê "Recebemos seu cadastro; vamos analisar" nos dois casos. Estado interno `retida_duplicidade` nunca aparece na resposta. [PROPOSTA]
6. Tempo: aplicar o piso de tempo de `PROFESSIONAL_RESPONSE_FLOOR_MS` (400 ms), igual a H-016, para o caminho de duplicidade não ser mais lento. [VERIFICADO] o mecanismo existe.

Transições (09 §4): H-035 só cria `pendente` ou `retida_duplicidade`. Nada de `em_revisao`, `aprovada`, `recusada`. [DECIDIDO]
**Decisão 54 (revisão da #48, substitui a versão anterior deste ponto):** `app_api` não recebe `update` em `verification_status`. `app_system` recebe `update` **por coluna** só em `public_name`, `slug`, `document_type`, `document_enc`, `document_hmac`, `verification_status` e `updated_at`. Um gatilho `BEFORE UPDATE` em `app.professional_profile` (1) torna os campos do documento write-once depois de gravados e (2) aceita mudança de `verification_status` só no primeiro cadastro: de `pendente` para `pendente` ou `retida_duplicidade`, com `document_hmac` preenchido na mesma atualização. Qualquer outra mudança de status é recusada, inclusive para `aprovada`, `em_revisao`, `recusada` e `suspensa`. A função `private.professional_profile_set_document` não usa `security definer`; ela trata `23505` do índice de HMAC repetindo a checagem e gravando como retida; colisão de slug é re-lançada. [DECIDIDO] (11-DECISOES.md, decisão 54)

## 3. Contratos de rota

Todas em `apps/api`, no estilo de `professional-route.ts` (JSON, teto de 4 KB, `no-store`, validação de Origin, só `application/json`). [PROPOSTA]

| Rota | Entrada | Saída |
|---|---|---|
| `PUT /v1/professional/profile` | `{publicName, documentType: "CPF"|"CNPJ", document: string}` | `201 {status:"received", verification:"pending"}`; reenvio idêntico `200` mesmo corpo; `422 {code:"invalid_field", fields:[{field, reason}]}`; `401 {code:"nao_autenticado"}`; `403` sem e-mail verificado; `429` |
| `GET /v1/professional/profile` | sessão | `200 {publicName, slug, documentType, verification:"pending"|"approved"|...}`; sem `document_enc`, sem `document_hmac`, sem número |

- `verification` público: `retida_duplicidade` e `em_revisao` aparecem como `pending`; `recusada` e `suspensa` seguem o fluxo de H-040. [PROPOSTA]
- `PUT` por idempotência natural (CA-11). Sem outros parâmetros de rota: o `user_id` vem só da sessão (CA-10).
- Limite de taxa por usuário e por IP (HMAC), reaproveitando a porta de limites de H-016: sugestão de 10 tentativas por hora por usuário. [PROPOSTA]
- `422` nunca devolve o valor enviado nem o motivo "já existe".

## 4. Riscos

| Risco | Tratamento |
|---|---|
| Vazamento em log, erro ou e-mail (R-01, T-11) | O número fica em variável local curta; nenhum `console`/log do corpo; handler de erro devolve códigos fixos; teste de varredura. |
| Enumeração por duplicidade (R3) | Mesmo corpo, status e tempo nos dois casos (§2); `422` sem "já existe"; limite de taxa. Resíduo: quem consegue ver o próprio `verification` por muito tempo em `pending` pode inferir; aceito e mitigado pelo prazo de H-040. |
| Reversão do HMAC | CPF tem ~10^9 combinações; com a chave `DOCUMENT_HMAC_KEY` do servidor, a força bruta offline só existe se a chave vazar. Chave fora do banco e do repo, distinta de `DATA_ENC_KEY_*`. |
| Chave de cifra perdida ou vazada | Perda = documentos ilegíveis (backup de chave separado do banco, 09 §7). Vazamento: rotação por nova versão; `document_hmac` só muda com nova chave HMAC (reprocessar exige decifrar). [NÃO VERIFICADO] plano de rotação do HMAC: ver D4. |
| Origem das chaves em produção | SD-11 pendente (jurídico). Em desenvolvimento, `.env.local`. [DECIDIDO] decisão 13 |
| Falso positivo de duplicidade (R-26) | Retenção reversível por H-040, sem bloqueio definitivo (RF-049). |
| Dois perfis do mesmo titular com CPF e CNPJ | Aceito, dúvida 5. |
| Autoaprovação | `app_system` só altera `verification_status` no primeiro cadastro, por gatilho no banco (decisão 54); aprovação e recusa ficam para a função própria de H-039, fora desta história. Testes estáticos na migração e cenários descritos em `identity-professional-profile-document.dbtest.mjs` (não executados). |

## 5. Testes e critérios verificáveis

Local, com `corepack pnpm check:all` e `db:test` (regra da fábrica). Evidência = comando, contagem e código de saída na Issue.

- **Domínio (unit):** CPF/CNPJ válidos com e sem máscara (CA-01, CA-02, CA-04); tamanho errado, dígito errado, sequência repetida, letras (CA-03).
- **Cripto (unit):** `document_enc` não contém o número nem os dígitos em ASCII e o primeiro byte é a versão (CA-08); ida e volta com AAD correto; AAD de outro `user_id` falha; chave inativa/ausente dá erro de configuração sem valor; outro segredo gera outro HMAC (CA-09); tipo diferente gera HMAC diferente.
- **Banco (`db:test`, migração):** colunas e CHECKs; índice parcial; duplicidade entre `pendente` e `aprovada` gera `retida_duplicidade` (CA-05); `recusada` não conta (CA-06); corrida de dois cadastros resulta em um ativo e um retido; segundo envio devolve `ja_cadastrado` (CA-11); `app_api`/`service_role`/`anon` sem acesso (CA-10); rollback restaura.
- **API (integração):** corpos idênticos (e tempo dentro do piso) entre sucesso e duplicidade (CA-05, R3); 401 sem sessão; 403 sem e-mail verificado; `GET` sem campos sensíveis (CA-10); Origin inválido; corpo acima do teto.
- **T-11:** teste que roda o cadastro e varre logs capturados, respostas, mensagens de erro e linhas das tabelas pelo CPF de teste (cru e só dígitos); deve achar zero (CA-07).
- **Tela (CA-12, CA-13):** formulário com rótulos, erro por campo (`aria-describedby`), envio por teclado, campos mantidos em erro de rede. Escopo de `apps/web`; contrato da API acima.
- **Critério de saída:** todos os testes acima verdes localmente; migração aplicada e revertida em banco de teste; nenhuma chave real no repo (`git grep` dos nomes sem valores).

## 6. Dúvidas não bloqueantes (com recomendação)

- **D1.** Máscara com 2 últimos dígitos só na resposta do `PUT`, não armazenada (alternativa: não mostrar nenhum dígito). **Recomendo** mostrar na resposta do `PUT` e omitir nas leituras. Nota: na duplicidade, o eco dos dígitos não revela nada além do que o próprio profissional digitou.
- **D2.** CNPJ alfanumérico: aceitar só numérico agora. **Recomendo** só numérico; revisar quando houver orientação oficial verificada.
- **D3.** E-mail verificado antes de cadastrar documento. **Recomendo** exigir (menos cadastros falsos), mesmo que o refino só exija sessão.
- **D4.** Rotação da chave do HMAC: sem plano agora; trocar a chave exige decifrar e recalcular todos os perfis. **Recomendo** deixar para SD-11 e registrar que `DOCUMENT_HMAC_KEY` não muda após o lançamento sem migração dedicada.
- **D5.** `verification_case` inicial: **Recomendo** não criar em H-035; H-039 cria o caso a partir de `pendente`/`retida_duplicidade`.
- **D6.** Nome de evento de auditoria `professional.document_duplicate` e a sua publicação: **Recomendo** aprovar; sem PII, só ids.
- **D7.** Limite de 80 caracteres do nome público e sufixo do slug: **Recomendo** aceitar.
