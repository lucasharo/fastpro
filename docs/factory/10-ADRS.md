# FastPro — Registro de decisões arquiteturais (ADRs)

- **Etapa:** architecture · **Data:** 2026-11-09 · **Papel:** Software Architect · **Status:** rascunho para validação humana (revisão 2)

## Histórico de mudanças
### Revisão 6 — 2026-11-10 (Rodada 14 nº 31 e 32; Revisão 5 do PO)
- **Fotos do pedido (decisão 31):** reduzidas **no envio** para ≈ **0,5 MB** e **no máximo 1.280 px**, **5 por pedido** (≈ 2,5 MB/pedido; ≈ 280 pedidos em ≈ 700 MB de Storage). **Só a versão reduzida é guardada**: o original e qualquer *master* maior nunca são persistidos. Supera o alvo "1–2 MB" da revisão 5.
- **Chat somente texto (decisões 32 e 33):** nenhum anexo, nem imagem nem PDF. **Removidos:** bucket `chat-attachments`, tabela `message_attachment`, validação por conteúdo e antimalware de anexos do chat, URLs assinadas e limites (5 × 10 MB) de anexo, miniatura e marca d'água do chat, e os riscos/testes de PDF do chat. A API **rejeita qualquer anexo** no chat. EXIF só se aplica às fotos do pedido.
- **Fotos extras** só via WhatsApp com opt-in (inalterado). **AMB-32 (PDF no chat) fica superada** pela decisão 33. **SD-12** (antivírus) é reduzida: sem anexos no chat, resta apenas o risco menor dos documentos de verificação (acesso só da Verificação).
- **Storage passa a ter apenas fotos do pedido e documentos de verificação de identidade**; estimativas refeitas (09 §9). O **egress de fotos (5 GB/mês)** segue como limite mais apertado.

### Revisão 5 — 2026-11-10 (Rodada 13 nº 28–30; doc 13)
- **ADR-008** reescrito (Mapbox: autocomplete/mapas temporários no gratuito; coordenada só via `permanent=true`, uma chamada no servidor; custo). **ADR-018** atualizado (Hobby→Pro ao cobrar; tick sem cron da Vercel; NestJS suportado). **ADR-007** e **ADR-020** atualizados com os fatos de Vercel, Supabase, Mapbox e Mercado Pago.
- **SD:** SD-01 e SD-15 respondidas (decisões 28); SD-02 respondida (decisão 29). Pendências de execução em `12-TODO.md` (#9–#12).
- Itens "(resumo)" do doc 13 (webhooks do MP, parte da Vercel) permanecem a reconfirmar.

### Revisão 4 — 2026-11-09 (Rodada 12 nº 27)
- **ADR-022** reescrito de novo: **todos os e-mails habilitados no código**, sem ponto de ativação, sem interruptor, sem reenvio de antigos; Resend com cota gratuita de 100/dia e 3.000/mês como restrição de desenho (contador, alertas, prioridade de login, degradação). ADR-011, ADR-020 (§20.1, §20.2) e SD-03/SD-19 ajustados. Fatos do Resend vêm de `13-VERIFICACAO-SERVICOS.md`; demais serviços seguem `[NÃO VERIFICADO]` salvo o que o doc 13 cobrir.

### Revisão 3 — 2026-11-09 (Rodadas 8 e 9; trecho de e-mail desativado SUPERADO pela revisão 4)
- **ADR-022** reescrito: **sem interruptor** (Rodada 9 nº 23); avisos de aceite/mensagem não lida implementados e **desativados no código**, ponto único de ativação documentado, sem reenvio de antigos; Resend atrás de porta. ADR-011 e ADR-020 ajustados.
- **SD:** SD-16, SD-18, SD-19, SD-20 respondidas (Rodada 8 nº 17, 19, 20; Rodada 9 nº 22); SD-03, SD-15 e `12-TODO.md` adiadas (`12-TODO.md`). Lista de abertas reduzida (§SD).

### Revisão 2 — 2026-11-09 (Rodadas 5, 6 e 7)
- **ADR-001** revisto: NestJS como função serverless única (Vercel, H1); sem processo residente. **ADR-018** reescrito (hospedagem Vercel, riscos de termos e de NestJS serverless `[NÃO VERIFICADO]`, alternativas). **ADR-014** revisto (rate limit só em Postgres). **ADR-007**: Pix e cartão, sem boleto, carência 72 h também para Pix. **ADR-010**: mensagens de sistema. **ADR-011**: interruptores por tipo de e-mail. **ADR-020**: linhas de Vercel, e-mail/Resend/domínio, backup manual.
- **Novos:** ADR-021 (aceite de trabalho, retirada, contador da 2ª onda e mensagem de sistema), ADR-022 (originalmente interruptores; reescrito na revisão 3 como "desativado no código").
- **SD:** SD-01 respondida (H1: Vercel); SD-07 e SD-08 extintas (H4); SD-10 respondida (H5); SD-03 reescrita (Resend; domínio); SD-04 atualizada (H3). Novas **SD-15..SD-20** (§SD).
- Web não consultada: limites e termos de Vercel, Supabase, Resend, Mapbox e MP continuam `[NÃO VERIFICADO]`.
- **Etiquetas:** `[APROVADO]` · `[DELEGADO]` · `[PROPOSTA]` (decisão proposta pelo Architect, não em vigor até validação) · `[NÃO VERIFICADO]` (fato externo sem fonte consultada nesta sessão; valores vêm de memória e podem estar errados ou desatualizados) · `[PENDENTE JURÍDICO]`
- **Convenções:** cada ADR traz Contexto, Decisão, Alternativas, Impacto e Riscos. Onde a decisão altera a stack aprovada, adiciona componente fora dela ou muda requisito, **não é decidida aqui**: vira **solicitação de decisão (SD-xx)** no final.
- **Restrição de orçamento [APROVADO]:** nada pago é premissa; planos pagos aparecem como gatilho (ADR-020).
- Não foi feita nenhuma consulta a fontes externas nem criada conta/projeto. Afirmações sobre Mercado Pago, Mapbox, Supabase, lojas e provedores de hospedagem/e-mail são `[NÃO VERIFICADO]` e dependem de spikes (`11` §6).

## Índice
| ADR | Tema | Etiqueta |
|---|---|---|
| 001 | Monólito modular NestJS (api + worker) | PROPOSTA |
| 002 | Fonte de verdade da autorização | DELEGADO (direção) / PROPOSTA (detalhe) |
| 003 | Concorrência: lock por agregado + constraints + idempotência | PROPOSTA |
| 004 | Estados ortogonais e tempo verificado no uso | APROVADO (estados) / PROPOSTA (derivação) |
| 005 | Identidade, sessão e magic link (D8) | DELEGADO / PROPOSTA |
| 006 | Login Google/Apple (AMB-05) | DELEGADO (A no MVP) / NÃO VERIFICADO |
| 007 | Billing: domínio dono do acesso; Mercado Pago | PROPOSTA / NÃO VERIFICADO |
| 008 | Geo: PostGIS, generalização, Mapbox | PROPOSTA / NÃO VERIFICADO |
| 009 | Mídia: pipeline, D10, marca d'água, antivírus | DELEGADO (D10) / PROPOSTA |
| 010 | Chat e Realtime como sinal | PROPOSTA |
| 011 | Notificações: outbox, digest, e-mail | PROPOSTA |
| 012 | Admin: app separado, MFA, RBAC, dupla aprovação, auditoria | APROVADO (papéis) / PROPOSTA |
| 013 | Observabilidade sem PII | PROPOSTA |
| 014 | Abuso e rate limit | PROPOSTA |
| 015 | Parâmetros de duplicidade (AMB-01) | DELEGADO (A) / PROPOSTA (valores) |
| 016 | Retenção: mecanismo sem prazos | PENDENTE JURÍDICO |
| 017 | Monorepo, migrações e acesso a dados | PROPOSTA |
| 018 | Hospedagem na Vercel e execução serverless no plano gratuito | APROVADO (Vercel, H1) / PROPOSTA / NÃO VERIFICADO |
| 019 | Mobile: riscos antecipados | NÃO VERIFICADO |
| 020 | Dimensionamento ao plano gratuito: limites, riscos e gatilhos | APROVADO (restrição) / NÃO VERIFICADO (valores) |
| 021 | Aceite de trabalho, retirada, 2ª onda e mensagem de sistema | APROVADO (H4, respostas 1–3, 7) / PROPOSTA (mecanismo) |
| 022 | E-mails todos habilitados no código, cota do Resend e provedor atrás de porta | APROVADO (Rodada 12 nº 27, T6) / VERIFICADO (limites, doc 13) / PROPOSTA (limiares) |
| SD | Solicitações de decisão | — |

---

## ADR-001 — Monólito modular NestJS, função serverless única [PROPOSTA; execução na Vercel APROVADA em H1]
**Contexto:** equipe pequena, sem orçamento, necessidade de transações atômicas entre pedido, vaga, aceite, conversa, mensagem de sistema, seleção e outbox. H1 fixa a Vercel.
**Decisão:** um único backend NestJS com módulos de limites explícitos (`08` §2), empacotado como **uma função serverless** (um aplicativo, não uma função por endpoint) `[NÃO VERIFICADO]`. O "worker" é a mesma base de código chamada pela rota interna de tick. Sem processo residente.
**Alternativas:** (a) microserviços: custo operacional e transações distribuídas incompatíveis com RF-088; (b) uma função serverless por endpoint: dificulta pool de conexão e compartilhamento de módulos (rejeitada; a variante "função única" é a adotada); (c) lógica em funções do Postgres: usada apenas onde protege invariantes (aceite, recompute de conversas, acesso comercial); (d) NestJS em host de processo contínuo fora da Vercel (ADR-018, SD-15).
**Impacto:** deploy simples; módulos podem virar serviços. **Riscos:** acoplamento acidental (regras de importação em CI); cold start e duração máxima da função; sem timers em memória (jobs idempotentes e *leases*).

## ADR-002 — Fonte de verdade da autorização [DELEGADO direção; PROPOSTA detalhe]
**Contexto:** dois sistemas de autorização (NestJS e RLS) podem divergir (risco apontado no relatório de ingestão). A tarefa direcionou: domínio no NestJS, RLS como defesa em profundidade.
**Decisão:** NestJS é a fonte primária de decisão; Postgres impõe invariantes (constraints/triggers) e RLS default-deny; Storage sem política direta; frontend só UX. A API conecta-se como papel **sem BYPASSRLS** e injeta o principal por transação, de modo que o RLS protege também os caminhos da própria API. Jobs/webhooks usam papel de sistema com grants mínimos. Matriz de acesso única legível por máquina gera testes nas duas camadas (`08` §4).
**Alternativas:** (a) só RLS com acesso direto do cliente ao banco: regras de estado e elegibilidade (vagas, geo, acesso comercial) ficam complexas e opacas; (b) só NestJS (RLS desligada): um bug vira vazamento; (c) NestJS conectando com `service_role` (bypass): mais simples, mas elimina a defesa em profundidade.
**Impacto:** custo de escrever/testar políticas e views; leitura profissional por views sem PII. **Riscos:** complexidade e desempenho de RLS (testes de carga e `EXPLAIN`); divergência (testes de paridade); uso do pooler em modo transação exige `set_config` local por transação.

## ADR-003 — Concorrência: lock por agregado + constraints + idempotência [PROPOSTA]
**Contexto:** 8 vagas (4+4), 2ª onda uma vez, seleção única, republicação única, operações compostas atômicas (FA-035).
**Decisão:** `SELECT … FOR UPDATE` na linha do pedido em toda mutação do agregado; ordem global de locks (cadeia → pedidos por ID); `lock_timeout` curto; constraints únicos/parciais e triggers como backstop; `Idempotency-Key` obrigatório em operações com efeito; `expected_version` para confirmações do cliente; outbox transacional. Ordem de ocupação das vagas = ordem de obtenção do lock (AMB-19 A, [DELEGADO]).
**Alternativas:** (a) concorrência otimista com retry: contenda alta em pedidos populares gera tempestade de retries, regra de contagem exige leitura consistente; (b) `SERIALIZABLE`: correto, mas aborta com frequência e é mais difícil de operar; (c) advisory locks por pedido: equivalente ao lock de linha, porém sem vínculo com a linha atualizada; (d) contador atômico sem lock (`UPDATE … WHERE count<4`): viável para vagas, mas não cobre operações compostas.
**Impacto:** latência serializada por pedido (aceitável: pedidos são independentes). **Riscos:** deadlock (ordem global + teste); pedido muito disputado (aceitável com teto de 8 participantes); `lock_timeout` com UX de nova tentativa.

## ADR-004 — Estados ortogonais e tempo verificado no uso [APROVADO estados; PROPOSTA derivação]
**Decisão:** os eixos do doc 05 §2 são mantidos separados (`08` §6). A **admissão** é derivada (`status='publicado' AND now() < acceptance_deadline_at`); `acceptance_deadline_at` é imutável. Acesso comercial é derivado de `access_grant`. Conversas recalculadas por função na mesma transação. Jobs apenas notificam ou materializam; nunca são necessários à correção.
**Alternativas:** enum único (proibido pelo pacote); estado materializado atualizado por timers (frágil com processos que dormem, ADR-018).
**Impacto:** consultas usam predicado de tempo; índice por `acceptance_deadline_at`. **Riscos:** deriva entre predicado e rótulos materializados (um teste de consistência compara).

## ADR-005 — Identidade, sessão e magic link (D8) [DELEGADO D8; mecanismo PROPOSTA]
**Contexto:** D8 exige confirmação por POST e código de 6 dígitos; 15 min, uso único; sessão 7 dias; anti-enumeração; AMB-13 A+C; cliente sem conta tradicional; Realtime e RLS pedem JWT do Supabase.
**Decisão:** módulo `identity` próprio emite desafios (token no fragmento da URL, código HMAC, 5 tentativas, nonce de navegador); o consumo é POST e abre uma **etapa de identificação** de curta duração (15 min; cria/vincula o usuário no Supabase Auth; não autoriza recurso algum, ver `46-DESENHO-H012`); a API converte a etapa na sessão (`app_session`, 7 dias absolutos, revogável) na H-014, depois das regras de nonce e código da H-013; o JWT de curta duração leva `sid`. Step-up por código para ações críticas (janela 30 min `[PROPOSTA]`). Profissional: e-mail/senha no Supabase Auth. Admin: convite + TOTP (`aal2`).
**Alternativas:** (A) magic link/OTP nativos do Supabase Auth com página de confirmação POST: menos código, mas expiração mínima, tamanho do código, uso único e limites de e-mail do plano gratuito são `[NÃO VERIFICADO]` e o controle de enumeração/limites é menor; (B) sessão totalmente própria (JWT emitido pelo NestJS) sem identidade no Supabase: perde Realtime privado com RLS e Storage nativos; (C) senha para clientes: contradiz decisão aprovada.
**Impacto:** código próprio de segurança sensível (revisão obrigatória, testes de abuso). **E-mail (Rodada 7):** o link/código do cliente é enviado direto pelo `EmailProviderPort` (Resend); Resend também pode ser o SMTP customizado do Supabase Auth para e-mails de profissional/admin e, se S-01 escolher a alternativa (A), do link nativo `[NÃO VERIFICADO]`. **Riscos:** como o NestJS obtém a sessão do Supabase para um usuário já verificado por nós (spike S-01); se inviável, fallback (B) com Realtime por polling (ADR-010), sem mudar a stack; cota de e-mail (ADR-020); sessão em dispositivo compartilhado (mitigada por step-up e botão "sair de todos").

## ADR-006 — Login Google/Apple (AMB-05) [DELEGADO A no MVP; regras das lojas NÃO VERIFICADO]
**Contexto:** AMB-05/D9 [DELEGADO]: A (somente e-mail/senha no MVP web), sujeita à confirmação do Architect sobre regras das lojas.
**Decisão:** no MVP web, profissional entra apenas com e-mail/senha. A arquitetura mantém Supabase Auth como emissor, permitindo adicionar provedores sociais sem mudar o modelo (`app_user.auth_user_id`; vínculo por e-mail verificado).
**Confirmação solicitada (não foi possível verificar nesta sessão, **[NÃO VERIFICADO]**):**
1. App Store (diretriz de "serviços de login"): apps iOS que oferecem login social de terceiros devem oferecer uma alternativa equivalente que preserve privacidade (na prática, "Entrar com Apple" ou equivalente conforme critérios vigentes). Aplica-se ao **app mobile iOS**, não ao web.
2. Lojas exigem, em geral, que contas criadas no app possam ser **excluídas dentro do app** (e Google Play, link web de exclusão) `[NÃO VERIFICADO]`; isso interage com retenção/auditoria (ADR-016).
3. Se o app oferecer apenas e-mail/senha (sem terceiros), a regra de login social não se aplica.
**Alternativas:** B (Google+Apple juntos no web): maior superfície de identidade a verificar (documentos), dependência de consoles de provedor; C (só Google): obrigaria Apple no iOS.
**Impacto:** recomendação mantida: A no web; **decisão final para a fase mobile** após leitura das regras vigentes nas fontes oficiais (S-07). **Risco:** custo de conta de desenvolvedor Apple (pago) e revisão de loja (L6) conflitam com a restrição de orçamento ⇒ fase mobile inviável sem decisão do usuário (SD-13).

## ADR-007 — Billing: domínio dono do acesso; Mercado Pago [PROPOSTA; capacidades NÃO VERIFICADO]
**Decisão:** ver `08` §8. Resumo: `access_grant` como livro; trial local sem MP e sem cobrança futura; MP atrás de uma porta; cartão recorrente por adesão expressa, **Pix e cartão apenas, sem boleto (H5)**, Pix como pagamento avulso por ciclo; webhook vira inbox idempotente, processamento assíncrono com **consulta ao recurso na API**; carência = `period_end + 72 h` para cartão **e Pix** (função de tempo; início do novo período sem lacuna, Rodada 8 nº 17); reconciliação diária; estornos manuais com dupla aprovação.
**Alternativas:** (0) boleto: removido por H5; (a) usar o "teste gratuito" do próprio MP: exigiria meio de pagamento ou vincular assinatura, contradiz RF-057; (b) confiar no corpo do webhook: vulnerável a forja/ordem; (c) Stripe/Pagar.me: troca de gateway (fora da stack ⇒ SD).
**Impacto:** lógica de tempo própria; modelo independe do gateway. **Fatos (doc 13, resumo a reconfirmar):** assinatura recorrente por API (semanal, mensal, anual) com Pix como meio; "Pix Automático" não encontrado (Pix manual); "período de testes" do MP sem detalhes (o trial sem cartão é do nosso app); tarifas e mensalidade **não obtidas** (403); webhooks `subscription_preapproval` e `subscription_authorized_payment`, `x-signature`, reenvio a cada 15 min. **Riscos:** (1) MP pode não oferecer assinatura recorrente adequada para o caso, Pix recorrente ou estrutura de planos por ciclo `[NÃO VERIFICADO]` ⇒ fallback: todos os ciclos como pagamento avulso com renovação por lembrete (preserva as regras aprovadas, perde conveniência); (2) formato da assinatura de webhook, limites de taxa e comportamento do sandbox `[NÃO VERIFICADO]` (S-03); (3) taxa por transação `[NÃO VERIFICADO]` reduz a receita líquida (negócio, não arquitetura); (4) PCI: evitar manipular cartão; (5) cobrança indevida e reembolso: `[PENDENTE JURÍDICO]` L3.

## ADR-008 — Geo: PostGIS, generalização, Mapbox permanente [PROPOSTA; decisão 29 APROVADA; fatos do doc 13]
**Decisão:** `08` §9. Casamento por raio com PostGIS sobre ponto **generalizado** (célula 500 m `[PROPOSTA]`); endereço exato só dono e casos autorizados; UI pública sem pino. **Mapbox (decisão 29):** autocomplete e mapas no plano gratuito (resultado **temporário, nunca armazenado**); para guardar coordenadas, **uma única chamada `permanent=true` no servidor** (US$ 5/1.000, cartão, limite de gasto) quando o rascunho é revisto; a publicação reutiliza a coordenada. Contador de gasto e *circuit breaker* em `external_quota(mapbox_permanent)`.
**Alternativas:** (a) casar pelo ponto exato: expõe triangulação; (b) pino de mapa: usa cota de mapas e aumenta a reidentificação; (c) outro geocodificador (muda a stack; descartado pela decisão 29); (d) CEP + tabela local: perde precisão; (e) permanente só na publicação com leitura temporária em memória (reduz o custo, leitura de termos mais frágil; plano B).
**Impacto:** custo variável ≈ US$ 0,005–0,015 por pedido (≈ US$ 6,50 por 1.000 pedidos, hipótese de 1,3 chamadas); cartão obrigatório na conta (12-TODO #9). **Riscos:** (1) os termos de produto (PDF) não foram lidos: interpretar "armazenar" como "guardar no banco" é leitura do texto `[NÃO VERIFICADO]`; (2) sem faixa gratuita no permanente: custo desde o primeiro pedido; (3) token público raspado consome a cota temporária (restrição por origem + limites); (4) PostGIS no Free = NÃO ENCONTRADO (spike S-02; plano B: distância por fórmula/`earthdistance` ou índice por célula, sem PostGIS).

## ADR-009 — Mídia: pipeline, D10, marca d'água, antivírus [DELEGADO D10; decisões 31 e 32 APROVADAS; parâmetros PROPOSTA]
**Decisão:** `08` §10. **Fotos do pedido:** reduzidas no envio (navegador) e reencodadas no servidor para ≤ 1.280 px e ≈ 0,5 MB, 5 por pedido, **guardando só a versão reduzida** (sem original nem *master*); EXIF removido (rotação aplicada antes). Entrega a profissionais por URL assinada de ~60 s servida pela API, com **marca d'água por visualizador aplicada sobre a versão reduzida**, rate limit, log compacto e sinal de raspagem (D10 inalterado). **Chat:** somente texto, sem nenhum anexo (decisão 33); a API rejeita qualquer anexo; não existe mídia de chat.
**Alternativas:** (a) guardar original/master e reduzir sob demanda: gasta Storage e amplia a exposição (rejeitada, decisão 31); (b) marca d'água só no cliente: contornável; (c) cache persistente de derivadas por profissional: consome Storage; (d) borrar/limitar fotos antes de aceitar: altera D10; (e) permitir imagens ou PDF no chat: abre outro caminho de mídia fora da regra de 5 fotos e consome Storage (rejeitada, decisões 32 e 33); (f) ClamAV residente e (g) terceiro: desnecessários para o chat (sem anexos); SD-12 reduzida aos documentos de verificação.
**Impacto:** menos CPU na marca d'água (arquivo menor) e capacidade ≈ 280 pedidos em ≈ 700 MB; perda de qualidade das fotos (aceita pelo usuário). **Riscos:** (1) bibliotecas de decodificação (HEIC etc.) são superfície de ataque; (2) marca d'água não impede fotografar a tela; (3) fachada visível (R-03); (4) documentos de identidade enviados por profissionais sem antivírus (R-07 reduzido; visão só da Verificação); (5) egress de fotos ≈ 25–50 MB/pedido limita ≈ 100–200 pedidos/mês (R-37).

## ADR-010 — Chat e Realtime como sinal [PROPOSTA]
**Decisão:** `08` §11. Persistir e autorizar via API; publicar em canal privado apenas `{conversation_id, message_id, type}`; cliente busca a mensagem pela API; fallback por polling.
**Alternativas:** (a) Postgres Changes com RLS enviando a linha: conteúdo trafega por outro caminho de autorização; (b) cliente escreve direto no banco: contorna o domínio; (c) WebSocket próprio no NestJS: custo e escala em hospedagem gratuita que dorme, e duplica o serviço do Supabase.
**Impacto:** uma ida extra à API por mensagem. **Mensagens de sistema (RF-075):** `message.kind='sistema'` criada só pela função de domínio na transação do aceite/retirada, imutável e idempotente por `dedupe_key` (ADR-021); o sinal Realtime é o mesmo. **Riscos:** cota de conexões simultâneas do Realtime gratuito `[NÃO VERIFICADO]`; latência percebida (mitigada por otimismo na UI); mensagens fora de ordem (ordenar por `created_at,id`).

## ADR-011 — Notificações: outbox, digest e e-mail [PROPOSTA; ver ADR-022]
**Decisão:** `08` §12 (todos os e-mails habilitados; cooldown por destinatário/categoria/escopo; flush reavaliado; janelas independentes de 15 min; lembretes com recheque; `email_outbox` com dedupe, recuo e supressão; classes de prioridade e reserva para `auth` sob cota). O canal "no site" (mensagem automática no chat) é sempre imediato e não consome cota.
**Alternativas:** (a) enviar tudo imediatamente: viola o agrupamento e estoura a cota de 100/dia; (b) filas externas: componente novo ⇒ SD; (c) fila no Postgres (escolhida).
**Impacto:** jobs por tick; latência ≥ 1 min nos flushes (login independe do tick). **Riscos:** cota gratuita (100/dia, 3.000/mês; R-34); domínio verificado exigido (R-33); bounces/complaints; conteúdo de lembrete de cobrança `[PENDENTE JURÍDICO]` L2/L3.

## ADR-012 — Admin: app separado, MFA, RBAC, dupla aprovação, auditoria [APROVADO papéis; PROPOSTA mecanismo]
**Decisão:** `08` §13. App e origem separados, convite, TOTP `aal2` obrigatório, RBAC por permissão, `approval_request/vote` com triggers contra autoaprovação, `access_case` com autorização por outra pessoa e log por leitura, `audit_event` append-only na mesma transação com encadeamento por hash.
**Alternativas:** (a) admin como rota do mesmo app web: superfície e cookies compartilhados; (b) projeto Supabase separado para admin: isolamento maior, porém duplica custo/limite gratuito (só 2 projetos `[NÃO VERIFICADO]`); (c) papéis fixos no código sem permissões: rígido.
**Impacto:** mais código de governança. **Riscos:** MFA TOTP do Supabase no plano gratuito `[NÃO VERIFICADO]`; perda de dispositivo MFA (processo de reenrolamento com dupla aprovação); matriz detalhada de telas (RF-146) ainda ausente.

## ADR-013 — Observabilidade sem PII [PROPOSTA; ferramenta SD-06]
**Decisão:** `08` §14: logs por allowlist; IDs pseudônimos; métricas de fila/webhook/e-mail/upload/RLS/cotas; painel interno mínimo.
**Alternativas:** (a) logar tudo e filtrar depois: vazamento garantido; (b) ferramenta paga: fora do orçamento.
**Riscos:** retenção curta nos provedores gratuitos `[NÃO VERIFICADO]` (um incidente pode ficar sem log); ferramentas de erro capturam variáveis locais (scrub obrigatório); fuso e correlação entre api/worker.

## ADR-014 — Abuso e rate limit [PROPOSTA, revisto por H1]
**Decisão:** `08` §15. Em serverless não há memória compartilhada: **todos** os limites (login, publicar, reenviar, visualização de fotos, aceitar/retirar) ficam em Postgres (`rate_counter`, upsert atômico, janelas grosseiras). Desafio anti-bot gratuito condicional (SD-05). Sem *fingerprint* invasivo; IP somente como HMAC. Sinal de abuso específico do aceite: taxa de aceites e de **retiradas** por profissional (R-26).
**Alternativas:** limites em memória por instância (ineficazes em serverless, rejeitada); Redis gerenciado (componente novo ⇒ SD); regras de firewall/WAF da plataforma `[NÃO VERIFICADO]` como reforço.
**Riscos:** custo de I/O no banco gratuito; falso positivo em NAT/IP compartilhado (limites por e-mail e IP combinados).

## ADR-015 — Parâmetros de duplicidade (AMB-01) [DELEGADO A; valores PROPOSTA]
**Decisão:** aviso+confirmação (nunca bloqueio). Critério: mesmo `service_id`, mesmo cliente verificado, distância do ponto exato ≤ **100 m**, e pedido ativo (`publicado|selecionado`) **ou** criado nas últimas **24 h**. Valores em `app_config`. Medição: taxa de avisos e de confirmações para recalibrar.
**Alternativas:** raio maior (500 m): mais falsos positivos em condomínios/prédios vizinhos; apenas endereço textual normalizado: frágil; B (bloqueio): proibido por princípio aprovado.
**Riscos:** erro do geocodificador próximo de 100 m (aceita-se; é só aviso); cliente ainda não autenticado no preenchimento (comparação ocorre após o e-mail verificado, na revisão).

## ADR-016 — Retenção: mecanismo sem prazos [PENDENTE JURÍDICO L1/L2]
**Decisão:** implementar o **mecanismo** (classes RC-01..11, `retention_policy` com período nulo = desligado, `legal_hold`, expurgo idempotente e auditado, `dsr_case`), mas **não definir prazos nem bases legais**. Exclusão de conta é anonimização com preservação de registros exigíveis (auditoria, financeiro, moderação) conforme o que o jurídico definir. Backups: rotação definida pelo jurídico (exclusão do titular × cópias).
**Alternativas:** prazo provisório (AMB-14 B): rejeitado para não afirmar conformidade; sem prazo: contraria doc 06 §7.
**Impacto:** o produto não deve ser lançado com dados reais sem política aprovada (L1/L2). **Riscos:** acumular dados sem política; atraso jurídico bloqueia lançamento. Dados de teste: sintéticos.

## ADR-017 — Monorepo, migrações e acesso a dados [PROPOSTA]
**Decisão:** pnpm + Turborepo com apps e pacotes de `08` §1.4; migrações SQL-first versionadas (Supabase CLI) com *expand/contract*; contratos em `packages/contracts` gerando OpenAPI e tipos; biblioteca de acesso a dados com SQL tipado (construtor de consultas, ex.: Kysely) em vez de ORM pesado, por precisar de `FOR UPDATE`, PostGIS e funções; testes de banco com pgTAP e Postgres efêmero.
**Alternativas:** Prisma/TypeORM/Drizzle: suporte irregular a locks e tipos geográficos, abstração que esconde SQL de segurança; escolha pode ser revista pelo DEV sem alterar a stack (é biblioteca interna do NestJS).
**Riscos:** mais SQL à mão; disciplina de migração; CI gratuito com minutos limitados `[NÃO VERIFICADO]` (testes de banco precisam ser rápidos).

## ADR-018 — Hospedagem na Vercel e execução serverless no plano gratuito [APROVADO Vercel (H1); desenho PROPOSTA; termos e limites NÃO VERIFICADO]
**Contexto:** H1: Next.js e API na Vercel, sem custo. A documentação não foi consultada (Rodada 7, nº 12).
**Decisão:** (1) `apps/web` e `apps/admin` como projetos Vercel separados, em **Hobby para desenvolvimento/testes e Pro ao começar a cobrar** (decisão 28); (2) NestJS como função serverless única (suportada, Fluid compute, bundle ≤ 250 MB) alcançada por rewrite `/api/*` na mesma origem do web; (3) jobs por tick com *lease*, **sem depender do cron da Vercel** (Hobby = 1x/dia): `pg_cron`/`pg_net` (Free: não encontrado, S-02/S-10), plano B chamada externa gratuita, plano C *tick oportunista*, Vercel Cron diário só como *keep-alive*; (4) sem estado em memória; (5) pooler em modo transação (60 diretas/200 pooler), 1 conexão por invocação; (6) upload direto ao Storage; (7) rate limit em Postgres; (8) e-mail de login síncrono, sem depender do tick; (9) healthcheck leve e endpoint de tick protegido.
**Riscos:** (R-28) **VERIFICADO:** o Hobby proíbe uso comercial (inclui processar pagamento): cobrar exige Pro (≈ US$ 20/mês + US$ 20 por seat), gatilho antes da primeira cobrança; (R-29) NestJS em serverless: suporte confirmado, restam cold start, tamanho e cliente Postgres (S-09); (R-30) **VERIFICADO:** cron Hobby 1x/dia ⇒ tick por `pg_cron`/`pg_net` (não encontrado no Free), plano B/C; (R-31) memória/duração do Hobby (2 GB, 300 s) são folgadas para reencode; resta o limite de corpo/resposta `[NÃO VERIFICADO]`; (R-10) cold start com webhook do MP (só grava e responde); limite de projetos Vercel `[NÃO VERIFICADO]`.
**Alternativas (contingência; SD-15 respondida pela decisão 28):** (A) manter NestJS em função única (**adotada**: suporte confirmado; spike S-09 mede cold start); (B) NestJS em host gratuito de processo contínuo e Next.js na Vercel (CORS/cookies entre origens, outros termos e cold start de "dormir"); (C) API em Route Handlers do Next.js + funções SQL (**altera a stack aprovada**); (D) plano pago da Vercel (gatilho, não premissa); (E) mover web e API para a mesma plataforma alternativa se os termos da Vercel proibirem o uso.
**Gatilho:** antes da **primeira cobrança real**, migrar a Vercel para o Pro (decisão 28; 12-TODO #9). Nada é contratado agora.

## ADR-021 — Aceite de trabalho, retirada, 2ª onda e mensagem de sistema [APROVADO H4 e respostas 1–3, 7; mecanismo PROPOSTA]
**Contexto:** H4 extingue a oferta. O profissional clica em "Aceitar trabalho"; o aceite ocupa a vaga, abre o chat, libera o primeiro nome e avisa o cliente por mensagem de sistema. O cliente conversa com quem aceitou e seleciona o que preferir. Preço e contratação são diretos entre as partes.
**Decisão:** tabela única `acceptance` com unique `(request_id, professional_id)`; operação atômica sob `FOR UPDATE` do pedido que cria aceite + conversa + mensagem de sistema + evento (`08` §7.2); `acceptances_count` (vagas consumidas) é o contador do gatilho da 2ª onda (>=4, uma vez, rótulo "Chamar mais profissionais"); retirada antes da seleção mantém a vaga consumida e põe a conversa em somente leitura (`08` §7.3). Idempotência em três camadas: `Idempotency-Key`, unique de domínio e `dedupe_key` da mensagem.
**Alternativas:** (a) manter participação + oferta (extinto por H4); (b) criar a mensagem de sistema por consumidor assíncrono do outbox (rejeitada: janela em que há aceite sem mensagem e risco de duplicata); (c) liberar a vaga na retirada (contradiz AMB-16 A e a resposta 3); (d) contar só aceites ativos para a 2ª onda (descartado, Rodada 8 nº 20); (e) permitir reaceite após retirar (descartado, Rodada 8 nº 19).
**Impacto:** o profissional vê o primeiro nome ao clicar, sem filtro do cliente ⇒ risco de aceite só para colher dados (R-26). **Riscos:** profissional "queima" vagas aceitando e retirando (mitigado: um CPF/CNPJ ⇒ uma vaga por pedido, sinais de abuso, 2ª onda do cliente); cliente confunde aceite com contratação (AMB-28, UI e Termos `[PENDENTE JURÍDICO]`).

## ADR-022 — E-mails habilitados, cota do Resend e provedor atrás de porta [APROVADO Rodada 12 nº 27 e T6; limites VERIFICADOS (doc 13); limiares PROPOSTA]
**Decisão:** **todos os e-mails estão habilitados no código**: aceite, mensagem não lida, lembretes, seleção, cancelamento, desistência, trial/ciclo, verificação e login. Sem interruptor, tabela de flags, tela, ponto de ativação ou "e-mail desativado" (supera a Rodada 9 nº 23 e a resposta 5). **Sem reenvio de aceites antigos.** Envio pelo `EmailProviderPort` com adapter **Resend** (trocável), candidato a SMTP do Supabase Auth. Em desenvolvimento/CI o destino é o **Mailpit local**; envio real depende do **domínio verificado** (decisão 15).
**Cota como restrição de projeto (fatos do doc 13):** 100 e-mails/dia (UTC), 3.000/mês, cada destinatário conta, e-mails de teste consomem cota, 10 req/s. Desenho `[PROPOSTA]`: contador em `external_quota`; alertas 70/85/95% e aviso reforçado em ≥ 90/dia e ≥ 2.700/mês; reserva de 10/dia e 300/mês só para `auth`; agrupamento de 15 min; degradação (digest elástico, lembretes de baixo valor suprimidos, itens `adiado_cota` reavaliados no dia seguinte; **chat/site continuam**; login com prioridade); remetente ≤ 5 envios/s.
**Alternativas:** interruptor por tipo (revisões 2–3, revogado); e-mails desativados por padrão (revisão 3, superada); enviar tudo sem controle (estoura a cota); outro provedor com cota maior (troca via porta, SD-03/upgrade); só o canal no site (perde aviso externo).
**Riscos:** (R-33) sem domínio verificado não há envio real; (R-34) 100/dia limita a escala a poucos pedidos novos/dia com aviso de aceite e de mensagem não lida ligados; reputação de entrega; perda de e-mails de login por cota (mitigada por reserva). **Gatilho:** ≥ 70% da cota em 3 dias seguidos ⇒ decisão do usuário sobre upgrade ou migração.

## ADR-019 — Mobile: riscos antecipados [NÃO VERIFICADO]
**Contexto:** mobile é posterior ao núcleo web [APROVADO] e a restrição de orçamento afeta a publicação em lojas.
**Riscos a verificar nas fontes oficiais antes de planejar mobile (S-07):**
1. Taxas de conta de desenvolvedor (Apple anual; Google única) são pagas ⇒ exigem decisão do usuário (SD-13).
2. **Assinatura do profissional vendida fora das lojas:** lojas podem exigir compra dentro do app (IAP) para desbloquear funcionalidades digitais de assinatura; isso conflita com o Mercado Pago como gateway e com o preço único. Exceções/“link externo” variam por região e política `[NÃO VERIFICADO]`. Possível mitigação: app mobile do profissional sem compra (assinatura apenas pela web), sujeito a regras de direcionamento.
3. Exclusão de conta dentro do app, login social (ADR-006), notificações push (não aprovadas), permissão de câmera/fotos, deep links (universal links/app links) para o link mágico e o POST de confirmação.
4. Expo/EAS tem cotas gratuitas de build `[NÃO VERIFICADO]`.
**Decisão:** nenhuma; apenas registrar que o desenho web (API, contratos, tokens) é reutilizável e que a fase mobile exige nova rodada de decisão.

## ADR-020 — Dimensionamento ao plano gratuito: limites, riscos e gatilhos [APROVADO a restrição; valores NÃO VERIFICADO]
**Contexto:** não há orçamento. Todos os valores abaixo vêm de memória do Architect (sem consulta a fonte oficial nesta sessão) e **podem estar desatualizados**; devem ser verificados na página oficial de cada serviço antes de qualquer decisão (S-08). "Gatilho" = condição para o usuário decidir upgrade ou migração; **nenhum plano pago é premissa**.

### 20.1 Tabela por serviço
| Serviço | Limite gratuito conhecido `[NÃO VERIFICADO]` | Risco do limite | Mitigação no desenho | Gatilho de upgrade/migração |
|---|---|---|---|---|
| **Supabase Postgres (Free)** | **VERIFICADO:** banco 500 MB; 60 conexões diretas e 200 no pooler; 2 projetos ativos | encher o banco; conexões esgotadas por invocações serverless | expurgos operacionais (09 §10); índices enxutos; 1 conexão por invocação | >70% do espaço; esgotamento do pooler |
| **Supabase projeto inativo** | **VERIFICADO:** pausa após 1 semana de inatividade | indisponibilidade; produção pausada | *keep-alive* diário (cron diário da Vercel basta); tráfego | **antes de cobrança real ou dados reais**: reavaliar (Pro a partir de US$ 25/mês) |
| **Supabase backups** | **VERIFICADO:** sem backup no Free; backup diário só no Pro; recomendado `supabase db dump` | perda irrecuperável | backup manual periódico (12-TODO #1) + teste de restauração (`11` §9) | **antes de dados reais ou pagamentos** |
| **Supabase Storage** | **VERIFICADO:** 1 GB; upload máx. 50 MB | 5 fotos × ≈ 0,5 MB ≈ 2,5 MB/pedido ⇒ ≈ 280 pedidos em ≈ 700 MB; documentos de verificação consomem o resto (chat sem anexos) | redução no envio (decisão 31), só versão reduzida, cotas, expurgo de órfãos, painel 70/85/95% | >70% ⇒ revisar; >85% ⇒ upgrade (12-TODO #10) |
| **Supabase egress** | **VERIFICADO:** 5 GB/mês | fotos servidas a muitos profissionais: ≈ 25–50 MB/pedido (hipótese) ⇒ ≈ 100–200 pedidos/mês: **limite mais apertado** | prévias ≈ 320 px na listagem, foto inteira só ao abrir, rate limit por profissional, `no-store` só onde necessário | >70% do mês |
| **Supabase Auth** | ordem de dezenas de milhares de MAU; **e-mail padrão com limite muito baixo, exige SMTP próprio** | e-mail do Auth indisponível; MAU de clientes cresce | Resend como SMTP customizado (T6) ou envio direto pelo `EmailProviderPort`; contagem de MAU | >70% de MAU |
| **Supabase Realtime** | **VERIFICADO:** 200 conexões simultâneas; 2 milhões de mensagens/mês | perda de tempo real | sinal mínimo; *polling* de contingência | conexões >70% |
| **Supabase extensões/jobs** | **PostGIS, `pg_cron`, `pg_net` no Free: NÃO ENCONTRADO na documentação** | tick e geo dependem delas | spike S-02/S-10; plano B tick externo gratuito; plano C tick oportunista; geo sem PostGIS (índice por célula) | indisponibilidade confirmada |
| **Mapbox** | **VERIFICADO:** geocodificação temporária 100.000 req/mês grátis (cada tecla conta; não armazenar); **permanente: US$ 5/1.000, sem faixa gratuita, cartão obrigatório**; mapas 50.000 *loads*/mês grátis; termos de produto (PDF) não lidos | custo variável desde o 1º pedido; cartão; estourar a cota temporária | decisão 29: temporário só para sugestão; **1 chamada permanente por rascunho revisto**; limite de gasto na conta; contador e breaker | cota temporária >70%; gasto permanente >70% do limite |
| **Mercado Pago** | **Tarifas Pix/cartão e mensalidade: não obtidas (403)**; assinatura recorrente por API; Pix Automático não encontrado | margem desconhecida; Pix manual por ciclo | porta de gateway; reconciliação; Pix avulso (12-TODO #12) | tarifa efetiva acima da margem aceita |
| **Vercel (Next.js e API NestJS)** | **VERIFICADO:** Hobby = só uso pessoal não comercial; funções 300 s, 2 GB/1 vCPU; 1 mi invocações; 100 GB banda; **cron 1x/dia**; Pro ≈ US$ 20/mês + US$ 20/seat, cron 1x/min; NestJS suportado | cobrar no Hobby viola os termos; cron diário não serve de tick | desenvolver no Hobby, **Pro ao cobrar** (decisão 28); tick via `pg_cron`/`pg_net`, plano B/C; upload direto ao Storage | **antes da primeira cobrança real** |
| **Armazenamento de backup manual (H3)** | destino gratuito para exports criptografados | perda se o export atrasar; chave perdida | rotina documentada, teste de restauração (D-01), 2 cópias | export com mais idade que a periodicidade acordada (`12-TODO.md`) |
| **E-mail transacional (Resend, T6)** | **VERIFICADO (doc 13):** 100 e-mails/dia (UTC), 3.000/mês, cada destinatário conta, testes consomem cota, 10 req/s; **domínio verificado exigido para enviar** | cota esgotada ⇒ avisos atrasam e, sem reserva, o login pode falhar; sem domínio não há envio real | todos os e-mails habilitados + contador, alertas, reserva para `auth`, agrupamento de 15 min, degradação; Mailpit em dev | ≥ 70% da cota em 3 dias seguidos; **domínio ausente antes de usuários reais (decisão 15)** |
| **Domínio próprio** | domínio tem custo; ainda não existe (H2) | SPF/DKIM/DMARC e verificação no Resend impossíveis sem domínio | desenvolvimento com e-mail local; SD-03 | antes de qualquer envio real a terceiros |
| **Fila/cache** | sem componente adicional (Postgres) | polling e `SKIP LOCKED` são suficientes só no volume inicial | `FOR UPDATE SKIP LOCKED`, índices parciais | latência de fila >1 min sustentada ⇒ SD (Redis/broker) |
| **Observabilidade** | ferramentas gratuitas têm retenção curta e cota de eventos | incidentes sem rastro | logs estruturados, painel interno, retenção curta consciente | cota de eventos >70% |
| **CI** | minutos gratuitos limitados em repositórios privados | CI bloqueado | cache Turborepo; testes de banco rápidos | >70% dos minutos |
| **Varredura de malware** | sem opção residente/gratuita compatível | risco residual limitado a documentos de verificação (chat sem anexos) | reencode das fotos; documentos em bucket privado, só da Verificação | primeiro incidente ⇒ SD-12 |
| **Anti-bot/CAPTCHA** | opções gratuitas existem `[NÃO VERIFICADO]` | spam de pedidos | rate limit/honeypot primeiro; desafio condicional (SD-05) | taxa de spam acima do limite |

### 20.2 Modelo de consumo de e-mail (hipótese, não medição)
Por pedido: cliente ≈ `1 (login) + 1 + ceil(demais aceites / agrupamento) (aceite) + digests de mensagem não lida + 1 lembrete T-24h + 1 aviso de vencimento + seleção/cancelamento`; profissional: lembretes de trial/ciclo, decisão de verificação, mensagens não lidas. Com até 8 aceites e conversas ativas, **dezenas por pedido no pior caso**; com **100/dia e cada destinatário contando**, poucos pedidos novos por dia esgotam a cota. O agrupamento de 15 min reduz muito o custo de aceites e mensagens. Medir pelo contador `external_quota` e fixar um **teto de e-mails por pedido** se o uso passar de 70%.

### 20.3 Decisões decorrentes
1. Qualquer gatilho atingido gera **solicitação de decisão ao usuário**; não há contratação automática.
2. **Gatilho obrigatório antes de cobrança real:** (a) backup e recuperação adequados, (b) hospedagem sem restrição de uso comercial, (c) remoção de pausa por inatividade, (d) política jurídica L1–L4/L7. Registrado como SD-04. (H3: o usuário aceita o risco de pausa/backup do Supabase gratuito até o início, com *keep-alive* e backup manual; reavaliar antes de cobrar valores reais.)
3. Desenvolvimento e testes: tudo local (Supabase CLI/Docker) e dados sintéticos; recursos externos só quando autorizados.

---

## Solicitações de decisão (SD)
Nenhuma SD aberta está em vigor sem decisão do usuário. Em 2026-11-10, SD-01, SD-02 e SD-15 estão respondidas.

### Respondidas, extintas ou adiadas
| ID | Situação | Resposta |
|---|---|---|
| **SD-01** | RESPONDIDA (H1; reconfirmada na decisão 28) | Hospedagem na **Vercel**: Hobby em desenvolvimento, **Pro ao cobrar**. |
| **SD-03** | **ENCAMINHADA (decisão 15, Rodada 12)** | Provedor = Resend (T6). **Domínio verificado é exigido para enviar** (doc 13) e é tratado pela decisão 15. Até lá: Mailpit local; nenhum envio real; lançamento real bloqueado até o domínio estar verificado. |
| **SD-04** | ATUALIZADA (H3) | Supabase gratuito mantido; reavaliar antes de cobrar valores reais ou dados reais. |
| **SD-07** | EXTINTA (H4) | Aceite atômico (ADR-021). |
| **SD-08** | EXTINTA (H4) | Sem oferta nem edição. |
| **SD-10** | RESPONDIDA (H5) | Sem boleto; carência 72 h vale para Pix. |
| **SD-15** | **RESPONDIDA (decisão 28)** | Termos verificados: o Hobby proíbe uso comercial; **migrar para o Pro ao começar a cobrar** (≈ US$ 20/mês + US$ 20/seat; 12-TODO #9). NestJS é suportado como função única; cold start segue no spike S-09. |
| **SD-02** | **RESPONDIDA (decisão 29)** | Mapbox mantido. Autocomplete e mapas no gratuito (temporário, nunca armazenado); coordenadas só via geocodificação **permanente** (US$ 5/1.000, cartão, limite de gasto na conta), **uma chamada no servidor**. Sem troca de geocodificador. |
| **SD-16** | **RESPONDIDA (Rodada 8 nº 17)** | Pagamento na carência: o novo período começa no fim do anterior (`period_end` anterior). |
| **SD-17** | **ADIADA (Rodada 8 nº 18)** | Backup manual (periodicidade, responsável, destino) vai para `12-TODO.md`; exigível antes de dados reais. |
| **SD-18** | **RESPONDIDA (Rodada 8 nº 19)** | Sem novo aceite após retirada; mantém só o histórico somente leitura. |
| **SD-19** | **RESPONDIDA** | AMB-27: "4 aceites" = vagas consumidas (Rodada 8 nº 20). AMB-26: o cliente vê os aceites abrindo o site (Rodada 7 nº 10). AMB-25: sem interruptor; **todos os e-mails habilitados no código** (Rodada 12 nº 27) e **sem reenvio de antigos**. |
| **SD-20** | **RESPONDIDA (Rodada 9 nº 22)** | O aviso "o FastPro apenas conecta, não é contrato" fica **só nos termos de uso**. Texto jurídico segue `[PENDENTE JURÍDICO]` L2/L7. |

### Abertas
| ID | Pergunta | Opções | Recomendação | Bloqueia |
|---|---|---|---|---|
| **SD-05** | Anti-bot/CAPTCHA gratuito condicional | (a) rate limit + honeypot; (b) desafio gratuito | (a) | Abuso |
| **SD-06** | Observabilidade com ferramentas gratuitas | (a) logs da plataforma + painel interno; (b) + erros com scrub de PII | (a) | Operação |
| **SD-09** | Estados de origem permitidos para republicar | (a) expirado/cancelado; (b) + concluído; (c) + selecionado desistente | (a) + (c) | Republicação |
| **SD-11** | Região dos dados, chaves/segredos e suboperadores (Supabase, Vercel, Resend, Mapbox, MP) | depende do jurídico (L2) | Levar ao jurídico | Lançamento |
| **SD-12** | **REDUZIDA (decisão 33):** sem anexos no chat, só restam os documentos de verificação enviados por profissionais; AMB-32 superada | (a) sem varredura no MVP, visão só da Verificação; (b) terceiro (viola minimização); (c) motor próprio depois | (a) | Verificação de documentos |
| **SD-13** | Fase mobile: contas de loja pagas | (a) adiar; (b) mobile só cliente; (c) decidir após verificar | (a) | Mobile |
| **SD-14** | Autorização para criar contas/projetos reais e chaves (nomes de variáveis apenas; sem valores em documentos) | no início da execução (Gate 2) | Solicitar no Gate 2 | Execução |

### Mudanças de requisito sugeridas
O PRD (RF-122) falava em flag administrável e auditada, e a Rodada 9 a trocou por código desativado; a **Rodada 12 nº 27** habilita todos os e-mails no código. O PO deve alinhar RF-122, RF-116, RF-154 e FA-029/FA-031: sem flag; e-mails ativos; limite de cota e degradação como requisito não funcional.
