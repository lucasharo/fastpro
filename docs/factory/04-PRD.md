# FastPro — PRD (requisitos funcionais)

- **Etapa:** specification · **Data:** 2026-11-10 · **Papel:** Product Owner · **Status:** rascunho para validação humana (revisão 6, aplica decisões 30-33; revisão 2 aplicou H4/H5)
- **Etiquetas:** `[APROVADO]` decisão do usuário · `[DELEGADO]` adotado por delegação (revogável; ver `11-DECISOES.md`) · `[PROPOSTA]` texto proposto pelo PO, sujeito a validação · `[PENDENTE JURÍDICO]`
- **Fontes:** `00`–`03`, `10`, `11` de `docs/factory/` e pacote 03/05/06/09 (resumos).

## Histórico de mudanças
### Revisão 2 — 2026-11-09 (Rodada 5: H4 e H5)
**H4 [APROVADO] — fim da oferta/proposta; entra "Aceitar trabalho".**
- Removido o conceito de oferta/proposta: conteúdo, edição, valor estruturado, prazo, uma oferta por profissional, "admissão de ofertas", "Receber mais ofertas".
- Novo: **aceite de trabalho** (botão "Aceitar trabalho"), no máximo um por profissional por pedido, idempotente (RF-069, RF-070, RF-075).
- Reescritos: RF-015, 050, 062, 067, 069, 070, 071, 072, 073, 081, 082, 085, 087, 090, 115, 117, 119, 164 (ver Impactos).
- Novo: RF-075 (efeitos do aceite), RF-076 (rótulo da 2ª onda), RF-122 (feature flag do e-mail de aviso de aceite).
- AMB-10 (conteúdo da oferta) extinta; SD-08 (edição da oferta) extinta. Novas dúvidas: AMB-21 a AMB-29.
**H5 [APROVADO] — sem boleto; carência de 72 h vale também para Pix.** RF-058, RF-059, seção 6.
**Não alterado:** preços, 4+4 (teto 8), 7 dias corridos, trial de 14 dias, EDS, demais decisões.
**Dependência de rótulos:** o texto "Receber mais ofertas" de D3 (`11-DECISOES.md`) fica substituído pela leitura de H4; ver RF-067 e RF-076. `11-DECISOES.md` não foi editado por este papel.

### Impactos (o que mudou e o que o Architect deve revisar)
| Tema | Mudança no PRD | Revisar (08..11) |
|---|---|---|
| Entidade `offer` e `offer_revision` | Extintas. O aceite equivale à participação; sem conteúdo nem revisão. | 09 (tabelas offer/offer_revision, unique `offer(participation_id)`), 08 §229 (lock "Enviar/editar oferta"), 10-ADRS (SD-08 extinta) |
| Gatilho da 2ª onda | De "4 ofertas recebidas" para "4 aceites" + pedido aberto (RF-067) | 08 (cálculo do gatilho, contadores internos), 09 (consulta/contador de aceites), 11 (testes de concorrência) |
| Admissão `aberto/encerrado` | Passa a regular a entrada de **aceites** (mesma semântica) | 08/09 (estado e trigger de criação) |
| Chat | Aceite cria a conversa e uma **mensagem automática de sistema** ao cliente (RF-075). Novo tipo de mensagem (origem sistema) | 08, 09 (tipo/autor de mensagem, idempotência da mensagem automática), 11 |
| E-mail de aviso de aceite e de mensagem não lida | **Rev. 4 (supera Rev. 3): HABILITADO no código, sem flag, sem tela, sem reenvio de antigos (RF-122).** Histórico: Rev. 3 o desativava. Chat segue imediato | Ver Impactos da Revisão 4 |
| Notificações RF-115/117/119 | RF-115 reescrito; AMB-25 extinta (decisão 23); RF-064/118/119 com e-mail habilitado (AMB-31 respondida na Rev. 4) | 08, 11 |
| Billing | Sem boleto; Pix e cartão; carência 72 h também para Pix (RF-058/059). SD-10 respondida: (b) | 08 §257 (carência por `period_end`, aplicar a Pix), 09 (tipos de pagamento, remover boleto), 10-ADRS (SD-10), 11 (webhooks: sem boleto; testes de carência Pix) |
| Elegibilidade/Participação | "participar/ofertar" vira "aceitar" (RF-050, 062, 065) | 08 (guardas de API), 09 |
| Arquitetura de autorização | Fotos continuam visíveis antes de **aceitar** (RF-029) | 08 |
| Hospedagem/Supabase | H1/H3: fora do escopo do PRD; sem requisito funcional novo | 08, 10, 11 (já são do Architect) |

### Revisão 3 — 2026-11-09 (Rodadas 6 a 9: decisões 1-23)
- **[SUPERADO na Revisão 4: os e-mails agora estão habilitados]** **Sem interruptor de e-mail (decisão 23):** RF-122 reescrito e RF-154 sem a parte da flag. O envio de e-mail de **aviso de aceite** e de **mensagem não lida** fica **implementado porém DESATIVADO no código** (comentado, ponto único de ativação), **sem interruptor, sem tela, sem reenvio de aceites antigos**. Link mágico e e-mails de conta ficam sempre ativos; chat imediato inalterado.
- **Decisão 14:** mensagem automática do aceite com texto fixo "Estou disponível para trabalhar" (RF-075). Atribuição na tela: AMB-30 (nova).
- **Decisão 17 / SD-16:** novo período começa no fim do anterior, inclusive após carência Pix (RF-059).
- **Decisão 19 / SD-18:** quem retirou o aceite não aceita de novo o mesmo pedido (RF-077).
- **Decisão 20 / AMB-27=A:** "4 aceites" = vagas consumidas, inclusive de quem retirou (RF-067).
- **Decisão 22:** aviso "FastPro apenas conecta; não é contrato" somente nos termos de uso, fora do botão (RF-078).
- **Decisões 1-4, 7, 10:** AMB-21 (A), AMB-22 (A), AMB-23 (B), AMB-24 (A), AMB-29 (A), AMB-26 respondida; ver `07-AMBIGUIDADES.md`.
- Nova dúvida: AMB-30 (atribuição da mensagem automática) e AMB-31 (e-mails de lembrete/seleção/cancelamento).

### Revisão 4 — 2026-11-09 (Rodada 12, decisão 27; fatos do Resend em `13-VERIFICACAO-SERVICOS.md`)
- **Todos os e-mails HABILITADOS no código (decisão 27):** aceite, mensagem não lida, lembretes de prazo (24 h e vencimento), seleção, cancelamento, desistência, lembretes de trial/ciclo, decisão de verificação e login (link/código). Supera a parte da decisão 23 que os mantinha "comentados/desativados" e a decisão 21 ("preparados mas não enviados"). **Permanece:** sem interruptor, sem tela/endpoint administrável, sem reenvio de aceites antigos (só eventos novos geram e-mail).
- **Envio real depende do domínio verificado no Resend (decisão 15):** em desenvolvimento/CI o destino é o **Mailpit local**; nenhum usuário real recebe e-mail antes do domínio verificado (bloqueio de lançamento, não de desenvolvimento).
- **Cota gratuita do Resend como requisito não funcional (RNF-EMAIL, seção 8):** 100/dia (dia UTC), 3.000/mês, contado por destinatário; com degradação controlada (login prioritário; chat e site nunca dependem de e-mail).
- Reescritos: RF-064, 073, 116, 118, 119, 122, 154 (e RF-041, 115 ajustados). AMB-31 respondida.
- **Impactos (QA/Architect devem checar):**
  | Tema | Verificar |
  |---|---|
  | Nenhum e-mail ligado a flag, comentário ou ponto de ativação | 08 §12.2: ausência de tabela/tela/endpoint de flag; revisão de código sem envio comentado |
  | Cada tipo de e-mail tem teste de que **é** enfileirado/enviado (ao Mailpit) | 11: aceite, mensagem não lida, lembrete 24 h, vencimento, seleção, cancelamento, desistência, trial/ciclo, verificação, login |
  | Sem backfill: aceites/eventos anteriores à habilitação não geram e-mail | 08 §12.2; 11: teste de não retroatividade |
  | Cota: contador diário (UTC) e mensal, alertas, reserva para `auth`, degradação e reavaliação no dia seguinte | 08 §12.6; 11: teste a 90/dia e 100/dia (login passa; não críticos adiados; chat/site intactos) |
  | Digest de 15 min como economia de cota; limite ≤ 5 envios/s | 08 §12.3 e §12.6 |
  | Sem domínio verificado nada real sai; Mailpit em dev/CI; `resend.dev` consome cota | 08 §12.5; ambientes e CI |
  | Conteúdo dos e-mails sem dados sensíveis (RF-120) em todos os tipos | 11 |

### Revisão 6 — 2026-11-10 (decisão 33 C; supera partes da Rev. 5)
- **Chat SOMENTE TEXTO, sem nenhum anexo (nem imagem, nem PDF)** [APROVADO, decisão 33 C]. **AMB-32 resolvida.** Reescritos: RF-101, RF-102, RF-105, RF-107, RF-136; RF-025a mantido. Fotos extras e documentos entre cliente e profissional só pelo WhatsApp, se o cliente autorizar.
- **Supera a Rev. 5** nos pontos "PDF mantido no chat" e "5 × 10 MB", e as linhas de Storage do chat, moderação/antimalware de anexo e denúncia de anexo.
- **Nova ambiguidade AMB-33** (documentos de verificação de identidade do profissional: formatos e limites). Não decidida; ver `07-AMBIGUIDADES.md`. Esses documentos não são anexos de chat.
- **Impactos para QA/Architect:**
  | Tema | Verificar |
  |---|---|
  | API de mensagens | Aceita só texto; qualquer campo de arquivo/anexo/multipart é recusado (400/415) sem caminho interno |
  | UI do chat | Sem botão de anexar, seletor, arrastar-e-soltar, colar imagem, preview ou botão de download |
  | Storage (08/09) | Sai o bucket/política de anexos do chat; sem URL assinada, miniatura ou marca d'água de chat; cota do 1 GB considera só fotos do pedido e documentos de identidade |
  | Moderação/segurança | Sem antimalware/magic bytes de anexo do chat; filtro automático e denúncia valem só para texto; denúncia sem "anexo" |
  | Modelo de dados | Sem tabela/coluna de anexo de mensagem; sem idempotência de upload |
  | Matriz de visibilidade (doc 05 §6) | Remover linhas de anexo do chat; mensagens = texto |
  | E-mails e mensagem automática | Sem menção a anexos (RF-120) |
  | Testes (11) | POST de mensagem com arquivo/imagem/PDF recusado; UI sem controle de anexo; denúncia/RF-107 sem anexo; fotos extras sem canal na plataforma |

### Revisão 5 — 2026-11-10 (Rodadas 13 e 14: decisões 30, 31, 32)
- **[PARCIALMENTE SUPERADA pela Rev. 6: chat sem nenhum anexo, inclusive PDF.]**
- **Fotos do pedido (decisões 30, 31):** 5 fotos; cada uma reduzida no envio para ≈ 0,5 MB (máx. 1.280 px). Fotos adicionais somente pelo WhatsApp, se o cliente autorizar o contato; senão o pedido fica só com as 5 (RF-025, novo RF-025a).
- **Chat sem imagens (decisão 32):** removidos imagem, upload/preview de imagem e limites de imagem do chat (RF-101, RF-102, RF-107, RF-136; FA-027). Fotos extras não passam pelo chat.
- **PDF no chat:** mantido como estava (suposição do líder, a confirmar): **AMB-32** (A/B/C, recomendação A).
- **Impactos (Architect/QA devem revisar):**
  | Tema | Verificar |
  |---|---|
  | Storage do chat | 08/09: bucket/política do chat só para PDF; remover caminho de imagem do chat (upload, miniatura, marca d'água, URL assinada de imagem); validação por conteúdo (magic bytes) recusa imagem mesmo renomeada; cota do 1 GB considera PDF (10 MB × 5) |
  | Storage das fotos do pedido | 08/09: redimensionamento no envio (≈ 0,5 MB, 1.280 px), guardar só a versão reduzida; estimativa de capacidade: 5 fotos × ≈ 0,5 MB ≈ 2,5 MB/pedido (substitui a proposta 1–2 MB da decisão 30); aceitar até 10 MB na entrada |
  | EXIF | Remoção de EXIF/localização somente nas fotos do pedido (RF-027); no chat não há imagem, logo não há EXIF a tratar |
  | Segurança/moderação | RF-102/RF-107/RF-126: filtro e antimalware do chat só para PDF; denúncia de anexo refere-se a PDF |
  | WhatsApp | Fotos extras dependem do opt-in de telefone (RF-016/138); sem recebimento de fotos pela plataforma |
  | Testes (11) | Chat rejeita JPG/PNG/WebP/GIF/HEIC e PDF falso; UI sem botão/preview de imagem; foto do pedido fica ≤ ≈ 0,5 MB e ≤ 1.280 px; 6ª foto recusada |

## 0. Avisos de uso
1. **Este PRD é uma reconstrução [PROPOSTA]** (autorizada em `11-DECISOES.md`, D1/D2). O PRD mestre original e o texto individual de **RN-001..408 e RN-641..675 continuam NÃO recebidos**. Nada aqui é a RN original. As RN originais que mencionem "oferta" ficam superadas por H4 [APROVADO] quando recuperadas.
2. Os IDs **RF-xxx** são próprios deste documento. Não são RN e não devem ser citados como se fossem. Não foram criadas RN novas. Quando o original for recuperado, fazer o mapa RF → RN.
3. Cada RF carrega a etiqueta de origem. O que é `[PROPOSTA]` não é requisito aprovado; é detalhamento mínimo necessário para refinar/testar.
4. Não altera preços, 4+4, 7 dias corridos, trial de 14 dias, EDS. Não impõe solução técnica.
5. Vínculo com critérios: `FA-0xx` (ver `05-CRITERIOS-ACEITE.md`). Ambiguidades: `07-AMBIGUIDADES.md` (AMB-xx).
6. Vocabulário: "**aceite**" = ação do profissional elegível de clicar em "Aceitar trabalho" num pedido. "**Participante**" = profissional com aceite válido no pedido (ocupa vaga, tem conversa). Aceite e participação são o mesmo ato [APROVADO] (decisão 1, AMB-21=A).

## 1. Atores e permissões (resumo)
| Ator | Descrição | Origem |
|---|---|---|
| Visitante | Navega sem conta | [APROVADO] |
| Cliente | Identificado por e-mail + link mágico; sem senha | [APROVADO] |
| Profissional | Conta própria; só participa após verificação humana | [APROVADO] |
| Admin | Superadmin, Verificação, Moderador, Financeiro, Suporte, Auditor; MFA | [APROVADO] |

Matriz de visibilidade: doc 05 §6 (aprovada). Reproduzida nos RF-136..139.

## 2. Estados (ortogonais, sem enum único) [APROVADO]
- **Admissão de aceites:** `aberto` | `encerrado` (expirado, selecionado, cancelado, concluído). (Antes "admissão de ofertas"; semântica igual.)
- **Situação do pedido:** `publicado`, `selecionado`, `concluido`, `cancelado`. `expirado` é evento de prazo, não situação exclusiva.
- **Conversa:** `ativa`, `somente_leitura`, `restrita_por_seguranca`. `arquivada` é preferência individual.
- **Rascunho de pedido** (antes de publicar) e **pendente de verificação de e-mail**: `[PROPOSTA]` (estados auxiliares).
- **Assinatura/Acesso comercial:** `sem_acesso`, `trial_ativo`, `trial_expirado`, `ativa`, `em_carencia` (72 h), `expirada`, `cancelada_com_acesso_ate_fim_do_periodo` `[PROPOSTA]` para nomes; as regras são [APROVADO].
- **Verificação do profissional:** `pendente`, `em_revisao`, `retida_duplicidade`, `aprovada`, `recusada`, `suspensa` `[PROPOSTA]` para nomes.

## 3. Requisitos funcionais

### M1. Navegação pública e catálogo
| ID | Requisito | Origem | FA |
|---|---|---|---|
| RF-001 | Visitante navega categorias, site e perfis públicos de profissionais sem conta. | [APROVADO] | FA-001 |
| RF-002 | Autocomplete de categorias, serviços e sinônimos ao informar "Qual serviço você precisa?". | [APROVADO] | FA-001 |
| RF-003 | Catálogo administrável (grupos, serviços, sinônimos, flag online/presencial, flag atividade regulamentada). População inicial: `06-CATALOGO-PROPOSTO.md` [PROPOSTA]; 10 grupos originais prevalecem. | [APROVADO] gestão; [PROPOSTA] conteúdo | — |
| RF-004 | Serviço online compatível tem alcance nacional (sem raio); serviço presencial depende de raio. | [DELEGADO] | FA-001 |
| RF-005 | Perfil público exibe nome/identidade profissional, serviços, selo "verificado" (somente identidade), média de avaliações (1 casa decimal) ou "Ainda sem avaliações", lista de avaliações mais recentes primeiro. | [APROVADO] | FA-019 |
| RF-006 | O selo "verificado" nunca é apresentado como certificação de qualidade, garantia ou seguro. | [APROVADO] | — |

### M2. Pedido de serviço (cliente)
| ID | Requisito | Origem | FA |
|---|---|---|---|
| RF-010 | Pedido contém: serviço (autocomplete), local (autocomplete de endereço Mapbox), urgência, descrição, fotos opcionais. | [APROVADO] | FA-001 |
| RF-011 | Urgência: exatamente **Imediato**, **Nas próximas semanas**, **Próximo mês**, **Ainda não defini**. | [APROVADO] | FA-001 |
| RF-012 | O cliente pode preencher o pedido antes de se autenticar. Nome (primeiro) e e-mail são exigidos no envio final; telefone é opcional. | [APROVADO] | FA-001, FA-002 |
| RF-013 | Endereço preciso é privado. Profissionais veem localização generalizada. | [APROVADO] | FA-007, FA-030 |
| RF-014 | Antes de publicar, o cliente revê todos os dados e confirma expressamente. Não existe publicação automática. | [APROVADO] | FA-002 |
| RF-015 | Ao publicar: novo ID, validade de **7 dias corridos** para entrada de novos **aceites**, admissão `aberto`. A validade não varia com o número de aceites. | [APROVADO] (H4: "ofertas" → "aceites") | FA-002, FA-012 |
| RF-016 | **Opt-in de contato:** na tela do pedido, o cliente que informou telefone vê checkbox para liberar telefone/WhatsApp aos profissionais participantes, **desmarcado por padrão**. Sem marcar, o telefone não é compartilhado. | [APROVADO] (11-DECISOES, Rodada 2) | FA-030 |
| RF-017 | O escopo do opt-in de RF-016 é: este pedido, apenas profissionais **participantes** (não elegíveis não participantes). Não é transferido para pedidos republicados. Revogação vale para acesso futuro; cópia já salva fora da plataforma é irrevogável e isto é informado. | [APROVADO] regra de base; escopo exato [PROPOSTA] | FA-021, FA-030 |
| RF-018 | O cliente vê o estado do pedido (aberto/encerrado, selecionado, concluído, cancelado) sem contadores, vagas ou ondas. | [APROVADO] | FA-010 |
| RF-019 | Rascunho preservado enquanto o cliente confirma o e-mail. Duração do rascunho e regras de descarte. | [PROPOSTA] | FA-002 |
| RF-020 | Pedido sem profissional elegível no raio: o sistema informa o cliente, sem revelar contadores internos. Texto e comportamento: **AMB-03**. | [PROPOSTA] / indefinido | — |
| RF-021 | Antispam/abuso de publicação (rate limit por e-mail/IP/dispositivo) sem expor detalhe ao usuário. | [PROPOSTA] | FA-003 |

### M3. Fotos do pedido
| ID | Requisito | Origem | FA |
|---|---|---|---|
| RF-025 | **Até 5 fotos por pedido**, aceitas no envio até 10 MB cada; JPG/PNG/WebP; HEIC apenas por conversão segura suportada. **Cada foto é reduzida no envio para ≈ 0,5 MB, com no máximo 1.280 px no maior lado** (decisão 31); é a versão reduzida que fica armazenada e é exibida. | [APROVADO] (decisões 30, 31) | FA-001 |
| RF-025a | **Fotos adicionais somente pelo WhatsApp**, e apenas se o cliente autorizar o compartilhamento do contato (RF-016). Se não autorizar, o pedido fica **só com as 5 fotos**. Não há outro canal de envio de fotos na plataforma (nem no chat: RF-101). | [APROVADO] (decisões 30, 32) | FA-001, FA-027 |
| RF-026 | Antes de publicar: preview, estado de carregamento, exclusão, reordenação. | [APROVADO] | — |
| RF-027 | Metadados de localização (EXIF) removidos das cópias compartilhadas. **Aplica-se às fotos do pedido** (única fonte de imagem na plataforma, decisão 32). | [APROVADO] / D10 | FA-007 |
| RF-028 | Arquivos privados; autorização verificada no servidor; miniaturas e originais com a mesma política; URLs expiram; sem link público permanente. | [APROVADO] | FA-008 |
| RF-029 | Profissional com identidade aprovada + acesso comercial vigente (assinatura ou trial legítimo) + serviço/raio elegíveis vê fotos **antes de aceitar o trabalho**; não vê dado pessoal restrito junto delas. | [APROVADO] | FA-007 |
| RF-030 | **Mitigações D10:** URL assinada curta, sem download do original, marca d'água com identificador do profissional, rate limit e log de acesso por profissional, detecção de raspagem, nenhum dado pessoal junto das fotos. | [DELEGADO] D10 | FA-007, FA-008 |
| RF-031 | Após expiração, elegível não participante perde acesso às fotos pela descoberta; participante mantém histórico autorizado; restrição de segurança prevalece. | [APROVADO] | FA-008, FA-025 |

### M4. Identidade do cliente e sessão
| ID | Requisito | Origem | FA |
|---|---|---|---|
| RF-035 | Cliente se autentica por link mágico enviado ao e-mail informado; sem senha. | [APROVADO] | FA-002 |
| RF-036 | Link válido por 15 min e de uso único. | [DELEGADO] (padrão) | FA-003 |
| RF-037 | **D8:** abrir o link não consome o token. O consumo exige ação do usuário na página (POST). Fallback: código de 6 dígitos. | [DELEGADO] D8 | FA-003 |
| RF-038 | Sessão de até 7 dias, revogável. Dados do cliente (pedidos, conversas, avaliações) acessíveis apenas na sessão do dono. | [DELEGADO] | FA-003 |
| RF-039 | Link/código inválido, expirado ou reutilizado não autoriza ver pedidos de terceiros nem publicar em nome deles; mensagem não confirma se o e-mail existe (anti-enumeração). | [APROVADO] (proteções) | FA-003 |
| RF-040 | Limite de tentativas e reenvio do código/link (valores a definir pelo Architect). | [PROPOSTA] | FA-003 |
| RF-041 | E-mails não carregam credencial permanente; reautenticação por novo link quando necessário. O e-mail de autenticação (link/código) é essencial e tem **prioridade máxima** sobre os demais na degradação por cota (RNF-EMAIL). | [APROVADO]; ressalva [PROPOSTA] | FA-029 |

### M5. Profissional: cadastro e verificação
| ID | Requisito | Origem | FA |
|---|---|---|---|
| RF-045 | Cadastro com e-mail/senha. Google/Apple quando suportados (**D9 pendente**). | [APROVADO]; D9 aberto | — |
| RF-046 | CPF ou CNPJ e documentos de identidade para validação (formatos aceitos e limites de tamanho: **AMB-33**, aberta). | [APROVADO] | FA-004 |
| RF-047 | Atividades regulamentadas exigem certificação anexada conforme flag do catálogo. Verificação da certificação: [PENDENTE JURÍDICO] L4. | [APROVADO]; L4 | FA-004 |
| RF-048 | Aprovação humana obrigatória. Meta operacional 2 dias úteis (não promessa). | [APROVADO] | FA-004 |
| RF-049 | Duplicidade suspeita retém a aprovação para revisão humana, com explicação e recurso. Não há bloqueio definitivo automático. | [APROVADO] | FA-004 |
| RF-050 | Profissional não aprovado (ou revogado/suspenso) não aceita trabalho nem participa, inclusive por chamada direta de API. | [APROVADO] | FA-004 |
| RF-051 | Perfil: serviços atendidos, base e **raio de atendimento em km (5 a 100)** para serviços presenciais. | [APROVADO]/[DELEGADO] | FA-010 |
| RF-052 | Documentos de verificação têm controle de acesso mais restrito que perfis públicos. | [APROVADO] | FA-031 |
| RF-053 | Estado e motivo da verificação visíveis ao profissional (recusa, retenção) com canal de recurso. | [PROPOSTA] derivada de RF-049 | FA-004 |

### M6. Assinaturas e trial
| ID | Requisito | Origem | FA |
|---|---|---|---|
| RF-055 | Planos: Mensal R$ 29,90 · Trimestral R$ 80,70 · Semestral R$ 149,40 · Anual R$ 238,80. Preço único nacional. Sem desconto de lançamento. Promoções futuras administráveis. | [APROVADO] | FA-006 |
| RF-056 | **D5:** benefícios idênticos nos 4 planos; difere só ciclo e preço. | [DELEGADO] D5 | FA-006 |
| RF-057 | Teste gratuito de 14 dias: só após aprovação de identidade **e** ativação pelo próprio profissional; sem meio de pagamento; **sem conversão automática**; não gera cobrança ao vencer. | [APROVADO] | FA-005 |
| RF-058 | Pagamento via Mercado Pago, **somente Pix e cartão. Não existe boleto** (H5). Cartão com renovação automática apenas por adesão expressa. Pix: cobrança manual (novo pagamento a cada ciclo). | [APROVADO] (H5) | FA-006 |
| RF-059 | **Carência de 72 h** quando um ciclo pago não é renovado: vale para falha de renovação automática no cartão **e também para Pix** não pago no vencimento do período (H5). A carência conta a partir do fim do período pago; ao fim das 72 h sem pagamento, `expirada`. Pagando na carência, **o novo período começa no fim do período anterior, sem lacuna** (a carência é incluída no novo período, não somada) (decisão 17, SD-16). **Trial expirado: sem carência.** | [APROVADO] (H5; decisão 17) | FA-006 |
| RF-060 | Webhooks do gateway idempotentes; status refletido corretamente. | [APROVADO] | FA-006, FA-035 |
| RF-061 | Cancelamento de assinatura paga preserva acesso até o fim do período pago. | [APROVADO] | FA-006 |
| RF-062 | Assinatura expirada: não descobre nem aceita **novos** pedidos; mantém conversas/participações; pode ser selecionado onde já aceitou (identidade aprovada, sem restrição de segurança). | [APROVADO] | FA-025 |
| RF-063 | Reembolso proporcional com retenção de 50%: **não automatizar**. Cobrança indevida é restituída conforme a lei. | [PENDENTE JURÍDICO] L3 | FA-032 |
| RF-064 | Lembretes ao profissional antes do fim do trial/ciclo (canal e conteúdo): **AMB-06**. Só e-mail está aprovado como canal; esses e-mails estão **habilitados** (decisão 27; AMB-31 respondida), com baixa prioridade na degradação por cota. | [PROPOSTA] | FA-005 |

### M7. Descoberta, distribuição e aceite de trabalho
| ID | Requisito | Origem | FA |
|---|---|---|---|
| RF-065 | Profissional elegível (aprovado, acesso vigente, serviço compatível, dentro do raio ou serviço online) descobre o pedido. | [APROVADO] | FA-010 |
| RF-066 | Teto de **8 participantes** (aceites) por pedido, internamente 4+4. Cliente e profissional não veem números de vagas/ondas. | [APROVADO] | FA-010 |
| RF-067 | Primeira onda: até 4 aceites. **D3 reinterpretado por H4:** o botão de 2ª onda aparece ao cliente quando houver **4 aceites** e o pedido estiver **aberto**; libera a 2ª onda (até +4 aceites), **uma única vez**; indisponível após os 7 dias, seleção ou cancelamento. **"4 aceites" = vagas consumidas, inclusive as de quem retirou o aceite** (decisão 20, AMB-27=A). | [DELEGADO] D3 + [APROVADO] H4 e decisão 20 | FA-010 |
| RF-068 | Clique repetido/simultâneo no botão de 2ª onda abre a 2ª onda uma só vez. | [APROVADO] (concorrência) | FA-010, FA-035 |
| RF-069 | Um profissional tem no máximo **1 aceite** por pedido e ocupa no máximo 1 vaga; clique repetido, retry ou concorrência não duplica (idempotente). | [APROVADO] (H4) | FA-011 |
| RF-070 | O aceite é um ato simples ("Aceitar trabalho"): **sem texto, valor, prazo, anexo ou qualquer conteúdo, e sem edição**. Não existe proposta/oferta. Qualquer combinação de preço, prazo ou condições acontece **no chat** (negociação fora do chat é contato direto por opt-in, RF-016). Preço e contratação são combinados diretamente entre as partes, no chat ou WhatsApp; o FastPro apenas conecta (decisão 4, AMB-24=A). Retirada do aceite: RF-077. | [APROVADO] (H4; decisão 4) | FA-011 |
| RF-071 | Profissional elegível sem vaga vê que não pode aceitar, sem contadores. Texto: **AMB-04**. | [PROPOSTA] | FA-010 |
| RF-072 | Aceites não são admitidos após 7 dias, seleção ou cancelamento (inclusive requisições simultâneas). | [APROVADO] | FA-012, FA-035 |
| RF-073 | Expiração aos 7 dias fecha a entrada de aceites; não cancela, não conclui, não apaga chats. Lembrete 24 h antes e aviso no vencimento (na plataforma e por e-mail habilitado, RF-119). | [APROVADO] | FA-012 |
| RF-074 | Mecanismo paralelo para contornar o teto de 8 é proibido. | [APROVADO] | FA-010 |
| RF-075 | **Efeitos do aceite** [APROVADO, decisões 1 e 14]: ao aceitar, no mesmo ato atômico (a) é registrado o aceite e consumida a vaga; (b) é criada a conversa cliente–profissional (RF-100); (c) o cliente recebe uma **mensagem automática no chat** (RF-115); (d) o profissional passa a ver o primeiro nome do cliente e demais dados autorizados (RF-110). A mensagem automática tem **texto fixo: "Estou disponível para trabalhar"** (decisão 14), não é editável e não é duplicada por retry. Como é atribuída na tela do chat (mensagem de sistema com remetente nulo versus exibida como do profissional): **AMB-30**. | [APROVADO] H4 e decisões 1, 14; atomicidade [PROPOSTA]; atribuição aberta | FA-011, FA-029 |
| RF-076 | **Rótulo da 2ª onda ao cliente** [PROPOSTA]: **"Chamar mais profissionais"** (sem números, sem "vagas", sem "ondas"). Alternativas em AMB-29. Substitui "Receber mais ofertas". | [APROVADO] (decisão 7, AMB-29=A) | FA-010 |
| RF-077 | **Retirada do aceite** (decisão 3, AMB-23=B; decisão 19, SD-18): antes da seleção o profissional pode retirar o aceite; a **vaga permanece consumida**, a conversa passa a somente leitura e o cliente é avisado no chat. **Quem retirou não pode aceitar de novo o mesmo pedido** (API e UI negam); mantém apenas o histórico somente leitura. | [APROVADO] | FA-011 |
| RF-078 | **Aviso de natureza do serviço:** o texto "o FastPro apenas conecta; preço e contratação são combinados diretamente; não é contrato" aparece **somente nos termos de uso**, **não** no botão "Aceitar trabalho" nem em diálogo de confirmação (decisão 22). Redação jurídica: [PENDENTE JURÍDICO] L2, L7. | [APROVADO] (decisão 22); texto jurídico pendente | FA-011 |

### M8. Seleção, conclusão, cancelamento
| ID | Requisito | Origem | FA |
|---|---|---|---|
| RF-080 | Cliente seleciona um participante existente (que aceitou o trabalho) e elegível (não bloqueado, verificação não revogada, perfil não suspenso). Seleção única por pedido. A seleção é etapa distinta do aceite: o cliente conversa com quem aceitou e fecha com quem preferir (decisão 2, AMB-22=A). | [APROVADO] | FA-013 |
| RF-081 | Seleção encerra imediatamente novos aceites, sem reabrir prazo ou vagas. Conversas existentes continuam ativas. | [APROVADO] | FA-014 |
| RF-082 | Seleção é possível após os 7 dias entre participantes anteriores, sem reabrir aceites ou alterar o prazo. | [APROVADO] | FA-013 |
| RF-083 | Troca de selecionado: só entre participantes prévios, antes da conclusão/cancelamento; histórico e chats não são transferidos; auditoria. | [APROVADO] | FA-015 |
| RF-084 | Conclusão: só o cliente, com confirmação explícita. Não há conclusão automática, pelo profissional ou por expiração. Habilita avaliação. Só a conversa do selecionado fica ativa; demais somente leitura. | [APROVADO] | FA-017 |
| RF-085 | Correção direta da conclusão em até 24 h **e** sem avaliação publicada, com confirmação; volta a "selecionado"; nunca reabre aceites. Fora disso: revisão administrativa com auditoria. | [APROVADO] | FA-018 |
| RF-086 | Cancelamento: ação expressa e confirmada. Sem selecionado: todos os chats somente leitura. Com selecionado: só o chat dele fica ativo. Notificações pertinentes sem expor o selecionado a concorrentes. | [APROVADO] | FA-016 |
| RF-087 | Desistência do profissional (após selecionado): registra e notifica; não troca sozinho. Sem substituto: duas confirmações independentes do cliente (cancelar; depois publicar novo pedido revisado). Não reabre vagas nem prazo. Retirar o aceite **antes** da seleção: RF-077. | [APROVADO] | FA-024 |
| RF-088 | Operações compostas (cancelar+selecionar, publicar, concluir, pagar, aceitar) são consistentes e idempotentes sob repetição/falha parcial. | [APROVADO] | FA-035 |

### M9. Republicação
| ID | Requisito | Origem | FA |
|---|---|---|---|
| RF-090 | Republicar cria **novo pedido** (novo ID, 7 dias novos), com revisão dos dados e confirmação; histórico ligado à cadeia; aceites, chats e consentimentos individuais não são transferidos. | [APROVADO] | FA-021 |
| RF-091 | Uma republicação ativa por cadeia. Segunda tentativa informa/abre a existente ou exige cancelamento consciente. Republicação com selecionado e serviço em andamento conta como ativa. | [APROVADO] | FA-022 |
| RF-092 | Não restringir serviços distintos pela mesma categoria/endereço. Critério de "mesmo serviço": **AMB-01 (D6)**. | [APROVADO] princípio; critério aberto | FA-022 |
| RF-093 | Selecionar alguém do pedido original com republicação ativa: mostrar impacto, exigir confirmação, cancelar a nova e selecionar no original de forma atômica. | [APROVADO] | FA-023 |
| RF-094 | Casos extremos de "cadeia ativa" (suspensão, contestação, correção retroativa): **AMB-02 (D7)**. | aberto | FA-022 |

### M10. Chat (somente texto; sem anexos)
| ID | Requisito | Origem | FA |
|---|---|---|---|
| RF-100 | Um chat por par cliente–profissional dentro de um pedido; criado com o aceite (participação); nunca compartilhado entre concorrentes. | [APROVADO] | FA-009 |
| RF-101 | **O chat é SOMENTE TEXTO, sem nenhum anexo** (nem imagem, nem PDF; decisões 32 e 33 C): sem upload, seletor de arquivo, preview ou exibição de arquivo. Áudio não é exibido (versão futura). Fotos extras e documentos entre cliente e profissional só pelo WhatsApp, se o cliente autorizar o contato (RF-025a, RF-016). | [APROVADO] (decisão 33 C) | FA-027 |
| RF-102 | **Sem anexos no chat** (decisão 33 C; substitui "somente PDF, 5 × 10 MB"): a API de mensagens aceita apenas texto e recusa qualquer arquivo/anexo, inclusive enviado direto pela API; o usuário é informado, sem caminho interno exposto. Não existe bucket, pipeline, moderação nem antimalware de anexos do chat. Mensagem de texto continua sujeita ao filtro automático de conteúdo e à denúncia. | [APROVADO] (decisão 33 C) | FA-027 |
| RF-103 | Sem editar nem excluir mensagem individual; correção por nova mensagem. (A mensagem automática de RF-075 também não é editável.) | [APROVADO] | FA-026 |
| RF-104 | Arquivar/desarquivar é preferência individual; nova mensagem permitida devolve a conversa à caixa principal daquele usuário. | [APROVADO] | FA-026 |
| RF-105 | Reenvio após falha não duplica a mensagem; falha sinalizada; rascunho recuperável quando seguro. | [APROVADO] | FA-028 |
| RF-106 | Conversa somente leitura não aceita mensagem ou arquivo. | [APROVADO] | FA-028 |
| RF-107 | Estados de mensagem: enviando, enviada, entregue, lida (quando verificável), falha, restrita. Copiar texto, denunciar, bloquear. Não há download de anexo (chat só texto, decisão 33). | [APROVADO] | FA-028 |
| RF-108 | Sem limite comercial de mensagens; rate limit apenas contra abuso. | [APROVADO] | FA-027 |
| RF-109 | Histórico não é apagado por expiração, assinatura vencida ou conclusão. | [APROVADO] | FA-012, FA-025 |
| RF-110 | Primeiro nome do cliente visível ao profissional **somente** após participação legítima (aceite válido); e-mail nunca. | [APROVADO] | FA-009, FA-030 |

### M11. Notificações
| ID | Requisito | Origem | FA |
|---|---|---|---|
| RF-115 | **Aceite de trabalho:** o cliente recebe **imediatamente uma mensagem automática no chat** do profissional que aceitou (RF-075), a cada aceite, sem agrupamento e sem depender de e-mail. O **e-mail** de aviso de aceite está **habilitado** (RF-122), complementar ao chat e sujeito à degradação por cota. O cliente vê os aceites ao abrir o site; após publicar o pedido, a tela o informa de que deve voltar ao FastPro para ver as respostas (decisão 10). Mensagem automática: texto fixo de RF-075. | [APROVADO] (H4) | FA-029 |
| RF-116 | Nova mensagem não lida (mensagens humanas): e-mail imediato na primeira; seguintes agrupadas (padrão 15 min). Política **independente** da de aceites. O e-mail de mensagem não lida está **habilitado no código** (RF-122), sem interruptor; o agrupamento de 15 min também economiza a cota. | [APROVADO]/[DELEGADO] 15 min; habilitação: decisão 27 | FA-029 |
| RF-117 | Resumo não é enviado se a mensagem/aceite já foi lido ou o estado mudou (sem aviso obsoleto). | [APROVADO] | FA-029 |
| RF-118 | Cancelamento/seleção/desistência: notifica os pertinentes, sem dados privados desnecessários e sem revelar o selecionado a concorrentes. **Por e-mail (habilitado, RF-122) além da plataforma;** sujeito à degradação por cota (prioridade crítica). | [APROVADO]; e-mail: decisão 27 | FA-016 |
| RF-119 | Expiração: lembrete 24 h antes (se aberto) e aviso no vencimento. Sem prometer aceites. Canal e-mail **habilitado** (decisão 27; AMB-31 respondida), com baixa prioridade na degradação por cota (pode ser suprimido ou adiado; nunca o aviso na plataforma). | [APROVADO]; canal: decisão 27 | FA-012 |
| RF-120 | E-mails e a mensagem automática não revelam endereço completo, anexos ou dados sensíveis. | [APROVADO] | FA-029, FA-030 |
| RF-121 | Canais além de e-mail (push/SMS/WhatsApp) não estão aprovados. | [PROPOSTA] manter fora | — |
| RF-122 | **Todos os e-mails estão HABILITADOS no código** (aceite, mensagem não lida, lembretes, seleção, cancelamento, desistência, trial/ciclo, verificação e login). **Não há interruptor, tela/endpoint administrável, ponto de ativação nem auditoria de flag.** **Não há reenvio nem e-mails retroativos de aceites antigos**: só eventos novos geram e-mail. O aviso de aceite sai com e-mail imediato no primeiro e agrupado depois (padrão 15 min), sem aviso obsoleto (RF-117) e sem dados privados (RF-120). O chat segue imediato e **independe de e-mail**. **Envio real depende do domínio verificado no Resend (decisão 15);** em desenvolvimento o e-mail vai ao Mailpit local. A cota gratuita é tratada como requisito não funcional (seção 8, RNF-EMAIL). Substitui o desenho com feature flag (AMB-25, ADR-022) e a desativação da decisão 23. | [APROVADO] (decisão 27; supera 21 e parte da 23) | FA-029 |

### M12. Avaliações e reputação
| ID | Requisito | Origem | FA |
|---|---|---|---|
| RF-125 | Somente o cliente avalia o profissional selecionado, após conclusão válida; uma avaliação por serviço; 1–5; comentário opcional. | [APROVADO] | FA-019 |
| RF-126 | **D4:** publicação automática após validação antifraude e filtro automático de conteúdo. Moderação humana somente por denúncia/contestação. | [DELEGADO] D4 | FA-019 |
| RF-127 | Primeira avaliação sem prazo comercial, enquanto dados/identidade estiverem legitimamente disponíveis. | [APROVADO] | FA-020 |
| RF-128 | Cliente edita em até 7 dias após publicar; depois, solicita análise excepcional. | [APROVADO] | FA-019 |
| RF-129 | Autor exibido como "Cliente do FastPro" (nunca e-mail ou primeiro nome). | [APROVADO] | FA-019 |
| RF-130 | Média aritmética das notas válidas (1 casa decimal); novo: "Ainda sem avaliações". | [APROVADO] | FA-019 |
| RF-131 | Profissional: uma resposta pública e contestação fundamentada; não edita nota nem avalia cliente. | [APROVADO] | FA-019 |
| RF-132 | Denúncia/contestação não remove automaticamente; decisão humana fundamentada, log, recurso. | [DELEGADO] D4 | FA-031 |
| RF-133 | Conclusão corrigida/anulada: revisar a validade da avaliação associada, sem exclusão silenciosa. | [APROVADO] | FA-018 |

### M13. Privacidade e consentimento
| ID | Requisito | Origem | FA |
|---|---|---|---|
| RF-136 | Matriz de visibilidade por papel (doc 05 §6) é obrigatória: nome, e-mail, telefone, endereço, fotos (**somente as do pedido**; o chat não tem anexos), mensagens (**somente texto**, sem anexos), seleção, conclusão. Linhas de "anexos do chat" saem da matriz (decisão 33); a matriz do doc 05 §6 deve ser atualizada na origem. | [APROVADO] | FA-007, FA-009, FA-030 |
| RF-137 | E-mail do cliente nunca é exposto a profissionais. | [APROVADO] | FA-030 |
| RF-138 | Telefone/WhatsApp: somente com opt-in do pedido (RF-016) ou autorização individual no chat, e apenas para participantes autorizados. | [APROVADO] | FA-030 |
| RF-139 | Endereço completo: apenas com compartilhamento específico do cliente a participante. | [APROVADO] | FA-030 |
| RF-140 | Direitos de titular (LGPD) e retenção por classe de dado: fluxos separados. Base legal/prazos: [PENDENTE JURÍDICO] L1, L2. | [PENDENTE JURÍDICO] | — |
| RF-141 | Links externos (WhatsApp) já compartilhados são fora do controle da plataforma; não prometer vigilância. | [APROVADO] | — |

### M14. Administração
| ID | Requisito | Origem | FA |
|---|---|---|---|
| RF-145 | Papéis: Superadmin, Verificação, Moderador, Financeiro, Suporte, Auditor. MFA obrigatório. Menor privilégio e segregação de funções. | [APROVADO] | FA-031 |
| RF-146 | Matriz detalhada de telas e permissões por papel: **ausente** (D1). Proposta mínima em AMB-08. | [PROPOSTA] | FA-031 |
| RF-147 | Fila de verificação (aprovar, recusar, reter por duplicidade, explicar, receber recurso) com auditoria. | [APROVADO] | FA-004 |
| RF-148 | Chat e documentos de identidade: acesso excepcional somente com caso autorizado, justificativa e log. Sem navegação livre. | [APROVADO] | FA-031 |
| RF-149 | Moderação por denúncia/contestação com decisão fundamentada e recurso. | [DELEGADO] D4 | FA-031 |
| RF-150 | Correção administrativa de conclusão (Suporte/Admin) com auditoria; não reabre aceites. | [APROVADO] | FA-018 |
| RF-151 | Estorno ≤ R$ 200: um Financeiro autorizado. > R$ 200: dois aprovadores independentes; sem autoaprovação. Dependente da política de reembolso. | [APROVADO]; L3 | FA-032 |
| RF-152 | Suspensão permanente com dupla aprovação quando definido. | [APROVADO] | FA-031 |
| RF-153 | Gestão de catálogo, sinônimos e promoções futuras. | [APROVADO] | — |
| RF-154 | Auditoria: ação, ator, objeto, estado anterior/posterior, data/hora, para suspensão, revisão de avaliação, correção de conclusão, estornos e consentimento. Consulta pelo Auditor. (Sem auditoria de flag: não existe flag de e-mail, todos os e-mails estão habilitados, RF-122.) | [APROVADO] | FA-031 |

### M15. Transversais
| ID | Requisito | Origem | FA |
|---|---|---|---|
| RF-160 | Interface conforme EDS aprovado: Roboto, tokens, claro/escuro, sem hex hardcoded em componentes. | [APROVADO] | FA-033 |
| RF-161 | Acessibilidade: objetivo WCAG 2.2 AA; só afirmar conformidade com evidência (teclado, leitor de tela, contraste, estados de erro). | [APROVADO] | FA-034 |
| RF-162 | Estados vazio/carregando/erro em todas as telas de lista e formulário. | [PROPOSTA] | FA-034 |
| RF-163 | Dados de teste exclusivamente sintéticos. | [APROVADO] | — |
| RF-164 | Web primeiro, responsivo; mobile depois. | [APROVADO] | — |

## 4. Fora de escopo (confirmado) [APROVADO]
Apps móveis na primeira fase; áudio no chat; pagamento/escrow e comissão sobre o serviço; cobrança por lead; moedas; limites comerciais de mensagens; desconto de lançamento; conversão automática do trial; publicação automática; reabertura silenciosa da admissão de aceites; avaliação do cliente pelo profissional; preço por cidade/categoria; teste A/B de preço; vigilância do WhatsApp externo; reembolso proporcional automatizado; **oferta/proposta com conteúdo, valor ou prazo estruturado (H4); boleto (H5)**.

## 5. Mapa FA → RF
| FA | RF principais |
|---|---|
| FA-001 | RF-001, 002, 010, 011, 012 |
| FA-002 | RF-012, 014, 015, 035 |
| FA-003 | RF-036..041 |
| FA-004 | RF-046..053, 147 |
| FA-005 | RF-057, 064 |
| FA-006 | RF-055..061 |
| FA-007 | RF-013, 027, 029, 030 |
| FA-008 | RF-028, 030, 031 |
| FA-009 | RF-100, 110, 136 |
| FA-010 | RF-065..068, 071, 074, 076 |
| FA-011 | RF-069, 070, 075, 077, 078 |
| FA-012 | RF-072, 073 |
| FA-013 | RF-080, 082 |
| FA-014 | RF-081 |
| FA-015 | RF-083 |
| FA-016 | RF-086, 118 |
| FA-017 | RF-084 |
| FA-018 | RF-085, 133, 150 |
| FA-019 | RF-125, 128..131 |
| FA-020 | RF-127 |
| FA-021 | RF-017, 090 |
| FA-022 | RF-091, 092, 094 |
| FA-023 | RF-093 |
| FA-024 | RF-087 |
| FA-025 | RF-031, 062, 109 |
| FA-026 | RF-103, 104 |
| FA-027 | RF-025a, 101, 102, 108 |
| FA-028 | RF-105..107 |
| FA-029 | RF-075, 115..117, 120, 122 |
| FA-030 | RF-016, 137..139 |
| FA-031 | RF-145..154 |
| FA-032 | RF-151, 063 |
| FA-033 | RF-160 |
| FA-034 | RF-161, 162 |
| FA-035 | RF-060, 068, 072, 088 |

## 6. Dependências e impacto (sem impor solução)
- **Dados:** pedido, cadeia, participação/aceite, seleção, conclusão, conversa (incluindo mensagem de sistema), avaliação, consentimento, auditoria (doc 05 §1), mais assinatura/acesso comercial, catálogo (sem flag de e-mail; decisões 23 e 27). **Não há entidade de oferta.**
- **APIs/serviços externos:** Mapbox (geocoding/autocomplete), Mercado Pago (assinatura, **Pix e cartão**, webhooks; sem boleto), e-mail transacional (Resend; todos os e-mails habilitados no código, sem flag; envio real exige domínio verificado, decisão 15; Mailpit local em desenvolvimento; cota gratuita de 100/dia e 3.000/mês, RNF-EMAIL), armazenamento privado de arquivos.
- **Arquitetura:** as invariantes (teto 8, seleção única, uma republicação ativa, aceite único, idempotência) devem ser garantidas no servidor; decisão de fonte de verdade da autorização é do Architect.
- **Jurídico:** L1, L2, L3, L4, L7 antes de cobrança real. A carência de 72 h para Pix (H5) é decisão do usuário; a política de reembolso (L3) continua pendente.

## 6.1 Requisito não funcional: cota de e-mail (RNF-EMAIL) [APROVADO decisão 27; limiares do Resend verificados em `13-VERIFICACAO-SERVICOS.md`; limiares de alerta/reserva do Architect são [PROPOSTA]]
- O plano gratuito do Resend permite **100 e-mails/dia (dia UTC) e 3.000/mês**, contando **cada destinatário**; e-mails de teste `resend.dev` também consomem cota.
- O sistema acompanha o uso diário e mensal e alerta perto dos limites (ex.: ≥ 90/dia, ≥ 2.700/mês).
- **Degradação ao se aproximar/estourar a cota:** (1) o e-mail de **login/conta tem prioridade** sobre todos os demais; (2) e-mails críticos (seleção, cancelamento, desistência, verificação) vêm a seguir; (3) aviso de aceite e mensagem não lida depois; (4) lembretes por último, podendo ser suprimidos ou adiados e reavaliados no dia UTC seguinte (nunca enviados se obsoletos); (5) **o chat e o site continuam funcionando**, pois nada essencial depende de e-mail.
- Nenhum e-mail real sai antes do domínio verificado (decisão 15); em desenvolvimento, Mailpit local.
- Critérios: FA-029 (cenários de cota).

## 7. Lacunas
- RN-001..408 e 641..675 sem texto. Este PRD cobre o que os resumos permitem; qualquer detalhe fora disso está em `07-AMBIGUIDADES.md`.
- Telas e permissões por papel admin; metas de triagem de risco elevado.
- Textos de mensagens ao cliente/profissional (texto da mensagem automática de RF-075 e rótulo de RF-076 estão decididos) e textos de e-mail.
- Atribuição da mensagem automática na tela do chat (AMB-30; decisão 26 a define como aviso do sistema); AMB-31 respondida na Rev. 4; redação jurídica de RF-078 (L2, L7).
