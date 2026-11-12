# H-028 — Refino: remoção de EXIF e tipo por conteúdo

- **Issue:** #41 "[E3] Remoção de EXIF e tipo por conteúdo" · **Backlog:** H-028 · **Dependências:** H-027 (#40), H-026 (#39)
- **Etapa:** specification · **Data:** 2026-11-12 · **Papel:** Product Owner · **Status:** refino para validação do líder
- **Etiquetas:** `[DECIDIDO]` aprovado nos documentos (PRD, decisões, critérios) · `[VERIFICADO]` conferido em documento de arquitetura, QA, backlog ou resultado de spike, sem decisão de produto · `[PROPOSTA]` sugestão do PO, a validar · `[NÃO VERIFICADO]` sem fonte ou depende de medição não feita
- **Fontes lidas:** 14-BACKLOG (H-027, H-028, S-06); quadro-status.md (#41 em Product Owner, #40 em Code Review); 04-PRD (RF-025, RF-025a, RF-027, RF-028); 05-CRITERIOS-ACEITE (FA-001, FA-007, FA-027); 11-DECISOES (rodadas 24 a 26: decisões 79 a 88; decisões 30 a 33); 11-ARQ-RISCOS-E-TESTES (T-07, T-10, T-11, P-03, P-04, R-25); 08-ARQUITETURA (nota de EXIF e Storage); 92-REFINO-H027 (padrão); 93-DESENHO-H027 (§2.4, §4.2, §5.1, §7, §8); 88-DESENHO-H026 (§1, §2, §4, §5, §8).

## 1. Objetivo

Fechar a parte de privacidade da foto do pedido que a #40 não fecha sozinha:

1. provar, com leitura independente do pipeline, que a foto guardada não carrega localização, dados de câmera nem miniatura da entrada;
2. decidir o tipo da foto pelo conteúdo, não pelo nome nem pelo tipo declarado;
3. recusar HEIC e qualquer formato fora de JPG, PNG e WebP.

Esta história entrega a condição 2 de 88 §8 para o envio abrir a visitantes: "prova formal de remoção de EXIF/metadados e detecção do tipo pelo conteúdo". `[DECIDIDO]` RF-027, FA-007, T-07, backlog H-028, 88 §8 (2).

A remoção em si já acontece na reconstrução da saída feita pela #40. A #41 não refaz a redução. Ela prova, fecha a regra de tipo e corrige o que a prova revelar, dentro do limite de 2 ciclos de correção.

## 2. Situação de partida

- `[VERIFICADO]` A #39 aceita só o tipo declarado (`image/jpeg`, `image/png`, `image/webp`). HEIC e HEIF declarados recebem 415. O nome do arquivo não é aceito nem guardado. (88 §1, §2; M-05; CA-13)
- `[VERIFICADO]` A #40 reconstrói a saída a partir dos pixels decodificados e não copia metadado. Nenhuma função de metadado é chamada. (93 §4.2 passo 5, §5.1)
- `[VERIFICADO]` A #40 recusa por conteúdo: formato real fora de jpeg, png e webp (inclui HEIC, GIF, SVG, AVIF e TIFF) vira 422 `imagem_invalida`. Mas essa checagem é feita por `metadata()` do sharp, depois que a biblioteca já foi chamada. (93 §2.4, §4.2 passo 2)
- `[VERIFICADO]` A #40 já prevê as provas R-04 (texto `.jpg`, HEIC falso, GIF, SVG, truncado, bomba) e R-09 (sentinelas de EXIF, GPS, XMP e ICC; marcadores APP1 e APP2 em JPEG). (93 §7)
- `[VERIFICADO]` Lacunas do que a #40 prevê, que ficam para a #41: IPTC não aparece na prova; a miniatura da entrada (dentro do EXIF) não tem caso próprio; PNG e WebP não têm varredura dos seus portadores de metadado; não há checagem de assinatura antes do decodificador; não há leitor independente do pipeline. (93 §7 R-09, §5.1)
- `[VERIFICADO]` O S-06 mediu a remoção com exif-reader, sharp e varredura de marcadores, sem ExifTool. (92 §2; 93 §5.1)
- `[NÃO VERIFICADO]` Miniatura, IPTC, PNG e WebP com metadado real ainda não foram medidos em nenhum spike.
- `[DECIDIDO]` O texto do backlog para H-028 ("rotação aplicada antes") está superado pela decisão 79: a rotação fica na #40.

## 3. Fronteira: o que é da #40 e o que fica com a #41

| Item | Dono | Base |
|---|---|---|
| Orientação aplicada no reencode | #40 | decisão 79; 93 CA-08 |
| Saída reconstruída do pixel decodificado, sem copiar metadado (código) | #40 | 93 §4.2 passo 5; CA-09 |
| Teste estático contra funções de metadado | #40 (R-09), reutilizado pela #41 | 93 R-09 |
| Original apagado depois da redução ou da recusa | #40 | decisão 82; 93 CA-02 |
| Recusa de formato real fora de jpeg/png/webp pelo decodificador | #40 (CA-04) | 93 §2.4 |
| Recusa de HEIC ou HEIF declarado (415) | #39 | 88 M-05 |
| Prova formal de ausência de metadado na saída, por formato de entrada e por portador (EXIF, GPS, XMP, IPTC, ICC, miniatura) | **#41** | RF-027; 88 §8 (2) |
| Leitor independente do pipeline para a prova | **#41** | 93 R-09 |
| Tipo decidido pelo conteúdo (regra e prova) | **#41** | T-07; backlog H-028 |
| Checagem de assinatura antes do decodificador | **#41** | `[PROPOSTA]` (D-H028-4) |
| HEIC e HEIF detectados pelo conteúdo: regra, prova e código de recusa | **#41** | decisão 80; D-H028-3 |
| Lista fechada de tipos recusados (GIF, SVG, TIFF, BMP, AVIF, PDF, HTML, executável) | **#41** fecha a lista e prova; a regra geral já é da #40 | 93 R-04 |
| Expurgo agendado e liberação do envio a visitantes | fora desta história | H-110; 88 §8 (3) e liberação |

## 4. Critérios de aceite (Given/When/Then)

- **CA-01 Sem localização nem dado de câmera na saída.** Dado uma foto JPG, PNG ou WebP de entrada com EXIF, GPS, XMP, IPTC e perfil ICC fictícios, um por vez e juntos, quando é reduzida, então a versão guardada não contém nenhum desses blocos: no JPEG, nenhum APP1 (Exif ou XMP), APP2 (ICC) ou APP13 (IPTC); no PNG, nenhum chunk `eXIf`, `iCCP`, nem `tEXt`, `zTXt` ou `iTXt` com XMP; no WebP, nenhum chunk `EXIF`, `XMP ` ou `ICCP`. Nenhum dado de GPS aparece. `[DECIDIDO]` RF-027, FA-007; lista de portadores por formato `[PROPOSTA]`.

- **CA-02 Miniatura da entrada não sobrevive.** Dado uma foto JPEG com miniatura embutida no EXIF, com imagem diferente da principal, quando é reduzida, então a saída tem uma única imagem JPEG e nenhuma miniatura. A verificação é estrutural (leitura dos marcadores), não busca de bytes. `[PROPOSTA]` (lacuna da #40, 93 §7 R-09).

- **CA-03 Prova por leitor independente.** Dado o conjunto de CA-01 e CA-02, quando cada saída é lida por um leitor fora do pipeline (ExifTool, se autorizado, ou leitura estrutural própria com o leitor já usado no S-06), então o leitor não encontra nenhum bloco proibido, e o resultado de cada arquivo é registrado por formato de entrada, portador e resultado. `[PROPOSTA]` (93 R-09 atribui o ExifTool à #41; ver D-H028-2).

- **CA-04 Tipo decidido pelo conteúdo.** Dado um arquivo cujo nome e tipo declarado não batem com o conteúdo (por exemplo, PNG declarado `image/jpeg`, ou JPEG declarado `image/png`), quando é recebido, então o tipo vem só dos bytes: se o conteúdo for JPG, PNG ou WebP, a foto é reduzida normalmente. Nome e tipo declarado não decidem o resultado. `[PROPOSTA]` (D-H028-1). Base `[VERIFICADO]`: T-07 cita "tipo falso por extensão".

- **CA-05 Assinatura antes do decodificador.** Dado um arquivo cujos primeiros bytes não são assinatura de JPEG, PNG ou WebP, quando é recebido, então recebe 422 `imagem_invalida`, a foto vai a `rejected`, o original é removido, e o decodificador não é chamado. A prova usa um decodificador espião com zero chamadas. `[PROPOSTA]` (D-H028-4). Código `[VERIFICADO]` 93 §2.4.

- **CA-06 HEIC e HEIF recusados pelo conteúdo.** Dado um arquivo cujo cabeçalho de tipo de arquivo declara marca principal HEIC ou HEIF, ainda que enviado com tipo declarado JPEG, PNG ou sem tipo, quando é recebido, então recebe 422 `imagem_invalida`, a foto vai a `rejected` e o original é removido. A checagem de CA-05 já impede a decodificação; CA-06 fixa o código e o caso. Um envio que declara HEIC continua com 415 da #39. `[DECIDIDO]` decisão 80 e backlog H-028 ("HEIC só por conversão suportada"); código `[PROPOSTA]` (D-H028-3).

- **CA-07 Lista fechada de tipos recusados.** Dado um arquivo de GIF, SVG, TIFF, BMP, AVIF, PDF, HTML ou executável, com ou sem nome `.jpg`, quando é enviado, então recebe 422 `imagem_invalida`, a foto vai a `rejected`, o original é removido e nenhum objeto reduzido fica no bucket final. `[DECIDIDO]` backlog H-028 ("arquivo renomeado ou falso é recusado"); lista completa `[PROPOSTA]`. A regra geral já é da #40 (93 R-04); a #41 fecha a lista e prova cada tipo.

- **CA-08 Recusa sem eco.** Dado qualquer recusa de CA-04 a CA-07, quando a resposta e o log são capturados, então não aparecem nome, tipo detectado, bytes, metadado da entrada, caminho interno nem texto de biblioteca; só o código fixo. Estende a prova de 93 CA-10 aos casos desta história. `[VERIFICADO]` T-11; 88 §5.

- **CA-09 Sem contrato novo e sem regressão.** Dado a entrega da #41, quando comparada com a #40, então não há código de recusa novo, coluna nova nem migração sem decisão registrada (D-H028-3), e os critérios CA-01 a CA-13 de 92 continuam passando. `[PROPOSTA]`.

## 5. Fora de escopo

- Rotação, reencode, dimensões, tamanho, limite de 64 MP, remoção do original e recusa por tamanho: #40 (92 e 93).
- Conversão de HEIC: continua recusada (decisão 80). Conversão exige spike próprio (R-25).
- Leitura, pré-visualização e marca d'água: H-029 e H-056.
- Expurgo agendado (condição 3 de 88 §8): H-110 e H-008.
- Liberação do envio a visitantes: decisão do líder (88 §8), não desta história.
- Deduplicação por conteúdo: R3 de 88.
- Risco de conteúdo da foto (fachada, interior, rosto): R-03 de 08 e D10. Não é metadado, então não é provado aqui.

## 6. Dependências e condições antes do Desenvolvimento

- **#40 (H-027) antes.** A #41 prova a saída da #40. O DEV da #41 começa só quando a #40 sair de Code Review e a saída estiver fixada. `[VERIFICADO]` quadro-status.md (#40 em Code Review).
- **Gate do `sharp` em Linux x64** (93 §8, decisão 85): CA-05 roda sem o decodificador. Os demais critérios dependem da carga do sharp no Windows local, como na #40.
- **#39:** sem mudança de contrato.

## 7. Evidência exigida

Registrada na Issue #41, com comando, contagem e código de saída de cada execução local. Não declarar CI verde.

- `corepack pnpm check:all` e `corepack pnpm db:test`: código de saída e contagem de testes.
- **Conjunto gerado em teste**, sem foto real e sem binário versionado: JPEG com EXIF, GPS, XMP, IPTC, ICC e miniatura; PNG com `eXIf`, `iCCP`, `tEXt` e `iTXt` com XMP; WebP com EXIF, XMP e ICCP; PNG com nome `.jpg`; cabeçalho HEIC e HEIF sintético; GIF, SVG, TIFF, BMP, AVIF, PDF, HTML e executável. Sentinelas fictícias: coordenada fictícia, nome `rua-das-flores-12.jpg` e cabeçalho sentinela.
- **CA-01 e CA-02:** tabela de formato de entrada × portador × resultado do leitor independente × código de saída.
- **CA-03:** versão e comando do leitor usado. Se o ExifTool não for autorizado, a limitação fica registrada.
- **CA-04 a CA-07:** tabela de caso × resposta esperada × resposta obtida × código, com a contagem de decodificações (CA-05 exige zero).
- **CA-08:** captura de todas as linhas de log e de todas as respostas, com busca das sentinelas e resultado.
- **Vercel e Linux:** `NÃO VERIFICADO` até a primeira pré-visualização.

## 8. Dúvidas para o líder

Sem perguntas ao usuário. Nenhuma impede o Architect de começar o desenho. D-H028-2 precisa de resposta antes da prova de CA-03.

- **D-H028-1 (tipo declarado × conteúdo).** **Recomendação:** o conteúdo decide. Se for JPG, PNG ou WebP, a foto é reduzida (CA-04). O navegador declara o tipo pelo nome, e a saída é sempre JPEG reencodado. **Alternativa:** recusar a divergência com código novo (`tipo_divergente`), o que exige migração. Não bloqueia.
- **D-H028-2 (leitor de prova).** O ExifTool é gratuito e independente, mas precisa ser instalado no computador de desenvolvimento. O desenho da #40 (93 §8) cita a 41-DECISAO-S09-CAMINHO como vedação a instalar algo novo para verificação. **Recomendação:** pedir autorização só para uso como ferramenta de prova local, fora das dependências do produto; sem autorização, usar leitura estrutural própria e registrar a limitação em CA-03. **Alternativa:** não usar leitor externo. Decisão necessária antes de CA-03.
- **D-H028-3 (código de HEIC e HEIF).** **Recomendação:** HEIC e HEIF detectados pelo conteúdo recebem `imagem_invalida` (422), código já existente, sem migração. A mensagem específica de HEIC fica no cliente, para o caso de envio declarado como HEIC (415 da #39). **Alternativa:** código novo `formato_nao_aceito`, com migração que amplia a lista de `reject_code` e mensagem própria. Não bloqueia.
- **D-H028-4 (assinatura antes do decodificador).** **Recomendação:** incluir CA-05. É uma checagem de poucos bytes que reduz a superfície do decodificador (R-25) e evita carregar o sharp para arquivo que não é imagem. **Alternativa:** manter só `metadata()` do sharp, como na #40. Não bloqueia.
- **D-H028-5 (janela do original até o `finalize`).** Entre o envio e o `finalize` (até 30 min), o original com metadado fica na quarentena. Um envio abandonado fica até o expurgo (88 §8, condição 3). **Recomendação:** esta história não muda essa janela. A prova de CA-01 vale para a saída. Com CA-01 a CA-08 verdes, a condição 2 de 88 §8 pode ser marcada como cumprida, e a condição 3 segue como liberação separada. **Alternativa:** exigir também a condição 3 para liberar esta história. Não bloqueia o DEV; decide a liberação.

## 9. Próximo passo

O líder valida D-H028-1, D-H028-2 e D-H028-5. D-H028-2 precisa ser respondido antes da prova de CA-03. O cartão #41 permanece em Product Owner até essa validação; a movimentação é do Orquestrador, não deste refino. O Orquestrador também registra que o texto "rotação aplicada antes" do backlog H-028 foi superado pela decisão 79.
