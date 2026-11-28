# Desenho H-120 — Dados sintéticos de demonstração

- **Issue:** #129 · **História:** H-120 · **Épico:** E15 · **Papel:** Arquiteto (WF-03) · **Data:** 2026-11-12
- **Entradas:** `84-REFINO-H120.md` (aceito), `11-ARQ-RISCOS-E-TESTES` §1, `18-PLANO-QA` §3.2 (DS-01 a DS-08), `09` §3, migrações em `supabase/migrations`, `packages/db/scripts/catalog-seed.mjs` (H-018).
- **Etiquetas:** `[DECIDIDO]` fonte aprovada; `[VERIFICADO]` conferido no repositório; `[PROPOSTA]` deste desenho; `[NÃO VERIFICADO]` não conferido.

## 0. Achado que muda o escopo de entrega

- `[VERIFICADO]` Nenhuma migração cria `service_request`, `acceptance`, `conversation`, `message` ou `media_asset`; só existem no modelo `09` §3. Hoje existem `app.app_user`, `app.professional_profile`, `app.request_draft`, `app.geocode_point`, `app.service*` (catálogo).
- `[PROPOSTA]` A carga é **em camadas**. Camada 1 (já executável): clientes, profissionais (13 perfis), rascunhos de pedido e coordenadas. Camada 2 (pedidos, aceites, chat, fotos): o script já nasce com o código, mas cada bloco só liga quando a tabela existir (detecção por `to_regclass`; ausente = bloco pulado com aviso). Nenhuma tabela é criada por H-120.
- `[PROPOSTA]` CA-H120-04 passa a valer para as camadas presentes; os blocos pulados ficam listados no relatório e como pendência da história que criar a tabela (publicação, aceite, chat, fotos). O líder precisa decidir sobre isto (dúvida D1).

## 1. Script de carga opt-in

- `[PROPOSTA]` `packages/db/scripts/demo-load.mjs` e `package.json` `db:demo:load` / `db:demo:remove`, no padrão de `catalog-seed.mjs` (`connect()`, `safeError`, nada de valor de conexão impresso). Não entra em `supabase/seed`, nem no reset, nem em `check:all`.
- `[PROPOSTA]` Trava de ambiente, avaliada **antes de abrir transação de escrita** e repetida **dentro** da transação:
  1. `FASTPRO_DEMO_ALLOW=local` explícito (ambiente ou `.env.local`); qualquer outro valor ou ausência = recusa, saída 2, zero escrita.
  2. Host de `DATABASE_URL_MIGRATIONS` precisa ser `127.0.0.1`, `localhost` ou `::1` (porta local do `supabase start`) ou um banco marcado efêmero por `FASTPRO_DEMO_EPHEMERAL=1`. Host `*.supabase.co`/`*.pooler.supabase.com` é recusado sempre, mesmo com a variável (a variável sozinha não basta).
  3. Sem chave nova em `ops.app_config`: a trava usa só os itens 1 e 2, repetidos dentro da transação.
  4. `--dry-run` aplica e desfaz, como H-018. Saída: contagens, nunca valores.
- `[DECIDIDO]` **Nota (decisão 58, 2026-11-12, regra permanente):** o item 2 acima, que recusava qualquer banco não local, foi **substituído** para o banco de desenvolvimento compartilhado do `.env.local`. Agora a trava aceita (a) banco local com `FASTPRO_DEMO_ALLOW=local` ou (b) banco do próprio projeto com `APP_ENV=development` (exato) e ref igual ao de `NEXT_PUBLIC_SUPABASE_URL`, por padrão exato: host `db.<ref>.supabase.co`, ou usuário `postgres.<ref>` em `*.pooler.supabase.com`. Ref só no usuário ou só no host de outro padrão não basta. Qualquer outro parâmetro de URL que não seja `sslmode` é recusado. Sem `--force`. Ver `11-DECISOES.md` (58) e `packages/db/scripts/lib/demo-guard.mjs`.
- `[PROPOSTA]` Catálogo: o script exige `app.service` já carregado por `db:seed:catalog` (H-018) e falha com instrução se estiver vazio. Não cria serviço (D2 do refino).
- `[PROPOSTA]` Conteúdo (quantidades do refino §3):

| Bloco | Como é criado |
|---|---|
| 2 clientes | `insert` direto em `app.app_user` (e-mail `cliente.a@sintetico.test`, `status ativo`); usuário no Auth **local** via API admin do `supabase start`, só para login de demo |
| 8 + 5 profissionais | `app.app_user` + `app.professional_profile` já com o status final (`aprovada` ×8; pendente, em_revisao, retida_duplicidade, recusada, suspensa), `public_name` "Profissional Sintético N", CPF/CNPJ gerado (dígitos válidos, faixa determinística) cifrado com chave de teste |
| Coordenada | uma só, comum a todos os perfis e pedidos da demo, em `app.geocode_point` (`state ok`, `geocode_mode permanent`, dentro da caixa BR do CHECK), endereço "Rua Sintética 000" |
| Rascunhos | `app.request_draft`, `service_id` do catálogo, sem nome/e-mail/telefone |
| Pedidos (6), aceites (2), chat, fotos | camada 2 (§0); aceite com texto fixo "Estou disponível para trabalhar"; chat só texto; 2 pedidos × 3 fotos PNG de cor sólida geradas em memória, sem EXIF/GPS |

- `[VERIFICADO]` O gatilho `professional_profile_guard_update` é `BEFORE UPDATE`: o `insert` com status final não o aciona. Por isso a carga insere o status final em vez de "aprovar" depois (aprovação é de H-039/H-040).
- `[PROPOSTA]` Sem e-mail: a carga não chama `ops.email_outbox`, nem o provedor. Verificado por contagem antes e depois (CA-H120-09).
- `[PROPOSTA]` Eventos de auditoria: a carga **não** grava em `audit.audit_event` (cadeia só de acréscimo, `tg_block_mutation` `[VERIFICADO]`); a evidência da carga é o relatório do script e o registro na Issue. Registrar na cadeia exigiria a remoção deixar rastro permanente (D3).

## 2. Marcador de origem

- `[DECIDIDO]` Refino D5 recomenda identificador fixo, sem alterar o esquema. `[PROPOSTA]` adotada: nenhuma coluna nova.
- `[PROPOSTA]` Três marcas combinadas; uma linha é "de demo" se **qualquer** uma casar, e a carga grava as três onde o esquema permite:
  1. **UUID reservado:** todo `id` de demo = `fa57d120-0000-4000-8000-<12 hex>` (versão 4 válida; prefixo `fa57d120-` reservado só à H-120). `<12 hex>` é determinístico (tabela fixa em `packages/db/scripts/lib/demo-ids.mjs`, ex.: cliente A = `...0000000a01`). Cobre `app_user.id`, `request_draft.id`, `geocode_point.subject_id`, pedidos e filhos.
  2. **E-mail `@sintetico.test`:** em `app.app_user.email` e no Auth local (`.test` é TLD reservado, nunca entrega).
  3. **Caminho de Storage** `demo-h120/<uuid_do_pedido>/<n>.png` nos buckets `request-photos`; nada de demo na raiz.
- `[PROPOSTA]` IDs determinísticos tornam a carga idempotente: `insert ... on conflict (id) do nothing`; segunda execução cria 0 linhas e imprime "já existe". Chaves únicas naturais (`email`, `document_hmac`) também colidem de propósito; conflito com linha **sem** marca (e-mail igual, ou `document_hmac` igual) aborta a carga com erro, sem tocar na linha real.
- `[PROPOSTA]` `FASTPRO_DEMO_NAMESPACE` não existe: o prefixo é constante no código, para não ser trocado por engano.

## 3. Remoção seletiva e reset

- `[PROPOSTA]` `db:demo:remove` aplica a mesma trava do §1, e abre uma transação que apaga **de baixo para cima** (mensagens, conversas, aceites, fotos, pedidos, `geocode_point`, `request_draft`, `professional_profile`, `app_session`/`auth_challenge` dos usuários de demo, `app_user`), sempre com `where id::text like 'fa57d120-%'` (ou `subject_id`/`user_id` equivalentes) **e** nunca por e-mail sozinho.
- `[PROPOSTA]` Antes de apagar, a remoção confere: se algum `app_user` com e-mail fora de `.test` aponta para linha com prefixo (ou o inverso: e-mail `@sintetico.test` sem prefixo), **para** e lista os IDs (marca inconsistente = suspeita de mistura). `--force` não existe.
- `[PROPOSTA]` Storage (local): primeiro lista objetos com prefixo `demo-h120/` pela API do Storage local e os remove; depois confere que a listagem voltou vazia; só então apaga as linhas. Falha na listagem = rollback do banco. Auth local: remove só usuários cujo e-mail termina em `@sintetico.test`.
- `[PROPOSTA]` Idempotente: segunda execução encontra 0 linhas e 0 objetos, imprime zeros e sai 0. A remoção **não** toca `app.service*`, `retention_*`, `audit.*` (RLS forçada: a remoção usa o papel de migrações; `[NÃO VERIFICADO]` se ele ignora RLS local, a ser confirmado no `db:test`).
- `[PROPOSTA]` Reset total: `supabase db reset` (já existente, apaga tudo, inclusive catálogo; recarregar com `db:seed:catalog`). Uso de desenvolvedor; nada novo a construir.

## 4. Riscos

| Risco | Mitigação |
|---|---|
| Dado real vaza para a demo | Gerador determinístico no código; nenhum arquivo/planilha de entrada; revisão de lote RT-07 (CA-H120-10); varredura T-11 com **lista explícita** dos identificadores de demo (D4 do refino), sem liberar o padrão |
| Carga em ambiente errado | Trava dupla (§1, itens 1 e 2), repetida na transação; host remoto recusado mesmo com a variável; sem `--force`; script fora do reset e de `check:all` |
| Dado sintético confundido com real | Três marcas (§2); `public_name`/endereço trazem "Sintético"; remoção recusa estado misto; a camada 2 nunca grava foto com GPS real |
| Chave/senha de demo versionada | Chave de teste do documento e senha do Auth local geradas na execução e gravadas só em `.env.local` ou no console local (decisão 13; T-13) |
| Quebrar contagens de testes | Carga fora do reset; `db:test` usa banco próprio e, se for preciso testar o script, roda em transação desfeita |
| Resíduo permanente (auditoria, Storage) | Sem eventos de auditoria na carga; Storage removido antes das linhas e conferido |
| Esquema muda e a carga quebra | Blocos da camada 2 por `to_regclass`; teste de contagem por camada |

**Nota (decisão 58, 2026-11-12):** a linha "Carga em ambiente errado" acima descreve a trava só-local, substituída para o banco de desenvolvimento do projeto. A trava atual está em `85-DESENHO-H120` §1 (nota) e em `11-DECISOES.md` (58): aceita banco local com `FASTPRO_DEMO_ALLOW=local`, ou o banco de desenvolvimento do projeto (`APP_ENV=development`, ref por padrão exato de host ou de usuário, parâmetros só `sslmode`). Outro host, ambiente ou parâmetro é recusado.

**Concorrência:** não rodar a carga/remoção e o `db:test` ao mesmo tempo no mesmo banco. Uma transação que perde o bloqueio falha com `40P01` (deadlock) e é desfeita, sem dano parcial.

## 5. Testes e critérios verificáveis

`[PROPOSTA]` Em `packages/db/tests/demo.dbtest.mjs` (banco local descartável, `FASTPRO_DEMO_ALLOW=local`) e `packages/db/tests/demo-guard.test.mjs` (sem banco), executados em `corepack pnpm check:all`:

| Critério do refino | Verificação |
|---|---|
| CA-01 | varredura T-11 sobre as linhas marcadas: 0 e-mail fora de `.test`; 0 CPF/CNPJ/telefone fora da lista de demo |
| CA-02 | `select` das linhas marcadas: todo e-mail termina em `@sintetico.test`, `public_name` contém "Sintético" |
| CA-03 | `demo-guard.test.mjs`: variável ausente, valor errado, host remoto com variável certa → saída ≠ 0 e contagem de linhas inalterada (unitário no guard + teste de integração) |
| CA-04 | banco vazio + catálogo: contagens por camada presente; saída 0 |
| CA-05 | segunda execução: contagens iguais, 0 duplicatas |
| CA-06 | insere uma linha sem prefixo; após `remove`, só ela resta |
| CA-07 | `remove` ×2; listagem de Storage com prefixo `demo-h120/` vazia; segunda sem erro |
| CA-08 | `check-secrets` sem achado |
| CA-09 | `ops.email_outbox` com a mesma contagem antes e depois |
| CA-10 | revisão manual de lote RT-07, registrada na Issue |
| extra | `FASTPRO_DEMO_ALLOW` ausente na `check:all` e no CI; `rg "fa57d120" supabase/migrations` = 0 (prefixo nunca entra em migração) |

## 6. Dúvidas não bloqueantes (com recomendação)

- **D1 (camada 2):** pedidos, aceites, chat e fotos dependem de tabelas ainda inexistentes (§0). **Recomendação:** entregar a camada 1 agora e deixar os blocos da camada 2 desligados por `to_regclass`, reabrindo H-120 (ou criando história pequena) quando a publicação, o aceite e as fotos forem migrados. Alternativa: adiar H-120 inteira.
- **D2 (trava):** aceitar `FASTPRO_DEMO_EPHEMERAL=1` para banco efêmero remoto? **Recomendação:** sim, mas só host local no MVP; efêmero remoto exige nova decisão.
- **D3 (auditoria):** registrar carga/remoção na cadeia de auditoria? **Recomendação:** não (linha permanente de dado sintético); registrar na Issue.
- **D4 (login da demo):** senha dos usuários de demo no Auth local. **Recomendação:** aleatória por carga, impressa uma vez no console local, nunca versionada.
- **D5 (RLS na remoção):** confirmar no `db:test` que o papel de migrações local apaga com RLS forçada. **Recomendação:** o primeiro teste da remoção prova isso; se falhar, usar `SET LOCAL row_security = off` no papel dono, não funções `security definer` novas.

## 7. Decisões do líder sobre a camada 2 (Issue #129, commit d7f5b31)

Registradas após a revisão que aprovou a entrega para QA com ressalva.

- **Pedidos:** 6 pedidos, todos `publicado`. Os estados `selecionado`, `concluído` e `cancelado` ficam como **pendência**: exigem linhas de seleção, conclusão ou cancelamento que não fazem parte desta carga.
- **Mensagens de sistema:** 2 (uma por aceite), conforme o modelo 09 §3.7, que gera uma mensagem de sistema por aceite. O refino falava em "uma"; prevalece o modelo.
- **Fotos no Storage:** saem de H-120 e viram **história própria**. O cliente de Storage (`criarStorageDemo`) está testado, mas não ligado, porque ler a chave de serviço fora de módulo permitido reprova `scripts/check-secrets`.
- **Colunas da camada 2:** validar contra as migrações quando chegarem (`app.service_request`, `app.acceptance`, `app.conversation`, `app.message`, `app.media_asset`). Pontos a confirmar: `identity_id` nulo no aceite; formato de `address_text_enc`; gatilhos de DELETE em aceite e mensagem, que podem bloquear a remoção (a transação desfaz, falha segura).
- **Enquanto as tabelas não existirem:** os blocos da camada 2 ficam pulados com aviso, e o CA-H120-04 da camada 2 não se aplica a nenhum banco.

### 7.1 Retorno do QA (Issue #129): varredura T-11 e telefone

Decisões registradas conforme instrução do coordenador ao devolver a #129 ao desenvolvimento. Confirmar pelo líder.

- **Varredura T-11 (CA-01), implementada em `packages/db/scripts/lib/demo-sweep.mjs`:** roda sobre o conjunto gerado em memória (clientes, profissionais, endereço, textos fixos, mensagens, caminhos de foto e os documentos de demo em dígitos e formatados), sem banco e sem rede. Regras: e-mail só com domínio `.test`; CPF e CNPJ só nas exceções exatas de demo (um CPF por profissional, 84 §8 D4), sem liberar o padrão; telefone sem exceção. Achados trazem tipo e origem, nunca o valor. Teste `T-H120-16` em `demo-layer2.test.mjs` falha se CPF fora da lista, e-mail real ou telefone real aparecer.
- **Limite conhecido da varredura:** os textos fixos da camada 1 (descrição do rascunho e nome público) ficam como literais em `demo-load.mjs`, fora do conjunto varrido. Os da camada 2 foram movidos para `TEXTOS_CAMADA2` e entram na varredura. Mover os da camada 1 exige tocar código já aprovado; fica para decisão.
- **Telefone (84 §3), desvio:** a demo não grava telefone em nenhuma tabela das camadas 1 e 2, então o item "faixa claramente fictícia" não tem efeito prático. Exceções de telefone: nenhuma. Alternativa, se o líder quiser telefone de demo: faixa de DDD inexistente (ex.: `00`), que é claramente fictícia e não casa com número real. Recomendação do DEV: manter sem telefone nesta história.
- **Pendências que não bloqueiam esta rodada:** verificação contra o banco (dry-run local, CA-H120-04 da camada 2) e Storage (fotos), ambos registrados em §7.
