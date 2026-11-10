# S-06 — Resultado: memória e tempo do reencode de fotos

- **Issue:** #11 ("[Spike] Memória e tempo do reencode de fotos"). **Data:** 2026-11-10. **Branch:** `feature/init`. **Workflow:** WF-03 adaptado a spike, coluna Arquitetura.
- **Refs:** decisão 31 (≈ 0,5 MB, ≤ 1.280 px), D10 (marca d'água), R-11, R-31, P-03; plano 19, S-06.

## Resumo em linguagem simples

Reduzir uma foto de 3000x4000 para 1.280 px leva em média menos de meio segundo e usa de 80 a 130 MB de memória, muito abaixo dos 2 GB da Vercel; todas as 21 imagens de teste ficaram abaixo de 0,5 MB, até a pior possível (ruído puro).
Dá para manter o teto de 0,75 MB, processando uma foto por vez; ficaram sem medir o HEIC, o limite real de 1 CPU/2 GB e a marca d'água no Linux da Vercel.

## 1. Ambiente e versões

| Item | Valor |
|---|---|
| Máquina | Windows 11, 12 núcleos lógicos (não é a instância da Vercel) |
| Node | 22.14.0 |
| sharp | 0.35.5 (instalado só no scratchpad, fora do repositório; `package.json` do repo intocado) |
| libvips / mozjpeg / libheif | 8.18.7 / commit 0826579 / 1.23.5 |
| exif-reader | 2.0.3 (só para conferir os metadados) |
| pnpm (corepack) | 10.34.9 (não usado nas medições) |
| Entradas | 20 imagens sintéticas 3000x4000 (10 JPG q92 de 2,0 a 10,0 MB; 10 PNG de ≈ 35 MB) + 1 imagem de estresse (PNG 4,7 MB com ruído branco pleno). Geradas por script com PRNG fixo, sem dados reais, fora do repositório. Ruído de amplitude crescente (6 a 120 de 255); EXIF e GPS fictícios injetados (10°S, 20°W, inexistentes); orientação 6 em 1 de cada 3 arquivos. |

Observação: os PNG sintéticos (35 MB) excedem a entrada de 10 MB do RF-025; foram usados como pior caso de decodificação. Os JPG cobrem a faixa realista.

## 2. Método

Rotina (`reencode`): `sharp(input, {limitInputPixels: 64 MP}).rotate()` (aplica o EXIF), `resize(1280, 1280, fit inside, sem ampliar)`, achata alfa em branco, saída bruta em memória; depois JPEG (mozjpeg) com qualidade em degraus 80, 72, 65, 58, 50, 44, 38, 32 até caber em 500.000 bytes. Sem `withMetadata`, nenhum metadado é gravado. `sharp.cache(false)`. 1 MB = 1.000.000 bytes.

Medição: um processo Node novo por imagem (partida a frio), tempo por `hrtime` ao redor do reencode (sem a carga do módulo), pico por `process.resourceUsage().maxRSS` (inclui o runtime Node, ≈ 58 MB só com o sharp carregado). Comandos (scripts no scratchpad, não versionados): `node gen.cjs`, `node gen_stress2.cjs`, `node run.cjs <threads> <mozjpeg 0|1>`, `node conc.cjs <N> <jpg|png> <threads>`, `node --expose-gc seq.cjs`, `node extras.cjs`, `node wm.cjs`.

## 3. Resultados

### 3.1 Por imagem, 1 thread do libvips, mozjpeg (cenário alvo; 21 imagens)

| Grupo | Tempo mediana / p95 / máx (ms) | Pico de memória mediana / máx (MB) | Saída mediana / máx (KB) | Cabe em 0,5 MB | Cabe em 0,75 MB | Cabe em 1 MB |
|---|---|---|---|---|---|---|
| JPG 3000x4000 (10) | 288 / 438 / 438 | 78 / 82 | 123 / 282 | 10/10 | 10/10 | 10/10 |
| PNG 3000x4000 (10) | 511 / 592 / 592 | 111 / 111 | 122 / 281 | 10/10 | 10/10 | 10/10 |
| Estresse, ruído branco (1) | 1.121 | 81 | 476 (2 passos, q72) | 1/1 | 1/1 | 1/1 |
| **Todas (21)** | **459 / 592 / 1.121** | **82 / 111** | **122 / 476** | **21/21** | **21/21** | **21/21** |

Dimensões finais corretas: 1.280x960 ou 960x1.280 (a rotação do EXIF foi aplicada). Só o estresse precisou de mais de 1 passo de qualidade; as demais ficaram em q80 com 84 a 282 KB. O 0,5 MB é, portanto, um teto, não o tamanho típico.

### 3.2 Variantes (mesmas 21 imagens)

| Variante | Tempo mediana / máx (ms) | Pico de memória máx (MB) | Saída máx (KB) |
|---|---|---|---|
| 1 thread, mozjpeg (base) | 459 / 1.121 | 111 | 476 |
| 12 threads do libvips | 468 / 1.155 | 134 | 476 |
| 1 thread, sem mozjpeg | 236 / 463 | 111 | 450 (mediana 170 KB, ≈ 40% maior nas fotos comuns) |

Threads extras não ajudam (e aumentam a memória); na Vercel (1 vCPU) usar `sharp.concurrency(1)`. Mozjpeg custa ≈ 2x o tempo e rende ≈ 30% menos bytes.

### 3.3 Concorrência dentro de um mesmo processo (como uma instância atendendo N pedidos)

Entradas: as N imagens mais ruidosas de cada tipo; buffers de entrada incluídos no pico (PNG de 35 MB cada).

| N simultâneos | JPG: pico MB / parede ms | PNG 35 MB: pico MB / parede ms |
|---|---|---|
| 1 | 82 / 473 | 109 / 613 |
| 2 | 102 / 500 | 160 / 723 |
| 4 | 140 / 607 | 263 / 804 |
| 8 | 174 / 987 | 409 / 1.475 |

(1 thread; com 12 threads o pico sobe ≈ 15 a 30%.) Tempos de parede são de 12 núcleos; com 1 vCPU o tempo é aproximadamente a soma dos tempos individuais `[ESTIMATIVA, NÃO VERIFICADO]`. Sequencial: 20 imagens no mesmo processo, RSS estável (65 a 98 MB), sem vazamento observado.

### 3.4 Entradas hostis e grandes

| Caso | Resultado |
|---|---|
| Texto renomeado `.jpg` | recusado em 2 ms ("unsupported image format") |
| Cabeçalho HEIC falso | recusado em 1 ms (cabeçalho corrompido) |
| PNG-bomba 15.000x15.000 (225 MP, 0,69 MB) | recusado em 5 ms pelo `limitInputPixels` de 64 MP; pico 59 MB |
| JPG 8000x6000 (48 MP) | aceito, 159 ms, pico 71 MB (o JPG é decodificado já reduzido) |
| PNG 8000x6000 (48 MP) | aceito, 274 ms, pico 108 MB |

### 3.5 Metadados (EXIF/GPS)

Em 3 arquivos (JPG e PNG, com orientação 6 e GPS fictício na entrada): a saída não tem EXIF, ICC nem XMP (`sharp.metadata`), os marcadores JPEG são só DQT/SOF2/DHT e as strings `Exif`, `GPS` e `Synthetic` não aparecem nos bytes. **ExifTool não está instalado; a prova é por `exif-reader`, `sharp` e varredura de marcadores, não por ExifTool.** O perfil ICC é aplicado antes de ser descartado (conversão para sRGB do libvips); não verificado com foto Display P3 real.

### 3.6 Marca d'água (D10) sobre a versão reduzida

Mosaico em SVG com identificador opaco fictício, 35% de opacidade, recomposto e reencodado em JPEG q75 (sem mozjpeg) a cada visualização; 10 repetições após aquecimento, 1 thread:

| Entrada reduzida | Tempo mediana / máx (ms) | Tamanho antes / depois |
|---|---|---|
| JPG suave (84 KB) | 95 / 115 | 84 / 100 KB |
| JPG ruidoso (282 KB) | 108 / 121 | 282 / 270 KB |
| Ruído branco (476 KB) | 98 / 104 | 476 / 480 KB |

Pico do processo 119 MB (inclui as medições anteriores). A marca ficou legível na inspeção visual (Windows). **Não verificado no Linux da Vercel:** o texto SVG depende de fontes do sistema, que podem não existir lá.

## 4. Decisão proposta

1. **Teto técnico: manter 0,75 MB** (alvo 0,5 MB). Medido: 21/21 ≤ 0,48 MB, inclusive ruído branco, com qualidade ≥ 72. A margem é grande; a política "se não couber no teto, recusar" fica só como defesa. Usar o laço de qualidade em degraus (piso q32) parando em ≤ 0,5 MB; recusar se o piso exceder 0,75 MB. Não reduzir abaixo de 1.280 px de lado nem ampliar.
2. **Entrada:** manter 10 MB; validar o tipo por conteúdo; `limitInputPixels` = 64 MP (cobre 48 MP de celulares; recusa a bomba de 225 MP).
3. **Limites de função (reencode e marca d'água):** um ativo por invocação (R-11); `sharp.concurrency(1)` e `sharp.cache(false)`; no máximo 4 reencodes simultâneos por instância (pico medido ≤ 263 MB com PNG de 35 MB; ≤ 140 MB com JPG); memória-alvo de projeto ≤ 512 MB, muito abaixo dos 2 GB do Hobby; duração máxima configurada de 10 s por invocação (medido ≤ 1,2 s a 12 núcleos; folga ≈ 8x para 1 vCPU e partida a frio), muito abaixo dos 300 s. Marca d'água: ≈ 0,1 s por visualização, sem necessidade de cache persistente (D10 e P-05 mantidos).
4. **R-31:** subir a foto direto ao Storage por URL assinada continua recomendado (evita o limite de corpo de função); o reencode lê do Storage em quarentena.

## 5. Riscos e o que NÃO foi medido

| Item | Situação |
|---|---|
| Limite real de memória/CPU (Docker `--memory=1g/2g`, 1 vCPU) | não medido (Docker ausente); só pico RSS e tempo em 12 núcleos. Reavaliar na Vercel em S-09. |
| Binário nativo do sharp e tamanho do pacote na Vercel (Linux) | não verificado (plano 19, S-09) |
| Fontes para a marca d'água no Linux da Vercel | risco: o texto pode não aparecer. Mitigação: converter o identificador em caminhos SVG (sem fonte) ou empacotar uma fonte; testar em S-09 |
| HEIC | sharp 0.35.5 só lista `.avif` como entrada do módulo heif (HEVC não vem no binário pré-compilado); nenhum HEIC real foi testado. Recomendação: recusar HEIC no servidor com mensagem e converter no navegador (canvas), ou decidir WASM em outro spike (R-25) |
| WebP e foto real | não testados (pedido: JPG e PNG sintéticos); imagens sintéticas não representam fotos reais, mas o pior caso (ruído branco) coube |
| Redução no navegador (canvas, Safari/Chrome) | não testada |
| ExifTool | não executado; ver 3.5 |
| Imagem com perfil Display P3 | não testada |

## 6. Limpeza

Todos os arquivos de teste ficaram no scratchpad; nenhuma imagem foi versionada. Nenhum segredo foi lido ou impresso.
