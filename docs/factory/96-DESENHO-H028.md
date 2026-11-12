# H-028 — Desenho: prova de ausência de metadado e tipo decidido pelo conteúdo

- **Issue:** #41 · **Workflow:** WF-03 (Arquitetura) · **Data:** 2026-11-12 · **Papel:** Architect
- **Etiquetas:** `[DECIDIDO]` aprovado em documento ou pelo líder · `[VERIFICADO]` conferido no código ou documento · `[PROPOSTA]` sugestão do Architect · `[NÃO VERIFICADO]` sem fonte ou sem medição
- **Base:** 95-REFINO-H028 (CA-01 a CA-09), 93-DESENHO-H027 (§2.4, §4.2, §5.1, §7 R-04/R-09), 88-DESENHO-H026 (§1, §2, §8), decisões 79 a 86 e 93 a 97 (11-DECISOES, rodadas 25 e 29), spikes/S-06-RESULTADO §3.5; código lido: `apps/api/src/media/media-reduce-service.ts`, `image-reducer-sharp.ts`, `packages/domain/src/media/{reduce,ports}.ts`, `apps/api/tests/{media-reduce-image.test.ts,media-fakes-h027.ts,media-reduce-service.test.ts}`.

## 0. Situação encontrada e decisões do dono do produto (não reabertas)

- `[DECIDIDO]` 93 o conteúdo decide o tipo (JPG, PNG ou WebP), nome e tipo declarado não decidem · 94 sem ferramenta externa de prova (ExifTool fora): leitura própria, com a limitação registrada · 95 HEIC e HEIF recusados com `imagem_invalida`, sem código novo e sem migração · 96 checagem de assinatura antes do decodificador · 97 a janela do original até o `finalize` não muda.
- `[VERIFICADO]` A saída da #40 é **sempre JPEG** (decisão 84), reconstruída do bruto, sem chamada de metadado (`image-reducer-sharp.ts`, passo `.raw()` → `.jpeg({ quality, mozjpeg })`). A entrada PNG ou WebP, portanto, só importa como **portador de metadado na entrada**; o que se prova ausente é a saída JPEG.
- `[VERIFICADO]` Hoje o formato real só é conferido por `sharp(...).metadata()` **depois** de a biblioteca ser carregada e chamada (`image-reducer-sharp.ts`, linhas 52 a 66). Não existe checagem de assinatura. O tipo declarado nunca é lido pelo serviço de redução (não há coluna de tipo em `app.media_asset`): o conteúdo já decide de fato, só falta fixar a regra e provar.
- `[VERIFICADO]` O tipo declarado só age em dois lugares da #39: a validação do corpo de `POST /v1/media/uploads` (fora de `image/jpeg|png|webp` ⇒ 415 `tipo_invalido`, o que inclui HEIC e HEIF declarados e a ausência de tipo) e o `allowed_mime_types` do bucket `quarantine` (cabeçalho do `PUT`, não o conteúdo). Nenhum dos dois olha os bytes: a assinatura é a única checagem de conteúdo antes do decodificador.
- `[VERIFICADO]` Os testes de serviço da #40 usam `ORIG = new Uint8Array(1000).fill(7)` (`media-reduce-service.test.ts`, linha 20) e `padraoOriginal = new Uint8Array(1000).fill(1)` (`media-route.test.ts`, linha 252). Com a checagem de assinatura, esses originais passam a ser recusados: ver **ajuste obrigatório de testes** em §7.
- **Fronteira com a #40 mantida:** rotação, reconstrução da saída, remoção do original, limite de 64 MP e recusa por formato real pelo decodificador continuam da #40. A #41 acrescenta uma função pura no domínio, uma chamada no serviço e provas. **O DEV da #41 começa só depois de a #40 sair de QA** (os arquivos de teste e o serviço são os mesmos).

## 1. Visão geral: o que muda no fluxo

```
finalize -> confirma -> reduce_begin (lease) -> readOriginal
                                   |
                                   v
                    detectarTipoImagem(bytes)   <-- NOVO (domínio, puro, sem sharp)
                      |                    |
              jpeg|png|webp               null
                      |                    |
          reducer.reduce (como na #40)   recusar(imagem_invalida):
                                         rejected + original removido + 422 { code }
                                         (reducer e sharp NÃO são chamados)
```

Um único ponto novo no código de produção, dentro de `reduzirTentativa`, entre o `if (original === null)` e `deps.reducer.reduce(...)`. O `metadata()` do sharp permanece como **segunda camada** (JPEG com cabeçalho bom e corpo ilegível, PNG com assinatura e IHDR bons mas corpo corrompido, WebP truncado).

## 2. Contratos novos (só o necessário)

### 2.1 Estados, banco e respostas: nenhum novo `[PROPOSTA]`

- Sem estado novo, sem coluna, sem função SQL, **sem migração** (decisão 95). A última migração do tema é a `20261112140000`; esta história não cria arquivo em `supabase/`.
- Sem código de recusa novo: `MEDIA_REJECT_CODES` continua com os 4 valores de `reduce.ts`. Recusa por assinatura é `imagem_invalida`.
- Transição existente reaproveitada: **C → E** (`media_reduce_reject`, §2.2 de 93) ganha um gatilho a mais, "assinatura fora de jpeg, png e webp", sem mudar efeito: `status='rejected'`, `reject_code='imagem_invalida'`, vaga liberada, original removido, `finalize` repetido devolve o mesmo 422 sem reprocessar (93 CA-06).
- Respostas inalteradas: 422 `{ "code": "imagem_invalida" }`, corpo fixo, sem eco (93 §2.3). HEIC ou HEIF **declarado** continua 415 `tipo_invalido` na emissão (#39); HEIC ou HEIF só descoberto pelo conteúdo é 422 `imagem_invalida` no `finalize`. A mensagem específica de HEIC para o visitante é do cliente (decisão 95; fora desta história).

### 2.2 Função de assinatura (domínio) `[PROPOSTA]`

Arquivo novo `packages/domain/src/media/image-type.ts`, exportado por `media/index.ts`. Pura, sem dependências, nunca lança exceção, aceita qualquer comprimento de entrada (inclusive 0 byte).

```ts
export type ImageKind = 'jpeg' | 'png' | 'webp';
export function detectarTipoImagem(bytes: Uint8Array): ImageKind | null;
```

Regras (lista fechada; qualquer outra coisa devolve `null`):

| Tipo | Regra sobre os primeiros bytes | Comprimento mínimo |
|---|---|---|
| `jpeg` | bytes 0 a 2 = `FF D8 FF` e byte 3 é byte de marcador (diferente de `00` e `FF`) | 4 |
| `png` | bytes 0 a 7 = `89 50 4E 47 0D 0A 1A 0A`, bytes 8 a 11 = comprimento `00 00 00 0D` e bytes 12 a 15 = `IHDR` | 16 |
| `webp` | bytes 0 a 3 = `RIFF`, bytes 8 a 11 = `WEBP` e bytes 12 a 15 ∈ {`VP8 `, `VP8L`, `VP8X`} | 16 |

A função **não classifica** o que recusa: HEIC, HEIF, AVIF, GIF, TIFF, BMP, PDF, SVG, HTML e executável caem todos em `null` porque nenhuma das três regras casa (o contêiner HEIF tem `ftyp` nos bytes 4 a 7 e marca principal `heic`, `heix`, `hevc`, `mif1`, `msf1` etc.; AVIF, `avif`/`avis`). Não devolver o tipo detectado evita que ele vire eco em resposta, log ou contador (CA-08).

Limitação de cabeçalho: a assinatura prova só que o arquivo **começa** como um dos três formatos. Um arquivo com cabeçalho JPEG e corpo diferente (poliglota, anexo depois do EOI) passa pela assinatura; quem decide é o decodificador (corpo ilegível ⇒ `imagem_invalida` da #40) e, se decodificar, o reencode descarta tudo o que não é pixel (X-04, X-05).

### 2.3 Chamada no serviço `[PROPOSTA]`

Em `media-reduce-service.ts`, `reduzirTentativa`, logo depois do tratamento de `original === null`:

```ts
if (detectarTipoImagem(original) === null) {
  deps.contadores.incrementar('recusa_assinatura');
  return recusar(id, tentativa, 'imagem_invalida', deps, nowMs);
}
```

- Fica **dentro** da vaga do semáforo e da lease, depois de `reduce_begin`: a leitura do original só acontece depois da lease (93 §2.2), então a checagem não pode vir antes. Custo: poucos bytes de comparação; a leitura de até 10 MB já existe na #40.
- `recusar` já faz `media_reduce_reject`, `tirarOriginal` e 422. Nada novo ali.
- O contador `recusa_assinatura` não leva tipo, tamanho nem identificador (93 §6).
- Porque a checagem fica **no serviço** (e não dentro do `SharpImageReducer`), o "decodificador espião" do CA-05 é o próprio `ImageReducerPort` falso com `chamadas === 0`, e o `sharp` nem é carregado (`carregarSharp()` é preguiçosa): a recusa funciona mesmo se a carga em Linux x64 falhar (gate da decisão 85).
- `SharpImageReducer` e `ImageReducerPort` **não mudam**.
- Quem manda é o conteúdo: nenhum trecho do serviço lê tipo declarado ou nome (CA-04). Um teste estático impede que `media-reduce-service.ts` e `image-reducer-sharp.ts` mencionem `content_type`, `contentType`, `mime` ou `filename`.

### 2.4 Leitor de prova (somente testes) `[PROPOSTA]`

Decisão 94: sem ExifTool. O leitor é **estrutural e próprio**, escrito para o teste, **não entra no código de produção** nem nas dependências do produto. Dois arquivos de apoio em `apps/api/tests/helpers/`:

- `estrutura-imagem.ts`: percorre o contêiner **sem usar o sharp nem o libvips** e devolve a lista de segmentos (JPEG), chunks (PNG) ou chunks RIFF (WebP), com o conteúdo classificado nos portadores da §3. Funções: `listarPortadores(bytes)` (o que existe, para controle positivo na entrada) e `verificarSaidaJpegLimpa(bytes)` (lista de violações; vazia = limpa).
- `construtores-imagem.ts`: monta a entrada **à mão**, byte a byte (segmentos APPn, chunks, RIFF), a partir de uma imagem-base gerada pelo sharp. Assim a entrada não depende do gravador de metadado do sharp (que é o que se quer testar), e IPTC, miniatura, MPF e COM, que o sharp não grava, existem no conjunto.

Regras do leitor:

1. **Falha fechada:** marcador desconhecido, comprimento que passa do fim, falta de SOI inicial ou de EOI final, bytes depois do EOI final, ou qualquer erro de leitura contam como violação (um leitor que "não entende" nunca aprova).
2. **Lista permitida, não lista proibida (JPEG de saída):** só pode haver SOI, EOI, DQT, DHT, SOF (0 a 3, 5 a 7, 9 a 11, 13 a 15), SOS, DRI, RSTn e **APP0 apenas se for JFIF de 16 bytes com miniatura 0×0** (um APP0 com `JFXX` ou com miniatura é violação). Todo APP1 a APP15, COM (`FFFE`), DNL, JPGn e TEM são violação. A varredura dos dados entrelaçados segue a regra do formato (`FF 00` é byte literal, `FF D0` a `FF D7` é reinício, qualquer outro `FF xx` é marcador).
3. **Controle positivo obrigatório:** antes de afirmar que a saída está limpa, o teste confirma que o mesmo leitor **encontra** o portador na entrada. Sem isso, um leitor que não vê nada aprovaria tudo.
4. **Controle negativo:** o leitor é testado contra saídas deliberadamente sujas (um JPEG limpo ao qual se acrescenta um APP1, um APP13, um COM e bytes depois do EOI) e deve acusar cada uma.
5. Busca de bytes (`Exif`, `GPS`, `http://ns.adobe.com`, `Photoshop`, `8BIM`, `ICC_PROFILE`, `sentinela-`) roda **além** do leitor, como reforço, nunca como prova principal (CA-02 exige estrutura).

## 3. Formatos de entrada e portadores de metadado

Saída sempre JPEG (`FF D8 FF ... FF D9`). Coluna da direita: o que o teste exige da saída. "Entrada" = como o conjunto gerado em teste coloca o portador.

| Portador | JPEG (entrada) | PNG (entrada) | WebP (entrada) | Saída exigida |
|---|---|---|---|---|
| **EXIF** | APP1 `Exif\0\0` + TIFF | chunk `eXIf`; `zTXt` ou `tEXt` com perfil bruto "Raw profile type exif" | chunk `EXIF` (flag `0x08` do VP8X) | nenhum APP1, `eXIf` ou `EXIF` |
| **GPS** | sub-IFD apontado pela tag `0x8825` dentro do EXIF, com coordenada fictícia | idem, dentro de `eXIf` | idem, dentro de `EXIF` | nenhum EXIF e `GPS` ausente dos bytes |
| **Miniatura da entrada** | IFD1 do EXIF com tags `0x0201`/`0x0202` apontando para um JPEG (FF D8) dentro do APP1; JFIF com miniatura (APP0) e `JFXX`; imagem anexada depois do EOI e APP2 `MPF` | não se aplica (sem miniatura padrão) | não se aplica | **uma única imagem**: 1 SOI, 1 SOF, 1 EOI, nenhum APPn, nada depois do EOI |
| **XMP** | APP1 `http://ns.adobe.com/xap/1.0/\0` e `ExtendedXMP` | `iTXt` com palavra-chave `XML:com.adobe.xmp` | chunk `XMP ` (flag `0x04`) | nenhum APP1, `iTXt`, `XMP ` |
| **IPTC** | APP13 `Photoshop 3.0\0` com recurso `8BIM 0x0404` | `zTXt` "Raw profile type iptc" | não tem chunk próprio (vai em XMP) | nenhum APP13 |
| **ICC** | APP2 `ICC_PROFILE\0` | chunk `iCCP` | chunk `ICCP` (flag `0x20`) | nenhum APP2 |
| **Comentário e texto livre** | COM (`FFFE`) | `tEXt`, `zTXt`, `iTXt` (Author, Comment) | não tem | nenhum COM, nenhum chunk de texto |
| **Data** | (dentro do EXIF) | chunk `tIME` | (dentro do EXIF) | nenhum chunk além dos da lista permitida |
| **Bytes extras** | depois do EOI (rabo de fabricante, ZIP anexado) | depois do `IEND` | depois do fim declarado no RIFF | o último byte é o EOI, sem nada depois |

Notas:
- A perfil de cor é **aplicado** (conversão a sRGB) antes de ser descartado (`toColourspace('srgb')`, `[VERIFICADO]` S-06 §3.5). Display P3 real: `[NÃO VERIFICADO]`, comparação de cor por tolerância já prevista em 93 R-12.
- Chunks de PNG e WebP que **não** são portadores pessoais (`IHDR`, `PLTE`, `IDAT`, `IEND`, `tRNS`, `sRGB`, `gAMA`, `cHRM`, `pHYs`, `VP8 `, `VP8L`, `VP8X`, `ALPH`) aparecem na entrada de controle e não são exigidos na saída: a saída é JPEG.
- WebP animado (`ANIM`, `ANMF`) e APNG (`acTL`, `fcTL`, `fdAT`): só o primeiro quadro entra (93 §5.1); o conjunto inclui um caso curto, sem ampliar o escopo.

## 4. Verificação estrutural da miniatura (CA-02)

Uma miniatura de EXIF **não aparece como um segundo SOI no nível do arquivo**: ela fica dentro do APP1, que um leitor de marcadores pula pelo comprimento. Por isso o teste tem duas pontas:

1. **Entrada (controle positivo):** `listarPortadores(entrada)` interpreta o APP1, lê o cabeçalho TIFF (ordem de bytes, IFD0 → IFD1), acha as tags `0x0201` (deslocamento) e `0x0202` (comprimento) e confirma que o intervalo apontado começa com `FF D8` e termina com `FF D9`. A imagem principal é azul 2000×1500; a miniatura é vermelha 160×120 (imagem **diferente**).
2. **Saída:** `verificarSaidaJpegLimpa` precisa ver exatamente 1 SOI, 1 SOF, 1 EOI, nenhum APPn e nada depois do EOI; e a leitura do pixel central da saída decodificada tem de ser azul (a miniatura vermelha não substituiu a imagem). Variantes: JPEG com `MPF` e segunda imagem anexada depois do EOI (a saída tem 1 SOI e termina no primeiro e único EOI) e JFIF com miniatura.

A busca de bytes pelo cabeçalho da miniatura (`FF D8` dentro de dados) é descartada como prova: dados comprimidos podem conter os mesmos bytes por acaso (CA-02 pede leitura estrutural).

## 5. Lista fechada de tipos aceitos e recusados

**Aceitos (3):** JPEG, PNG, WebP, decididos pela §2.2. Nada mais.

**Recusados com 422 `imagem_invalida`, `rejected`, original removido e nenhum objeto reduzido (CA-07, CA-06):**

| Caso do conjunto (gerado em teste) | Vetor mínimo | Camada que recusa |
|---|---|---|
| HEIC | `00 00 00 18` `ftyp` `heic` + preenchimento; variantes `heix`, `hevc`, `mif1` | assinatura |
| HEIF | `ftyp` `mif1`, `msf1` | assinatura |
| AVIF | `ftyp` `avif`, `avis` | assinatura |
| GIF | `GIF87a`, `GIF89a` | assinatura |
| SVG | `<svg ...>` e `<?xml ...?><svg>` | assinatura |
| TIFF | `II*\0`, `MM\0*` | assinatura |
| BMP | `BM` + cabeçalho | assinatura |
| PDF | `%PDF-1.7` | assinatura |
| HTML | `<!doctype html><script>...` | assinatura |
| Executável | `MZ` (Windows) e `7F 45 4C 46` (ELF) | assinatura |
| Texto renomeado `.jpg`, arquivo vazio, 1 a 3 bytes, JPEG 2000 (`FF 4F FF 51`) | idem | assinatura |
| Cabeçalho PNG ou JPEG válido com corpo corrompido ou truncado | `pngComDimensoes` e JPEG cortado ao meio | `metadata()` e decodificação do sharp (#40, segunda camada) |
| RIFF que não é WebP (`WAVE`, `AVI `) | `RIFF....WAVE` | assinatura |

A lista é o **conjunto de prova**, não uma lista negra: qualquer formato fora das três regras da §2.2 é recusado por omissão.

## 6. Segurança e privacidade

- A checagem reduz a superfície do decodificador (R-25): o libvips só recebe bytes que começam como JPEG, PNG ou WebP; GIF, TIFF, SVG, PDF, AVIF e HEIC nunca chegam a ele. O endurecimento opcional `sharp.block` (93 §4.2 passo 2) segue `[NÃO VERIFICADO]` e fica fora desta história.
- **Sem eco (CA-08):** resposta = exatamente `{"code":"imagem_invalida"}` com os cabeçalhos de `DRAFT_HEADERS` e nenhum outro; contadores só com nomes fixos (`recusa_assinatura`, `recusa_imagem_invalida`); nada de nome, tipo declarado ou detectado, bytes, chave `d/…`, caminho ou texto de biblioteca. O serviço não tem log de linha (93 §6); o teste cobre console, `process.stdout` e `process.stderr` mesmo assim.
- Nome do arquivo: não existe no contrato da #39 (o corpo da emissão não aceita nome); o sentinela `rua-das-flores-12.jpg` é injetado onde for possível (tipo declarado, cabeçalhos, conteúdo) e buscado em tudo que sai.
- Sem leitura nova: nenhuma rota, nenhuma política, nenhuma porta de storage nova (93 CA-11 continua valendo, e o teste R-11 da #40 segue verde).

## 7. Testes que provam cada critério

Padrão da #39 e da #40 `[VERIFICADO]`: Vitest, execução local `corepack pnpm check:all`. **Conjunto gerado dentro do teste, sem foto real e sem binário versionado**: imagem-base pelo `sharp` (como em `media-reduce-image.test.ts`); portadores montados à mão por `construtores-imagem.ts`; vetores de tipo recusado por `Buffer.from`. Sentinelas fictícias: `sentinela-exif-h028`, `sentinela-xmp-h028`, `sentinela-iptc-h028`, `sentinela-cabecalho-h028`, coordenada fictícia (latitude `9/1`, longitude `20/1`), nome `rua-das-flores-12.jpg`.

Arquivos: `packages/domain/tests/media-image-type.test.ts` (X-01), `apps/api/tests/media-metadata-h028.test.ts` (X-02 a X-06, sharp real), `apps/api/tests/media-tipo-h028.test.ts` (X-07 a X-11, serviço com fakes da #40), e os dois helpers acima.

| ID | Prova | Critérios |
|---|---|---|
| X-01 | Tabela de vetores de `detectarTipoImagem`: aceita JPEG (`FF D8 FF E0`, `E1`, `DB`), PNG e WebP (`VP8 `, `VP8L`, `VP8X`); `null` para todos os vetores da §5, vazio, 1 a 3 bytes, `FF D8 FF` sem 4º byte, PNG sem IHDR, RIFF sem `WEBP`, `RIFF…WEBP` com chunk `XXXX`; 2.000 buffers pseudoaleatórios (semente fixa) de 0 a 64 bytes nunca lançam exceção; a função não importa nenhum módulo (teste estático do arquivo) | CA-05, CA-06, CA-07 |
| X-02 | **JPEG:** para EXIF só, EXIF com GPS, XMP, IPTC, ICC, COM e todos juntos: controle positivo (`listarPortadores` acha o portador na entrada) ⇒ redução com o `SharpImageReducer` real ⇒ `verificarSaidaJpegLimpa(saída)` vazio e `sharp(saída).metadata()` sem `exif`, `xmp`, `icc`, `iptc` | CA-01, CA-03 |
| X-03 | **PNG:** `eXIf`, `iCCP`, `tEXt`, `zTXt` (perfil bruto), `iTXt` XMP, `tIME`, um a um e juntos: controle positivo ⇒ redução real ⇒ saída JPEG limpa (mesmo leitor). **WebP** (com e sem VP8X): `EXIF`, `XMP `, `ICCP`, um a um e juntos, idem; WebP animado curto reduz só o primeiro quadro | CA-01, CA-03 |
| X-04 | **Miniatura:** JPEG com IFD1 apontando para JPEG vermelho 160×120 diferente da principal azul 2000×1500, JFIF com miniatura, MPF com segunda imagem depois do EOI, ZIP anexado depois do EOI ⇒ controle positivo de cada um ⇒ saída com 1 SOI, 1 SOF, 1 EOI, nenhum APPn, último byte = EOI; pixel central da saída azul; `sharp(saída).metadata().pages` ausente ou 1 | CA-02 |
| X-05 | Reforço: busca de bytes nas saídas de X-02 a X-04 (`Exif`, `GPS`, `http://ns.adobe.com`, `Photoshop`, `8BIM`, `ICC_PROFILE`, `sentinela-`) ⇒ nenhuma; verificação estática de que `image-reducer-sharp.ts` não chama `withMetadata`, `keepMetadata`, `withExif`, `withIccProfile`, `withXmp` (reutiliza R-09 de 93) | CA-01 |
| X-06 | **O leitor é confiável:** controle negativo (JPEG limpo + APP1, + APP13, + COM, + bytes após o EOI, + APP0 JFXX, + SOI duplo ⇒ cada um acusado); JPEG truncado, marcador desconhecido e comprimento maior que o arquivo ⇒ acusados (falha fechada); lista de marcadores observada nas saídas é registrada na Issue | CA-03 |
| X-07 | **Conteúdo decide:** PNG enviado com tipo declarado `image/jpeg`, JPEG declarado `image/png`, WebP declarado `image/jpeg`, e nome sentinela `.jpg`/`.png` trocados ⇒ pela rota de teste da #40 (emissão com o tipo declarado, `PUT` do conteúdo real, `finalize`) com o redutor real: 200 `ready`, objeto `p/<id>` começa com `FF D8 FF` e `sharp.metadata().format === 'jpeg'`; teste estático: `media-reduce-service.ts` e `image-reducer-sharp.ts` não citam `content_type`, `contentType`, `mime`, `filename` | CA-04 |
| X-08 | **Assinatura antes do decodificador:** originais da §5 pelo serviço com `FakeReducer`: `chamadas === 0` para todos; `sharp` não é importado (o teste usa só o redutor falso e confere que o módulo `sharp` não foi carregado via `vi.mock`/contador de importação); teste estático: em `reduzirTentativa`, `detectarTipoImagem(` aparece **antes** de `reducer.reduce(`; PNG com assinatura boa e corpo corrompido **passa** pela assinatura e é recusado pela 2ª camada com o `SharpImageReducer` real (`imagem_invalida`) | CA-05 |
| X-09 | **HEIC e HEIF pelo conteúdo:** `ftyp` `heic`, `heix`, `hevc`, `mif1`, `msf1` enviados com tipo declarado `image/jpeg` e nome `.jpg` ⇒ `finalize` 422 `imagem_invalida`, linha `rejected` com `reject_code`, `originais` sem o id, `reduzidas` vazio, diário sem `putReduced`, `finalize` repetido ⇒ mesmo 422 e `chamadasLeitura` inalterada; HEIC **declarado** como `image/heic` na emissão ⇒ 415 `tipo_invalido` (teste da #39 mantido); ausência de `content_type` ⇒ 415 | CA-06 |
| X-10 | **Lista fechada:** cada vetor da §5, com tipo declarado `image/jpeg` e nome `.jpg` ⇒ 422 `imagem_invalida`, `rejected`, original removido, nenhum objeto reduzido, vaga liberada (5 vivas, 1 `rejected`, 6ª aceita) | CA-07 |
| X-11 | **Sem eco:** captura de todas as respostas (status, cabeçalhos, corpo), do `console.*`, de `process.stdout/stderr` e da `instantanea()` dos contadores nos casos de X-07 a X-10; o corpo é exatamente `{"code":"imagem_invalida"}`; nenhum sentinela (`rua-das-flores-12`, `sentinela-cabecalho-h028`, `sentinela-exif-h028`), nenhuma palavra de tipo (`heic`, `heif`, `avif`, `gif`, `svg`, `tiff`, `pdf`, `ftyp`, `image/`), nenhum caminho (`d/`, `p/`) e nenhum texto de biblioteca; chaves dos contadores só da lista fixa | CA-08 |
| X-12 | **Sem contrato novo e sem regressão:** `MEDIA_REJECT_CODES` igual aos 4 valores; `git diff --stat` da entrega sem arquivo em `supabase/` (registrado na Issue); a suíte de 93 (R-01 a R-15) continua verde depois do ajuste abaixo | CA-09 |

**Ajuste obrigatório de testes da #40 (parte da entrega):** `ORIG` em `media-reduce-service.test.ts`, `padraoOriginal` em `media-route.test.ts` e os originais criados em `media-fakes-h027.ts` passam a começar com `FF D8 FF E0` (JPEG mínimo falso; o `FakeReducer` não decodifica nada). Sem isso a checagem de assinatura recusa o original falso e os testes de sucesso da #40 quebram.

**Cobertura:** CA-01 X-02/X-03/X-05 · CA-02 X-04 · CA-03 X-02/X-03/X-06 · CA-04 X-07 · CA-05 X-01/X-08 · CA-06 X-01/X-09 · CA-07 X-01/X-10 · CA-08 X-11 · CA-09 X-12. Os 9 critérios têm prova.

**Evidência na Issue #41** (comando, contagem e código de saída; sem declarar CI verde): `corepack pnpm check:all`; tabela de formato de entrada × portador × resultado do leitor × controle positivo; lista de marcadores observada nas saídas; tabela de caso × resposta esperada × obtida × chamadas do redutor (zero em CA-05); captura de CA-08 com busca dos sentinelas; versão do `sharp` (`0.35.5`, fixada). `db:test` roda por regra do projeto, sem mudança de banco esperada.

## 8. Limitações registradas (decisão 94)

1. **Sem ExifTool.** A prova é um leitor estrutural próprio; ela não é independente do entendimento do autor sobre os formatos. Mitigação: lista permitida em vez de lista proibida, controle positivo na entrada, controle negativo do leitor (X-06) e falha fechada. Quem quiser a conferência externa roda o ExifTool à mão sobre as saídas; isso não é feito nem exigido aqui.
2. **Conjunto sintético.** Nenhuma foto real de câmera ou celular (MakerNote, rabo da Samsung, HEIC convertido, Display P3 de verdade) foi usada. Bytes depois do EOI cobrem o rabo de fabricante por construção, mas não por amostra real. `[NÃO VERIFICADO]` com arquivo real.
3. **Só estrutura do contêiner.** O leitor não prova ausência de dado escondido nos pixels (esteganografia, marca d'água) nem a ausência de dado pessoal na imagem (fachada, rosto: R-03 de 08, fora de escopo).
4. **A assinatura é de cabeçalho.** Poliglota (cabeçalho JPEG + conteúdo estranho) passa pela assinatura; quem protege é o decodificador mais o reencode que descarta tudo que não é pixel (X-04).
5. **Sharp 0.35.5 no Windows.** Linux/Vercel `NÃO VERIFICADO` até a primeira pré-visualização (decisão 85); X-07/X-08 sem `sharp` real rodam em qualquer ambiente.
6. **Objeto no Storage.** A prova lê os bytes entregues a `putReduced`. O Storage local ou remoto pode acrescentar metadados do **objeto** (tipo, tamanho, etag), nunca EXIF; a conferência do objeto lido de volta fica `NÃO VERIFICADO` fora da prova R-15 da #40.
7. **Janela do original** (decisão 97): a prova vale para a saída; o original com metadado fica na quarentena entre o envio e o `finalize` (até 30 min) e, se nunca finalizado, até o expurgo (88 §8, condição 3, H-110).

## 9. Riscos

| # | Risco | Tratamento |
|---|---|---|
| R1 | Assinatura rígida demais recusa JPEG legítimo (por exemplo, primeiro byte antes do `FF D8`) | JPEG de câmera e de navegador começa em `FF D8 FF`; conjunto de teste com as variantes `E0`, `E1`, `DB`; contador `recusa_assinatura` ao vivo mostra a taxa; risco aceito e baixo |
| R2 | Leitor próprio com defeito aprova saída suja | Controle positivo e negativo (X-06), falha fechada, lista permitida; revisão do leitor no Code Review |
| R3 | Atualização do `sharp` passa a copiar metadado | Versão fixada (`0.35.5`); X-02 a X-05 rodam em todo `check:all`; teste estático contra funções de metadado |
| R4 | Ajuste dos fakes da #40 esquecido | Descrito em §7; sem ele os testes de sucesso quebram e acusam na hora |
| R5 | #41 e #40 mexem nos mesmos arquivos | #41 começa o DEV só quando a #40 sair de QA (§0) |
| R6 | PNG e WebP com metadado pesado ou animado aumentam tempo e memória | Limites da #40 (64 MP, 10 s, 4 simultâneas) valem; nenhum caso novo de volume aqui |
| R7 | A leitura do original inteiro só para olhar 16 bytes | Mantida: já ocorre na #40 e a leitura parcial exigiria método novo na porta; revisitar com H-110 se a taxa de recusa for alta |
| R8 | Falso senso de que "tipo por conteúdo" cobre HEIC do iPhone | Continua recusado (decisão 80/95); conversão é spike próprio (R-25) |

## 10. Plano para o DEV (ordem sugerida)

0. Confirmar a #40 fora de QA e a árvore limpa nos arquivos da #40. 1. `image-type.ts` + `index.ts` + X-01. 2. Helpers `construtores-imagem.ts` e `estrutura-imagem.ts` + X-06 (o leitor primeiro). 3. X-02 a X-05 com o redutor real (se algo vazar metadado, corrigir dentro do limite de 2 ciclos). 4. Chamada em `reduzirTentativa` + ajuste dos fakes da #40 + X-07 a X-11. 5. X-12 e `corepack pnpm check:all`. 6. Evidência na Issue #41 com comando, contagem e código de saída; Vercel e Linux como `NÃO VERIFICADO`.

## 11. Dúvidas ao líder (não bloqueiam o DEV)

1. **Verificação de metadado também em tempo de execução?** Poderia-se rodar um verificador da saída antes de `putReduced`. **Recomendação:** não; o reencode já constrói a saída do pixel, a versão do `sharp` é fixa e a prova roda em todo `check:all`. **Alternativa:** guarda em produção (custo de microssegundos, mas muda o contrato da #40 com uma causa transitória nova). Não bloqueia.
2. **HEIC com mensagem própria para o visitante.** Hoje o cliente só distingue HEIC quando ele é declarado (415). Para HEIC com tipo declarado JPEG, o servidor devolve `imagem_invalida` e a mensagem é genérica. **Recomendação:** aceitar (decisão 95). Não bloqueia.
3. **Sem tipo declarado** é caso da #39 (415 na emissão); nesta história só se confirma por teste, sem alteração.
