# H-027 — Refino: redução e reencode das fotos

- **Issue:** #40 "[E3] Redução e reencode das fotos" · **Backlog:** H-027 · **Dependências:** H-026 (#39), S-06 (#11), S-09 (#8, condição de DEV)
- **Etapa:** specification · **Data:** 2026-11-12 · **Papel:** Product Owner · **Status:** refino para validação do líder
- **Etiquetas:** `[DECIDIDO]` aprovado nos documentos (PRD, decisões, critérios) · `[VERIFICADO]` conferido em documento de arquitetura, QA, backlog ou resultado de spike, sem decisão de produto · `[PROPOSTA]` sugestão do PO ou valor de spike ainda não adotado, a validar · `[NÃO VERIFICADO]` sem fonte ou depende de medição não feita
- **Fontes lidas:** 14-BACKLOG (H-027, H-028, H-029, H-056, S-06, S-09, BLQ-SPK); 16-MANIFESTO-ISSUES e 21-ISSUES-CRIADAS (H-027 = #40, H-028 = #41); 04-PRD (RF-025, RF-027); 05-CRITERIOS-ACEITE (FA-001, FA-007); 11-DECISOES (decisões 30 a 33; I-29); 11-ARQ-RISCOS-E-TESTES (R-11, R-25, R-31, F-09, F-11, T-07, P-03, P-04, P-06, Q-08, Q-12); 08-ARQUITETURA §10.1 a §10.4; 09 (`media_asset`); 10-ADRS (ADR-009, ADR-018); 88-DESENHO-H026 (§1, §2, §3, §8, §10); 87-REFINO-H026 (padrão deste documento); spikes/S-06-RESULTADO.md; spikes/S-09-RESULTADO.md e 41-DECISAO-S09-CAMINHO.md (condição do `sharp`).

## 1. Objetivo

Transformar a foto que está em quarentena (H-026) em uma versão reduzida pronta para uso: no máximo 1.280 px no maior lado, cerca de 0,5 MB e nunca acima do teto técnico. Só essa versão é guardada; o original sai da quarentena; a foto passa a `ready`. `[DECIDIDO]` RF-025, decisão 31, I-29; teto 0,75 MB `[PROPOSTA]` (08 §10.2 (3), S-06 §4.1).

Esta história não remove EXIF como item próprio, não valida o tipo pelo conteúdo e não cria leitura da foto. Esses itens são de H-028 (#41), ver §5.

## 2. Situação de partida

- A H-026 entrega o registro `pending` com `confirmed_at`, o original na quarentena e nenhuma leitura. Hoje nada grava `ready`. `[VERIFICADO]` 88 §0 e §2.
- A `finalize` de H-026 "nunca grava `ready` e nunca copia ou lê o objeto" (CA-09). Quem faz essa passagem é esta história. `[VERIFICADO]` 88 §1.
- Medição local do reencode (S-06, 2026-11-10; Windows, 12 núcleos, não é a Vercel): 21 de 21 imagens sintéticas couberam em 0,48 MB ou menos, inclusive ruído branco; pico de memória de até 111 MB por processo; mediana de 459 ms com 1 thread. A rotação do EXIF foi aplicada e a saída saiu sem metadados gravados. `[VERIFICADO]` spikes/S-06-RESULTADO.md §3 e §4.
- Não medido em S-06: HEIC, WebP com foto real, Linux da Vercel, limite real de 1 vCPU e 2 GB, redução no navegador, perfil Display P3. `[NÃO VERIFICADO]`

## 3. Estados do arquivo nesta história

| De | Para | Gatilho | Marcação |
|---|---|---|---|
| `pending` com `confirmed_at` | `ready` | Reencode concluído e versão reduzida gravada no bucket final | `[VERIFICADO]` 08 §10.2 (4); gatilho `[PROPOSTA]` (D-H027-3) |
| `pending` com `confirmed_at` | `rejected` | Recusa definitiva (ver CA-04) | `[PROPOSTA]` (D-H027-7); `rejected` existe em 08 §10.2 (4) |
| `pending` com `confirmed_at` | igual | Falha transitória; nova tentativa pelo mesmo `finalize` | `[VERIFICADO]` F-11 |
| `ready` | `ready` | `finalize` repetido | `[VERIFICADO]` 08 §10.2 (2) |

## 4. Critérios de aceite (Given/When/Then)

- **CA-01 Tamanho e dimensão.** Dado uma foto JPG, PNG ou WebP confirmada de até 10 MB, quando o reencode termina, então a versão guardada tem maior lado de no máximo 1.280 px (sem ampliar foto menor), tamanho de cerca de 0,5 MB e nunca acima de 0,75 MB. `[DECIDIDO]` RF-025, decisão 31; teto `[PROPOSTA]` (D-H027-5).
- **CA-02 Só a versão reduzida persiste.** Dado uma foto reduzida com sucesso, quando o armazenamento é inspecionado, então existe um único objeto reduzido no bucket final, com nome aleatório e sem nome original, e o original da quarentena foi removido. Nenhum original ou *master* fica guardado. `[DECIDIDO]` I-29, 08 §10.1 e §10.2 (3); remoção imediata `[PROPOSTA]` (D-H027-4).
- **CA-03 Estado `ready` só com objeto pronto.** Dado uma foto reduzida, quando o registro passa a `ready`, então o objeto reduzido já existe no bucket final e o registro aponta para ele. Nunca há `ready` sem objeto nem objeto sem registro. `[VERIFICADO]` 08 §10.2 (4); `[PROPOSTA]` a ordem de gravação.
- **CA-04 Recusa definitiva.** Dado um arquivo que não se decodifica como imagem JPG, PNG ou WebP, ou cuja área excede o limite de 64 milhões de pixels, ou que não cabe no teto mesmo no menor nível de qualidade, quando o reencode termina, então a foto vai a `rejected`, o original é removido, nenhum objeto reduzido fica no bucket final, o visitante recebe mensagem sem caminho interno e a vaga do rascunho é liberada. `[DECIDIDO]` backlog H-027 ("se não couber, recusa com mensagem"); limite de 64 MP e a recusa de imagem-bomba `[VERIFICADO]` S-06 §3.4; liberação da vaga `[VERIFICADO]` 88 §1 (`rejected` não conta no limite).
- **CA-05 Falha transitória não rejeita nem deixa meio estado.** Dado tempo esgotado, falta de memória ou erro do armazenamento durante o reencode, quando isso ocorre, então a foto não vira `rejected`, não fica objeto reduzido sem registro nem registro `ready` sem objeto, o original permanece até a nova tentativa, e um novo `finalize` com a mesma chave completa o processo sem criar segunda versão. `[VERIFICADO]` F-11, F-09; gatilho da nova tentativa `[PROPOSTA]` (D-H027-3).
- **CA-06 Repetição não reprocessa.** Dado uma foto já `ready`, quando o `finalize` chega de novo, então responde o mesmo resultado, não refaz o reencode e não cria outra versão reduzida. `[VERIFICADO]` 08 §10.2 (2); 88 §1 (CA-04 de H-026).
- **CA-07 Limites de processamento.** Dado várias fotos ao mesmo tempo na mesma instância, quando são reduzidas, então cada processamento trata um arquivo por vez, com no máximo 4 processamentos simultâneos por instância, memória-alvo de 512 MB e duração máxima configurada de 10 s por foto. `[PROPOSTA]` S-06 §4.3; `[VERIFICADO]` R-11 (um ativo por invocação).
- **CA-08 Orientação correta.** Dado uma foto com orientação de câmera girada, quando reduzida, então a versão guardada sai na orientação real e as dimensões de CA-01 valem para o lado correto. `[VERIFICADO]` S-06 §3.1 (orientação 6 aplicada); fronteira com H-028 em D-H027-1.
- **CA-09 Saída sem metadado de entrada.** Dado uma foto de entrada com EXIF e GPS, quando a versão reduzida é gerada, então ela não copia metadados da entrada (EXIF, XMP, GPS). A prova dedicada e a checagem de tipo ficam em H-028. `[VERIFICADO]` S-06 §3.5 (medido por `exif-reader`, `sharp` e varredura de marcadores, sem ExifTool); prova formal em #41.
- **CA-10 Sem dado pessoal em log ou resposta.** Dado qualquer reencode, quando grava log ou responde, então não aparecem nome original, EXIF, IP, caminho interno ou endereço de upload. Os registros são contagens por código de resultado. `[VERIFICADO]` 08 §10.3, T-11; mesma regra de 88 §5.
- **CA-11 Sem leitura nova.** Dado uma foto em `ready`, quando alguém tenta obter link ou acessar o objeto, então não consegue por esta história: não há rota de leitura, nem política de Storage, nem URL de download. Visualização é de H-056 e H-029. `[VERIFICADO]` 88 §4 e CA-08 de H-026; 08 §10.3.
- **CA-12 Redução no navegador.** Dado um navegador que consegue reduzir a foto antes do envio, quando o visitante escolhe a foto, então ela é reduzida no navegador antes de pedir a URL de envio, e o tamanho declarado é o da versão reduzida; o servidor reencoda do mesmo jeito. `[DECIDIDO]` backlog H-027 ("redução no envio (navegador)"); a ordem e o fallback são `[PROPOSTA]` (D-H027-6).
- **CA-13 Registro mínimo.** Dado a versão reduzida gravada, quando o registro é atualizado, então guarda só o necessário: referência da versão reduzida, tamanho final e dimensões finais. Sem nome, caminho do original, EXIF ou IP. `[PROPOSTA]` (detalhe de colunas com o Architect); base `[VERIFICADO]` 88 §2 (sem colunas de original ou nome).

## 5. Fora de escopo

- Remoção de EXIF e GPS como item próprio, prova formal de metadados e checagem do tipo pelo conteúdo, com recusa de arquivo falso: H-028 (#41). `[DECIDIDO]` backlog e decisão 31; ver D-H027-1 para a fronteira.
- Conversão de HEIC: continua recusada com 415 nesta história (D-H026-3); ver D-H027-2.
- Pré-visualização, exclusão e reordenação de fotos: H-029 (#42).
- Marca d'água e entrega a profissionais, URL de 60 s, limite de visualização: H-056 e H-057.
- Vínculo das fotos ao pedido publicado: H-030 e H-031.
- Job de expurgo agendado e o tick: H-110 e H-008 (cron gratuito limitado a 1 vez por dia; ver D-H027-3).
- Liberação para visitantes reais: segue a condição de 88 §8, decidida pelo líder; esta história não abre o fluxo.
- Documentos de identidade: H-037.

## 6. Dependências e condições antes do Desenvolvimento

- **H-026 (#39):** precondição técnica. Está em Aguardando aprovação no quadro local. `[VERIFICADO]` quadro-status.md.
- **S-06 (#11):** resultado existe em `spikes/S-06-RESULTADO.md` e o cartão está em Concluído no quadro. A linha do S-06 em 14-BACKLOG ainda diz "Pendente" (desatualizada). **Registro:** o Orquestrador atualiza a linha para "medido localmente; Vercel NÃO VERIFICADO". `[VERIFICADO]`
- **S-09 (#8), carga do `sharp` em Linux x64:** condição de DEV. A decisão 41 libera H-027 com `sharp` só se o binário `linux-x64` carregar; hoje o pacote tem 51 MB, mas a carga em Linux não foi verificada (WSL não feito). Sem isso, a história fica presa à primeira pré-visualização real. `[VERIFICADO]` 41 §2 e spikes/S-09-RESULTADO.md §6; decisão em D-H027-9.
- **H-028 (#41) depende de #40.** A ordem é #40 antes de #41. Não há sobreposição de desenvolvimento, desde que a fronteira de D-H027-1 seja aceita.
- **Liberação:** a condição de 88 §8 (sem fluxo aberto a visitante antes de H-027 e H-028, expurgo agendado) não muda com este refino, exceto pelo que D-H027-4 propõe.

## 7. Evidência exigida

Registrada na Issue #40, com comando, contagem e código de saída de cada execução local. Não declarar CI verde. Medição de Vercel fica como `NÃO VERIFICADO` até a primeira pré-visualização.

- `corepack pnpm check:all` e `corepack pnpm db:test`: código de saída e contagem de testes.
- **Conjunto de teste reproduzível dentro do repositório** (imagens sintéticas geradas em teste, sem foto real): JPG 3000x4000, PNG, ruído branco, 8000x6000, imagem-bomba e arquivo renomeado. Hoje as imagens do S-06 ficaram no scratchpad, não no repositório; o DEV precisa reproduzi-las no repositório.
- **CA-01 e CA-04:** tamanho, dimensão e recusas medidos no conjunto acima.
- **CA-02 e CA-03:** inspeção do armazenamento local depois do reencode: um objeto reduzido, nenhum original, estado `ready` com objeto existente.
- **CA-05 e F-11:** falha simulada (tempo esgotado e erro de armazenamento) com nova tentativa do mesmo `finalize`: uma versão, nenhuma linha `rejected` indevida.
- **CA-06:** `finalize` repetido após `ready`: mesmo resultado e nenhuma segunda versão.
- **CA-07:** tempo e memória pelo processo, com os limites de §4, registrados no ambiente local (Windows). Vercel: `NÃO VERIFICADO`.
- **CA-09:** varredura de marcadores e de metadados na saída, com a prova formal entregue em #41.
- **CA-10:** varredura de log e de respostas sem dado pessoal.

## 8. Dúvidas para o líder

Sem perguntas ao usuário. Cada dúvida tem recomendação. Nenhuma impede o Architect de começar o desenho; D-H027-9 impede o Desenvolvimento.

- **D-H027-1 (fronteira com #41: orientação e metadados).** O backlog põe a rotação e a remoção de EXIF em H-028, "rotação aplicada antes". O S-06 aplica a rotação dentro do reencode, porque sem ela a medida de 1.280 px sai no eixo errado, e a saída sai sem metadado por construção. **Recomendação:** #40 aplica a orientação no reencode e garante saída sem metadado de entrada (CA-08 e CA-09); #41 fica com a prova formal de EXIF e GPS, a checagem de tipo pelo conteúdo e a recusa do arquivo falso. **Alternativa:** mover a rotação para #41, o que exige redimensionar antes de corrigir a orientação (ruim). Não bloqueia.
- **D-H027-2 (HEIC).** O S-06 não testou HEIC, e o `sharp` pré-compilado não decodifica HEVC; o próprio S-06 recomenda recusar no servidor e converter no navegador, ou abrir spike com WASM (R-25). **Recomendação:** HEIC continua com 415 depois de #40 e a conversão vira decisão própria. Isso ajusta a previsão de D-H026-3 (88 §8 item 4). **Alternativa:** incluir conversão em #40 após spike próprio, com teste de memória. Não bloqueia o desenho de #40.
- **D-H027-3 (gatilho do reencode).** O backlog não diz se é síncrono no `finalize` ou por job. O tick de H-008 no plano gratuito roda 1 vez por dia, o que deixaria a foto presa por horas. **Recomendação:** reencode síncrono no `finalize`, com a mesma chave de idempotência; a nova tentativa em falha transitória é o próprio cliente repetir o `finalize`. **Alternativa:** job com lease (H-005) mais tick, o que tem latência inaceitável no plano gratuito. Decisão do Architect, com este critério.
- **D-H027-4 (original apagado logo).** A condição 2 de 88 §8 mantém o original na quarentena até H-028, pelo risco de EXIF. Com o original removido logo depois de gravar a versão reduzida (CA-02), esse risco some do armazenamento final. **Recomendação:** remover logo (CA-02 e P-04 inteiro) e manter a condição de liberação até #41, porque a prova de metadado ainda não existe. **Alternativa:** deixar o original para o expurgo, que dá até 1 dia de exposição. Pede ajuste de 88 §8.
- **D-H027-5 (teto e alvo).** Decisão 31 diz "≈ 0,5 MB"; 08 §10.2 e Q-12 usam teto de 0,75 MB; S-06 mediu que cabe com folga. **Recomendação:** alvo de 0,5 MB, teto de 0,75 MB, com recusa acima do teto (CA-01 e CA-04), registrado como valor de `app_config`. **Alternativa:** teto de 0,5 MB, o que recusa fotos com ruído legítimo. Não bloqueia.
- **D-H027-6 (redução no navegador).** O backlog pede redução no envio, mas a emissão de H-026 declara `size_bytes` antes do envio. **Recomendação:** o navegador reduz antes de pedir a URL, e a emissão declara o tamanho reduzido (CA-12); se o navegador não conseguir reduzir, envia o original até 10 MB e o servidor reduz. O servidor é a única garantia. **Alternativa:** redução só no servidor, mais simples, mas com mais banda e memória de função. Não testada no navegador (S-06 §5).
- **D-H027-7 (falha definitiva e `rejected`).** **Recomendação:** `rejected` só para o que nunca vai funcionar (não decodifica, área acima de 64 MP, não cabe no teto mesmo no piso de qualidade); tempo, memória e erro de armazenamento seguem como transitórios (CA-05). **Alternativa:** tratar tudo como `rejected`, o que perde fotos boas por falha de infraestrutura. Não bloqueia.
- **D-H027-8 (formato de saída).** Nenhum documento fixa o formato. O S-06 mediu JPEG com mozjpeg, cerca de 30% menor e 2 vezes mais lento. **Recomendação:** JPEG, com o tempo medido (CA-07). **Alternativa:** WebP, sem medição. Não bloqueia.
- **D-H027-9 (gate do `sharp` em Linux, DEV).** A decisão 41 libera H-027 com `sharp` só se o binário `linux-x64` carregar; não foi verificado. **Recomendação:** o Architect registra como primeiro passo do DEV a carga em `linux-x64` (WSL, se houver, sem Docker e sem instalar nada novo); se falhar, a história fica presa à primeira pré-visualização, como a decisão 41 prevê, ou o Architect escolhe biblioteca de contingência (ADR-018). **Alternativa:** aceitar desenvolver e validar só na primeira pré-visualização. Bloqueia o DEV, não o desenho.

## 9. Próximo passo

O líder valida D-H027-1, D-H027-3 e D-H027-4, que definem fronteira, gatilho e o que sai da quarentena. D-H027-9 bloqueia o DEV e cabe ao Architect com o líder. As demais dúvidas seguem para o Architect com as recomendações acima. O cartão #40 permanece na coluna Product Owner até essa validação; a movimentação é do Orquestrador, não deste refino.
