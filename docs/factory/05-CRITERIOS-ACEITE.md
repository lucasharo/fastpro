# FastPro — Critérios de aceite FA-001..035 (Given/When/Then)

- **Data:** 2026-11-09 · **Papel:** Product Owner · **Status:** rascunho [PROPOSTA] para validação (revisão 6, aplica decisões 30-33; revisão 2 aplicou H4/H5)
- Os resultados esperados de negócio de cada FA vêm do pacote (doc 09) e são [APROVADO], exceto onde H4/H5 os substituem. A **redação Given/When/Then é [PROPOSTA]** do PO. Decisões incorporadas: D3 (reinterpretado por H4), D4, D5, D8, D10 [DELEGADO]; opt-in de telefone, H4 e H5 [APROVADO].
- Vínculo: cada FA lista os RF de `04-PRD.md`. RN originais continuam sem texto; não são citadas.
- Convenções: "Cliente A/B", "Profissional P1..Pn", "pedido PD". Dados de teste sintéticos. Onde há ambiguidade aberta há referência AMB-xx e o cenário correspondente fica **condicionado**.
- QA amplia com negativos/limites/rede/a11y; os cenários aqui são o mínimo de aceite.

## Histórico de mudanças
### Revisão 2 — 2026-11-09 (H4 e H5)
- **Reescritos por H4 (oferta → aceite de trabalho):** FA-004, FA-007 (texto), FA-010, FA-011, FA-012, FA-013, FA-014, FA-016 (texto), FA-018, FA-021, FA-023, FA-029, FA-034 (texto). Cenários de oferta (conteúdo, edição, "mais de uma oferta") **removidos**.
- **Reescritos por H5 (sem boleto, carência para Pix):** FA-006.
- **Novos cenários:** FA-010 (rótulo sem números; gatilho de 4 aceites), FA-011 (aceite único/idempotente, sem conteúdo, mensagem automática única), FA-029 (chat imediato; e-mail com flag desligada e ligada; **substituído na Rev. 3 por e-mail desativado no código, sem flag**).
- Cobertura das decisões atualizada (D3 com H4; novas linhas H4 e H5). Itens condicionados atualizados.
- **Não alterado:** FA-001..003, 005, 008, 009, 015, 017, 019, 020, 022, 024..028, 030..033, 035 (salvo troca de termo "ofertas" por "aceites" em FA-035).

### Revisão 3 — 2026-11-09 (decisões 1-23)
- **FA-029 e FA-031:** removidos os itens de flag/interruptor e de auditoria de flag. Passam a exigir: e-mail de aviso de aceite e de mensagem não lida **implementado porém DESATIVADO no código** (comentado, ponto único de ativação), sem interruptor, sem tela, sem reenvio de aceites antigos; link mágico e e-mails de conta sempre ativos; chat imediato inalterado. FA-003 ajustado.
- **FA-011:** mensagem automática com texto fixo "Estou disponível para trabalhar" (decisão 14); retirada do aceite sem novo aceite (decisões 3, 19); aviso "apenas conecta" não aparece no botão (decisão 22).
- **FA-010:** "4 aceites" = vagas consumidas, inclusive retirados (decisão 20). **FA-006:** novo período começa no fim do anterior, inclusive carência Pix (decisão 17).
- Condicionados restantes: AMB-30 (atribuição da mensagem automática; decisão 26 a define como aviso do sistema), AMB-31 (e-mails de lembrete). **AMB-31 respondida na Rev. 4.**

### Revisão 4 — 2026-11-09 (Rodada 12, decisão 27)
- **FA-029, FA-031, FA-003 e FA-012 (lembrete):** todos os e-mails estão **habilitados** no código (aceite, mensagem não lida, lembretes, seleção, cancelamento, desistência, trial/ciclo, verificação, login); sem interruptor, tela ou reenvio de aceites antigos; em desenvolvimento vão ao Mailpit; envio real depende de domínio verificado no Resend (decisão 15). Novos cenários de cota (RNF-EMAIL do PRD §6.1): login prioritário, degradação, chat e site continuam. Substitui os cenários "desativado no código" da Rev. 3.
- **Impactos (QA/Architect devem checar):**
  | Verificar | Onde |
  |---|---|
  | Um teste positivo por tipo de e-mail (enfileira/envia ao Mailpit) em vez de "nada é enviado" | 11; FA-029, FA-012, FA-016, FA-005 |
  | Ausência de flag, comentário ou ponto de ativação no código; sem tela/endpoint de e-mail no admin | 08 §12.2; revisão de código; FA-029, FA-031 |
  | Não retroatividade (sem backfill) | FA-029 |
  | Simulação de cota: ≥ 90/dia e 100/dia (UTC), 2.700 e 3.000/mês; login passa, demais adiados/suprimidos e reavaliados no dia seguinte; chat e site intactos; contagem por destinatário | 08 §12.6; FA-029 |
  | Sem domínio verificado nenhum e-mail real sai; `resend.dev` consome cota | ambientes/CI; FA-029 |
  | Resumos obsoletos (RF-117) e dados sensíveis (RF-120) valem para todos os tipos de e-mail | FA-029, FA-030 |

### Revisão 6 — 2026-11-10 (decisão 33 C; supera partes da Rev. 5)
- **FA-027 reescrito:** chat somente texto, sem nenhum anexo (nem imagem, nem PDF), na UI e na API; sem bucket/moderação/antimalware de anexo. **FA-028, FA-009, FA-029 e os cenários de republicação/cancelamento:** removidas referências a anexo/arquivo de chat. Fotos extras e documentos só pelo WhatsApp com autorização do cliente. **AMB-32 resolvida.**
- **Nova AMB-33** (formatos/limites dos documentos de identidade do profissional, FA-004): aberta, sem cenário numérico até decisão.
- **Impactos para QA:**
  | Verificar | Onde |
  |---|---|
  | UI do chat sem anexar/seletor/arrastar/colar/preview/download | FA-027 |
  | API de mensagem recusa qualquer arquivo (imagem, PDF, PDF falso) e nada é armazenado | FA-027; 11 |
  | Sem bucket/URL assinada/antimalware de chat; matriz de visibilidade sem anexos | 08/09/11; FA-009, FA-030 |
  | Reenvio de texto sem duplicar; sem cenário de upload | FA-028 |
  | Cenários de PDF 5 × 10 MB da Rev. 5 não devem existir mais nos testes | 11 |
  | Upload de documentos de identidade (formatos/tamanhos) fica pendente da AMB-33; não reutilizar regras do chat | FA-004 |

### Revisão 5 — 2026-11-10 (decisões 30, 31, 32)
- **[Parcialmente superada pela Rev. 6: FA-027 sem PDF.]**
- **FA-001:** novo cenário de redução de foto (≈ 0,5 MB, 1.280 px, máx. 5). **FA-027** reescrito: chat só texto e PDF, sem imagem (UI e API), fotos extras só por WhatsApp com autorização (RF-025a). **FA-007:** EXIF vale apenas para fotos do pedido. PDF e limites no chat condicionados à **AMB-32**.
- **Impactos (QA/Architect devem checar):**
  | Verificar | Onde |
  |---|---|
  | Storage do chat só com PDF; imagem recusada por conteúdo (inclusive renomeada) e sem upload/preview na UI | 08/09/11; FA-027 |
  | Redução das fotos do pedido (≈ 0,5 MB, ≤ 1.280 px), só a versão reduzida armazenada; limite de 5 | 08/09/11; FA-001 |
  | EXIF removido somente nas fotos do pedido; sem pipeline de imagem no chat | FA-007, FA-027 |
  | Fotos extras fora da plataforma (WhatsApp, com opt-in); sem canal alternativo | FA-027, FA-030 |

### Impactos (o que o Architect e o QA devem revisar)
| Mudança | FA | Revisar |
|---|---|---|
| Gatilho "4 ofertas" → "4 aceites" | FA-010 | 08/09: contador de aceites; 11: testes de corrida |
| Rótulo do botão da 2ª onda sem números | FA-010 | UI; EDS inalterado |
| Aceite único/idempotente, sem conteúdo/edição | FA-011 | 09: remover `offer`/`offer_revision`; unique por (pedido, profissional) |
| Mensagem automática no chat; todos os e-mails habilitados, sem flag (Rev. 4) | FA-029 | Ver Revisão 4 abaixo |
| Sem boleto; carência de 72 h para Pix | FA-006 | 08 §257; 09; 10-ADRS SD-10; 11 (testes de carência Pix) |
| Termo "ofertar/oferta" → "aceitar/aceite" | FA-004, 007, 012..014, 018, 021, 023, 034, 035 | 11: nomes de casos de teste |

---

## FA-001 Visitante navega e inicia pedido sem senha (RF-001, 002, 010..012)
- **Dado** um visitante sem conta, **quando** abre o site, **então** vê categorias e perfis públicos sem login.
- **Dado** o visitante na tela de pedido, **quando** digita parte de um serviço ou sinônimo, **então** o autocomplete sugere serviços do catálogo.
- **Dado** o visitante preenchendo o pedido, **quando** preenche serviço, local, urgência e descrição sem se autenticar, **então** o sistema aceita o preenchimento e **não** pede senha em nenhum ponto.
- **Dado (decisões 30, 31)** o visitante anexa fotos, **quando** envia até 5 (JPG/PNG/WebP, até 10 MB cada na entrada), **então** cada foto armazenada tem ≈ 0,5 MB e no máximo 1.280 px no maior lado; a 6ª foto é recusada.
- **Dado** a urgência, **quando** o visitante abre a lista, **então** vê exatamente Imediato, Nas próximas semanas, Próximo mês, Ainda não defini.

## FA-002 Publicação só após identificação, link mágico, revisão e confirmação (RF-012, 014, 015, 035)
- **Dado** um pedido preenchido, **quando** o cliente tenta enviar sem primeiro nome ou sem e-mail, **então** o envio é bloqueado com erro por campo.
- **Dado** nome e e-mail informados, **quando** o cliente confirma o e-mail pelo link mágico, **então** segue para a tela de revisão; o pedido ainda **não** está publicado.
- **Dado** a tela de revisão, **quando** o cliente confirma expressamente, **então** o pedido é publicado com novo ID, admissão `aberto` e validade de 7 dias corridos.
- **Dado** e-mail não verificado, **quando** alguém tenta publicar via chamada direta de API, **então** a publicação é recusada.
- **Dado** o cliente que fecha a aba antes de confirmar, **quando** retorna, **então** o pedido **não** foi publicado automaticamente (RF-014, RF-019 [PROPOSTA]).

## FA-003 Link/e-mail inválido ou expirado não dá acesso (RF-036..041)
- **Dado** um link com mais de 15 min, **quando** usado, **então** é rejeitado e é oferecido novo envio; nenhuma sessão é criada.
- **Dado** um link já consumido, **quando** reutilizado, **então** é rejeitado.
- **Dado** um link inexistente/adulterado, **quando** usado, **então** não revela se o e-mail existe e não expõe pedidos de terceiros.
- **Dado** o Cliente A autenticado, **quando** solicita pedido/conversa do Cliente B por ID, **então** recebe negação (sem confirmar existência).
- **Dado (D8)** um e-mail aberto por scanner/pré-visualização que faz GET no link, **quando** o cliente real abre depois, **então** o link ainda é válido; o consumo só ocorre ao confirmar a ação na página (POST).
- **Dado (D8)** o cliente que não consegue usar o link, **quando** pede o código de 6 dígitos, **então** o código válido por 15 min e de uso único autentica; código errado repetido é limitado.
- **Dado** a sessão de 7 dias, **quando** vence ou é revogada, **então** nova sessão exige novo link.
- **Dado (decisão 27)** todos os e-mails habilitados, **quando** o cliente pede link/código, **então** o e-mail de autenticação é enviado com prioridade máxima na cota (ao Mailpit em desenvolvimento).

## FA-004 Profissional não aprovado não aceita trabalho, nem por API (RF-046..050, 147)
- **Dado** profissional em `pendente`, `em_revisao`, `retida_duplicidade`, `recusada` ou `suspensa`, **quando** tenta aceitar um trabalho pela UI ou por chamada direta de API, **então** é negado e nada é criado (sem aceite, sem conversa, sem mensagem automática).
- **Dado** a aprovação humana, **quando** o profissional Verificação aprova, **então** o estado muda para `aprovada`, com auditoria (ator, data).
- **Dado** suspeita de duplicidade, **quando** o sistema detecta, **então** retém a aprovação, informa o motivo e oferece recurso; **não** bloqueia definitivamente de forma automática.
- **Dado** atividade regulamentada no cadastro, **quando** não há certificação anexada, **então** a aprovação não é concluída. A verificação do conteúdo da certificação depende de [PENDENTE JURÍDICO] L4.

## FA-005 Trial de 14 dias (RF-057, 064)
- **Dado** profissional aprovado que ainda não ativou, **quando** não clica em ativar, **então** o trial **não** inicia.
- **Dado** profissional não aprovado, **quando** tenta ativar o trial, **então** é negado.
- **Dado** profissional aprovado, **quando** ativa por conta própria, **então** o trial inicia (14 dias), sem pedir meio de pagamento.
- **Dado** o trial vencido, **quando** o 14º dia termina, **então** o acesso comercial cessa sem carência, **nenhuma cobrança** é gerada e **nenhuma assinatura** é criada automaticamente.
- **Dado** repetição de ativação, **quando** o profissional tenta um segundo trial, **então** o comportamento segue AMB-09 (novo trial não definido).

## FA-006 Mercado Pago (Pix e cartão), carência 72 h, idempotência (RF-055..061; H5)
- **Dado** os planos, **quando** o profissional abre a assinatura, **então** vê Mensal R$ 29,90, Trimestral R$ 80,70, Semestral R$ 149,40, Anual R$ 238,80, com benefícios idênticos (D5).
- **Dado (H5)** a tela de pagamento, **quando** o profissional escolhe como pagar, **então** as únicas opções são **Pix** e **cartão**; **não há boleto** em nenhuma tela, API ou e-mail.
- **Dado (H5)** uma tentativa de criar pagamento por boleto via chamada direta de API, **quando** processada, **então** é recusada e nada é criado.
- **Dado** pagamento aprovado no Mercado Pago, **quando** o webhook chega, **então** o acesso passa a `ativa` pelo período do plano.
- **Dado** o mesmo webhook entregue duas vezes, **quando** processado, **então** o resultado é igual ao de uma entrega (sem acesso/cobrança em duplicidade).
- **Dado** falha na renovação paga no **cartão**, **quando** ocorre, **então** o acesso permanece por 72 h (`em_carencia`) e depois expira se não regularizado.
- **Dado (H5)** período pago por **Pix** que termina sem novo pagamento, **quando** o período acaba, **então** o acesso permanece por 72 h (`em_carencia`) contadas do fim do período e depois fica `expirada` se não houver pagamento.
- **Dado (H5)** profissional em carência por Pix que paga dentro das 72 h, **quando** o webhook de pagamento chega, **então** o acesso volta a `ativa` sem lacuna e sem pagamento em duplicidade; o novo período começa no **fim do período anterior** (a carência é incluída, não somada) (decisão 17).
- **Dado** trial vencido, **quando** o 14º dia termina, **então** **não** há carência de 72 h (a carência vale só para ciclo pago).
- **Dado** cartão sem adesão expressa à renovação automática, **quando** o ciclo termina, **então** não há cobrança automática.
- **Dado** Pix, **quando** o ciclo termina, **então** exige novo pagamento manual.
- **Dado** cancelamento de assinatura paga, **quando** confirmado, **então** o acesso permanece até o fim do período pago.
- **Dado** webhook de status desconhecido ou fora de ordem, **quando** chega, **então** o estado não regride indevidamente (QA detalha).

## FA-007 Elegível vê fotos antes de aceitar, sem dados pessoais (RF-013, 027, 029, 030, 136)
- **Dado** profissional aprovado, com acesso vigente (assinatura ou trial), serviço e raio elegíveis, **quando** abre o pedido em descoberta **antes de aceitar**, **então** vê as fotos e a localização generalizada.
- **Dado** o mesmo profissional, **quando** inspeciona a resposta, **então** não há primeiro nome, e-mail, telefone nem endereço completo no conteúdo.
- **Dado (D10; só fotos do pedido, o chat não tem imagens)** uma foto exibida, **quando** inspecionada, **então** não contém EXIF de localização, vem de URL assinada de curta duração, o original não é oferecido para download e há marca d'água com identificador do profissional.
- **Dado (D10)** o profissional que solicita fotos em volume anômalo, **quando** excede o rate limit, **então** é limitado, o acesso é registrado em log por profissional e o padrão sinaliza raspagem.
- **Dado** profissional em trial legítimo, **quando** acessa, **então** a regra é a mesma de assinante.

## FA-008 Sem acesso, sem imagem (RF-028, 030, 031)
- **Dado** visitante, **quando** requisita a URL/ID/miniatura de uma foto, **então** nega (401/403/404 indistinguível).
- **Dado** profissional inelegível (fora do raio, sem acesso vigente, não aprovado), **quando** requisita foto por ID, **então** nega.
- **Dado** URL assinada vazada e expirada, **quando** usada por terceiro, **então** nega.
- **Dado** a miniatura, **quando** requisitada sem autorização, **então** nega com a mesma política do original.
- **Dado** pedido expirado, **quando** elegível **não participante** tenta ver as fotos, **então** nega; **participante** mantém acesso autorizado.

## FA-009 Só o participante legítimo vê nome e a própria conversa (RF-100, 110, 136)
- **Dado** profissional elegível não participante (sem aceite), **quando** vê o pedido, **então** não vê o primeiro nome do cliente.
- **Dado** aceite válido, **quando** abre o pedido/conversa, **então** vê o primeiro nome e a conversa **própria**.
- **Dado** P1 e P2 participantes, **quando** P1 requisita conversa de P2 (por ID previsível ou chamada direta), **então** nega.
- **Dado** o cliente, **quando** abre o pedido, **então** vê cada conversa separadamente, e nunca uma mistura entre profissionais.

## FA-010 Teto de 8, 4+4, botão de 2ª onda (RF-065..068, 071, 074, 076; D3 reinterpretado por H4)
- **Dado** pedido aberto, **quando** profissionais elegíveis aceitam o trabalho, **então** no máximo 4 aceites iniciais são admitidos (1ª onda).
- **Dado** menos de 4 aceites, **quando** o cliente abre o pedido, **então** **não** vê o botão de 2ª onda.
- **Dado (D3/H4)** 4 aceites e pedido aberto, **quando** o cliente abre o pedido, **então** vê o botão **"Chamar mais profissionais"** (rótulo [PROPOSTA], RF-076), cujo texto e tela **não** contêm números, "vagas", "ondas" nem "4"/"8".
- **Dado** o clique, **quando** confirmado, **então** libera até +4 aceites, **uma única vez**; o botão desaparece.
- **Dado (D3/H4)** pedido expirado (7 dias), selecionado ou cancelado, **quando** o cliente abre o pedido, **então** o botão não está disponível.
- **Dado** 8 aceites, **quando** o 9º profissional tenta aceitar, **então** é negado com mensagem que não revela contadores (texto: AMB-04).
- **Dado** clique duplo ou duas abas no botão de 2ª onda, **quando** processados, **então** só uma 2ª onda é aberta (ver FA-035).
- **Dado** plano mensal ou anual, **quando** o profissional descobre pedidos, **então** o acesso é equivalente (D5).
- **Dado (decisão 20)** 4 aceites em que um profissional retirou o aceite, **quando** o cliente abre o pedido, **então** o botão continua visível, pois "4 aceites" conta as vagas consumidas, inclusive a do que retirou.
- **Removido (H4):** "4 participações mas só 2 ofertas". Não existe mais distinção entre participação e oferta.

## FA-011 Aceite único, idempotente, sem conteúdo (RF-069, 070, 075)
- **Dado** profissional elegível com vaga, **quando** vê o pedido, **então** existe o botão **"Aceitar trabalho"** e **não** há campo de texto, valor, prazo, anexo nem tela de "enviar proposta".
- **Dado** P1 que ainda não aceitou, **quando** clica em "Aceitar trabalho", **então** ficam registrados exatamente 1 aceite, 1 vaga consumida, 1 conversa e 1 mensagem automática ao cliente (RF-075).
- **Dado** P1 já com aceite, **quando** envia duas requisições simultâneas de aceitar (duplo clique, duas abas), **então** existe exatamente 1 aceite, 1 vaga e 1 mensagem automática.
- **Dado** P1 com aceite, **quando** reenvia a requisição (retry), **então** nenhum novo aceite, conversa ou mensagem é criado e a resposta é equivalente à primeira.
- **Dado** a falha de rede durante o envio, **quando** o cliente HTTP repete com a mesma chave de idempotência, **então** o resultado é único.
- **Dado** P1 com aceite, **quando** procura editar o aceite ou anexar condições a ele, **então** a UI não oferece e a API nega (não há edição; combinar condições é pelo chat).
- **Dado** a requisição de aceitar enviada com campos extras (texto, valor, prazo) por chamada direta de API, **quando** processada, **então** os campos são ignorados/recusados e nada é persistido como "oferta".
- **Dado (decisão 14)** o aceite, **quando** o cliente abre a conversa, **então** vê uma única mensagem automática com o texto exato "Estou disponível para trabalhar", sem e-mail nem telefone do profissional e sem dado privado do pedido; ela não é editável.
- **Dado (decisões 3, 19)** P1 com aceite e pedido ainda sem seleção, **quando** retira o aceite, **então** a vaga permanece consumida, a conversa fica somente leitura e o cliente é avisado no chat.
- **Dado (decisão 19)** P1 que retirou o aceite, **quando** tenta aceitar de novo o mesmo pedido (UI ou API), **então** é negado e nada é criado; P1 mantém só o histórico somente leitura.
- **Dado (decisão 22)** o botão "Aceitar trabalho" e seu fluxo, **quando** inspecionados, **então** não exibem o aviso "FastPro apenas conecta / não é contrato"; o aviso consta somente nos termos de uso (redação jurídica pendente: L2, L7).
- **Condicionado:** atribuição visual da mensagem automática na tela do chat (AMB-30).

## FA-012 Expiração aos 7 dias (RF-072, 073, 109, 119)
- **Dado** pedido aberto há 7 dias corridos, **quando** o prazo chega, **então** a admissão passa a `encerrado`; o pedido **não** é cancelado nem concluído.
- **Dado** o pedido expirado, **quando** profissional tenta aceitar o trabalho, **então** nega (inclusive requisições concorrentes ao vencimento).
- **Dado** conversas existentes, **quando** o pedido expira, **então** permanecem ativas e não são apagadas.
- **Dado** pedido ainda aberto, **quando** faltam 24 h, **então** o cliente recebe o lembrete (na plataforma e por e-mail habilitado, decisão 27; sujeito à degradação por cota); no vencimento, recebe aviso, sem promessa de novos aceites.
- **Dado** pedido selecionado/cancelado antes de 24 h do fim, **quando** o momento do lembrete chega, **então** o lembrete **não** é enviado.

## FA-013 Seleção após expiração (RF-080, 082)
- **Dado** pedido expirado com participante P1 (que aceitou), **quando** o cliente seleciona P1, **então** a seleção é efetivada.
- **Dado** a seleção após expirar, **quando** efetivada, **então** os aceites **não** reabrem e o prazo original não muda.
- **Dado** um profissional que **não aceitou** o trabalho, **quando** o cliente (ou chamada direta) tenta selecioná-lo, **então** nega.
- **Dado** participante bloqueado, com verificação revogada ou suspenso, **quando** selecionado, **então** nega.

## FA-014 Seleção encerra aceites e mantém conversas (RF-081)
- **Dado** pedido aberto com P1, P2, P3 (aceites), **quando** o cliente seleciona P1, **então** a admissão passa a `encerrado` de imediato.
- **Dado** a seleção, **quando** P4 tenta aceitar o trabalho, **então** nega.
- **Dado** as conversas com P2 e P3, **quando** a seleção ocorre, **então** continuam `ativas` até conclusão/cancelamento.
- **Dado** P2, **quando** é notificado, **então** não recebe a identidade do selecionado.

## FA-015 Troca de selecionado (RF-083)
- **Dado** P1 selecionado e serviço não concluído, **quando** o cliente seleciona P2 (participante prévio), **então** P2 passa a selecionado, com auditoria, sem reabrir aceites.
- **Dado** a troca, **quando** efetivada, **então** nada do histórico/conversa de P1 é transferido a P2 e vice-versa.
- **Dado** pedido concluído ou cancelado, **quando** o cliente tenta trocar, **então** nega.
- **Dado** profissional que nunca participou, **quando** se tenta selecionar, **então** nega.

## FA-016 Cancelamento (RF-086, 118)
- **Dado** pedido sem selecionado, **quando** o cliente confirma o cancelamento, **então** o pedido fica `cancelado`, novos aceites encerrados e **todas** as conversas somente leitura.
- **Dado** pedido com selecionado P1, **quando** o cliente confirma o cancelamento, **então** apenas a conversa com P1 permanece `ativa`; as demais ficam somente leitura.
- **Dado** o cancelamento, **quando** concluído, **então** os pertinentes são notificados sem identidade do selecionado aos concorrentes.
- **Dado** o clique sem a confirmação expressa, **quando** o cliente não confirma, **então** nada muda.
- **Dado** envio em conversa somente leitura, **quando** tentado, **então** é recusado.

## FA-017 Conclusão (RF-084)
- **Dado** selecionado P1, **quando** o cliente confirma a conclusão, **então** o pedido fica `concluido` e a avaliação é habilitada.
- **Dado** a conclusão, **quando** efetivada, **então** só o chat de P1 segue ativo e os demais ficam somente leitura.
- **Dado** o profissional ou o sistema (por expiração), **quando** tentam concluir, **então** nega.
- **Dado** pedido sem selecionado, **quando** se tenta concluir, **então** nega.
- **Dado** dupla conclusão simultânea, **quando** processada, **então** há uma só conclusão.

## FA-018 Correção de conclusão (RF-085, 133, 150)
- **Dado** conclusão há menos de 24 h e sem avaliação publicada, **quando** o cliente corrige e confirma, **então** o pedido volta a `selecionado`, conversas anteriores restauradas se permitido e a admissão de aceites **não** reabre.
- **Dado** conclusão há mais de 24 h **ou** com avaliação publicada, **quando** o cliente tenta corrigir diretamente, **então** nega e oferece solicitação administrativa.
- **Dado** a solicitação administrativa, **quando** Suporte/Admin decide, **então** há registro de auditoria e a avaliação associada é revisada (sem exclusão silenciosa).
- **Dado** o limite de 24 h, **quando** QA testa exatamente 24 h (limite), **então** a regra de inclusão do limite é definida por AMB-11.

## FA-019 Avaliação (RF-125..131; D4)
- **Dado** pedido não concluído, **quando** o cliente tenta avaliar, **então** nega.
- **Dado** conclusão válida, **quando** o cliente avalia com 1–5 e comentário opcional, **então** a avaliação passa por antifraude e filtro automático e, se aprovada, é **publicada automaticamente**; nenhuma moderação humana prévia ocorre (D4).
- **Dado** nota fora de 1–5, **quando** enviada, **então** nega.
- **Dado** uma avaliação já existente para o serviço, **quando** o cliente tenta segunda, **então** nega.
- **Dado** profissional diferente do selecionado, **quando** se tenta avaliar, **então** nega.
- **Dado** a avaliação publicada, **quando** exibida, **então** o autor é "Cliente do FastPro"; sem e-mail e sem primeiro nome.
- **Dado** a avaliação, **quando** o cliente edita em até 7 dias da publicação, **então** a edição é aceita; depois, só solicitação de análise excepcional.
- **Dado** o profissional, **quando** responde, **então** a resposta pública é única; o profissional não altera a nota nem avalia o cliente.
- **Dado** profissional sem avaliações, **quando** o perfil é exibido, **então** mostra "Ainda sem avaliações"; com avaliações, a média com 1 casa decimal.
- **Dado (D4)** denúncia ou contestação, **quando** registradas, **então** a avaliação **não** é removida automaticamente; o Moderador decide com fundamento, log e possibilidade de recurso.
- **Dado** reprovação no filtro automático/antifraude, **quando** ocorre, **então** o comportamento visível ao cliente é definido por AMB-12.

## FA-020 Primeira avaliação sem prazo comercial (RF-127)
- **Dado** conclusão há meses, **quando** o cliente (autenticado por novo link) avalia, **então** a avaliação é aceita se a identidade/dados continuam legitimamente disponíveis.
- **Dado** dados já eliminados por retenção, **quando** se tenta avaliar, **então** nega com mensagem adequada. Prazo de retenção: [PENDENTE JURÍDICO] L1.

## FA-021 Republicação (RF-017, 090)
- **Dado** pedido original (expirado, cancelado ou outro permitido), **quando** o cliente republica, revê os dados e confirma, **então** surge um pedido com ID novo, 7 dias novos e vínculo de cadeia com o original.
- **Dado** a republicação, **quando** criada, **então** aceites, conversas e consentimentos individuais **não** são transferidos.
- **Dado (opt-in)** o original com telefone liberado, **quando** o cliente republica, **então** a opção de telefone vem **desmarcada** e deve ser marcada de novo.
- **Dado** o pedido original, **quando** a republicação é criada, **então** o original permanece inalterado.

## FA-022 Uma republicação ativa por cadeia (RF-091, 092, 094)
- **Dado** republicação ativa, **quando** o cliente tenta outra na mesma cadeia, **então** o sistema informa/abre a existente ou exige cancelamento consciente da ativa.
- **Dado** duas tentativas quase simultâneas, **quando** processadas, **então** só uma é criada.
- **Dado** republicação com selecionado e serviço em andamento, **quando** se tenta nova, **então** ainda conta como ativa.
- **Dado** dois serviços realmente distintos (mesma categoria/endereço), **quando** o cliente cria o 2º pedido, **então** **não** é bloqueado. Critério de "distinto": AMB-01 (D6).
- **Dado** os casos extremos (suspensão, contestação, correção retroativa), **quando** ocorrem, **então** o comportamento segue AMB-02 (D7), e o cenário fica **condicionado**.

## FA-023 Seleção no original com republicação ativa (RF-093)
- **Dado** o original com participante P1 e republicação ativa, **quando** o cliente tenta selecionar P1, **então** vê o impacto e é exigida a confirmação.
- **Dado** a confirmação, **quando** processada, **então** a republicação é cancelada **e** P1 é selecionado no original numa operação consistente.
- **Dado** falha no meio, **quando** ocorre, **então** não resta estado parcial contraditório (republicação cancelada sem seleção, ou o inverso).
- **Dado** repetição da requisição, **quando** reenviada, **então** o efeito é o mesmo de uma só.
- **Dado** a nova cancelada, **quando** efetivada, **então** seus chats ficam somente leitura; nada é transferido (aceites, mensagens, consentimento, avaliação).

## FA-024 Desistência sem substituto (RF-087)
- **Dado** P1 selecionado que desiste, **quando** comunica, **então** o sistema registra e notifica o cliente e **não** troca sozinho.
- **Dado** a ausência de outro participante, **quando** o cliente decide, **então** são oferecidas duas confirmações independentes: (1) cancelar o pedido atual; (2) publicar novo pedido com dados revistos.
- **Dado** o novo pedido, **quando** publicado, **então** tem novo ID, nenhum chat transferido e nenhuma vaga antiga reaberta.
- **Dado** a desistência, **quando** ocorre, **então** o prazo de 7 dias do original não é reaberto.

## FA-025 Assinatura expirada preserva participação (RF-031, 062, 109)
- **Dado** P1 participante cujo acesso comercial expirou, **quando** o cliente o seleciona, **então** a seleção é efetivada (identidade aprovada, sem restrição de segurança).
- **Dado** P1 com acesso expirado, **quando** busca novos pedidos, **então** não os descobre e não aceita novos.
- **Dado** P1 com acesso expirado, **quando** abre pedidos onde já aceitou, **então** mantém conversa e histórico.
- **Dado** P1 suspenso por segurança, **quando** selecionado, **então** nega.

## FA-026 Mensagens sem edição/exclusão; arquivar (RF-103, 104)
- **Dado** mensagem enviada (inclusive a automática de aceite), **quando** o usuário procura editar/excluir, **então** a UI não oferece e a API nega.
- **Dado** conversa ativa, **quando** o usuário arquiva, **então** sai da caixa principal **só dele**; o outro participante não é afetado.
- **Dado** conversa arquivada que ainda aceita envio, **quando** chega nova mensagem, **então** volta à caixa principal do usuário que a arquivara.
- **Dado** conversa arquivada e somente leitura, **quando** chega "nova mensagem", **então** não há nova mensagem e permanece arquivada.

## FA-027 Chat somente texto, sem nenhum anexo (RF-025a, 101, 102, 108) [decisão 33 C]
- **Dado** o chat, **quando** o usuário envia texto, **então** é entregue.
- **Dado (decisão 33)** o chat, **quando** o usuário procura anexar qualquer arquivo (imagem ou PDF), **então** a UI não oferece botão de anexar, seletor, arrastar-e-soltar, colar imagem, upload, preview nem download.
- **Dado (decisão 33)** envio direto pela API de mensagem com arquivo/anexo (JPG/PNG/WebP/GIF/HEIC, PDF, PDF falso ou qualquer outro), **quando** chega ao servidor, **então** é recusado, nada é armazenado e o usuário é informado, sem caminho interno.
- **Dado (decisão 33)** o sistema, **quando** inspecionado, **então** não há bucket, URL assinada, miniatura, marca d'água, moderação nem antimalware de anexo de chat.
- **Dado (RF-025a)** o cliente que quer enviar mais de 5 fotos, **quando** procura fazê-lo, **então** a plataforma não oferece canal (nem no chat); fotos extras e documentos entre cliente e profissional só pelo WhatsApp se o cliente autorizou o contato; sem autorização, o pedido permanece com 5 fotos.
- **Dado** o áudio, **quando** o usuário procura enviar, **então** a opção não é exibida.
- **Dado** muitas mensagens legítimas, **quando** enviadas em ritmo humano, **então** não há limite comercial; só rate limit contra abuso.

## FA-028 Reenvio sem duplicar (apenas texto); somente leitura (RF-105..107)
- **Dado** falha de rede no envio, **quando** o usuário reenvia, **então** a mensagem aparece uma só vez e a falha foi sinalizada.
- **Dado** mensagem de texto com envio interrompido e reenviada, **quando** concluída, **então** não há mensagem duplicada (chat sem anexos, decisão 33).
- **Dado** conversa somente leitura, **quando** se tenta enviar mensagem (UI ou API), **então** nega.
- **Dado** conversa em `restrita_por_seguranca`, **quando** se tenta enviar, **então** nega com aviso apropriado.

## FA-029 Notificações: chat imediato; todos os e-mails habilitados; cota do Resend (RF-075, 115..117, 120, 122, RNF-EMAIL)
- **Dado (H4)** o primeiro aceite de um pedido, **quando** ocorre, **então** o cliente recebe **imediatamente** uma mensagem automática no chat do profissional, visível como não lida ao entrar na plataforma.
- **Dado (H4)** um segundo, terceiro ou quarto aceite, **quando** ocorrem, **então** cada um gera a sua própria mensagem automática no respectivo chat (sem agrupamento no chat).
- **Dado (decisão 27/RF-122)** o e-mail de aviso de aceite **habilitado**, **quando** ocorre um aceite, **então** o e-mail é enfileirado e enviado (em desenvolvimento, entregue ao Mailpit local), com envio imediato no primeiro e agrupado depois (15 min), **e** a mensagem no chat aparece imediatamente sem depender dele.
- **Dado (decisão 27)** a primeira mensagem humana não lida de uma conversa, **quando** ocorre, **então** o e-mail de mensagem não lida é enviado; as seguintes são agrupadas.
- **Dado (decisão 27)** lembrete 24 h, aviso de vencimento, seleção, cancelamento, desistência, lembretes de trial/ciclo e decisão de verificação, **quando** o evento ocorre, **então** o respectivo e-mail é enviado (ao Mailpit em desenvolvimento), sem dados sensíveis (RF-120).
- **Dado (decisão 27)** o sistema em operação, **quando** inspecionadas telas e APIs de admin e de configuração, **então** não existe interruptor, tela ou endpoint para ligar/desligar e-mails, e o código de envio não está comentado nem condicionado a flag.
- **Dado (decisão 27)** aceites e eventos ocorridos antes da habilitação, **quando** ela entra em vigor, **então** **nenhum** e-mail retroativo é gerado (só eventos novos).
- **Dado (decisão 15)** ambiente sem domínio verificado no Resend, **quando** o sistema envia e-mails, **então** nenhum chega a usuário real (Mailpit em dev/CI); o envio real só ocorre com domínio verificado.
- **Dado (RNF-EMAIL)** o uso próximo de 100 e-mails/dia (UTC) ou 3.000/mês, **quando** novos e-mails são gerados, **então** login/conta têm prioridade; lembretes e avisos de menor prioridade são suprimidos ou adiados e reavaliados no dia seguinte (descartados se obsoletos); o **chat e o site continuam funcionando**.
- **Dado (RNF-EMAIL)** cota diária esgotada, **quando** o cliente pede link/código de login, **então** a resposta ao usuário continua uniforme e o e-mail de login segue na fila com prioridade, sem desvio da regra de limites.
- **Dado (decisão 27)** link mágico/código e e-mails de conta, **quando** solicitados, **então** são enviados e nunca degradados antes dos demais.
- **Dado (decisão 10)** o cliente que acabou de publicar o pedido, **quando** vê a confirmação, **então** a tela informa que ele deve voltar ao FastPro para ver as respostas.
- **Dado** a mensagem lida antes do resumo, **quando** o resumo seria enviado, **então** é cancelado/omitido.
- **Dado** o pedido selecionado/cancelado com e-mails na fila, **quando** o resumo seria enviado, **então** não é enviado resumo obsoleto.
- **Dado** o e-mail enviado ou a mensagem automática, **quando** inspecionados, **então** não trazem endereço completo, dados sensíveis nem credencial permanente.
- **Dado** a alteração de uma política (ex.: 15 min), **quando** feita, **então** a outra não muda.

## FA-030 E-mail nunca; telefone só com consentimento (RF-016, 137..139)
- **Dado** o profissional (elegível, participante ou selecionado), **quando** inspeciona qualquer tela ou resposta de API, **então** o e-mail do cliente nunca aparece.
- **Dado** o formulário do pedido com telefone preenchido, **quando** exibido, **então** o checkbox de liberar telefone/WhatsApp está **desmarcado por padrão**.
- **Dado** o checkbox não marcado, **quando** um profissional aceita o trabalho, **então** não vê o telefone/WhatsApp.
- **Dado** o checkbox marcado (opt-in no pedido), **quando** um profissional **aceita o trabalho**, **então** vê o telefone/WhatsApp apenas dentro daquela participação.
- **Dado** o checkbox marcado, **quando** um elegível **que não aceitou** abre o pedido, **então** não vê o telefone.
- **Dado** que o cliente não informou telefone, **quando** o pedido é preenchido, **então** o opt-in não é exibido ou fica inativo.
- **Dado** o opt-in marcado e depois revogado, **quando** o cliente revoga, **então** o acesso futuro cessa; o aviso informa que cópia salva fora da plataforma não pode ser revogada.
- **Dado** o opt-in, **quando** o pedido é republicado, **então** o consentimento não é transferido (FA-021).
- **Dado** o telefone não liberado, **quando** o cliente prefere compartilhar com um profissional específico, **então** pode autorizar individualmente no chat.
- **Dado** o endereço completo, **quando** o cliente não compartilhou especificamente, **então** o profissional não o vê.

## FA-031 Admin sem navegação livre (RF-145..154)
- **Dado** admin sem caso autorizado, **quando** tenta abrir um chat ou documento de identidade, **então** nega.
- **Dado** o caso autorizado com justificativa, **quando** admin acessa, **então** há log (quem, o quê, por quê, quando) e o acesso é mínimo necessário.
- **Dado** acesso admin sem MFA, **quando** tenta entrar, **então** nega.
- **Dado** o papel Auditor, **quando** consulta, **então** vê a trilha e não altera dados.
- **Dado** o Moderador, **quando** decide denúncia/contestação, **então** a decisão é fundamentada, registrada e sujeita a recurso (D4).
- **Dado** a suspensão permanente, **quando** requerida, **então** exige dupla aprovação quando definido; sem autoaprovação.
- **Dado** a chamada direta de API por papel inadequado, **quando** feita, **então** nega (não apenas oculta na UI).
- **Dado (decisão 23)** o painel e as APIs administrativas, **quando** inspecionados, **então** não existe configuração de e-mail a alterar nem evento de auditoria de flag, pois todos os e-mails estão habilitados (RF-122, RF-154; decisão 27).

## FA-032 Estornos (RF-151, 063)
- **Dado** estorno ≤ R$ 200,00, **quando** um Financeiro autorizado aprova, **então** é efetivado com uma aprovação.
- **Dado** estorno > R$ 200,00, **quando** apenas um aprovador aprova, **então** permanece pendente; com um segundo aprovador **independente**, é efetivado.
- **Dado** o solicitante do estorno, **quando** tenta aprovar o próprio, **então** nega (sem autoaprovação).
- **Dado** o mesmo aprovador, **quando** tenta dar as duas aprovações, **então** nega.
- **Dado** exatamente R$ 200,00, **quando** processado, **então** conta como "até R$ 200" (uma aprovação).
- **Dado** a política de reembolso proporcional (retenção de 50%), **quando** operada, **então** não há automação; aguarda [PENDENTE JURÍDICO] L3.

## FA-033 Temas e EDS (RF-160)
- **Dado** tema claro ou escuro, **quando** a interface é renderizada, **então** usa os tokens aprovados (cores, Roboto 400/500/700, raios, tamanhos).
- **Dado** a varredura de código, **quando** executada, **então** não há hex de cor hardcoded em componentes.
- **Dado** a alternância de tema, **quando** feita, **então** nenhum componente fica ilegível.
- O EDS não é alterado por este documento.

## FA-034 Acessibilidade (RF-161, 162)
- **Dado** os fluxos principais (pedido, link mágico, aceite de trabalho, chat, assinatura), **quando** navegados só pelo teclado, **então** todos os controles são alcançáveis, com foco visível e ordem lógica.
- **Dado** leitor de tela, **quando** usado nos mesmos fluxos, **então** rótulos, estados e erros são anunciados (inclusive a chegada da mensagem automática de aceite e o botão "Chamar mais profissionais").
- **Dado** os tokens nos dois temas, **quando** o contraste efetivo é medido, **então** atende ao critério adotado (WCAG 2.2 AA).
- **Dado** estados vazio/carregando/erro, **quando** exibidos, **então** são perceptíveis e acionáveis.
- A conformidade WCAG 2.2 AA **só** pode ser declarada com evidência registrada.

## FA-035 Idempotência e falha parcial (RF-060, 068, 072, 088)
- **Dado** duplo clique ou reenvio, **quando** em aceite de trabalho, seleção, cancelamento, conclusão, pagamento (webhook) ou republicação, **então** o efeito é o de uma só execução.
- **Dado** duas ações conflitantes simultâneas (selecionar P1 e selecionar P2; concluir e cancelar), **quando** processadas, **então** resulta em estado consistente, sem seleção/conclusão/cancelamento contraditórios.
- **Dado** falha entre passos de uma operação composta (cancelar nova + selecionar original; ou aceite = vaga + conversa + mensagem automática), **quando** ocorre, **então** não resta estado parcial (ver FA-023, FA-011).
- **Dado** 8 vagas e N profissionais simultâneos aceitando, **quando** disputam, **então** exatamente 8 (4+4) são admitidos, nunca 9.
- **Dado** duas republicações quase simultâneas, **quando** processadas, **então** apenas uma é criada (FA-022).
- **Dado** a ordem de eventos inesperada (conclusão duplicada, avaliação duplicada, correção fora do prazo), **quando** ocorre, **então** o resultado é igual ao da execução única válida.

---

## Cobertura das decisões
| Decisão | FA que a exercitam |
|---|---|
| D3 (reinterpretado por H4: gatilho = 4 aceites) | FA-010, FA-012, FA-035 |
| D4 | FA-019, FA-031 |
| D5 | FA-006, FA-010 |
| D8 | FA-003 |
| D10 | FA-007, FA-008 |
| Opt-in de telefone/WhatsApp | FA-021, FA-030 |
| H4 e decisões 14, 19, 20, 22, 23, 27 (aceite de trabalho; chat; e-mails habilitados sem flag; cota) | FA-004, FA-010, FA-011, FA-029, FA-031, FA-035 |
| H5 (sem boleto; carência 72 h para Pix) | FA-006 |

## Itens condicionados
Cenários dependentes de ambiguidade aberta: FA-005 (AMB-09), FA-010 (AMB-04), FA-011 (AMB-30; texto jurídico L2/L7), FA-018 (AMB-11), FA-019 (AMB-12), FA-020 (L1), FA-022 (AMB-01, AMB-02), FA-032 (L3); documentos de identidade do profissional: formatos/limites em AMB-33 (FA-004). FA-027 deixou de ser condicionado (AMB-32 resolvida pela decisão 33 C). AMB-21..29 estão respondidas ou extintas. Ver `07-AMBIGUIDADES.md`.
