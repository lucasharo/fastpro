# H-037 — Refino: documentos de identidade do profissional

- **Issue:** #50 "[E4] Documentos de identidade" · **Workflow:** WF-03, etapa Product Owner · **Data:** 2026-11-12 · **Papel:** Product Owner · **Status:** refino para consolidação do líder (sem perguntas diretas ao usuário; numeração local `Q-H037-n`, o líder renumera na sequência da sessão)
- **Coluna no quadro:** "Product Owner (1)", linha #50 (verificado em `docs/factory/quadro-status.md`, linhas 90 a 94).
- **Etiquetas:** `[DECIDIDO]` aprovado em documento ou pelo líder · `[VERIFICADO]` conferido no código, migração ou documento nesta leitura · `[PROPOSTA]` sugestão do PO, a validar · `[NÃO VERIFICADO]` sem fonte ou sem execução
- **Rastro:** 14-BACKLOG (H-035, H-037, H-038, H-039, H-040, H-041, H-073; BLQ-DEC; A-1 e A-2 de §7; BK-1); 04-PRD (RF-046, RF-052, RF-148; AMB-33 em RF-046 e §1); 05-CRITERIOS-ACEITE (FA-004, FA-031); 07-AMBIGUIDADES (AMB-33, revisão 6); 08-ARQUITETURA (§5, §10, linhas 180, 364 a 374, 387 a 388, 426); 09-MODELO-DADOS (§3.3 `verification_case` e `identity_document`, §7, §8 linhas 201 e 220, §9 linhas 248 a 262); 11-DECISOES (decisões 31, 33, 34, 35); 11-ARQ-RISCOS-E-TESTES (T-07, I-29, I-15); 88-DESENHO-H026 (quarentena); 102-REFINO-MIDIA-COMPOSICAO (#141); 72-REFINO-H035 (#48, por leitura de trechos); 82-DESENHO-H109 (retenção, RC-01); 57-REFINO-H073 (D-H073-4); 21-ISSUES-CRIADAS (H-037 e H-102).

## 0. Situação e limites desta leitura

- `[VERIFICADO]` #50 está na coluna Product Owner. Sem Issue anterior em Arquitetura para H-037.
- `[VERIFICADO]` Dependências declaradas no backlog para H-037: H-026 (#39), H-016 e S-06. O líder informa que estão concluídas.
- `[VERIFICADO]` **Lacuna de dependência:** a coluna "Dep." de H-037 não cita H-035 (#48), mas o documento precisa de um perfil profissional existente (`professional_profile`, migração `20261111420000_identity_professional_profile_document.sql`). Ver Q-H037-13.
- `[VERIFICADO]` **S-06:** o líder informa que está concluído. A linha de S-06 em 14-BACKLOG ainda diz "Pendente", e 93-DESENHO-H027 §8 registra que a atualização cabe ao Orquestrador. Não li `spikes/S-06-RESULTADO.md`.
- `[VERIFICADO]` **Bucket `identity-docs` não existe nas migrações.** Há só `insert into storage.buckets` para `quarantine` (`20261112120000`) e `request-photos` (`20261112140000`). `identity-docs` aparece apenas no `check` de `retention_policy`/`retention_queue` (`20261111470000`) e na lista fechada `RETENTION_BUCKETS` de `packages/domain/src/retention/types.ts`.
- `[VERIFICADO]` **Não existem** `identity_document` nem `verification_case` em nenhuma migração (busca por nome em `supabase/migrations`). Ambos são do modelo de 09 §3.3 e precisam ser criados por H-037 (documento) e H-039 (caso).
- `[VERIFICADO]` **Detector de tipo não aceita PDF.** `packages/domain/src/media/image-type.ts` (`detectarTipoImagem`, linha 30) reconhece só JPEG, PNG e WebP e recusa PDF, de forma explícita (linha 28). Não existe validador de PDF.
- `[VERIFICADO]` **Redutor acoplado a foto de pedido.** `SupabaseMediaReduceStorage` (`packages/db/src/media-quarantine.ts`, linhas 309 a 391) grava e lê sempre no bucket `MEDIA_REDUCED_BUCKET` (`request-photos`), com chave `p/<uuid>`. O bucket `request-photos` aceita só `image/jpeg` e 750 KB (`20261112140000`). Reaproveitar o redutor sem parametrizar o bucket gravaria documento de identidade no bucket de fotos de pedido, que tem leitura para o pedido. Ver R6.
- `[VERIFICADO]` **Quarentena de H-026 é por rascunho.** `app.media_asset` tem `draft_id` (FK `on delete restrict`) e não tem `owner_type` (`88-DESENHO-H026` §2). O documento de identidade pertence ao profissional autenticado, não a um rascunho. Ver Q-H037-1.
- `[VERIFICADO]` Decisões aplicáveis: **34** (imagem e PDF, até 5 arquivos de 5 MB cada, provisório) e **35** (imagens reduzidas no envio e PDF limitado a 2 MB, provisório; retenção jurídica pendente, L1). A 35 é posterior e mais específica no PDF; ver Q-H037-4.
- `[VERIFICADO]` **BK-1** (14-BACKLOG §7) pergunta sobre os limites e recomenda a opção (b). A decisão 35 adota essa opção, mas o backlog ainda marca H-037 como BLQ-DEC. Ver Q-H037-16.
- `[NÃO VERIFICADO]` Corpo da Issue #50 e comentários no GitHub. Este ambiente não executou `gh`.
- `[NÃO VERIFICADO]` Estado no quadro de #48, #39, #52, #111 (H-102) e #141. Só a linha de #50 foi conferida.
- `[NÃO VERIFICADO]` Se o Storage remoto do Supabase tem o bucket `identity-docs` ou o `quarantine` com os limites (o bucket de quarentena ainda não foi verificado remotamente, por 88 §4).
- `[NÃO VERIFICADO]` Legibilidade de documento reduzido para 1.280 px e 750 KB. S-06 mediu fotos, não documentos.
- `[NÃO VERIFICADO]` Se H-102 (RBAC, #111) está concluída. Ela define o papel "Verificação" e a permissão de tarefa atribuída, usados por H-039.
- Não li por inteiro: `72-REFINO-H035.md` (só trechos), `75-DESENHO-H035.md`, `57-REFINO-H073.md` (só o trecho D-H073-4), `93-DESENHO-H027.md` (só o algoritmo de redução, §4.2 e §4.3), e os arquivos de teste de mídia. Não li `.env.local` e não pesquisei nele.
- Nenhum código foi escrito. Nenhum commit foi feito (sem shell); o líder commita.

## 1. Objetivo

Permitir que o profissional envie, de forma privada, os documentos de identidade que a Verificação usa para decidir o cadastro. Os arquivos ficam em armazenamento privado. Nenhum papel lê o conteúdo nesta história. A leitura pela Verificação, com tarefa atribuída, é de H-039 (#52).

Esta história não aprova ninguém, não cria a fila de decisão e não trata certificação (H-038, #51).

## 2. Escopo

- **E1. Envio de imagem** (JPG, PNG ou WebP) pelo profissional autenticado. O tipo é detectado pelo conteúdo. A imagem é reduzida no navegador antes do envio e reencodada no servidor, e só a versão reduzida é persistida.
- **E2. Envio de PDF** de até 2 MB, validado por conteúdo, sem redução e sem renderização pelo servidor.
- **E3. Limites** de quantidade e tamanho, com recusa antes de qualquer gravação.
- **E4. Armazenamento privado** em bucket `identity-docs` (a criar em migração), sem política de leitura e sem URL de leitura no adaptador.
- **E5. Registro** de cada arquivo em `identity_document` (09 §3.3), ligado ao `professional_profile`, sem nome original, sem caminho exposto e sem tamanho exato na resposta.
- **E6. Auditoria** do recebimento e da recusa, na mesma transação da ação (I-15), sem nome de arquivo e sem conteúdo.
- **E7. Retenção sem prazo.** Os objetos ficam guardados até o parecer da L1. Nenhum job de expurgo é ativado por esta história.
- **E8. Estados de envio** na interface do profissional: vazio, preparando, enviando, recebido, recusado e erro (§6).

## 3. Fora de escopo

- Fila de verificação, decisão, recurso e atribuição de tarefa: H-039 (#52).
- Leitura do documento pela Verificação e acesso excepcional por caso (RF-148): #52 e H-073, com H-102.
- Certificação de atividade regulamentada (anexo e verificação do conteúdo): H-038 (#51), com BLQ-JUR L4.
- Exibição de estado e motivo ao profissional, com recurso: H-041.
- Cadastro do CPF ou CNPJ: H-035 (#48). Ele não é alterado por esta história.
- Prazos, base legal, expurgo, anonimização e exclusão ao encerrar conta: L1 e H-109, H-111.
- Antivírus residente (sem motor gratuito compatível com a hospedagem; SD-12 reduzida).
- Conversão de HEIC (continua recusado) e OCR ou verificação automática de conteúdo do documento.
- Documento de chat: não existe anexo no chat (decisão 33).

## 4. Fluxos

**F1. Envio bem-sucedido de imagem**
1. O profissional autenticado abre a seção "Documentos" do cadastro e escolhe um arquivo (JPG, PNG ou WebP).
2. O navegador confere o tamanho de entrada. Se passar de 5 MB, recusa sem enviar (ver Q-H037-3).
3. O navegador reduz a imagem (mesmas constantes de domínio de H-027, ver Q-H037-6).
4. A API emite uma URL de envio de uso único para a quarentena, com um registro `identity_document` em `pendente_envio` (TTL de 30 min, como H-026).
5. O navegador envia o arquivo reduzido direto ao Storage (a API não recebe os bytes).
6. O navegador chama a confirmação. A API confere o objeto por `stat` (existe e tamanho), lê o conteúdo para validar o tipo, reencoda a imagem e grava a versão reduzida em `identity-docs`. O original na quarentena é removido em seguida.
7. O registro vai para `recebido`. A auditoria é gravada. A tela mostra "Documento recebido".

**F2. Envio de PDF**
Igual a F1, sem a etapa 3 (sem redução) e com validação do cabeçalho `%PDF-` e do tamanho (até 2 MB). O arquivo é gravado byte a byte (CA-17). Ver Q-H037-7 e Q-H037-8.

**F3. Recusa**
Tipo fora da lista, conteúdo que não corresponde ao tipo declarado, tamanho acima do limite, quantidade acima de cinco, ou perfil em estado que não aceita envio (§5, RN-09). Nada é gravado. A quarentena é limpa. A tela mostra o motivo fixo.

**F4. Substituição e exclusão**
O profissional pode enviar outro arquivo enquanto houver vaga (RN-05). Pode excluir um arquivo ainda não analisado (Q-H037-10). O arquivo antigo que já foi analisado não é apagado nesta história: fica como `substituido` ou `retido`, porque o prazo de retenção é L1.

**F5. Expiração do pendente**
Um envio sem confirmação vira órfão após 30 min. O próximo envio libera a vaga. A varredura de órfãos (3 h) remove o objeto (reaproveitando 88 §3).

## 5. Regras de negócio

- **RN-01 (dono).** Só o profissional autenticado, dono do próprio `professional_profile`, envia ou exclui documento. Admin não envia. Outro profissional não vê nem envia para um perfil que não é seu (404 uniforme). `[PROPOSTA]` (RF-046; 08 §5.2)
- **RN-02 (tipo por conteúdo).** Aceitos: JPEG, PNG, WebP e PDF. O tipo vem do conteúdo, nunca do nome, da extensão ou do cabeçalho declarado. HEIC, HEIF, GIF, SVG, HTML, executável e texto são recusados (415). `[DECIDIDO]` tipos (decisão 34); `[PROPOSTA]` detecção de PDF (ausente hoje).
- **RN-03 (imagem).** A imagem é reduzida no envio (decisão 35) e reencodada no servidor. Só a versão reduzida é guardada (princípio da decisão 31 aplicado a documentos, ver Q-H037-6). EXIF, GPS e metadados são removidos por construção (T-07). `[DECIDIDO]` redução no envio; `[PROPOSTA]` só a reduzida.
- **RN-04 (PDF).** Até 2 MB (decisão 35). Não é reduzido, não é renderizado nem convertido no servidor, e é gravado como recebido. A validação mínima é cabeçalho `%PDF-` e tamanho. `[DECIDIDO]` limite; `[PROPOSTA]` validação.
- **RN-05 (quantidade).** Até 5 arquivos vivos por profissional (decisão 34, provisório). Arquivo vivo é o que não está `recusado`, `substituido` nem expurgado. Ao sexto, a API recusa com 422 `limite_documentos`, sem gravar nada. `[DECIDIDO]` 5 (provisório); ver Q-H037-5.
- **RN-06 (armazenamento privado).** Bucket `identity-docs` com `public = false`, `file_size_limit` de 2 MB e `allowed_mime_types` de `image/jpeg` e `application/pdf`. Sem política de leitura para `anon`, `authenticated` nem `service_role` fora da API. Nenhuma URL de leitura no adaptador. `[PROPOSTA]` (mesma postura de `quarantine` e `request-photos`).
- **RN-07 (acesso de leitura).** Nesta história, nenhum papel lê o arquivo. Não há rota `GET` de documento. A leitura pela Verificação com tarefa atribuída é de #52, pela porta interna que esta história define. Acesso excepcional de admin (RF-148) passa por `access_case` (H-073). `[DECIDIDO]` pela decisão 34 e RF-052; a leitura do dono é conflito, ver Q-H037-2.
- **RN-08 (sem prazo).** Nenhum prazo de retenção é ativado. A política `retention_policy` de `identity-docs` fica desligada (`enabled = false`, conforme 82 §Tabelas). Nenhum literal de prazo aparece no código. `[DECIDIDO]` (L1 pendente; nenhum prazo legal inventado).
- **RN-09 (estados que aceitam envio).** `[PROPOSTA]` envio permitido em `pendente`, `em_revisao`, `retida_duplicidade` e `recusada` (reenvio). Negado em `aprovada` e `suspensa` (Q-H037-9). Em qualquer estado, o envio não altera `verification_status`.
- **RN-10 (documento não aprova).** O envio não muda `verification_status` nem o estado do caso (`verification_case`). Quem muda o estado é a Verificação (H-039). `[DECIDIDO]` (FA-004; 09 §6)
- **RN-11 (dados que não são guardados).** Nome original, EXIF, IP, tipo detectado em texto livre e caminho exposto não são gravados em tabela de negócio nem em log. O objeto recebe nome aleatório (uuid, sem extensão). `[PROPOSTA]` (T-11; reaproveita 88 §5)
- **RN-12 (auditoria).** Cada recebimento e cada recusa gera um evento de auditoria na mesma transação, com ator, data, tipo, tamanho e resultado. `[PROPOSTA]` (I-15)
- **RN-13 (cota).** Limite de emissão por profissional e por IP-HMAC, com o mesmo formato de H-026 (12 por hora e 25 por dia por perfil; 40 por hora e 150 por dia por IP). `[PROPOSTA]`; ver Q-H037-19.
- **RN-14 (sem decisão automática sobre conteúdo).** A API não julga se o documento é legível ou verdadeiro. Ilegível ou divergente é decisão da Verificação (H-039). `[PROPOSTA]`
- **RN-15 (teto global).** Teto de documentos vivos no Storage, como o teto de 150 vagas de fotos (H-026). `[PROPOSTA]`; ver Q-H037-20.

## 6. Estados de interface (profissional)

Textos novos sem texto aprovado estão marcados como `[PROPOSTA]` e dependem de Q-H037-17.

| Estado | Quando | Texto e comportamento |
|---|---|---|
| Vazio | Nenhum documento | "Envie seu documento de identidade. Aceitos: foto JPG, PNG ou WebP de até 5 MB, ou PDF de até 2 MB." Botão "Escolher arquivo". |
| Preparando | Reduzindo a imagem | "Preparando seu arquivo..." Indicador de progresso; sem clique duplicado. |
| Enviando | Envio ao Storage | "Enviando documento..." Cancelável. Cancelar libera a vaga no próximo envio (F5). |
| Recebido | Confirmado | "Documento recebido. A equipe de verificação vai analisar." Lista com tipo e data, sem nome original. |
| Recusado (tipo) | 415 | "Este tipo de arquivo não é aceito. Use JPG, PNG, WebP ou PDF." |
| Recusado (tamanho) | 413 ou recusa no navegador | Imagem: "Esta imagem é grande demais. Escolha uma imagem de até 5 MB." PDF: "Este PDF tem mais de 2 MB. Envie um arquivo menor." |
| Limite | 422 `limite_documentos` | "Você já enviou o máximo de 5 documentos." Se houver arquivo excluível, mostra "Excluir" (Q-H037-10). |
| Falha de envio | Rede ou 503 | "Não foi possível enviar. Tente de novo." Repetir usa o mesmo `client_upload_id`. |
| Muitas ações | 429 | "Muitas tentativas. Tente mais tarde." Sem número. |
| Sessão | 401 | "Entre de novo para enviar." |
| Acessibilidade | Todos | Controles por teclado; rótulo em cada campo; anúncio de estado por região `aria-live`; contraste pelo token de design. Teste com leitor de tela é pendente (G-14 de 98, BLQ-JUR L5). `[NÃO VERIFICADO]` |

## 7. Critérios de aceite

Cada critério tem prova. "Local" é execução com `corepack pnpm check:all` ou `db:test`, com contagem e código de saída registrados na Issue.

- **CA-01 Imagem válida recebida.** Dado um profissional autenticado em `pendente` e uma imagem JPG de 4 MB, quando envia e confirma, então o registro vai para `recebido` e o objeto em `identity-docs` tem no máximo 1.280 px de lado e 750 KB. Prova: teste de rota com Storage falso e Storage local (local).
- **CA-02 PDF válido recebido.** Dado um PDF de 2 MB com cabeçalho `%PDF-`, quando envia e confirma, então o registro vai para `recebido` e o objeto é idêntico ao enviado (hash igual). Prova: teste de rota e comparação de hash (local).
- **CA-03 Limite de PDF.** Dado um PDF de 2 MB + 1 byte, quando tenta enviar, então é recusado antes de gravar, com 413, sem linha e sem objeto. Prova: teste de rota (local).
- **CA-04 Tipo por conteúdo.** Dado um GIF, um HEIC, um executável renomeado para `.jpg`, um texto com `Content-Type: image/jpeg` e um arquivo com assinatura falsa de PDF, quando envia, então cada um é recusado com 415 `tipo_nao_aceito`, sem linha e sem objeto. Prova: teste de rota com conjunto de arquivos (local).
- **CA-05 Limite de quantidade.** Dado cinco documentos vivos, quando envia o sexto, então recebe 422 `limite_documentos`, nada é gravado e os cinco anteriores ficam intactos. Prova: teste de rota e SQL (local).
- **CA-06 Ninguém lê.** Dado um arquivo em `identity-docs`, quando `anon`, `authenticated` (inclusive o dono), `service_role` fora da API e um admin sem caso tentam listar, baixar ou assinar leitura, então são negados no Storage local. A API não tem rota `GET` de documento e o adaptador não tem método de leitura. Prova: teste de banco e Storage local, e varredura de rotas (local).
- **CA-07 Bucket privado.** Dado o bucket criado pela migração, quando consultado, então `public = false`, `file_size_limit` é 2 MB e os tipos são somente `image/jpeg` e `application/pdf`. Prova: consulta em `storage.buckets` no banco de desenvolvimento (local). `[NÃO VERIFICADO]` no Storage remoto.
- **CA-08 Sem prazo.** Dado o código da entrega, quando revisado por busca, então não há literal de prazo (dias, meses ou anos) para `identity-docs`, e a política está desligada. Prova: teste de busca, como CA-H109-11 (local).
- **CA-09 Documento não aprova.** Dado um perfil `pendente`, quando um documento é recebido, então `verification_status` e o caso continuam iguais. Prova: teste de banco (local).
- **CA-10 Sem dado sensível em log ou resposta.** Dado um arquivo com sentinelas (nome, GPS falso e IP), quando envia, recusa e falha no Storage, então nenhuma linha de log, nenhum corpo e nenhum cabeçalho contém as sentinelas nem o caminho do objeto. Prova: captura de `console`, `stdout`, `stderr` e respostas (local).
- **CA-11 Pendente expirado.** Dado um envio sem confirmação há mais de 30 min, quando novo envio é emitido, então a vaga é liberada e o órfão é varrido após 3 h. Prova: relógio injetado e varredura com Storage falso (local).
- **CA-12 Dono e negação uniforme.** Dado um profissional B e um perfil A, quando B tenta enviar ou consultar documentos de A, então recebe 404 com corpo e cabeçalhos iguais aos do caso sem cookie. Admin sem perfil não envia. Prova: teste de rota (local).
- **CA-13 Estados que aceitam envio.** Dado um perfil em cada estado de RN-09, quando tenta enviar, então aceita nos estados permitidos e recusa nos demais, sem alterar o estado. Prova: teste de rota e de banco (local). Depende de Q-H037-9.
- **CA-14 Auditoria.** Dado um recebimento ou uma recusa, quando conferido, então existe um evento de auditoria na mesma transação, sem nome e sem conteúdo. Se a auditoria falhar, a ação é desfeita. Prova: teste de banco (local).
- **CA-15 Legibilidade da redução.** Dado um conjunto de documentos sintéticos (dados fictícios, ADR-016), quando reduzidos, então o texto continua legível para inspeção visual registrada pelo QA. `[NÃO VERIFICADO]` até execução; resultado é inspeção, não automático.
- **CA-16 Orçamento de Storage.** Dado o pior caso (cinco PDFs de 2 MB por profissional), quando calculado, então o total por profissional fica em 10 MB e o total do domínio fica dentro do teto de 300 MB de 09 §9, registrado em `external_quota`. Prova: cálculo registrado no QA (documento).
- **CA-17 PDF sem redução.** Dado um PDF válido, quando confirmado, então o objeto gravado tem o mesmo tamanho e o mesmo hash do enviado. Prova: comparação de hash (local). Mesmo teste de CA-02.
- **CA-18 Sem rota de envio para outros papéis.** Dado um admin ou um papel de Verificação, quando tenta enviar em nome de um profissional, então é negado (404 uniforme). Prova: teste de rota (local).
- **CA-19 Sem leitura pela porta de envio.** Dado a porta de envio de H-037, quando exercitada, então ela não expõe leitura. A porta de leitura da Verificação é definida aqui e testada em #52. Prova: teste de contrato (local).
- **CA-20 Interface.** Dado cada estado de §6, quando exibido, então o texto aprovado aparece, os controles funcionam por teclado e o estado é anunciado. Prova: teste de página com DOM simulado (local); leitor de tela `[NÃO VERIFICADO]`.

## 8. Casos de borda

| # | Caso | Comportamento esperado |
|---|---|---|
| B1 | Arquivo `.pdf` com conteúdo JPEG | Aceito como JPEG pelo conteúdo; tipo gravado pelo conteúdo. |
| B2 | PDF com ação embutida (`/JavaScript`, `/Launch`, `/EmbeddedFile`) | Depende de Q-H037-7. Recomendação: recusa. |
| B3 | PDF protegido por senha | Depende de Q-H037-8. Recomendação: recusa, porque a Verificação não consegue ler. |
| B4 | Imagem com dimensões muito grandes (acima de 64 Mpx) | Recusa com 422 `nao_cabe_no_limite`, sem gravar (limite de H-027). |
| B5 | Imagem de 6 MB | 413 `arquivo_grande`; recusa antes de gravar. |
| B6 | Documento reduzido com texto pequeno | Aceito pela API (RN-14). Risco de ilegibilidade; CA-15 e Q-H037-6. |
| B7 | Envio interrompido | Pendente expira em 30 min (F5). Sem efeito na lista. |
| B8 | Substituição com perfil `em_revisao` | Permitido (RN-09). O anterior fica `substituido`, sem exclusão. |
| B9 | Duas abas, mesmo `client_upload_id` | Repetição: um registro, sem vaga nova (CA-11 de H-026). |
| B10 | Armazenamento indisponível | 503 fixo, sem gravar nada. |
| B11 | Perfil `retida_duplicidade` (H-040) | Pode enviar, pois a retenção é para a Verificação decidir. |
| B12 | Cadastro removido ou anonimizado (RC-01) | Fora desta história; expurgo é de H-109. |
| B13 | Limite atingido e todos os cinco recebidos | Mostra "Excluir" só se houver arquivo excluível (Q-H037-10). |
| B14 | Sessão expira no meio do envio | 401; o pendente expira (F5). |

## 9. Dependências

- **Hard, concluídas (líder):** H-026 (#39): padrão de quarentena, TTL, cotas, constantes de mídia e porta de Storage. H-016: sessão do profissional. S-06: medidas de redução (`spikes/S-06-RESULTADO.md`, não lido).
- **Hard, não declarada no backlog:** H-035 (#48). Sem `professional_profile`, o documento não tem dono. `[VERIFICADO]` pela migração `20261111420000`. Estado de #48 `[NÃO VERIFICADO]`. Ver Q-H037-13.
- **Modelo de dono:** H-026 não pode ser reaproveitada como está (ver §1 e R7). Ver Q-H037-1.
- **#141 (composição da mídia na raiz):** `[VERIFICADO]` ainda não feita (102 §2.2: `vercel.ts` não passa mídia; `composicao.ts` não tem campo de mídia). Impacto:
  - **Pode ser feito antes de #141:** domínio (tipos, limites, validação de PDF e de tipo), migração (bucket `identity-docs`, `identity_document`, auditoria), adaptador de Storage com porta sem leitura, serviço e testes com fakes. Nada disso toca `composicao.ts` nem `vercel.ts`.
  - **Depende de #141:** montar a rota de documento na raiz da API (`composicao.ts`, `vercel.ts`) e a prova ponta a ponta em desenvolvimento (CA-01 a CA-05 com servidor real). Os dois trabalhos mexem nos mesmos arquivos de montagem; pela regra de Issues independentes, não podem andar em paralelo nesse ponto.
  - **Conclusão de #50:** não pode terminar sozinha se o aceite exigir envio funcionando em desenvolvimento. Sem #141, #50 pode ser concluída só com a parte de domínio e dados, e a montagem fica como condição explícita. Ver Q-H037-14.
- **#52 (H-039):** depende de H-037. Lê o documento pela porta interna desta história, com tarefa atribuída. #50 prova a negação; #52 prova a leitura positiva (CA-19).
- **H-102 (#111, RBAC):** define o papel de Verificação e a tarefa atribuída. `[NÃO VERIFICADO]` se está concluída.
- **H-109 (retenção) e L1:** mecanismo desligado para `identity-docs`. Nenhuma liberação a profissional real em produção antes do parecer L1 (Q-H037-12).
- **Infra:** migração pelo `npx supabase` no banco de desenvolvimento (não pelo MCP). O bucket é criado pela migração. `[NÃO VERIFICADO]` no Storage remoto.
- **Decisões abertas no backlog:** BK-1 (limites) e BLQ-DEC. Ver Q-H037-16.

## 10. Riscos

| # | Risco | Tratamento |
|---|---|---|
| R1 | **LGPD e L1.** Documento de identidade (classe C3) sem prazo e sem base legal. O objeto fica guardado indefinidamente. | Sem prazo inventado (RN-08). Mecanismo desligado. Produção fechada até L1 (Q-H037-12). Criptografia de objeto em avaliação (Q-H037-11). |
| R2 | **Custo zero e Storage.** O total do Storage gratuito é 1 GB. Pior caso por profissional: 10 MB (cinco PDFs de 2 MB). Pela divisão de 09 §9 (300 MB para documentos), o pior caso cabe em cerca de 30 profissionais; o caso típico (três imagens reduzidas de 0,5 MB e um PDF de 1 MB, ou seja, cerca de 2,5 MB) cabe em cerca de 120. Egress é baixo, porque só a Verificação lê. | Limite de 2 MB no PDF; reduzir imagens (RN-03); teto de vagas vivas (RN-15); limite do bucket (CA-07). Medição real do Storage `[NÃO VERIFICADO]`. |
| R3 | **Bucket não existe.** `identity-docs` não está nas migrações. | Criar por migração com `npx supabase` (CA-07). |
| R4 | **PDF sem antivírus.** O PDF não é renderizado no servidor, mas pode conter ação embutida. | Validação mínima (RN-04), recusa de ação e de senha (Q-H037-7 e Q-H037-8), e leitura apenas pela Verificação, sem exibição inline (#52). Risco residual aceito (08 §10, SD-12 reduzida). |
| R5 | **Legibilidade.** Reduzir para 1.280 px pode tornar o documento ilegível. | CA-15 com inspeção de QA. Se falhar, mudar o alvo (Q-H037-6). |
| R6 | **Redutor acoplado a fotos.** Reaproveitar `SupabaseMediaReduceStorage` sem mudança grava o documento em `request-photos`, bucket de leitura do pedido, e o tipo aceito é só JPEG. | Parametrizar o bucket de destino e o tipo (teste que falha se o destino for `request-photos`). Não reutilizar o caminho `p/<uuid>` sem mudança. |
| R7 | **Modelo de dono.** `media_asset` é por rascunho (`draft_id`, FK restrita, sem `owner_type`). | Q-H037-1. Recomendação: modelo próprio de documento de profissional, sem alterar `media_asset`. |
| R8 | **Conflito sobre quem lê.** 08 §5 e 09 §8 dão leitura ao dono. RF-052, decisão 34 e AMB-33 dizem só Verificação. | Q-H037-2. Até decisão, a recomendação é ninguém lê. |
| R9 | **Limite de PDF divergente.** Decisão 34 (5 MB) e decisão 35 (2 MB) para PDF. | Q-H037-4. A 35 é a posterior e mais específica. |
| R10 | **Sem decisão sobre criptografia de objeto.** 09 §8 marca "Enc de objeto" como [PROPOSTA]. | Q-H037-11. |
| R11 | **Fila sem capacidade.** Documentos acumulam sem Verificação, e a meta de 2 dias úteis não é promessa (H-039). | Fora desta história; registrado para H-039. |

## 11. Perguntas abertas

Todas as perguntas abaixo vão ao líder. Nenhuma foi enviada ao usuário. Numeração local `Q-H037-n`; o líder renumera na sequência da sessão.

- **Q-H037-1 Dono do documento.** O documento pertence ao profissional autenticado, não ao rascunho. Alternativas: (a) modelo próprio de documento de profissional, com quarentena própria e sem alterar `media_asset`; (b) reaproveitar `media_asset` com um campo de dono, o que altera a migração de H-026. **Recomendação: (a).** Destrava CA-01, CA-12 e o desenho da porta.
- **Q-H037-2 Leitura pelo dono.** Alternativas: (a) ninguém lê depois do envio; o profissional vê só o estado e pode excluir enquanto não for analisado; (b) o dono lê a própria cópia por URL curta. **Recomendação: (a)**, porque cumpre "acesso só da Verificação" (decisão 34, RF-052, AMB-33). Pede alteração de 08 §5 e 09 §8, que hoje dão leitura ao dono. Destrava CA-06.
- **Q-H037-3 Tamanho de entrada da imagem.** Alternativas: (a) 5 MB (decisão 34); (b) 10 MB (teto de foto, já medido em S-06). **Recomendação: (a)**, porque a 34 não foi alterada para imagem e a quarentena fica menor. Destrava CA-01 e F1 passo 2.
- **Q-H037-4 Limite do PDF.** Alternativas: (a) 2 MB, como manda a decisão 35, substituindo os 5 MB da 34; (b) 5 MB, como na 34. **Recomendação: (a).** Destrava CA-02 e CA-03.
- **Q-H037-5 Quantidade.** Alternativas: (a) 5 arquivos vivos por profissional (decisão 34); (b) 3 arquivos (opção c de BK-1). **Recomendação: (a)**, com revisão em L1. Destrava CA-05. Confirmar se arquivo substituído conta no limite (recomendação: não).
- **Q-H037-6 Alvo da imagem reduzida.** Alternativas: (a) mesmas constantes das fotos (1.280 px e 750 KB); (b) mais resolução (1.600 px e 1 MB), se o QA reprovar a legibilidade em CA-15. **Recomendação: (a)**, com a inspeção de CA-15 como gate. Se reprovar, a mudança é nova decisão. Destrava CA-01 e CA-15.
- **Q-H037-7 Validação do PDF.** Alternativas: (a) só cabeçalho `%PDF-` e tamanho; (b) (a) mais recusa de ação embutida (`/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`), com risco de falso positivo. **Recomendação: (b)**, com revisão de Reviewer e Architect. Destrava CA-02 e B2.
- **Q-H037-8 PDF protegido por senha.** Alternativas: (a) recusar, porque a Verificação não consegue ler; (b) aceitar sem verificar. **Recomendação: (a).** Destrava B3.
- **Q-H037-9 Estados que aceitam envio.** Alternativas: (a) envio em `pendente`, `em_revisao`, `retida_duplicidade` e `recusada` (reenvio), e negado em `aprovada` e `suspensa`; (b) permitir também em `aprovada` (renovação). **Recomendação: (a).** Destrava CA-13 e RN-09.
- **Q-H037-10 Exclusão pelo profissional.** Alternativas: (a) pode excluir arquivo ainda não analisado (libera a vaga; auditoria); (b) não pode excluir, só substituir. **Recomendação: (a)**, porque evita a vaga presa. Destrava F4 e o estado "Limite".
- **Q-H037-11 Criptografia em repouso.** Alternativas: (a) só bucket privado e acesso por API (mesma postura das fotos, custo zero); (b) criptografia de aplicação por arquivo, com chave em `.env.local` (SD-11 pendente). **Recomendação: (a)**, com risco registrado. Destrava o desenho de armazenamento.
- **Q-H037-12 Produção antes de L1.** Alternativas: (a) a rota de documento fica fechada em produção até o parecer L1 (como 88 §8); (b) abrir em produção com retenção sem prazo. **Recomendação: (a).** Destrava a liberação de #50.
- **Q-H037-13 Dependência de H-035 (#48).** O backlog não lista H-035 em "Dep." de H-037. Alternativas: (a) incluir H-035 e exigir #48 concluída antes de #50; (b) manter como está. **Recomendação: (a)**, e atualizar 14-BACKLOG. Estado de #48 não verificado.
- **Q-H037-14 Ordem com #141.** #141 e #50 mexem em `composicao.ts` e `vercel.ts`. Alternativas: (a) #50 faz domínio, migração, serviço e testes antes e monta a rota depois de #141; (b) #50 espera #141 inteira. **Recomendação: (a)**. Destrava a montagem e a prova ponta a ponta.
- **Q-H037-15 Leitura pela Verificação.** Alternativas: (a) #50 entrega só a negação e a porta interna, e a leitura positiva fica em #52; (b) #50 entrega também a leitura para a Verificação. **Recomendação: (a)**, porque a leitura depende de H-102 e da tarefa atribuída de H-039. Destrava CA-19.
- **Q-H037-16 BK-1 e BLQ-DEC.** A decisão 35 adota a opção (b) de BK-1. Alternativas: (a) considerar BK-1 respondida pela 35 (limites provisórios até L1), e remover BLQ-DEC de H-037 com a correção de A-1 e A-2; (b) manter o bloqueio até confirmação explícita do usuário. **Recomendação: (a)**, sem perder o registro de "provisório". Destrava o início de H-037 pelo quadro.
- **Q-H037-17 Textos da interface.** Aprovar os textos de §6 (marcados `[PROPOSTA]`). **Recomendação: aprovar como estão.** Destrava CA-20 e os casos B3 e B5 de QA.
- **Q-H037-18 Recusa de documento de outra pessoa.** Se o profissional envia documento de terceiro (ex.: da mãe), a API não tem como saber. Alternativas: (a) fora desta história; a Verificação decide (H-039); (b) pedir autodeclaração no envio. **Recomendação: (a)**, com texto de instrução na tela. Destrava o texto de §6.
- **Q-H037-19 Cotas de emissão.** Alternativas: (a) valores de H-026 (12 por hora e 25 por dia por perfil; 40 por hora e 150 por dia por IP); (b) valores próprios para documento. **Recomendação: (a)**, com revisão do Architect. Destrava RN-13.
- **Q-H037-20 Teto global de documentos vivos.** Alternativas: (a) teto fixo como o de fotos (vagas globais), com valor a definir pelo Architect; (b) sem teto global. **Recomendação: (a)**. Destrava RN-15.

## 12. Próximos passos sugeridos (para o líder e o Architect)

1. Líder consolida Q-H037-1 a Q-H037-20 em lista única numerada, com numeração contínua da sessão, e pergunta ao usuário só o que não tiver recomendação aceita. Pelo rascunho, o usuário provavelmente precisa decidir Q-H037-2 (leitura pelo dono), Q-H037-12 (produção antes de L1) e Q-H037-16 (BK-1).
2. Architect faz o desenho do modelo de dono, do bucket, da porta e do redutor parametrizado (Q-H037-1, R6, R7), sem alterar `media_asset` nem o redutor de fotos.
3. Atualizar 14-BACKLOG: dependência de H-035 (se aprovada), AMB-33 respondida pela 34 e 35, e linha de S-06 (ver §0).

## 13. Registro

- **Arquivo:** `D:\projetos\fastpro\docs\factory\106-REFINO-H037.md`
- **Commit:** não commitado (sem shell nesta sessão). O líder faz `git add` e `git commit` com a mensagem indicada.
