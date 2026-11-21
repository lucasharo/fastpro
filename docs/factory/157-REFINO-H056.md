# Refino H-056 — Fotos a elegíveis com marca d'água (Issue #69)

- **Issue:** #69 `[E6] Fotos a elegíveis com marca d'água` · **História:** H-056 · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner (primeira coluna do quadro).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-20.
- **EXEC-ID:** não atribuído (não informado pelo líder).
- **Natureza:** somente documento. Nenhum código, migração, teste, banco de dados ou alteração no quadro foi realizado. O cartão permanece em Product Owner até decisão humana/Orquestrador.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas:
- `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`.
- `docs/factory/quadro-status.md` (atualizado em 2026-11-20 local, Rodada 145/146).
- `14-BACKLOG.md` (linha H-056, H-027, H-029, H-031, H-032, H-042, H-055, H-057, H-058; Spikes S-06, S-09).
- `04-PRD.md` (RF-025 a RF-031, RF-101, RF-110, RF-136 a RF-139; D10).
- `05-CRITERIOS-ACEITE.md` (FA-001, FA-007, FA-008, FA-025, Q-13).
- `08-ARQUITETURA.md` (§0, §1.1, §4.2, §4.3, §7.2, §9.3, §10 "Storage, mídia e D10", §10.3, §10.4, §16.4; ADR-009, ADR-018).
- `09-MODELO-DADOS.md` (§3.4, §3.8, §3.10, §6, §7, §9 "Capacidade e limites de Storage").
- `10-ADRS.md` (ADR-009 "Mídia: pipeline, D10, marca d'água", ADR-018 "Hospedagem na Vercel e execução serverless", ADR-001).
- `11-ARQ-RISCOS-E-TESTES.md` (Invariantes I-16, I-29, I-30; Testes P-01 a P-06, T-03, T-04, T-07, Q-08, Q-12, Q-13; Riscos R-03, R-31, R-35, R-37).
- `11-DECISOES.md` (Decisões 30, 31, 32, 33, 79 a 88, 150, 213, 252, 424, 448, 563 a 582, 603 a 622, 640 a 645; Rodadas 67, 74, 91, 102, 114, 121, 140, 145, 146, 147).
- Refinos e desenhos correlatos:
  - `93-DESENHO-H027.md` e `98-DESENHO-H029.md` (redução e galeria de fotos do rascunho em `request-photos/p/<uuid>`);
  - `102-REFINO-MIDIA-COMPOSICAO.md` e `104-DESENHO-MIDIA-COMPOSICAO.md` (#141 CONCLUÍDA; montagem de portas e leitor `ReducedPhotoReaderPort`);
  - `117-REFINO-REMOCAO-HISTORICO-ACESSO.md` (#150 CONCLUÍDA; eliminação total de `media_access_log` e resumo diário);
  - `121-REFINO-REMOCAO-BACKUP.md` (#151 CONCLUÍDA; remoção de backup do escopo);
  - `126-REFINO-H032.md` e `127-DESENHO-H032.md` (visibilidade do pedido por papel #45; decisão 424);
  - `137-REFINO-H042.md` e `142-DESENHO-H042.md` (#55 CONCLUÍDA; guarda de elegibilidade `private.professional_access_guard`);
  - `139-REFINO-H055.md` e `153-DESENHO-H055.md` (#68 CONCLUÍDA/APROVADA; descoberta de pedidos, `has_photos` e `request_discovery_photo_flags`);
  - `158-REFINO-H058.md` e `162-DESENHO-H058.md` (#71 em DEV; aceitar trabalho idempotente).
- Migrações aplicadas no repositório:
  - `20261112120000_media_create_asset_quarantine.sql` (tabela `app.media_asset`);
  - `20261112140000_media_expand_reduce_ready.sql` (bucket `request-photos`, status `ready`, JPEG, teto 750 KB, max 1.280 px);
  - `20261112190000_media_expand_photo_order.sql` (`sort_order` de 1 a 5 em `app.media_asset`);
  - `20261113010000_requests_create_service_request.sql` (vínculo `app.media_asset.request_id` preenchido no commit da publicação);
  - `20261113420000_eligibility_expand_professional_access_guard.sql` (função de guarda `private.professional_access_guard`);
  - `20261119100000_requests_expand_discovery_photo_flags.sql` (função `private.request_discovery_photo_flags`).
- Modelo estrutural de referência: `docs/factory/139-REFINO-H055.md`.

Limitações `[NÃO VERIFICADO]`:
- O texto original da Issue #69 no GitHub não foi lido por comando de rede (este agente opera no ambiente estritamente local). O objetivo e os requisitos foram reconstruídos a partir da linha H-056 do backlog oficial (`14-BACKLOG.md`) e do cruzamento minucioso com todas as fontes documentais, ADRs e decisões técnicas aprovadas.
- Nenhum comando de alteração ou migração de banco foi executado (ambiente preservado; sem escritas no Postgres).
- Sem Docker: desenvolvimento contra projeto Supabase na nuvem (plano gratuito) ou runtime Node.js local.
- Sem Mapbox: nenhuma chamada externa de mapas na visualização de fotos.
- Sem e-mail real: Mailpit e templates locais exclusivamente (envio real desligado em desenvolvimento).
- Sem backup de dados: formalmente removido do escopo do projeto (decisão 151 e Rodada 73/85).
- Resposta uniforme sem enumeração: toda recusa de visualização devolve status uniforme anti-enumeração (404 com corpo constante), sem revelar o motivo da inelegibilidade ou detalhes da mídia.

---

## 1. Verificação de fila

- `[VERIFICADO]` O quadro da fábrica (`docs/factory/quadro-status.md`) lista a Issue #69 (`[E6] Fotos a elegíveis com marca d'água`) na coluna **Product Owner (3)**, junto de #131 e #137.
- `[VERIFICADO]` Total de 77 Issues Concluídas no quadro, incluindo fundações essenciais para H-056:
  - **#40 (`H-027`):** Redução e reencode de fotos em quarentena para versão reduzida em `request-photos/p/<id>` (JPEG ≤ 1.280 px, teto 750 KB, alvo ≈ 0,5 MB; bucket privado);
  - **#41 (`H-028`):** Remoção total de EXIF e metadados de localização das fotos;
  - **#42 (`H-029`):** Galeria do dono e leitor de imagem reduzida `ReducedPhotoReaderPort` lendo de `request-photos`;
  - **#44 (`H-031`):** Publicação de pedidos (`app.service_request`), associando as fotos confirmadas via `app.media_asset.request_id`;
  - **#45 (`H-032`):** Visibilidade de localização e dados do pedido (`GET /v1/professional/requests/:id`);
  - **#49 (`H-036`):** Perfil profissional, catálogo de serviços atendidos, base geográfica e raio;
  - **#52 (`H-039`):** Fila de verificação cadastral (`verification_status = 'aprovada'`);
  - **#54 (`H-041`):** Estado da verificação visível;
  - **#55 (`H-042`):** Guarda de elegibilidade na API e no banco (`private.professional_access_guard` modo `descoberta_aceite` e `participacao`);
  - **#57 (`H-044`):** Ativação de trial de 14 dias;
  - **#58 (`H-045`):** Acesso comercial derivado (`billing.access_grant` e `private.commercial_access`);
  - **#68 (`H-055`):** Descoberta de pedidos elegíveis com indicador `has_photos` e função `private.request_discovery_photo_flags`;
  - **#141:** Composição da rota de mídia na API (upload, redução e galeria);
  - **#150:** Exclusão definitiva de `media_access_log` e resumos de mídia;
  - **#151:** Exclusão definitiva de backup, restauração e exportação do escopo do projeto.
- `[VERIFICADO]` Em Desenvolvimento no momento:
  - **#71 (`H-058`):** Aceitar trabalho idempotente (em desenvolvimento em paralelo; fatias 1 a 4 commitadas);
  - **#109 (`H-099`):** Lembretes de prazo, trial e ciclo;
  - **#120 (`H-111`):** Direitos do titular (`dsr_case`);
  - **#123 (`H-114`):** Runbook de incidente e reconciliação;
  - **#124 (`H-115`):** Autorização por recurso e paridade.
- `[VERIFICADO]` No Backlog aguardando ou correlacionadas a H-056:
  - **#70 (`H-057`):** Limite de visualizações por profissional (contador por janela) e sinal de raspagem de fotos;
  - **#72 (`H-059`):** Vagas 4+4 e teto de 8;
  - **#76 (`H-065`):** Conversa criada no aceite (chat somente texto, sem anexos, decisões 32 e 33).
- `[VERIFICADO]` Dependências reais e condição de bloqueio:
  - **Dependências Concluídas:** H-027 (#40), H-029 (#42), H-031 (#44), H-032 (#45), H-042 (#55), H-045 (#58), H-055 (#68), #141 e #150 já estão `Concluídas` no quadro e plenamente operacionais no banco e na API.
  - **Dependência de Desenvolvimento de H-056:** O refino e o desenho de H-056 podem ser concluídos de imediato. O desenvolvimento do fluxo principal (acesso às fotos pelo profissional elegível antes do aceite) **não possui bloqueios pendentes**.
  - **Condição parcial relacionada a H-058 (#71):** A manutenção do acesso às fotos após o prazo de admissão de 7 dias para o profissional **participante** (RF-031, FA-008) depende da existência da tabela `app.acceptance` criada pela Issue #71. Essa verificação é condicional e se integra naturalmente após a conclusão de #71.

---

## 2. Objetivo

Permitir que o **profissional elegível** (com identidade aprovada, conta ativa, e-mail verificado, acesso comercial vigente e serviço/raio compatíveis com o pedido publicado) visualize as **fotos anexadas ao pedido antes de aceitar o trabalho**, de modo a avaliar a viabilidade técnica e a complexidade do serviço antes de manifestar interesse formal (RF-029, D10).

Para proteger a privacidade do cliente e a integridade da plataforma:
1. As imagens são servidas **estritamente com marca d'água dinâmica e repetida** (padrão em mosaico diagonal de baixo contraste), contendo um **identificador curto opaco do profissional visualizador** (não nome, não CPF/CNPJ; mapeável internamente no banco em caso de vazamento) aplicado sobre a **versão reduzida já armazenada** (JPEG ≤ 1.280 px, ≈ 0,5 MB guardada no bucket `request-photos`);
2. **Nenhum arquivo original nem versão master sem marca** é jamais entregue ou oferecido para download a profissionais (RF-030, D10, decisão 31);
3. A imagem com marca d'água é entregue via **URL assinada de curta duração (~60 segundos)**, gerada com HMAC-SHA-256 e vinculada ao profissional, ao pedido e à foto específica (RF-030, P-05);
4. A renderização é efetuada **sob demanda em memória** pela API NestJS (utilizando a biblioteca nativa `sharp` já existente no projeto) **sem cache persistente no servidor**, preservando a cota gratuita de 1 GB de Storage do Supabase (ADR-009, 08 §10.3);
5. A listagem disponibiliza **metadados leves das fotos** e suporta **prévias reduzidas (~320 px)** para navegação rápida em galeria/carrossel, servindo a foto inteira (1.280 px) somente sob clique/abertura, contendo o consumo de transferência de rede dentro do limite restrito de **5 GB/mês de egress** do plano gratuito (R-37, P-05, Q-13);
6. **Nenhum dado pessoal do cliente (PII)** — nome, e-mail, telefone, endereço — é exposto na resposta da foto ou em seus metadados (RF-030, RF-136, I-16, T-03);
7. Em estrito cumprimento à decisão da Rodada 67 e Issue #150 (`117-REFINO-REMOCAO-HISTORICO-ACESSO.md`), **nenhum registro de log por foto acessada** (`media_access_log`) é gravado no banco de dados.

Resultado de negócio: o profissional qualificado obtém todas as informações visuais necessárias para decidir pelo aceite com agilidade e confiança, enquanto a plataforma assegura rastreabilidade contra vazamentos, mitiga raspagem massiva e opera com custo zero na infraestrutura gratuita.

---

## 3. Escopo (dentro de H-056)

1. **Consulta da galeria de fotos do pedido pelo profissional:** rota autenticada `GET /v1/professional/requests/:id/photos`, retornando a lista ordenada das fotos prontas do pedido com seus identificadores de mídia (`id`), ordem de exibição (`sortOrder`) e dimensões declaradas, sem URLs permanentes.
2. **Emissão de URL assinada curta de visualização:** rota autenticada `GET /v1/professional/requests/:id/photos/:photoId/view` que valida a elegibilidade do profissional e emite uma URL assinada temporária (TTL de 60 segundos) apontando para o endpoint de streaming de mídia. Suporte a parâmetro de variante `?variant=preview` (~320 px) ou `?variant=full` (≤ 1.280 px, padrão).
3. **Endpoint de entrega do binário da imagem com marca d'água:** rota `GET /v1/media/watermarked-photos/:token` que valida a assinatura criptográfica HMAC do token, decodifica o identificador do profissional e a foto solicitada, busca o JPEG da versão reduzida no bucket `request-photos` via `ReducedPhotoReaderPort`, compõe a marca d'água em memória via `sharp` e faz o streaming da imagem resultante.
4. **Aplicação dinâmica de marca d'água via `sharp`:**
   - Camada overlay SVG semitransparente em mosaico diagonal (repetição regular com ângulo aproximado de -30° a -45°);
   - Texto da marca d'água contendo o **identificador curto opaco do profissional** (ex.: `FP-XXXX-XXXX`), gerado de forma determinística e pseudonimizada;
   - Baixo contraste (opacidade entre 15% e 25%), legível sob inspeção pericial, sem obstruir a avaliação do trabalho;
   - Renderização no formato `image/jpeg` otimizado em memória, mantendo dimensões compatíveis com a versão guardada (≤ 1.280 px para `full` e ≤ 320 px para `preview`).
5. **Integração com a Guarda de Elegibilidade (H-042):**
   - Profissional não participante só obtém autorização se cumprir todos os critérios da guarda `private.professional_access_guard` modo `descoberta_aceite` no instante `p_now`;
   - Pedido deve estar em `status = 'publicado'` e `p_now < acceptance_deadline_at` (168 horas);
   - Serviço do pedido deve corresponder aos serviços cadastrados do profissional e estar dentro do raio presencial (ou serviço online nacional declarado).
6. **Tratamento do profissional participante (pós-aceite):**
   - Profissional que já aceitou o pedido (`app.acceptance` ativo) mantém acesso autorizado às fotos com marca d'água mesmo após a expiração dos 7 dias corridos (`p_now >= acceptance_deadline_at`), até o encerramento do pedido (RF-031, FA-008).
7. **Visualização pelo cliente dono do pedido:**
   - O cliente autenticado dono do pedido (`customer_user_id`) pode visualizar as fotos do seu pedido através da rota do dono (ou redirecionamento autorizado) sem a marca d'água de profissional, consumindo a versão reduzida já armazenada em `request-photos`.
8. **Silêncio uniforme e anti-enumeração:**
   - Profissional inelegível, pedido inexistente, pedido de outro serviço ou foto não pertencente ao pedido recebem a mesma resposta HTTP `404 Not Found` com corpo constante `{ code: "foto_nao_encontrada" }` (ou `pedido_nao_encontrado`), sem vazar a razão da recusa (financeira, territorial ou cadastral).
9. **Cabeçalhos de proteção e anti-cache:**
   - Envio compulsório de `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` e `Content-Disposition: inline`.
10. **Proteção de memória e limites operacionais (S-06, S-09):**
    - Execução do reencode com concorrência controlada (sem filas residentes pesadas);
    - Timeout estrito de renderização (ex.: 5 segundos);
    - Em caso de estouro de memória ou timeout, resposta limpa com HTTP 503 fixo `{ code: "renderizacao_indisponivel" }`, sem travar a função serverless.
11. **Testes automatizados completos:** testes unitários de geração de overlay e token, testes de rota, testes de autorização e guarda, testes de integridade do JPEG com sharp e fakes, e testes de não regressão contra vazamento de PII.

---

## 4. Fora de escopo

- **Contador por janela e sinal de raspagem:** pertence estritamente à história H-057 (#70). H-056 não emite `abuse_signal` nem aplica suspensão cautelar de acesso a fotos; H-056 fornece a rota e valida o rate limit HTTP básico da API.
- **Log de acesso por foto (`media_access_log`):** formalmente eliminado do produto pela Issue #150 (`117-REFINO-REMOCAO-HISTORICO-ACESSO.md`). Não criar tabela, trigger nem registro de auditoria por foto acessada.
- **Upload, quarentena e redução inicial de fotos:** já entregues e concluídos em H-026 (#39), H-027 (#40) e H-029 (#42).
- **Publicação de pedidos e vínculo de fotos:** já entregues em H-031 (#44) e H-055 (#68).
- **Ação de aceitar trabalho ("Aceitar trabalho"):** pertence à história H-058 (#71). H-056 não cria aceites nem consome vagas.
- **Controle de vagas 4+4 e botão de 2ª onda:** pertencem a H-059 (#72) e H-060 (#134).
- **Anexos e envio de imagens no chat:** formalmente proibidos no produto pelas decisões 32 e 33 (chat é estritamente texto; não há buckets, URLs nem marcas d'água no chat).
- **Backup e restauração de fotos:** formalmente removido do escopo do projeto (decisão 151 e Rodada 73/85).
- **Chamadas a provedores externos de mapas ou CDNs pagas:** proibição total de dependências externas em tempo de execução. Todo o processamento é local na API NestJS e Storage Supabase.

---

## 5. Fluxos e estados

### 5.1 Rota e controle de acesso

O acesso a fotos pelo profissional divide-se em duas etapas: obtenção dos metadados da galeria e obtenção da imagem renderizada.

```
[Cliente Web/App Profissional]
        |
        | 1. GET /v1/professional/requests/{id}/photos
        v
[API: Auth & Sessão] -------> (Sem sessão) ----------------------> 401 sessao_necessaria
        |
        +-------------------> (Não profissional) ---------------> 403 perfil_profissional_obrigatorio
        |
[API: Guarda H-042 & Pedido] -> (Inelegível / Fora raio / Exp.) -> 404 foto_nao_encontrada (uniforme)
        |
        | (Elegível)
        v
200 OK: { photos: [{ id, sortOrder, width, height }] }
        |
        | 2. GET /v1/professional/requests/{id}/photos/{photoId}/view?variant=preview|full
        v
[API: Validação & Assinatura] -> Gera token HMAC curto (60 s) com professional_id, photo_id e exp
        |
        v
200 OK: { view_url: "/v1/media/watermarked-photos/{token}", expires_in: 60 }
        | (ou redirecionamento 307 Temporary Redirect)
        |
        | 3. GET /v1/media/watermarked-photos/{token}
        v
[API: Validação do Token HMAC] -> (Expirado ou adulterado) -------> 403 link_expirado (ou 404)
        |
        | (Token Válido)
        v
[API: Busca JPEG Reduzido] ---> Leitura em request-photos/p/{photoId} via ReducedPhotoReaderPort
        |
        v
[API: Engine Sharp em Memória] -> Gera overlay SVG em mosaico com identificador opaco
        |                        Aplica composição sobre a imagem JPEG (redimensiona se variant=preview)
        v
200 OK (image/jpeg): binário da foto com marca d'água (Cache-Control: private, no-store)
```

### 5.2 Guarda de elegibilidade e matriz de acesso

A permissão para visualizar fotos do pedido é avaliada com relógio injetado (`p_now`):

| Papel do Solicitante | Estado do Profissional / Pedido | Posição no Pedido | Resultado da Verificação | Efeito HTTP |
|---|---|---|---|---|
| Anônimo | Qualquer | — | Sem autenticação | 401 `sessao_necessaria` |
| Cliente | Sessão válida | Dono do pedido (`customer_user_id`) | Autorizado (sem marca de profissional) | 200 OK (foto original reduzida) |
| Cliente | Sessão válida | Não é dono do pedido | Recusado | 404 uniforme |
| Profissional | Verificação pendente / recusada | — | Falha na guarda (H-042) | 404 uniforme (silêncio) |
| Profissional | Assinatura expirada (sem carência) | — | Falha comercial (H-045) | 404 uniforme (silêncio) |
| Profissional | Aprovado + comercial ativo | Pedido fora do raio ou outro serviço | Falha de casamento territorial/serviço | 404 uniforme |
| Profissional | Aprovado + comercial ativo | Pedido publicado e `p_now < deadline` | **Elegível antes do aceite** | **200 OK (foto com marca d'água)** |
| Profissional | Aprovado + comercial ativo | Pedido expirado (`p_now >= deadline`), não aceitou | Prazo de admissão encerrado (RF-031) | 404 uniforme |
| Profissional | Aprovado + comercial ativo | Pedido expirado ou em andamento, **com aceite ativo** | **Participante legítimo** (RF-031, FA-008) | **200 OK (foto com marca d'água)** |
| Profissional | Suspenso / Bloqueado | Qualquer | Falha na guarda (H-042) | 404 uniforme |

**Invariante de Anti-enumeração e Silêncio Comercial (decisão 569, RF-137):** Um profissional inelegível ou não autorizado que tenta acessar fotos de um pedido recebe exatamente a mesma resposta `404 Not Found` que receberia se o pedido ou a foto não existissem. A rota jamais revela se a foto existe, se o pedido é válido, se o profissional está inadimplente ou se a verificação cadastral foi reprovada.

### 5.3 Marca d'água dinâmica e identificador opaco do profissional

1. **Identificador opaco do profissional (Viewer Identifier):**
   - O identificador não deve conter o nome do profissional (evita expor PII do profissional em raspagens ou tokens).
   - Não deve conter CPF nem CNPJ (violação grave de proteção de dados sensíveis).
   - Não deve expor o UUID primário do banco em claro, caso o líder opte por token curto pseudonimizado.
   - Padrão recomendado: string curta de 10 a 14 caracteres alfanuméricos derivada deterministicamente via HMAC-SHA-256 do `professional_id` com segredo do ambiente (`WATERMARK_ID_SALT`), formatada como prefixo legível (ex.: `FP-7K9A-3M2X`).
   - Mapeamento determinístico: a moderação/segurança da plataforma consegue reconstituir instantaneamente qual profissional visualizou a imagem a partir do código impresso, comparando o HMAC com a base de profissionais.

2. **Geometria e estilo visual do mosaico:**
   - Padrão em mosaico com linhas de texto repetidas inclinadas em ângulo de **-30 graus** em relação ao plano horizontal.
   - Espaçamento horizontal de ~180 a 240 pixels e vertical de ~120 a 160 pixels entre repetições.
   - Tipografia: fonte limpa sem serifa (`sans-serif` ou `Arial/Helvetica`), negrito moderado.
   - Cor e transparência: texto branco ou cinza claro com sombra sutil em baixo contraste, renderizado com opacidade entre **18% e 22%** (`rgba(255,255,255,0.20)` ou com modo de mescla suave).
   - Propriedade anti-remoção: a repetição em grade contínua cobre o centro, as bordas e os cantos da foto, impedindo que um invasor remova a marca d'água por corte periférico (crop) ou máscara simples.

3. **Geração do overlay via SVG no Sharp:**
   - A API gera um buffer SVG em memória com dimensões iguais às da imagem base (`ready_width` × `ready_height`).
   - O SVG utiliza `<pattern>` repetido com o identificador do profissional e `<rect width="100%" height="100%" fill="url(#watermark-pattern)"/>`.
   - O `sharp` faz o composite da camada SVG sobre o buffer JPEG da versão reduzida lida do Storage, emitindo o JPEG final em uma única passagem de processamento.

```
+-------------------------------------------------------+
|  FP-7K9A-3M2X        FP-7K9A-3M2X        FP-7K9A-3M2X |
|           FP-7K9A-3M2X        FP-7K9A-3M2X            |
|  FP-7K9A-3M2X        FP-7K9A-3M2X        FP-7K9A-3M2X |
|           FP-7K9A-3M2X        FP-7K9A-3M2X            |
|  FP-7K9A-3M2X        FP-7K9A-3M2X        FP-7K9A-3M2X |
+-------------------------------------------------------+
   (Padrão diagonal em mosaico sobre toda a foto)
```

### 5.4 Token assinado e URL de curta duração (~60 segundos)

1. A URL de visualização da foto contém um token opaco assinado com TTL estrito de 60 segundos.
2. Estrutura do payload assinado:
   - `pid`: UUID da foto (`media_asset.id`);
   - `rid`: UUID do pedido (`service_request.id`);
   - `usr`: UUID do profissional (`app_user.id` / `professional_id`);
   - `exp`: Timestamp Unix de expiração (emissão + 60 segundos);
   - `var`: Variante solicitada (`p` para preview, `f` para full).
3. Mecanismo de assinatura:
   - HMAC-SHA-256 gerado sobre a concatenação dos campos com a chave de segredo `WATERMARK_TOKEN_SECRET`;
   - Formato compacto codificado em `base64url`: `payload_base64url.assinatura_base64url`.
4. Validação na entrega:
   - O endpoint decodifica o token, valida a assinatura HMAC e confere se `p_now <= exp`.
   - Se a assinatura for inválida ou o token estiver expirado, a API rejeita imediatamente com HTTP 403 `{ code: "link_expirado" }` (ou 404 uniforme), sem consumir CPU de renderização nem tocar no Storage.

### 5.5 Renderização sob demanda e contenção de memória (S-06, S-09)

1. **Sem armazenamento em disco/Storage:** A foto derivada com marca d'água **nunca é persistida no bucket `request-photos`** nem em qualquer tabela do banco. Isso elimina o risco de exaustão do teto de 1 GB de Storage e evita vazamentos por acúmulo de arquivos derivados.
2. **Ciclo de vida em memória:**
   - Leitura do buffer JPEG da versão reduzida via `ReducedPhotoReaderPort` (buffer de ≈ 0,3 MB a 0,5 MB);
   - Execução da composição SVG no `sharp` em processo único (conforme ADR-001 e Spike S-06);
   - Transmissão direta do buffer resultante no corpo da resposta HTTP;
   - Coleta de lixo imediata do buffer.
3. **Contenção e timeout:**
   - Timeout de renderização de 5 segundos via `AbortSignal` ou temporizador de promessa;
   - Em caso de falha de carregamento do sharp ou falta temporária de memória na função serverless, a API devolve HTTP 503 fixo `{ code: "renderizacao_indisponivel" }`, preservando a estabilidade da instância.

### 5.6 Minimização de transferência e controle de egress (R-37, P-05, Q-13)

1. **Variante Preview (`?variant=preview`):**
   - Na listagem de fotos de um pedido, o front-end carrega inicialmente as miniaturas com largura máxima de 320 px (`ready_width` reescalado proporcionalmente).
   - O arquivo de prévia com marca d'água tem peso médio de apenas 25 KB a 45 KB (aproximadamente 10% do peso da imagem cheia).
   - Para um pedido com 5 fotos, a visualização da grade consome apenas ~180 KB em vez de 2,5 MB de dados.
2. **Variante Full (`?variant=full`):**
   - Servida apenas quando o profissional clica explicitamente em uma foto específica para vê-la em detalhe/tela cheia.
   - Peso médio de ≈ 400 KB a 550 KB, limitada a 1.280 px.
3. **Impacto no limite de 5 GB/mês de egress do Supabase:**
   - Reduz o consumo em até 80% durante a navegação exploratória dos profissionais, permitindo que a plataforma suporte com folga as centenas de acessos mensais estimados para a fase de lançamento.

---

## 6. Regras de negócio e invariantes

| Ref. | Regra | Fonte | Como H-056 atende |
|---|---|---|---|
| RN-H056-01 | **Elegibilidade mandatória pré-aceite.** Profissional não participante só vê fotos se estiver aprovado na verificação, com conta ativa, e-mail verificado, acesso comercial ativo e casamento válido de serviço e raio presencial (ou online nacional). | RF-029, FA-007; `08` §10.3 | Integração com `private.professional_access_guard` modo `descoberta_aceite`; CA-H056-03 e 04 |
| RN-H056-02 | **Marca d'água compulsória com identificador opaco.** Toda foto entregue a profissional contém obrigatoriamente marca d'água repetida em mosaico com identificador curto opaco do profissional. | RF-030, D10, P-05; `08` §10.3 | Composição overlay SVG via `sharp` com identificador derivado; CA-H056-06 e 07 |
| RN-H056-03 | **Proibição absoluta de entrega do original.** O original e qualquer master sem marca d'água jamais são disponibilizados para download ou visualização por profissionais. | RF-030, D10, decisão 31; I-29 | O leitor acessa exclusivamente `request-photos/p/<id>` e entrega apenas o buffer com marca; CA-H056-08 |
| RN-H056-04 | **URL assinada de curta duração (~60 s).** O link direto para o binário da imagem expira em no máximo 60 segundos após a emissão, bloqueando acessos posteriores e links vazados. | RF-030, FA-007, FA-008; P-05 | Token HMAC-SHA-256 com timestamp `exp = now + 60s`; CA-H056-09 e 10 |
| RN-H056-05 | **Renderização sob demanda sem cache persistente.** As imagens marcadas são geradas dinamicamente na API e nunca salvas no Storage. | ADR-009; `08` §10.3 | Processamento em memória via `sharp` e descarte pós-streaming; CA-H056-11 |
| RN-H056-06 | **Participante mantém acesso pós-expiração.** O profissional que aceitou formalmente o trabalho (`app.acceptance`) continua visualizando as fotos após os 7 dias corridos do pedido. | RF-031, FA-008 | Avaliação do status de participação do profissional; CA-H056-12 |
| RN-H056-07 | **Elegível não participante perde acesso pós-expiração.** Profissional que não aceitou o pedido perde o acesso às fotos imediatamente após `p_now >= acceptance_deadline_at`. | RF-031, FA-008 | Bloqueio automático pelo prazo de admissão; CA-H056-13 |
| RN-H056-08 | **Silêncio uniforme e anti-enumeração.** Profissional não elegível, suspenso, sem plano ou fora do raio recebe erro HTTP 404 uniforme. Nenhuma resposta revela dados financeiros ou cadastrais. | Decisão 569, RF-137 | Resposta constante 404 `{ code: "foto_nao_encontrada" }`; CA-H056-14 |
| RN-H056-09 | **Blindagem total de PII junto das fotos.** Nenhuma resposta de foto traz primeiro nome, e-mail, telefone, endereço ou coordenadas do cliente. | RF-030, RF-136, I-16, T-03 | Serialização isolada; resposta binária JPEG limpa sem EXIF; CA-H056-15 |
| RN-H056-10 | **Prevenção de exaustão de egress (Variante Preview).** Suporte à variante reduzida de ~320 px para grade e listagem antes da abertura em tela cheia. | R-37, P-05, Q-13 | Parâmetro `variant=preview` gerando miniatura leve com marca; CA-H056-16 |
| RN-H056-11 | **Cabeçalhos de proteção e anti-cache.** Envio obrigatório de `Cache-Control: private, no-store`, `Content-Disposition: inline` e CSP restritiva. | `08` §10.3; CA-H056-17 | Cabeçalhos padronizados em todas as respostas de imagem; CA-H056-17 |
| RN-H056-12 | **Ausência estrita de log de acesso por foto.** Nenhum registro de visualização é inserido em tabela de auditoria ou log por foto acessada. | Decisão da Rodada 67; Issue #150 | Cumprimento integral da eliminação de `media_access_log`; CA-H056-18 |
| RN-H056-13 | **Cliente dono acessa as próprias fotos.** O cliente dono do pedido acessa as fotos de seu pedido na íntegra sem marca d'água de profissional. | RF-026, RF-028; `08` §10.3 | Rota de acesso do dono na sessão do cliente; CA-H056-19 |
| RN-H056-14 | **Determinismo temporal nos testes.** Prazos de expiração de token e de admissão utilizam relógio injetado `p_now` (`clock.nowMs()`). | Decisão 517, P4; `08` §1.1 | Injeção do `ClockPort` de domínio; CA-H056-20 |

Invariantes citadas:
- **I-16** (nenhuma consulta a profissional retorna e-mail; telefone só com consentimento; endereço exato só com compartilhamento): H-056 cumpre rigorosamente na visualização das imagens.
- **I-29** (no máximo 5 fotos por pedido/rascunho; persistida somente a versão reduzida ≤ 1.280 px, teto 750 KB, sem original guardado): H-056 consome exclusivamente essa versão reduzida já validada.
- **I-30** (chat é somente texto; sem anexos de imagem ou PDF): fotos existem unicamente no pedido; nenhum pipeline de mídia no chat.
- **D10** (fotos visíveis antes de aceitar com URL assinada curta, marca d'água por visualizador, sem download do original e sem log de acesso por foto): princípio fundacional de H-056.
- **P-05** (derivada = versão reduzida + marca d'água, nunca maior que a guardada; prévia ≈ 320 px; `no-store`).

---

## 7. Critérios de aceite (Given / When / Then)

Todos os critérios são testáveis e mensuráveis. Testes de API e domínio rodam localmente com dados sintéticos e relógio controlado (`nowMs`), sem chamadas externas nem dependência de Docker.

- **CA-H056-01 (Autenticação obrigatória para listar fotos do pedido).**
  - **Dado** uma requisição a `GET /v1/professional/requests/{id}/photos` sem cookie de sessão ou com cookie inválido/expirado,
  - **Quando** a rota é acionada,
  - **Então** responde HTTP `401 Unauthorized` com corpo `{ code: "sessao_necessaria" }` e cabeçalho `Cache-Control: no-store`.

- **CA-H056-02 (Perfil não profissional recebe recusa).**
  - **Dado** uma sessão válida pertencente a um usuário que é apenas cliente (`app.customer_profile`) e não possui perfil profissional,
  - **Quando** requisita a rota de fotos do profissional,
  - **Então** responde HTTP `403 Forbidden` com `{ code: "perfil_profissional_obrigatorio" }` (ou 404 uniforme anti-enumeração).

- **CA-H056-03 (Profissional elegível lista metadados das fotos do pedido).**
  - **Dado** um profissional elegível (aprovado, ativo, e-mail verificado, acesso comercial vigente, serviço e raio compatíveis),
  - **E** um pedido publicado com 3 fotos com status `ready` ordenadas em `sort_order` 1, 2 e 3,
  - **Quando** consulta `GET /v1/professional/requests/{id}/photos`,
  - **Então** responde HTTP `200 OK` contendo a lista `photos` com exatamente 3 itens, com campos `id`, `sortOrder`, `width` e `height`, sem expor URLs permanentes nem caminhos de bucket.

- **CA-H056-04 (Silêncio financeiro: profissional não elegível recebe 404 uniforme).**
  - **Dado** um profissional cuja verificação cadastral está em `pendente`, `recusada` ou `suspensa`, ou cujo acesso comercial está expirado/sem acesso,
  - **E** existindo um pedido publicado com fotos na sua região,
  - **Quando** o profissional requisita a listagem de fotos ou a emissão de token de visualização de foto,
  - **Então** a API responde HTTP `404 Not Found` com corpo `{ code: "foto_nao_encontrada" }`, sem vazar a razão financeira ou cadastral da recusa.

- **CA-H056-05 (Profissional fora do raio ou outro serviço recebe 404 uniforme).**
  - **Dado** um profissional elegível com raio de 15 km,
  - **E** um pedido publicado com fotos localizado a 40 km de distância de sua base,
  - **Quando** o profissional requisita a rota de fotos do pedido,
  - **Então** responde HTTP `404 Not Found` com corpo `{ code: "foto_nao_encontrada" }`.

- **CA-H056-06 (Emissão de URL assinada de visualização de foto).**
  - **Dado** um profissional elegível solicitando visualização da foto com `photoId` válido pertencente ao pedido,
  - **Quando** chama `GET /v1/professional/requests/{id}/photos/{photoId}/view?variant=preview`,
  - **Então** responde HTTP `200 OK` com `{ view_url: "/v1/media/watermarked-photos/{token}", expires_in: 60 }`, contendo token HMAC assinado com validade de 60 segundos.

- **CA-H056-07 (Marca d'água dinâmica aplicada no binário da foto).**
  - **Dado** uma requisição válida ao endpoint de mídia com token assinado,
  - **Quando** a imagem é entregue pela API,
  - **Então** o corpo binário é um JPEG válido (`image/jpeg`), as dimensões respeitam a variante solicitada, e os pixels contêm a composição visual da marca d'água com o identificador curto do profissional em padrão mosaico.

- **CA-H056-08 (Proibição absoluta de download da foto original/sem marca).**
  - **Dado** qualquer requisição de profissional para visualização de foto,
  - **Quando** a resposta de mídia é processada,
  - **Então** o cabeçalho `Content-Disposition` é `inline`, e a imagem entregue jamais é o JPEG bruto sem marca d'água guardado no Storage.

- **CA-H056-09 (Token expirado além de 60 segundos devolve 403/404).**
  - **Dado** uma URL de foto assinada cujo timestamp de criação foi há 65 segundos (`nowMs > exp`),
  - **Quando** a rota de mídia é acionada com esse token,
  - **Então** a API recusa a requisição com HTTP `403 Forbidden` `{ code: "link_expirado" }` (ou 404 uniforme) e nenhum processamento de imagem é executado.

- **CA-H056-10 (Token adulterado ou com assinatura forjada devolve 403/404).**
  - **Dado** um token cuja assinatura HMAC foi alterada em 1 byte ou forjada com chave incorreta,
  - **Quando** requisitado na API,
  - **Então** responde HTTP `403 Forbidden` `{ code: "link_invalido" }` (ou 404 uniforme).

- **CA-H056-11 (Renderização sob demanda sem gravação de arquivo derivado).**
  - **Dado** 10 requisições consecutivas de profissionais distintos para visualizar a mesma foto,
  - **Quando** inspecionado o bucket `request-photos` no Storage,
  - **Então** nenhuma imagem nova ou arquivo derivado foi inserido no bucket (o Storage permanece com exatamente o mesmo número de objetos reduzidos).

- **CA-H056-12 (Profissional participante mantém acesso após os 7 dias).**
  - **Dado** um profissional que aceitou formalmente o pedido (`app.acceptance` ativo),
  - **E** o pedido atingiu prazo expirado (`p_now >= acceptance_deadline_at`),
  - **Quando** o profissional participante requisita as fotos do pedido,
  - **Então** ele obtém a visualização normalmente com sua marca d'água (acesso preservado conforme RF-031 e FA-008).

- **CA-H056-13 (Elegível não participante perde acesso após os 7 dias).**
  - **Dado** um profissional elegível que NÃO aceitou o trabalho,
  - **E** o prazo de 7 dias expirou (`p_now >= acceptance_deadline_at`),
  - **Quando** tenta requisitar fotos do pedido,
  - **Então** a API responde HTTP `404 Not Found` `{ code: "foto_nao_encontrada" }`.

- **CA-H056-14 (Foto pertencente a outro pedido devolve 404).**
  - **Dado** uma requisição combinando um `requestId` válido e um `photoId` válido de outro pedido,
  - **Quando** processada pela API,
  - **Então** responde HTTP `404 Not Found` `{ code: "foto_nao_encontrada" }`.

- **CA-H056-15 (Blindagem estrita de PII na resposta e nos metadados).**
  - **Dado** o endpoint de metadados de fotos e o endpoint de binário de imagem,
  - **Quando** inspecionados o corpo JSON, os cabeçalhos HTTP e os bytes EXIF da imagem retornada,
  - **Então** não há primeiro nome, e-mail, telefone, endereço, coordenada ou chave de bucket.

- **CA-H056-16 (Variante preview com peso e dimensões reduzidas).**
  - **Dado** uma foto guardada com 1.280 × 960 px e 450 KB,
  - **Quando** requisitada com `variant=preview`,
  - **Então** a imagem gerada tem largura máxima de 320 px e tamanho em bytes inferior a 60 KB, com a marca d'água proporcional legível.

- **CA-H056-17 (Cabeçalhos HTTP obrigatórios na entrega de imagem).**
  - **Dado** qualquer entrega com sucesso da imagem com marca d'água,
  - **Quando** inspecionados os cabeçalhos da resposta,
  - **Então** constam `Content-Type: image/jpeg`, `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` e `Content-Disposition: inline`.

- **CA-H056-18 (Sem registro em log de acesso a fotos / Issue #150).**
  - **Dado** a execução completa da visualização de 5 fotos de um pedido por um profissional,
  - **Quando** inspecionado o banco de dados antes e depois da operação,
  - **Então** nenhuma linha foi gravada em qualquer tabela de log de acesso a fotos (ausência absoluta de `media_access_log`).

- **CA-H056-19 (Visualização das fotos pelo cliente dono do pedido).**
  - **Dado** a sessão ativa do cliente dono do pedido (`customer_user_id`),
  - **Quando** acessa as fotos de seu pedido,
  - **Então** visualiza as imagens reduzidas sem a marca d'água de profissional.

- **CA-H056-20 (Tratamento de timeout e falha de memória do sharp).**
  - **Dado** um cenário de simulação de carga extrema onde o processamento do sharp excede 5 segundos ou lança erro de memória,
  - **Quando** a API trata a falha,
  - **Então** devolve HTTP `503 Service Unavailable` `{ code: "renderizacao_indisponivel" }`, sem derrubar o processo e sem vazar stack trace.

- **CA-H056-21 (Execução autossuficiente sem Docker nem Mapbox).**
  - **Dado** o ambiente local de desenvolvimento,
  - **Quando** toda a suíte de testes de H-056 é executada,
  - **Então** todos os testes passam sem chamadas de rede externa e sem depender de provedores terceiros.

---

## 8. Matriz de cenários de teste e cobertura

| Identificador | Cenário de Teste | Condição / Fixture | Resultado Esperado | Critério de Aceite |
|---|---|---|---|---|
| CT-01 | Sessão anônima em fotos | Requisição sem cookie de sessão | 401 `{code: "sessao_necessaria"}` | CA-H056-01 |
| CT-02 | Sessão de cliente na rota profissional | Usuário cliente tenta acessar rota `/professional/requests/:id/photos` | 403 `{code: "perfil_profissional_obrigatorio"}` | CA-H056-02 |
| CT-03 | Profissional elegível lista fotos | Aprovado, ativo, e-mail ok, comercial ok, raio ok; pedido com 3 fotos | 200 OK com array de 3 fotos `{id, sortOrder, width, height}` | CA-H056-03 |
| CT-04 | Verificação pendente | Perfil profissional com `verification_status = 'pendente'` | 404 `{code: "foto_nao_encontrada"}` (silêncio uniforme) | CA-H056-04 |
| CT-05 | Verificação recusada | Perfil profissional com `verification_status = 'recusada'` | 404 `{code: "foto_nao_encontrada"}` (silêncio uniforme) | CA-H056-04 |
| CT-06 | Assinatura expirada | Acesso comercial expirado (após as 72 h de carência) | 404 `{code: "foto_nao_encontrada"}` (silêncio financeiro) | CA-H056-04 |
| CT-07 | Em carência de 72 h | Assinatura vencida há 24 h (dentro da carência de 72 h) | 200 OK com fotos visíveis normalmente | CA-H056-03 |
| CT-08 | Cancelada em vigência | Cancelamento agendado, mas `p_now < ends_at` | 200 OK com fotos visíveis normalmente | CA-H056-03 |
| CT-09 | Pedido fora do raio | Pedido localizado a 50 km para profissional com raio de 20 km | 404 `{code: "foto_nao_encontrada"}` | CA-H056-05 |
| CT-10 | Serviço não atendido | Pedido de serviço que o profissional não marcou em seu catálogo | 404 `{code: "foto_nao_encontrada"}` | CA-H056-05 |
| CT-11 | Emissão de URL de visualização | Profissional elegível solicita token para foto válida | 200 OK com `view_url` e `expires_in = 60` | CA-H056-06 |
| CT-12 | Imagem com marca d'água entregue | Token válido consumido na rota de mídia | 200 OK `image/jpeg` com marca d'água renderizada | CA-H056-07 |
| CT-13 | Inspeção de ausência de original | Verificação dos cabeçalhos da imagem | `Content-Disposition: inline`, sem download do original | CA-H056-08 |
| CT-14 | Token expirado (>60 s) | Token com `exp` vencido há 5 segundos | 403 `{code: "link_expirado"}` (ou 404 uniforme) | CA-H056-09 |
| CT-15 | Token com tag adulterada | Modificação de bytes na assinatura do token | 403 `{code: "link_invalido"}` (ou 404 uniforme) | CA-H056-10 |
| CT-16 | Token com outro usuário | Token gerado para P1 enviado na sessão de P2 | 403/404 recusa de acesso | CA-H056-10 |
| CT-17 | Inexistência de cache no Storage | 5 visualizações consecutivas da mesma foto | Número de objetos no bucket `request-photos` inalterado | CA-H056-11 |
| CT-18 | Participante vê pós-expiração | Profissional com aceite ativo em pedido com 8 dias de publicação | 200 OK com visualização autorizada da foto | CA-H056-12 |
| CT-19 | Não participante barrado pós-expiração | Profissional sem aceite em pedido com 8 dias de publicação | 404 `{code: "foto_nao_encontrada"}` | CA-H056-13 |
| CT-20 | Foto cruzada de outro pedido | `requestId` de A com `photoId` de B | 404 `{code: "foto_nao_encontrada"}` | CA-H056-14 |
| CT-21 | Inspeção de PII na resposta | Análise minuciosa de metadados e headers | Sem nome, e-mail, telefone, endereço ou rota interna | CA-H056-15 |
| CT-22 | Variante preview | Requisição com `?variant=preview` | Largura ≤ 320 px, tamanho < 60 KB | CA-H056-16 |
| CT-23 | Cabeçalhos anti-cache | Inspeção dos cabeçalhos de resposta | `Cache-Control: private, no-store`, `no-referrer` | CA-H056-17 |
| CT-24 | Ausência de log de acesso | Conferência do banco antes e depois do acesso | Nenhuma linha gravada em tabela de log (Issue #150) | CA-H056-18 |
| CT-25 | Cliente dono vê próprias fotos | Sessão do dono acessando foto do seu pedido | 200 OK sem marca d'água de profissional | CA-H056-19 |
| CT-26 | Timeout de renderização sharp | Simulação de processamento excedendo 5 s | 503 `{code: "renderizacao_indisponivel"}` sem falha geral | CA-H056-20 |

---

## 9. Dependências reais conferidas no quadro

Estado verificado em `docs/factory/quadro-status.md` (Rodada 145/146) e base de código:

- **H-027 (#40) — Redução e reencode de fotos:** `Concluído` no quadro. Disponibiliza a versão reduzida em `request-photos/p/<uuid>` (JPEG ≤ 1.280 px, teto 750 KB, sem EXIF).
- **H-029 (#42) — Galeria e leitor de fotos:** `Concluído` no quadro. Fornece a interface `ReducedPhotoReaderPort` e a leitura de `request-photos`.
- **H-031 (#44) — Publicação idempotente com 7 dias:** `Concluído` no quadro. Liga as fotos confirmadas ao pedido via coluna `app.media_asset.request_id`.
- **H-032 (#45) — Visibilidade do pedido por papel:** `Concluído` no quadro. Padronizou rotas com prefixo `/v1/professional/requests/` e listas fechadas de projeção.
- **H-042 (#55) — Guarda de elegibilidade na API e no banco:** `Concluído` no quadro. Disponibiliza `private.professional_access_guard` modo `descoberta_aceite` e `participacao`.
- **H-045 (#58) — Acesso comercial derivado:** `Concluído` no quadro. Fornece `billing.access_grant` e `private.commercial_access`.
- **H-055 (#68) — Descoberta de pedidos elegíveis:** `Concluído` no quadro. Entrega a listagem de pedidos elegíveis com o sinal booleano `has_photos` e a função de banco `private.request_discovery_photo_flags`.
- **#141 — Composição de rotas de mídia:** `Concluído` no quadro.
- **#150 — Remoção do histórico de acesso a fotos:** `Concluído` no quadro. Eliminou formalmente `media_access_log` e resumos de mídia.
- **#151 — Remoção de backup do escopo do projeto:** `Concluído` no quadro.
- **#71 (H-058) — Aceitar trabalho idempotente:** Em `Desenvolvimento` no quadro. Cria a tabela `app.acceptance` e formaliza a relação de participante.
- **Consumidores que aguardam H-056 (#69):**
  - **#70 (H-057, Backlog):** Limite de visualizações por profissional (contador por janela) e sinal de raspagem de fotos.
- **Situação da dependência de H-056:**
  - O núcleo de H-056 — acesso às fotos pelo profissional **elegível antes do aceite** — está plenamente destravado e com todas as fundações concluídas.
  - O caso específico de acesso continuado pelo profissional **participante após os 7 dias** (RF-031) integra-se à tabela `app.acceptance` entregue pela Issue #71. Esse ponto não bloqueia o início do desenho nem do desenvolvimento de H-056.

---

## 10. Riscos e mitigações

- **R1. Exaustão do limite gratuito de Egress (5 GB/mês do Supabase / R-37, Q-13).** Se profissionais visualizarem todas as fotos completas (1.280 px / ~500 KB) em grande volume, a cota de 5 GB pode se esgotar rapidamente.
  *Mitigação:* Implementação compulsória da variante miniatura `preview` (~320 px, peso < 50 KB) para a visualização na listagem/grade do pedido, carregando a imagem completa apenas sob clique explícito (RN-H056-10, CA-H056-16).
- **R2. Sobrecarga de CPU/Memória na Vercel com renderização sob demanda via Sharp (S-06, S-09, R-31).** A composição de SVG sobre imagem JPEG em ambiente serverless consome memória e CPU a cada invocação.
  *Mitigação:* Reuso da instância única de `sharp` com limite de threads (`sharp.concurrency(1)` e `sharp.cache(false)` já adotados na fábrica), timeout estrito de 5 s e retorno HTTP 503 limpo em caso de indisponibilidade transitória (CA-H056-20).
- **R3. Raspagem automatizada (scraping) de fotos por profissionais ou bots (R-03, D10).** Profissional malicioso automatizando download de fotos de todos os pedidos da região.
  *Mitigação:* URLs assinadas de uso curto (~60 segundos), rate limit HTTP na emissão de links, marca d'água indelével com identificador do profissional em cada imagem, e integração futura com os contadores de H-057 (#70).
- **R4. Vazamento de dados pessoais ou localização do cliente através da foto (RF-030, RF-136, I-16).** Fotos que contenham detalhes de fachada ou numeração, ou metadados de geolocalização.
  *Mitigação:* EXIF e metadados já são integralmente expurgados no upload (H-028). A resposta não carrega nenhum metadado textual de cliente. A marca d'água estampa o identificador de quem viu, desincentivando vazamentos de tela.
- **R5. Reintrodução acidental de log de acesso a fotos violando a Issue #150.** Risco de agentes ou desenvolvedores recriarem `media_access_log` por confundirem requisitos antigos do PRD com as decisões consolidadas.
  *Mitigação:* Proibição explícita registrada em regra de negócio (RN-H056-12), teste negativo de persistência (CA-H056-18) e barreira arquitetural.
- **R6. Vazamento de tokens assinados de fotos para terceiros.** Compartilhamento de URL assinada em fóruns ou grupos externos.
  *Mitigação:* Validade efêmera de 60 segundos; após 1 minuto, o link torna-se nulo. Além disso, a imagem traz a marca d'água impressa com a identificação do profissional que gerou o token original.
- **R7. Adulteração ou falsificação do identificador do profissional na marca d'água.** Tentativa de forjar o identificador para imputar vazamento a outro profissional.
  *Mitigação:* O identificador é resolvido exclusivamente no servidor a partir da sessão autenticada (`session.userId`) ou do token HMAC assinado pelo servidor. Nenhum parâmetro do cliente dita o identificador impresso.
- **R8. Armazenamento indevido de derivadas no Storage estourando a cota de 1 GB (R-35).** Salvar cópias com marca d'água no bucket `request-photos`.
  *Mitigação:* Proibição total por desenho. A porta de escrita no Storage não é exposta ao serviço de visualização; a entrega é streaming efêmero a partir da memória RAM da função.

---

## 11. Perguntas ao líder

Lista única numerada de **830 a 849** (conforme instrução oficial para H-056). Cada item apresenta alternativas concretas, a recomendação fundamentada do Product Owner e o impacto que destrava no desenvolvimento. O líder adota as recomendações.

**830. Rota para listagem dos metadados das fotos de um pedido.**
Qual deve ser o caminho HTTP para o profissional consultar a galeria/metadados das fotos de um pedido?
- (a) `GET /v1/professional/requests/:id/photos` — sub-recurso explícito sob o escopo de pedidos do profissional, alinhado ao padrão REST e às rotas existentes (`/v1/professional/requests/:id`).
- (b) `GET /v1/requests/:id/photos` — prefixo genérico.
- (c) Incluir a lista de fotos diretamente na resposta de `GET /v1/professional/requests/:id`.
- **Recomendação:** (a). Mantém o isolamento de escopo por papel profissional (`/v1/professional/`), preserva a lista fechada imutável `ELIGIBLE_PROFESSIONAL_KEYS` de H-032 e evita carregar metadados pesados de fotos na consulta básica do pedido. Destrava a declaração da rota de galeria e CA-H056-03.

**831. Rota para emissão da URL assinada de visualização de foto.**
Como a URL assinada de curta duração (~60 s) deve ser solicitada pelo cliente?
- (a) `GET /v1/professional/requests/:id/photos/:photoId/view` respondendo JSON `{ view_url: "/v1/media/watermarked-photos/:token", expires_in: 60 }`.
- (b) Redirecionamento HTTP `307 Temporary Redirect` direto da rota `:photoId/view` para a rota de mídia assinada.
- (c) Rota única sem URL assinada intermediária, servindo o binário diretamente com autenticação por cookie de sessão.
- **Recomendação:** (a). Permite que o front-end web/mobile decida o momento exato de disparar a carga da imagem (ou renderizar em tags `<img src="...">` com token curto), desacopla a checagem de autorização do streaming de mídia e cumpre expressamente o requisito de URL assinada curta de RF-030 e D10. Destrava CA-H056-06.

**832. Rota de streaming do binário da imagem com marca d'água.**
Qual deve ser o endpoint responsável por servir o binário JPEG da foto renderizada com marca d'água?
- (a) `GET /v1/media/watermarked-photos/:token` — rota pública especializada na API que valida o token HMAC assinado e faz o streaming da imagem sem exigir cookies (permitindo uso direto em `<img>`).
- (b) `GET /v1/professional/requests/:id/photos/:photoId/image` exigindo cookie de sessão a cada requisição de byte.
- **Recomendação:** (a). O token assinado de 60 s é autossuficiente e seguro; permite que navegadores e apps mobile carreguem as imagens em elementos nativos de imagem sem complexidades de envio de cookies de credencial em tags HTML e previne deadlocks de sessão. Destrava CA-H056-07.

**833. Algoritmo de assinatura e formato do token da URL curta (~60 s).**
Qual mecanismo criptográfico deve ser utilizado para gerar e validar o token de visualização de foto?
- (a) Token compacto codificado em `base64url` com formato `payload.hmac`, onde o payload contém `photoId`, `requestId`, `professionalId`, `variant` e timestamp `exp` (now + 60 s), autenticado via HMAC-SHA-256 com chave do ambiente `WATERMARK_TOKEN_SECRET`.
- (b) Token JWT padrão assinado com HS256.
- (c) UUID opaco persistido em tabela temporária no Postgres.
- **Recomendação:** (a). Mecanismo stateless e ultra-leve via módulo nativo `node:crypto`, sem bibliotecas externas pesadas e sem gerar I/O de banco de dados para cada visualização de imagem. Destrava CA-H056-09/10 e o módulo de token.

**834. Conteúdo do identificador do profissional impresso na marca d'água.**
Qual identificador deve constar no texto da marca d'água repetida sobre a imagem?
- (a) Código curto alfanumérico pseudonimizado (ex.: `FP-XXXX-XXXX`), derivado deterministicamente por HMAC-SHA-256 do `professional_id` com segredo interno `WATERMARK_ID_SALT` (truncado em 8 caracteres de hash formatado com prefixo `FP-`).
- (b) O UUID completo do profissional em claro (`professional_id`).
- (c) O primeiro nome do profissional.
- **Recomendação:** (a). Conforme determinado em `08-ARQUITETURA.md` §10.3 ("identificador curto opaco do profissional, não nome, não CPF; mapeável no banco"). Um código curto de 10 caracteres cabe perfeitamente no padrão em mosaico sem poluir visualmente a imagem e é 100% mapeável internamente pela plataforma em caso de vazamento. Destrava CA-H056-07.

**835. Padrão visual, repetição e rotação da marca d'água.**
Qual deve ser a geometria e estilo da marca d'água aplicada via `sharp`?
- (a) Padrão em mosaico com repetição em grade, texto inclinado a -30 graus, com fonte sem serifa clara e opacidade entre 18% e 22% (`rgba(255,255,255,0.20)`).
- (b) Carimbo único centralizado no meio da foto.
- (c) Faixa fixa de rodapé.
- **Recomendação:** (a). Segue a especificação de `08-ARQUITETURA.md` §10.3 ("marca d'água repetida, padrão em mosaico, baixo contraste"). Mosaico diagonal impede que o profissional corte os cantos da imagem para remover a marca d'água. Destrava a geração do template SVG no sharp.

**836. Suporte a variantes de imagem: Preview (320 px) vs Full (1.280 px).**
A API deve suportar o parâmetro `?variant=preview` para otimização de banda e egress?
- (a) Sim, suportar `variant=preview` (redimensionada para largura máxima de 320 px, peso < 50 KB) e `variant=full` (máximo 1.280 px, padrão), ambas com a marca d'água aplicada proporcionalmente.
- (b) Não, servir sempre a imagem completa de 1.280 px em todas as chamadas.
- **Recomendação:** (a). Mitiga diretamente o risco crítico R-37 (egress de 5 GB/mês do Supabase) e cumpre o requisito de teste P-05 / Q-13. Permite navegação rápida em galerias e carrosséis sem desperdício de dados. Destrava CA-H056-16.

**837. Política de persistência da imagem com marca d'água (armazenamento vs streaming).**
Confirmar a regra de que as imagens com marca d'água NUNCA são salvas no Storage.
- (a) Sim, estritamente renderização em memória sob demanda na API, sem nenhum arquivo persistido no Storage ou banco.
- (b) Salvar as derivadas no bucket `request-photos` para cache.
- **Recomendação:** (a). Conforme aprovado em ADR-009 e `08` §10.3. Salvar cópias de cada foto para cada profissional multiplicaria o armazenamento por dezenas de vezes, estourando rapidamente o limite gratuito de 1 GB do Supabase. Destrava CA-H056-11 e R8.

**838. Resposta HTTP para profissional não elegível ou fora do raio (silêncio uniforme).**
Confirmar que profissionais inelegíveis recebem HTTP 404 uniforme ao tentar consultar fotos de um pedido.
- (a) Sim, HTTP `404 Not Found` com corpo `{ code: "foto_nao_encontrada" }` para qualquer situação de inelegibilidade, inadimplência, reprovação ou distância fora do raio.
- (b) HTTP 403 detalhando a causa (ex.: "acesso_vencido", "fora_do_raio").
- **Recomendação:** (a). Segue a regra fundamental de silêncio comercial e anti-enumeração (decisão 569 e RF-137), garantindo que terceiros não descubram o status cadastral de ninguém através da manipulação de URLs. Destrava CA-H056-04/05.

**839. Política de cabeçalhos de resposta HTTP na entrega da imagem.**
Quais cabeçalhos de segurança e cache devem ser enviados compulsòriamente na entrega da imagem?
- (a) `Content-Type: image/jpeg`, `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` e `Content-Disposition: inline`.
- (b) `Cache-Control: public, max-age=3600`.
- **Recomendação:** (a). `no-store` impede cache compartilhado em proxies ou navegadores abertos em computadores públicos; `inline` impede download forçado do arquivo como attachment; e CSP sandbox isola completamente o binário contra ataques de injeção. Destrava CA-H056-17.

**840. Comportamento após expiração do prazo de admissão de 7 dias.**
Como a rota deve se comportar quando o pedido atinge ou supera o prazo `acceptance_deadline_at`?
- (a) Se o profissional tiver aceite ativo (`app.acceptance`), permite visualizar as fotos normalmente; se não tiver aceite, devolve HTTP `404 Not Found` `{ code: "foto_nao_encontrada" }`.
- (b) Bloquear todos os profissionais após 7 dias, inclusive participantes.
- **Recomendação:** (a). Cumpre expressamente o requisito RF-031 e critério de aceite FA-008 ("após expiração, elegível não participante perde acesso; participante mantém histórico autorizado"). Destrava CA-H056-12 e CA-H056-13.

**841. Visualização de fotos pelo cliente dono do pedido.**
Como o cliente dono do pedido visualiza as fotos de sua solicitação após a publicação?
- (a) Através da rota do dono `GET /v1/requests/:id/photos` e `:photoId/view`, recebendo as fotos reduzidas do bucket `request-photos` sem a marca d'água de profissional.
- (b) O dono vê a mesma marca d'água de profissional.
- **Recomendação:** (a). O cliente é o proprietário das fotos que enviou; ele tem o direito de inspecionar suas próprias imagens limpas na tela de detalhes do pedido, conforme já desenhado em H-029 e H-032. Destrava CA-H056-19.

**842. Nome das variáveis de ambiente para criptografia de marca d'água.**
Quais identificadores devem constar em `.env.example` para as chaves secretas de H-056?
- (a) `WATERMARK_TOKEN_SECRET` (chave de 32 bytes para HMAC do token curto de 60 s) e `WATERMARK_ID_SALT` (sal de 32 bytes para derivação do identificador opaco do profissional).
- (b) Reutilizar `DISCOVERY_CURSOR_KEY` já existente.
- **Recomendação:** (a). Segregação estrita de segredos criptográficos por finalidade, em consonância com as melhores práticas de segurança e auditoria da fábrica. Destrava a configuração do ambiente e testes unitários.

**843. Formato e compressão de saída da imagem com marca d'água.**
Qual deve ser o formato e nível de compressão na saída do sharp?
- (a) JPEG (`image/jpeg`) com qualidade 80 (`{ quality: 80, mozjpeg: true, chromaSubsampling: '4:2:0' }`), garantindo tamanho compacto sem perda visual perceptível para o profissional.
- (b) PNG sem perdas.
- (c) WebP dinâmico.
- **Recomendação:** (a). Todas as fotos guardadas em `request-photos` já são JPEG com teto de 750 KB; emitir JPEG com qualidade 80 mantém total compatibilidade universal com qualquer navegador/app e gera imagens extremamente compactas (~200 a 400 KB). Destrava a configuração do encoder do sharp.

**844. Tratamento de falhas de memória ou timeout do motor de imagem.**
Como a API deve responder caso o processamento do `sharp` atinja timeout (5 s) ou lance erro de alocação de memória?
- (a) Responder HTTP `503 Service Unavailable` com corpo `{ code: "renderizacao_indisponivel" }`, registrando métrica operacional limpa sem PII e sem travar a aplicação.
- (b) Repassar o erro 500 com stack trace do libvips.
- **Recomendação:** (a). Garante tolerância a falhas na infraestrutura serverless da Vercel e evita qualquer vazamento de detalhes internos do sistema. Destrava CA-H056-20.

**845. Rate limit específico da emissão de tokens de fotos.**
Qual teto de taxa deve ser aplicado para a emissão de tokens de fotos por profissional?
- (a) 60 requisições por minuto por profissional autenticado na rota `:photoId/view`, devolvendo HTTP `429 Too Many Requests` `{ code: "muitas_requisicoes" }` em caso de estouro.
- (b) 120 requisições por minuto.
- (c) Sem rate limit na aplicação.
- **Recomendação:** (a). Alinhado ao rate limit de descoberta da decisão 610 (#68); um profissional humano não consome mais de 60 fotos por minuto em uso normal. Destrava a política de taxa da rota.

**846. Ausência estrita de log de acesso por foto (reforço da Issue #150).**
Confirmar que nenhuma tabela, trigger ou registro de auditoria por foto acessada deve ser criado em H-056.
- (a) Sim, estritamente sem log por foto, em total cumprimento à Issue #150 e decisão da Rodada 67.
- (b) Criar tabela temporária de auditoria de foto.
- **Recomendação:** (a). A decisão da Issue #150 é irrevogável no repositório (`117-REFINO-REMOCAO-HISTORICO-ACESSO.md`), tendo expurgado `media_access_log` para poupar I/O e armazenamento no Postgres gratuito. Destrava CA-H056-18.

**847. Organização de pastas e arquivos de código no monorepo.**
Onde devem ser organizados os novos arquivos de código de H-056?
- (a) Módulo de marca d'água e tokens em `packages/domain/src/media/watermark.ts`; rotas e serviços em `apps/api/src/requests/photo-view-route.ts`, `photo-view-service.ts` e `photo-watermark-service.ts`.
- (b) Criar um pacote novo `packages/watermark`.
- **Recomendação:** (a). Mantém harmonia com a organização já aprovada na fábrica para pedidos e mídia, evitando proliferação desnecessária de pacotes. Destrava o desenho de arquivos da Arquitetura.

**848. Consumo da função de banco para validação de acesso às fotos.**
Como a autorização de acesso à foto de um pedido deve ser resolvida no banco de dados?
- (a) Criação de uma função aditiva `private.request_photo_access(p_request_id, p_professional_id, p_photo_id, p_now)` que executa internamente a guarda `private.professional_access_guard` (modo `descoberta_aceite` ou `participacao`), confere se a foto pertence ao pedido e possui `status = 'ready'`, retornando boolean.
- (b) Múltiplas consultas SQL avulsas disparadas pela API.
- **Recomendação:** (a). Garante atomicidade, executa a segurança diretamente no Postgres e impede discrepâncias entre a camada de aplicação e a camada de dados. Destrava o adaptador de banco.

**849. Relação de fronteira com H-057 (#70) e H-058 (#71).**
Como delimitar perfeitamente o escopo de H-056 em relação às histórias vizinhas?
- (a) H-056 entrega exclusivamente: listagem de metadados das fotos do pedido, emissão de URL assinada de 60 s, renderização da marca d'água dinâmica via sharp, entrega da imagem binária e rate limit básico. A detecção de anomalias/raspagem e emissão de `abuse_signal` pertencem a H-057 (#70); a ação de aceite pertence a H-058 (#71).
- (b) Implementar detecção de raspagem e suspensão cautelar junto com H-056.
- **Recomendação:** (a). Respeita rigorosamente a divisão atômica do backlog oficial (`14-BACKLOG.md`), garantindo entregas incrementais, testáveis e sem escopo inflado. Destrava o isolamento de testes e planejamento do líder.

---

## 12. Próximos passos

1. **Revisão pelo Líder (Orquestrador):** O líder valida os limites de fronteira com H-057 (#70) e H-058 (#71) e consolida as respostas às perguntas **830 a 849** na próxima rodada oficial de `docs/factory/11-DECISOES.md`.
2. **Transição de Etapa:** A Issue #69 permanece na coluna "Product Owner" do quadro até que o líder execute a transição para a coluna "Arquitetura".
3. **Desenho Técnico pela Arquitetura:** A Arquitetura produzirá o documento `docs/factory/166-DESENHO-H056.md` (ou numeração seguinte), detalhando:
   - Os contratos TypeScript dos tokens HMAC e das portas `WatermarkImageComposerPort` e `PhotoAccessStorePort`;
   - O template SVG parametrizado para o mosaico diagonal no `sharp`;
   - A especificação da função SQL aditiva `private.request_photo_access`;
   - A montagem das rotas na API NestJS e os limites de concorrência e memória.
4. **Condição para Desenvolvimento de #69:** O início do desenvolvimento do fluxo principal de H-056 está **plenamente liberado**, pois todas as dependências prévias de elegibilidade (#55), acesso comercial (#58), fotos reduzidas (#40, #141) e descoberta (#68) já estão concluídas e homologadas no repositório.
