# H-025 — Refino: rascunho de pedido sem conta

- **Issue:** #38 "[E3] Rascunho de pedido sem conta" · **Backlog:** H-025
- **Etapa:** specification · **Data:** 2026-11-11 · **Papel:** Product Owner · **Status:** refino para validação do líder
- **Etiquetas:** `[DECIDIDO]` aprovado nos documentos (PRD, decisões, critérios) · `[VERIFICADO]` conferido em documento de arquitetura, QA ou backlog, sem decisão de produto · `[PROPOSTA]` sugestão do PO, a validar · `[NÃO VERIFICADO]` sem fonte ou depende de decisão em aberto
- **Fontes lidas:** 14-BACKLOG (H-025 e dependentes H-013, H-026, H-030, H-033); 04-PRD (RF-002, RF-010 a RF-012, RF-019, RF-021); 05-CRITERIOS-ACEITE (FA-001, FA-002); 03-JORNADAS (J1.2 a J1.4); 11-DECISOES (decisões 30 a 33, D8); 11-ARQ-RISCOS-E-TESTES (§2.2, R-15, T-01, T-02, F-05, G-01, G-06); 09-MODELO-DADOS (`request_draft`, RC-09).

## 1. Objetivo
Permitir que o visitante sem conta monte o pedido (serviço, local em texto, urgência e descrição) e fique com um rascunho guardado, sem informar senha e sem dado pessoal, até o passo de identificação. `[DECIDIDO]` RF-012 e FA-001.

Esta história entrega só o rascunho e seu vínculo com o navegador (nonce). Não publica, não envia e-mail, não recebe fotos e não geocodifica coordenadas.

## 2. O que o cliente faz sem conta

| Passo | O que acontece | Dado pessoal? | Origem |
|---|---|---|---|
| 1. Serviço | Busca no catálogo (autocomplete) e escolhe o serviço | Não | `[DECIDIDO]` RF-002, FA-001 |
| 2. Local | Digita o endereço e escolhe uma sugestão; o rascunho guarda só o texto | Não identifica o cliente | `[VERIFICADO]` G-01, 08 §5 (sugestões não são gravadas) |
| 3. Urgência | Escolhe uma de 4 opções | Não | `[DECIDIDO]` RF-011 |
| 4. Descrição | Texto livre | Não identifica o cliente | `[DECIDIDO]` RF-010 |
| 5. Salvar | Cria ou atualiza o rascunho com o nonce do navegador | Não | `[VERIFICADO]` 11-ARQ §2.2: POST/PATCH `/drafts`, visitante (nonce), idempotente |

- **Nenhum dado pessoal é exigido antes da identificação.** Primeiro nome e e-mail são pedidos no passo de identificação, não no preenchimento. `[DECIDIDO]` RF-012 e FA-002.
- Fotos: fora desta história (H-026). Telefone: fora (ver D-H025-4).
- Como e quando o rascunho é salvo (a cada campo ou por ação) não está definido. `[NÃO VERIFICADO]` ver D-H025-3.

## 3. Estados do rascunho

Estados previstos no modelo de dados: `aberto`, `aguardando_email`, `descartado`, `publicado`. `[VERIFICADO]` 09 (`request_draft`).

| De | Para | Gatilho | Marcação |
|---|---|---|---|
| (criação) | `aberto` | Primeiro salvamento com o nonce do navegador | `[PROPOSTA]` |
| `aberto` | `aguardando_email` | Cliente informa nome e e-mail e pede o link | `[PROPOSTA]` (fluxo `[VERIFICADO]` 08 §5.1) |
| `aguardando_email` | `aberto` | Link ou código confirmado no mesmo navegador | `[VERIFICADO]` T-01, R-15 |
| `aberto` ou `aguardando_email` | `descartado` | Prazo do rascunho vence | `[PROPOSTA]`; prazo `[NÃO VERIFICADO]` (D-H025-1) |
| `aberto` | `publicado` | Só após revisão e confirmação expressa | `[DECIDIDO]` FA-002; fora de H-025 (H-030, H-031) |

- `descartado` é terminal e o rascunho deixa de aparecer ao cliente.
- Confirmar o e-mail em outro navegador **não** anexa o rascunho. `[VERIFICADO]` T-01.
- A situação "aguardando geocodificação" aparece em F-05 e G-06, mas não está no conjunto de estados acima. `[NÃO VERIFICADO]` ver D-H025-2.

## 4. Critérios de aceite (Given/When/Then)

- **CA-01 Preenchimento sem senha.** Dado um visitante sem conta, quando preenche serviço, local, urgência e descrição, então o rascunho é salvo e nenhuma tela pede senha. `[DECIDIDO]` FA-001.
- **CA-02 Urgência exata.** Dado o campo urgência, quando o visitante abre a lista, então vê exatamente "Imediato", "Nas próximas semanas", "Próximo mês" e "Ainda não defini". Quando a API recebe um valor fora dessa lista, então responde 422 e nada é gravado. `[DECIDIDO]` RF-011; 422 `[VERIFICADO]` 11-ARQ §2.2.
- **CA-03 Salvar sem identificação.** Dado um rascunho só com serviço, local e descrição, quando é salvo, então é gravado sem nome nem e-mail e a resposta não exige esses campos. `[DECIDIDO]` RF-012.
- **CA-04 Identificação obrigatória para avançar.** Dado um rascunho sem primeiro nome ou sem e-mail, quando o cliente tenta enviar para a revisão, então o envio é bloqueado com erro por campo. `[DECIDIDO]` FA-002.
- **CA-05 Vínculo pelo navegador.** Dado um rascunho criado no navegador A, quando o PATCH chega com o nonce de A, então é aceito; quando chega sem o nonce ou com outro nonce, então responde como "não encontrado" (sem revelar a existência do rascunho). `[PROPOSTA]` (ver D-H025-7; base `[VERIFICADO]` T-02, 404 indistinguível).
- **CA-06 Idempotência.** Dado um rascunho, quando o mesmo salvamento é enviado duas vezes, então o resultado é o mesmo e não há duplicidade. `[VERIFICADO]` 11-ARQ §2.2 (Idem: sim).
- **CA-07 Sem coordenada.** Dado um endereço escolhido em uma sugestão, quando o rascunho é salvo, então só o texto do endereço é guardado; nenhuma coordenada é gravada em rascunho, log ou cache. `[VERIFICADO]` G-01.
- **CA-08 Não publica.** Dado um rascunho em `aberto` ou `aguardando_email`, quando o visitante fecha a aba ou não confirma o e-mail, então nenhum pedido é publicado. `[DECIDIDO]` FA-002.
- **CA-09 Expiração.** Dado um rascunho cujo prazo venceu, quando o cliente tenta abri-lo, então vê que o rascunho não existe mais e o registro entra no expurgo. `[PROPOSTA]`; prazo `[NÃO VERIFICADO]` (D-H025-1). Expurgo `[VERIFICADO]` RC-09, H-110.
- **CA-10 Limite de abuso.** Dado um visitante (IP ou dispositivo) que cria rascunhos acima do limite, quando tenta mais um, então recebe 429 sem detalhe do limite. `[PROPOSTA]`; valores `[NÃO VERIFICADO]` (D-H025-6). Base `[DECIDIDO]` RF-021 (sem expor detalhe).

## 5. Fora de escopo

- Upload e limite de fotos (H-026; RF-025, RF-025a).
- Geocodificação permanente e coordenada da revisão (H-021).
- Envio do link mágico e validação do código de 6 dígitos (H-011, H-013).
- Revisão, confirmação expressa e publicação (H-030, H-031).
- Telefone e opt-in de WhatsApp (H-033; RF-016).
- Aviso de duplicidade e cobertura (H-024, H-030).
- Telas, textos e estados vazios: não especificados em 03-JORNADAS; ficam para o desenho de UX.

## 6. Dependências

- **Antes de H-025:** H-018 (catálogo e sinônimos), H-019 (autocomplete de serviço), H-020 (sugestão de endereço, sem gravação). `[VERIFICADO]` 14-BACKLOG.
- **H-025 libera:** H-013 (vínculo do rascunho pelo código e nonce), H-026 (fotos no rascunho), H-030 (revisão), H-033 (opt-in). `[VERIFICADO]` 14-BACKLOG.
- **Modelo:** `request_draft` com campos opcionais e TTL configurável em `app_config`. `[VERIFICADO]` 09.

## 7. Dúvidas não bloqueantes (para o líder)

Estas dúvidas não impedem o Architect de começar. Cada uma tem recomendação.

- **D-H025-1 (exige aprovação do usuário).** Qual o prazo do rascunho antes de descartar? RF-019 ainda está `[PROPOSTA]`. Recomendação do PO: 7 dias corridos, igual à validade do pedido e à sessão, configurável em `app_config`. Alternativa: 48 h, mais restritiva contra spam.
- **D-H025-2.** "Aguardando geocodificação" (F-05, G-06) é um estado ou um sinalizador? Recomendação: sinalizador separado (ex.: `geocode_pending`), mantendo os quatro estados. Destrava H-021, não H-025.
- **D-H025-3.** Quando o rascunho é salvo? Recomendação: a cada campo com atraso curto (debounce), sem botão extra. Afeta a carga e o limite de abuso.
- **D-H025-4.** Telefone entra no rascunho anônimo? Recomendação: não. Telefone e opt-in ficam para H-033, com checkbox desmarcado por padrão (RF-016).
- **D-H025-5.** Quais campos são obrigatórios para revisar? Recomendação: rascunho aceita campos parciais; serviço, local, urgência e descrição são obrigatórios na revisão (H-030). Destrava H-030.
- **D-H025-6.** Limites de tamanho da descrição e de rascunhos por visitante. Recomendação: o Architect propõe valores `[PROPOSTA]`; não bloqueia.
- **D-H025-7.** Código de resposta quando o nonce não confere. Recomendação: "não encontrado" indistinguível (404), como em T-02.

## 8. Próximo passo

Aguardar a validação do líder sobre D-H025-1 (único ponto que pede aprovação do usuário). O restante segue para o Architect com as recomendações acima.
