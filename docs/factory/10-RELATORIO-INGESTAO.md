# FastPro — Relatório de ingestão (Gate 0, somente leitura)

- **Data:** 2026-11-09 · **Produto:** fastpro · **Executor:** Orquestrador (análise própria; nenhum especialista foi delegado nesta rodada)
- **Natureza:** PROPOSTA para decisão. Nada foi implementado nem alterado em GitHub/serviços externos.
- **Etiquetas:** `[APROVADO]` decisão do usuário no pacote · `[DELEGADO]` adotado por delegação · `[PROPOSTA]` sugestão deste relatório · `[NÃO VERIFICADO]` · `[PENDENTE JURÍDICO]`

---

## A. Checklist de recebimento

**Pacote:** `D:\Downloads\fastpro_pacote_para_orquestrador_2026-11-08.zip`
SHA256 do ZIP: `7ADE1DC0E16A7F7B9706B8B12B612CAE0308D7CB54369FE2648451356DA4C5EB`
Versão declarada: 0.1 (consolidação conversacional, 2026-11-08). Todos os 14 arquivos conferem com `SHA256SUMS.txt` (14/14 OK).

| Arquivo | SHA256 (12 iniciais) | Lido |
|---|---|---|
| 00_LEIA_PRIMEIRO.md | 06456cf0b1ad | sim |
| 01_PROMPT_PARA_ORQUESTRADOR.md/.txt (idênticos) | 02cbf097aabd | sim (conteúdo = sua mensagem; os 2 arquivos têm o mesmo hash, o conteúdo foi lido via mensagem) |
| 02_MANIFESTO_E_FONTES.md | 99710f15f19d | sim |
| 03_PRODUTO_ESCOPO_E_NEGOCIO.md | f4bfd944644d | sim |
| 04_DESIGN_SYSTEM_EDS.md | 1b866b262ef6 | sim |
| 05_PEDIDOS_OFERTAS_E_CICLO_DE_VIDA.md | 88838bead090 | sim |
| 06_IDENTIDADE_CHAT_PRIVACIDADE_AVALIACOES.md | a77a0678c2a1 | sim |
| 07_ARQUITETURA_BASE_E_INTEGRACOES.md | 3129f4dc7d0c | sim |
| 08_CONTRATO_DOS_AGENTES_E_GATES.md | c8acbf57f672 | sim |
| 09_CRITERIOS_FUNCIONAIS_INICIAIS.md | 16c621bd9851 | sim |
| 10_RASTREABILIDADE_E_PENDENCIAS.md | 0fb7ba75de06 | sim |
| 11_PLANO_DE_INGESTAO.md | 1e3b8c3b2549 | sim |
| manifest.json | 4d1c93ba66b4 | **não lido** (só conferido o hash; metadados) |

**Fontes oficiais que faltam (nenhuma foi recebida):**
1. PRD/escopo mestre versionado do FastPro.
2. EDS/Design System mestre versionado (o 04 é síntese).
3. Texto individual de RN-001 a RN-408.
4. Redação individual de RN-641 a RN-675 (35 regras; nunca existiu em texto individual).
5. Nomes oficiais dos 10 grupos de categorias do catálogo.
6. Registro de decisões original / telas e permissões detalhadas.
7. Repositório GitHub do produto (owner, nome, visibilidade) — não informado.

Não existe nenhum documento oficial no diretório do produto (`D:\projetos\fastpro` continha apenas o que a fábrica criou hoje).

---

## B. Mapa de rastreabilidade (documento ↔ regras ↔ módulos ↔ agente)

| Doc | Faixa RN | Módulos | Agente principal | Grau de prova |
|---|---|---|---|---|
| 03 Produto/negócio | RN-001–239, 295–339 (parte) | Assinaturas, Cadastro, Catálogo, Pedido, Admin | Strategist / PO | Resumo; preços e prazos citados `[APROVADO]`; limites `[DELEGADO]` |
| 04 EDS | RN-240–294, 340–408 | Design system, tokens, a11y | Strategist (design) / Reviewer | Resumo com valores numéricos `[APROVADO]` |
| 05 Ciclo de vida | RN-521–640 | Pedido, Seleção, Conclusão, Republicação | PO / Architect / QA | Aprovado explicitamente, texto sintetizado |
| 06 Chat/privacidade | RN-409–520, 571–588 | Fotos, Chat, Notificações, Reputação, LGPD | PO / Architect / Reviewer | Aprovado explicitamente, sintetizado |
| 07 Arquitetura | (transversal) | Stack e 12 responsabilidades técnicas | Software Architect | Stack `[APROVADO]`; detalhes são lista de tarefas |
| 08 Contrato/gates | — | Governança | Orquestrador | Regras operacionais |
| 09 Critérios FA-001..035 | cruza as faixas | todos | PO → QA/Reviewer | Resultado esperado, sem Given/When/Then |
| 10 Rastreabilidade | RN-001–675 | — | Orquestrador | Índice por faixa, **não** texto |

**Comprovado textualmente neste pacote:** preços/planos, trial 14 d, carência 72 h, 7 dias, 4+4, tokens/cores/Roboto/raios, limites de fotos/anexos, matriz de transições, visibilidade por papel, FA-001..035.
**Resumo ou premissa:** tudo que é atribuído a RN individual (nenhuma RN tem texto individual aqui); faixa RN-641–675; limites `[DELEGADO]` (link 15 min, sessão 7 d, raio 5–100 km, agrupamento 15 min).

---

## C. Conflitos, dúvidas e riscos

### Bloqueante para planejar
Nenhum. A análise e o planejamento podem seguir com o que existe.

### Bloqueante para desenvolver
| # | Item | Detalhe | Decisão necessária |
|---|---|---|---|
| D1 | Falta das RN-001–408 e dos documentos mestres | Histórias que dependem de regra ausente não podem ser escritas (ex.: telas, permissões por papel admin, metas de triagem). | Enviar os originais, ou autorizar o PO a **propor** texto marcado como proposta. |
| D2 | Catálogo: 10 grupos sem nome | Não dá para popular o catálogo/busca nem definir certificações de profissões regulamentadas. | Informar os 10 grupos e serviços. |
| D3 | Gatilho de "Receber mais ofertas" ambíguo | Doc 03 §6: "após **4 ofertas**"; doc 05: "primeira **onda** completa" (4 participações). Se 4 profissionais participam mas só 2 ofertam, o cliente pode liberar a 2ª onda? Também não está dito se isso é possível após os 7 dias. | Decidir regra exata. `[PROPOSTA]`: liberar quando 4 ofertas existirem **e** o pedido estiver aberto. |
| D4 | Autoria da avaliação: "automática" × "sem avaliação automática" | Doc 03 §7 e 06: publicação automática após verificações/moderação. Doc 03 §10: "sem ... avaliação automática". | Confirmar: publica automático após antifraude/moderação, ou há moderação humana? |
| D5 | Aprovação (4 planos "benefícios idênticos") e "sem desconto de lançamento" | Os preços implicam desconto por período (R$ 29,90 / 26,90 / 24,90 / 19,90 por mês). Não é conflito, mas "benefícios idênticos nos 4 planos" soa como lista, sem diferenciais. Confirmar que só muda o ciclo de cobrança. | Confirmar. |
| D6 | Mesmo serviço × serviço distinto | Critério para bloquear republicações duplicadas e múltiplos pedidos. | PO propõe heurística; usuário decide se afeta direito de publicar. |
| D7 | Cadeia "ativa" em casos extremos | Suspensão, contestação e correção retroativa. | Decisão do usuário após proposta do PO. |
| D8 | Link mágico 15 min uso único × leitores de e-mail | Scanners de segurança e pré-visualização de e-mail costumam abrir o link e consumi-lo, causando "link expirado" para o cliente. | `[PROPOSTA]` confirmação por botão na página (não por GET) ou código de 6 dígitos como alternativa. Mudar o mecanismo exige decisão. |
| D9 | Login Google/Apple "quando suportadas" | Se Google for oferecido no iOS, as regras da App Store podem exigir "Entrar com Apple". `[NÃO VERIFICADO]` | Architect confirmar contra as regras vigentes das lojas. |
| D10 | Fotos visíveis a elegíveis **sem** vaga | Qualquer profissional elegível (inclusive em trial gratuito de 14 d) vê as fotos antes de participar; pode raspar fotos de casas dos clientes, sem custo. | Decisão de produto: manter, ou limitar (ex.: só depois de ocupar vaga, versão reduzida/borrada, rate limit). Hoje é `[APROVADO]`, então só alterar com sua decisão. |

### Bloqueante para lançar
| # | Item | Estado |
|---|---|---|
| L1 | Retenção e base legal por classe de dado (documentos de identidade, chats, avaliações, logs) | `[PENDENTE JURÍDICO]` |
| L2 | Termos de uso, política de privacidade, consentimentos, DPO/encarregado | `[PENDENTE JURÍDICO]` |
| L3 | Reembolso/arrependimento (CDC art. 49), retenção de 50% proposta | `[PENDENTE JURÍDICO]`, não automatizar |
| L4 | Verificação de certificações de atividades regulamentadas | `[PENDENTE JURÍDICO]` |
| L5 | Evidência de WCAG 2.2 AA, testes de concorrência/segurança/RLS, backup/recuperação, observabilidade | Sem evidência (ainda não há produto) |
| L6 | Aprovação de lojas (Apple/Google), contas de desenvolvedor | Não iniciado |
| L7 | Responsabilidade da plataforma por "verificado" e por conteúdo trocado em chat/WhatsApp externo | `[PENDENTE JURÍDICO]` |

### Não bloqueante / observações
- Reembolso `<= R$200` por 1 Financeiro e `> R$200` por 2: depende da política de reembolso (L3) para ter significado.
- Raio 5–100 km `[DELEGADO]`: revisar com dados reais de uso; online é nacional.
- Preço único nacional sem teste A/B: ok.
- Referência visual externa (uupm.cc): só inspiração; não copiar.
- Pacote 01 duplicado em .md/.txt: sem problema.
- **Fábrica:** o prompt pede coordenar "TODOS os oito agentes" e o doc 11 admite análises em paralelo "se permitido". O `AGENTS.md` da fábrica impõe **um especialista ativo por vez, sem paralelismo, e só os workflows necessários**. Prevalece a regra da fábrica: tudo abaixo é **sequencial**.
- **Ferramentas:** o MCP do GitHub falhou na conexão nesta sessão; nenhum registro/Issue/Project foi tocado. Para o Gate 2 será preciso reconectar e informar owner, nome e visibilidade do repositório.
- Ao ler os preços: 29,90 / 80,70 (3×26,90) / 149,40 (6×24,90) / 238,80 (12×19,90) — aritmética conferida.

### Riscos principais (técnicos e de negócio)
1. **Dois sistemas de autorização** (RLS do Supabase + NestJS): risco de divergência e de caminho alternativo que vaza foto/chat. Escolher fonte de verdade.
2. **Concorrência** nas 8 vagas (4+4), seleção única, publicação/republicação/conclusão idempotentes e atomicidade cancelar-republicação + selecionar-original.
3. **Mercado Pago:** assinatura recorrente no cartão, Pix/boleto manual, trial sem meio de pagamento, carência de 72 h, webhooks e reconciliação. Capacidades exatas `[NÃO VERIFICADO]` (conferir na documentação vigente na etapa de arquitetura).
4. **Mapbox:** custo por autocomplete/geocoding em escala nacional, termos de armazenamento de resultados de geocoding, privacidade de endereço (localização generalizada).
5. **Cliente sem conta:** abuso/spam de pedidos, enumeração de e-mail, sessão de 7 dias em dispositivo compartilhado, associação cliente↔profissional na mesma pessoa.
6. **Cold start de marketplace** (profissionais pagam antes de haver demanda) e churn: risco de negócio para o Strategist avaliar sem alterar o modelo aprovado.
7. **Desvio de conversa** para WhatsApp (plataforma não intermedeia pagamento, então a retenção depende do valor do acesso).
8. **LGPD:** documentos de identidade, fotos de residências, geolocalização, mensagens; moderação x privacidade.

---

## D. Plano de trabalho dos agentes (sequencial, um ativo por vez)

Tudo abaixo é **proposta**; nada foi executado. Cada passo gera artefatos só em `D:\projetos\fastpro\docs\factory\`.

| Ordem | Agente | Entradas | Saídas (planejamento) | Depende de |
|---|---|---|---|---|
| 1 | Orquestrador | Este pacote | Este relatório + registro de decisões pendentes | — |
| 2 | Product Strategist | 02, 03, 10 | `01-VISAO`, `02-ESCOPO-MVP`, `03-JORNADAS`; parecer de riscos de negócio, recorte de lançamento | Decisão sobre D1/D2 |
| 3 | Product Owner | 03, 05, 06, 09 | PRD refinado, critérios FA-001..035 em Given/When/Then, lista de ambiguidades (D3–D7) | 2 |
| 4 | Software Architect | 05, 06, 07, PRD | Arquitetura, modelo lógico/estados, matriz de dados sensíveis, contratos, ADRs (fonte de verdade da autorização, idempotência, Mercado Pago, Mapbox) | 3 |
| 5 | Backlog Architect | PRD + arquitetura | Épicos/histórias/dependências com FA → RN → história → teste; **sem criar Issues** | 3, 4 |
| 6 | Reviewer | EDS, arquitetura, RN | Checklist de revisão (tokens de cor, Roboto, vazamento de foto/endereço/chat, bypass das vagas) | 4 |
| 7 | QA | FA, estados, backlog | Matriz de testes: positivos, negativos, concorrência, autorização, a11y, rede | 3, 4, 5 |
| 8 | DEV | Backlog + arquitetura | Somente plano técnico/estimativa/riscos (sem código) | 4, 5 |

Paralelismo: **nenhum** sob a regra da fábrica. Ordem 6 e 7 são independentes entre si e poderiam rodar juntas em outra política, mas aqui ficam em série.
Nota sobre o ciclo da fábrica: este plano ocupa as fases `conception → specification → design → architecture` do `lifecycle/STAGES.md`; o pacote serve de insumo e não encerra nenhuma fase.

---

## E. Arquitetura e backlog propostos (para revisão)

**Stack `[APROVADO]`:** Next.js (web), React Native + Expo (mobile), NestJS (backend), Supabase (Postgres/Auth/Storage/Realtime), Mapbox, Mercado Pago, pnpm + Turborepo, Admin web separado. Sem substituição proposta.

**Módulos (proposta):** Identidade (cliente magic link / profissional), Catálogo, Pedidos e ciclo de vida, Distribuição (8 vagas 4+4), Ofertas, Seleção/Conclusão/Republicação, Chat e Anexos, Fotos, Avaliações, Assinaturas/Billing, Notificações, Geo, Admin (RBAC/MFA/auditoria), Observabilidade.

**Pontos de atenção da stack (para ADR, não decisões):**
- Preferir **domínio e transições no NestJS** com RLS como defesa em profundidade; documentar quem é a fonte de verdade.
- Estados ortogonais do doc 05 como máquinas separadas; transações com chave de idempotência.
- Matching por raio: PostGIS (distância esférica) com índice espacial; ver custo e precisão.
- Fotos/anexos: bucket privado, URL assinada de vida curta, remoção de EXIF, conversão HEIC, antivírus/inspeção.
- Notificações: fila com cancelamento de resumo quando lido.

**Épicos propostos (backlog não materializado):**
E0 Fundação (monorepo, tokens/EDS, CI) · E1 Identidade e sessão · E2 Catálogo e Geo · E3 Pedido (criação, fotos, publicação) · E4 Verificação de profissionais · E5 Assinaturas e trial · E6 Distribuição e ofertas · E7 Chat e anexos · E8 Seleção, conclusão, cancelamento · E9 Republicação · E10 Avaliações · E11 Notificações · E12 Admin/RBAC/auditoria/financeiro · E13 LGPD, retenção e observabilidade · E14 Mobile · E15 Hardening e release.
Sequência sugerida (web primeiro): E0 → E1 → E2 → E3 → E4 → E5 → E6 → E7 → E8 → E9 → E10 → E11 → E12 → E13; E14 após estabilização do núcleo web.

**Riscos específicos pedidos:**
- *Jurídico/LGPD:* L1–L4, L7; dados de identidade e geolocalização exigem base legal e DPIA/RIPD. Nenhuma conformidade é afirmada.
- *Mercado Pago:* webhooks assinados, reprocessamento, estados de assinatura, falha de renovação (72 h), conversão do trial sem cobrança automática, chargeback.
- *Mapbox:* custo, termos de uso/armazenamento, chave restrita por domínio/app, endereço preciso nunca público.
- *Identidade:* D8, enumeração de e-mail, sessão de 7 dias, vínculo cliente↔profissional.

---

## F. Critérios funcionais e estratégia de QA (propostos)

- Cada FA-001..035 vira cenários Given/When/Then pelo PO, com rastreio FA → RN (quando houver RN textual) → história → teste.
- **Negativos mínimos** do doc 05 §8 (seleção por não participante, oferta após 7 d/seleção/cancelamento, URL de foto vazada, ID previsível de chat, duas republicações simultâneas, falha parcial no cancelar+selecionar, dupla conclusão/avaliação).
- **Concorrência:** 8 vagas com N profissionais simultâneos; clique duplo em "Receber mais ofertas"; reenvio de mensagem; webhook duplicado.
- **Autorização por papel** conforme a tabela de visibilidade do doc 05 §6, testada por chamada direta de API (FA-004, FA-008, FA-009, FA-031).
- **EDS/Reviewer:** varredura automática de hex em componentes, fonte Roboto 400/500/700, claro/escuro, breakpoints, modal vs bottom sheet.
- **A11y:** teclado, leitor de tela, contraste efetivo dos tokens; WCAG 2.2 AA só se declara com evidência.
- **Segurança/privacidade:** vazamento de PII em logs, RLS, upload malicioso, brute force no link mágico.
- **Dados de teste:** apenas sintéticos.
- Lacuna: nenhum teste pode ser dado como executado; só o plano está proposto.

---

## G. Primeiro gate de aprovação — o que preciso que você decida

Nada será alterado fora de `D:\projetos\fastpro\docs\factory\` sem seu comando. Peço, nesta ordem:

1. **Autorizar o Gate 1 (planejamento, sequencial, só documentos locais):** Strategist → PO → Architect → Backlog → Reviewer → QA → DEV(plano). Sem Issues, sem GitHub, sem código, sem credenciais, sem criar projetos em Supabase/Vercel/Firebase.
2. **Fontes faltantes (D1/D2):** enviar PRD/EDS/RN originais e os nomes dos 10 grupos de categorias — ou autorizar o PO a **propor** o texto, marcado como proposta, para você validar.
3. **Decisões curtas que destravam a especificação:** D3 (gatilho de "Receber mais ofertas"), D4 (avaliação automática × moderação), D5 (confirmar que os 4 planos só mudam o ciclo), D8 (link mágico vs scanners de e-mail), D10 (fotos para elegíveis sem vaga).
4. **Quando chegar ao Gate 2 (não agora):** owner, nome e visibilidade do repositório GitHub, e a reconexão do MCP do GitHub.
5. **Jurídico (L1–L4, L7):** indicar se haverá assessoria; sem isso, nenhuma cobrança real ou lançamento.

Estado da fábrica: `conception = NEEDS_INPUT`. Nenhuma fase marcada como `DONE`. `CONCLUIR`/`BLOQUEAR` não foram atribuídos.
