# Refino H-032 — Visibilidade de localização (Issue #45, WF-03, Product Owner)

- **Issue:** #45 `[E3] Visibilidade de localização` · **História:** H-032 · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner.
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-13.
- **EXEC-ID:** não atribuído (não informado pelo líder).
- **Natureza:** somente documento. Nenhum código, migração, teste ou consulta ao banco. Nenhuma alteração no quadro. O cartão permanece em Product Owner até o líder decidir a movimentação.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido nos documentos ou no quadro · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas: `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`, `docs/factory/21-ISSUES-CRIADAS.md` (H-032 = #45), `14-BACKLOG.md` (linha H-032, §2), `04-PRD.md` (RF-013, RF-136, RF-137), `05-CRITERIOS-ACEITE.md` (FA-007, FA-030), `08-ARQUITETURA.md` (§4.3, §9.1, §9.2), `09-MODELO-DADOS.md` (§3.3 professional_area, §3.4 service_request, `address_share`, matriz de dados linhas 230 e 231), `11-ARQ-RISCOS-E-TESTES.md` (I-16, I-28), `110-DESENHO-H031.md` (§4.1, §11, A4), `88-DESENHO-H022.md` (grade de 500 m, rótulo), `97-DESENHO-H023.md` (consulta da descoberta), `113-REFINO-H045.md` (formato), `11-DECISOES.md` (decisões 57, 249 e rodadas 52, 62 a 89), `quadro-status.md` (atualizado em 2026-11-13 12:30).

Limitações `[NÃO VERIFICADO]`:
- O texto da Issue #45 no GitHub não foi lido. Não há shell nem `gh` nesta rodada. O objetivo foi reconstruído do backlog e dos documentos. O líder deve conferir o texto da Issue antes da Arquitetura.
- O código real de `service_request` e das funções da #44 não foi lido nesta rodada. A forma atual vem de `110-DESENHO-H031.md` §4.1 e da nota de implementação em `09-MODELO-DADOS.md` §3.4 (linha 93).
- O banco de desenvolvimento não foi consultado.
- O dono de `address_share` (RF-139) não foi identificado no backlog. Ver pergunta 410.

---

## 1. Verificação de fila e dependências

- `[VERIFICADO]` O quadro mostra #45 em "Product Owner (2)". Está na coluna certa. Não há outra história pendente de PO além de #51.
- `[VERIFICADO]` Dependências declaradas de H-032 no backlog: **H-022 (#35)** e **H-031 (#44)**.

| Dependência | Estado no quadro | Efeito sobre #45 |
|---|---|---|
| H-022 (#35) célula de 500 m e `match_point` | **Concluído** | Atendida. A grade v1 (`match_grid_version = 1`) já existe. |
| H-031 (#44) publicação idempotente | **Concluído** (Rodada 74, por instrução do usuário) | Atendida. `service_request` existe, com `address_text` em texto puro. |
| H-021 (#34) coordenada permanente | **Concluído** | Atendida. É a base de `geocode_point`. |
| H-023 (#36) descoberta por raio | **QA** (não concluída; Code Review aprovado na Rodada 86) | **Não está na lista formal de H-032**, mas lê a mesma superfície (`service_request` e `geocode_point`) e a migração dela tem prefixo `20261113210000`. Ver §1.1. |
| H-024 (#37) cobertura booleana | **Arquitetura**, espera #36 | Sem conflito direto. A #45 não pode remover coluna que #37 lê (110 §11). |
| H-042 (#55) e aceite (E6, #71) | **Backlog** | Regras de participante (nome após aceite, aceite retirado) não podem ser provadas de verdade ainda. Ver §1.2. |
| Seleção (E8, #84) | **Backlog** | Regra "após seleção" não tem o fato de origem. Ver pergunta 409. |
| H-033 (#46) telefone | **Backlog** | Não é dependência. A #46 acrescentará `phone_*` por expansão. |

### 1.1 Pode começar Desenvolvimento?
- **Arquitetura: sim.** As dependências formais estão concluídas.
- **Desenvolvimento: ainda não.** `[PROPOSTA]` A #45 altera a leitura de profissional (função ou view e rota de detalhe) e uma migração em `service_request`. A #36 usa a mesma superfície e está em QA. Pelo `AGENTS.md` (§3), Issues com arquivos em comum não andam em paralelo. **Recomendação (pergunta 413):** o Desenvolvimento da #45 só começa depois que a #36 sair de QA para Aguardando aprovação.

### 1.2 Partes que dependem de história ainda não construída
- **Participante (aceito) e aceite retirado** (CA-05, CA-07): dependem de aceite (E6) e da tabela de participação, ambos em Backlog. `[PROPOSTA]` A #45 implementa apenas a regra de negação e prova a parte de dono, elegível e negação. A parte de participante fica com fixture sintética marcada, ou para a história de aceite. Não se implementa leitura de participante sem a tabela de aceite.
- **Seleção** (regra "após seleção"): depende de E8. Ver pergunta 409.

---

## 2. Objetivo

Garantir que a localização do pedido seja vista por cada papel apenas no grau permitido: endereço exato privado; profissional vê célula generalizada e rótulo público; e-mail e telefone nunca aparecem em resposta a profissional. Entregar também a **cifra do endereço em texto** (decisão 249: "cifrar na #45").

Resultado de negócio: o profissional decide se quer o pedido com base na região aproximada, sem receber o endereço antes de o cliente autorizar.

---

## 3. Escopo (dentro de H-032)

1. **Rótulo público** do pedido (bairro, cidade e UF) gravado na publicação, por expansão de `service_request` (09 §3.4 e 110 §4.1: "`public_label` entra por expansão nas histórias donas").
2. **Célula generalizada** para o profissional: centro da célula de 500 m (grade v1) e distância arredondada. Sem ponto exato, sem coordenada de pedido. Ver pergunta 417.
3. **Regra de visibilidade** de endereço exato, nome, e-mail e telefone por papel (§4).
4. **Leitura para profissional sem colunas sensíveis:** função ou view de detalhe (dono de regra: pergunta 411) com lista de colunas fechada.
5. **Cifra de `address_text`** em repouso (decisão 249), com a chave fora do banco. Ver §6 e perguntas 404 a 407.
6. **Testes** de contrato, de catálogo do banco, de ausência de vazamento e de fronteira de prazo (§7).

## 4. Fora de escopo

- Telefone e WhatsApp, opt-in e revogação (H-033, #46). `[PROPOSTA]` A #45 só garante que nenhuma leitura de profissional tem coluna de telefone.
- Fotos e marca d'água (H-035..., #69). A regra "foto só do pedido, em URL assinada" fica com essa história.
- Tabela de aceite, participação, seleção e conversa (E6 a E8).
- Tela pós-publicação completa (#47) e painel do cliente (#47).
- Leitura administrativa de endereço (pergunta 415).
- Chamada ao provedor de mapas. **Mapbox real está proibido** (Rodada 74; decisão 239 substituída). O rótulo deve sair de dado já gravado, nunca de chamada nova.
- Retenção e expurgo do endereço após o fim do pedido: `[PENDENTE JURÍDICO]` (ADR-016); pergunta 419.

---

## 5. Regras de visibilidade

Quem pode ver o quê. `[DECIDIDO]` quando vem de documento aprovado; `[PROPOSTA]` quando é deste refino.

| Dado | Dono do pedido (cliente da sessão) | Participante com aceite ativo | Profissional elegível, antes de aceitar | Profissional não elegível ou sem acesso | Admin |
|---|---|---|---|---|---|
| Endereço exato (`address_text`, ponto exato) | sim | só com `address_share` ativo (RF-139; 08 §4.3) `[PROPOSTA]` pergunta 409 | **não** | **não** (404 uniforme) | só com caso de acesso aberto (`access_case`) `[PROPOSTA]` pergunta 415 |
| Célula generalizada (centro de 500 m) e distância arredondada | sim | sim | **sim** (FA-007; RF-013) | não | sim |
| Rótulo público (bairro, cidade, UF) | sim | sim | **sim** (FA-007; RF-013) | não | sim |
| Primeiro nome do cliente | sim | **sim, só com aceite ativo** (08 §4.3) | **não** (FA-007: "não há primeiro nome") | não | sim |
| E-mail do cliente | sim (é a conta) | **nunca** (RF-137; FA-030) | **nunca** | **nunca** | não aparece em tela de profissional |
| Telefone | (H-033) | (H-033, com consentimento) | **nunca** | **nunca** | (H-033) |
| Descrição e serviço, urgência | sim | sim | **sim** (08 §4.3: "detalhe textual") | não | sim |

### 5.1 Regras numeradas
- **RN-01 (`[DECIDIDO]` RF-013, FA-007):** o endereço exato é privado. O profissional elegível vê a localização generalizada (célula e rótulo) e nunca o endereço completo.
- **RN-02 (`[DECIDIDO]` FA-007):** o profissional elegível que abre o pedido **antes de aceitar** não recebe primeiro nome, e-mail, telefone nem endereço completo na resposta.
- **RN-03 (`[DECIDIDO]` RF-137, FA-030):** e-mail do cliente nunca aparece a profissional, em nenhuma tela ou resposta de API.
- **RN-04 (`[DECIDIDO]` 08 §4.3):** primeiro nome do cliente só para participante com aceite ativo. Aceite retirado perde a visão do pedido `[PROPOSTA]` (ver 08 §4.3, texto entre colchetes).
- **RN-05 (`[DECIDIDO]` FA-030, 08 §4.3):** endereço completo só quando o cliente compartilha de forma específica com aquele participante. `[PROPOSTA]` Compartilhar não acontece sozinho ao aceitar ou selecionar (pergunta 409).
- **RN-06 (`[PROPOSTA]`, 08 §9.2):** a célula é o centro de grade de 500 m, determinística. Na resposta ao profissional aparecem o rótulo público, a célula generalizada (ou só a distância) e a distância arredondada. Não aparece ponto exato nem coordenada de pedido (pergunta 417).
- **RN-07 (`[PROPOSTA]`):** a distância mostrada é arredondada para 0,5 km, para não expor a posição com precisão de dezenas de metros.
- **RN-08 (`[PROPOSTA]`):** o detalhe ao profissional segue a janela de `08 §4.3`: só enquanto o pedido está aberto (`publicado` e antes de `acceptance_deadline_at`). Depois disso, resposta 404 uniforme.
- **RN-09 (`[DECIDIDO]` decisão 249):** `address_text` é cifrado em repouso. Texto em claro só existe na API, para dono ou participante autorizado, e nunca em log, resposta de profissional ou auditoria.
- **RN-10 (`[PROPOSTA]`):** a rota de detalhe ao profissional devolve **lista fechada de chaves**. Não inclui `address_text`, `exact_point`, `geocode_point_id`, hash, e-mail, telefone nem coordenadas.

---

## 6. Dados e cifra (decisão 249)

Situação atual `[VERIFICADO em 110 §4.1 e 09 §3.4 nota]`: `service_request.address_text` é `text not null`, CHECK entre 3 e 200 caracteres, em **texto puro**. `exact_point` vive só em `app.geocode_point` (RLS forçada, sem acesso direto). `public_label` **não existe** em `service_request`; deve entrar por expansão nesta história.

Proposta `[PROPOSTA]` (pergunta 404 a 407):
- **Coluna nova** `address_text_enc bytea` (ou equivalente), gravada na publicação, e o `address_text` em claro removido em migração expansiva, após backfill dos pedidos sintéticos do DEV. Não há produção.
- **Quem cifra:** a API, antes de chamar a função de publicação. Isso exige nova migração que substitui `private.request_publish_commit`, função já concluída pela #44. O banco não guarda a chave.
- **Chave:** variável `ADDRESS_ENC_KEY` (32 caracteres ou mais), em `.env.local` do produto e no ambiente de implantação. Nunca no código, na Issue ou no banco. Sem rotação nesta fase.
- **Leitura:** decifragem só na API, para dono e participante autorizado (e admin com caso, se a pergunta 415 for aceita).
- **Rascunho:** `request_draft.address_text` continua em claro até expirar (no máximo 30 dias, teste T-DB13 da #44). `[PROPOSTA]` Registrar como dívida (pergunta 407).

---

## 7. Estados e fluxos

### 7.1 Estado do pedido para visibilidade
`publicado` + antes do prazo = **aberto** (elegível vê célula e rótulo). `publicado` + prazo vencido = **fechado** (404 uniforme ao profissional; o dono continua vendo). `selecionado`, `concluido`, `cancelado`: definidos pelas histórias de E8 (fora desta).

### 7.2 Fluxo de leitura pelo profissional (`[PROPOSTA]`)
1. Sessão do profissional. Verifica verificação, acesso vigente, serviço e raio (regras da #36 e H-042).
2. Se não elegível, ou se o pedido está fechado: 404 uniforme (`pedido_nao_encontrado`).
3. Se elegível e aberto: devolve a lista fechada da RN-10, com rótulo, célula generalizada, distância arredondada, serviço, descrição e urgência.
4. Nenhuma chamada a provedor externo. Nenhum log com dado de localização.

### 7.3 Fluxo do dono
1. Sessão do cliente igual a `customer_user_id`. Devolve o endereço decifrado, o rótulo e a célula.
2. Dono de outro pedido: 404 uniforme.

### 7.4 Fluxo do participante `[PROPOSTA]`
- Depende do aceite e de `address_share` (pergunta 409). Não implementado nesta história sem a tabela de aceite (§1.2).

---

## 8. Critérios de aceite (numerados e testáveis)

Todos os testes são locais, com dados sintéticos e marcador de teste. Evidência: comando, contagem e código de saída de `corepack pnpm check:all` e `db:test`, registrada na Issue.

- **CA-01 (lista fechada, FA-007, RN-10).** A resposta de detalhe ao profissional elegível e aberto tem exatamente as chaves da lista fechada. Prova: teste de contrato com lista de chaves.
- **CA-02 (sem coordenada, RN-06).** A resposta ao profissional não contém par numérico com cara de coordenada (latitude e longitude), nem `geocode_point_id`, nem hash. Prova: varredura do corpo. Se a pergunta 417 aceitar o centro da célula, a varredura prova que só o centro da célula aparece, nunca o ponto exato.
- **CA-03 (sem identificação, FA-007, RN-02).** O profissional elegível antes de aceitar não recebe primeiro nome, e-mail, telefone nem endereço completo. Prova: teste de contrato e varredura de padrões de e-mail e telefone no corpo.
- **CA-04 (e-mail nunca, RF-137, FA-030, RN-03).** O e-mail do cliente não aparece em nenhuma resposta a profissional, em nenhum papel de participação. Prova: varredura de corpo e cabeçalhos.
- **CA-05 (dono, RN-09).** O dono recebe o endereço decifrado com a sessão correta. Prova: teste de rota com banco real.
- **CA-06 (não dono, IDOR).** Outro cliente, e profissional sem elegibilidade, recebem 404 uniforme para o pedido. A resposta é igual, byte a byte, à de pedido inexistente. Prova: comparação de respostas.
- **CA-07 (elegibilidade).** Profissional fora do raio, sem acesso vigente ou não aprovado recebe 404 uniforme. Prova: três fixtures, cada uma com uma causa.
- **CA-08 (fronteira de prazo, RN-08).** Em `acceptance_deadline_at − 1 µs` o detalhe é devolvido; em `acceptance_deadline_at` e depois, 404 uniforme. Prova: relógio fixo, mesma expressão da #36.
- **CA-09 (participante com aceite, RN-04).** `[PROPOSTA]` Dependente de E6. Nesta história: com fixture sintética marcada, o participante com aceite ativo vê o primeiro nome, e o que não tem aceite não vê. Se a tabela de aceite não existir, o teste fica como pendência registrada, não simulado.
- **CA-10 (compartilhamento específico, RN-05).** `[PROPOSTA]` Endereço só para participante com `address_share` ativo; revogado (`revoked_at` preenchido) volta a não ver. Depende da pergunta 410 (dono da tabela).
- **CA-11 (catálogo do banco).** As funções e views de leitura de profissional não têm colunas `address_text`, `address_text_enc`, `exact_point`, `geocode_point_id`, e-mail nem `phone_*`. Prova: consulta a `pg_attribute` e `pg_proc.prosrc`, no molde de T-DB15 da #44.
- **CA-12 (cifra, RN-09).** `address_text_enc` não é legível por `select` direto de qualquer papel de aplicação. Round-trip cifra e decifra devolve o texto original. Chave ausente faz a publicação falhar com erro fechado, sem gravar pedido. Prova: testes de banco e de API.
- **CA-13 (sem texto em log).** Sentinela de endereço e de chave não aparece em log, corpo de erro ou auditoria. Prova: varredura de saída.
- **CA-14 (rótulo sem provedor externo, `[PROPOSTA]`).** O rótulo público vem do dado já gravado. A publicação e a leitura passam com o provedor de mapas ausente, sem chamada nova. Prova: teste com provedor ausente. Mapbox real está proibido.
- **CA-15 (rótulo gravado, `[PROPOSTA]`).** O rótulo público (bairro, cidade, UF) é gravado na publicação, com CHECK de tamanho. Prova: teste de banco. Fonte do rótulo depende da pergunta 408.
- **CA-16 (distância arredondada, RN-07).** A distância devolvida é múltipla de 0,5 km. Prova: teste de unidade com distâncias conhecidas.
- **CA-17 (migração, expansiva e reversível).** Aplicada com `npx supabase`, idempotente, com prefixo maior que `20261113210000`. O `.down.sql` recusa se houver dados, a menos que a guarda de força esteja ativa. Prova: `db:test` antes e depois, e `db:status`.
- **CA-18 (interface, se houver tela da #45).** Texto da tela do profissional fala em "bairro, cidade e UF" e "a cerca de X km"; não aparece "endereço exato", coordenada ou mapa. Prova: teste de navegador e estático. Depende da pergunta 411.
- **CA-19 (evidência local).** `corepack pnpm check:all` e `db:test` rodados localmente, com contagem e código de saída na Issue. Não se declara CI verde sem execução.

---

## 9. Riscos

- **R1. Descrição livre com endereço ou telefone** (pergunta 412). O cliente pode digitar telefone ou endereço na descrição, que o profissional lê. Mitigação: aviso na revisão e registro; validação automática, se o líder aceitar.
- **R2. Chave de cifra perdida.** Sem a chave, os endereços ficam ilegíveis. Mitigação `[PROPOSTA]`: chave só em `.env.local` e no ambiente de implantação, e registro de onde ela está. Sem rotação nesta fase.
- **R3. Triangulação.** Quem repete buscas com bases diferentes descobre a célula, não o endereço. Risco já aceito em 08 §9.2 e 88 R3.
- **R4. Rótulo sem fonte** (pergunta 408). Sem Mapbox real, o bairro, a cidade e a UF não têm origem confirmada. Pode travar CA-15.
- **R5. Conflito com #36** (§1.1). Arquivos e superfície de leitura em comum. Mitigação: esperar QA.
- **R6. Regras de participante sem dado de origem.** Aceite e seleção não existem ainda (§1.2). Mitigação: fixture sintética marcada e pendência registrada.
- **R7. Dado em claro hoje.** Pedidos sintéticos do DEV têm `address_text` em claro. Mitigação: backfill na migração, só no DEV.
- **R8. Retenção do endereço exato** (LGPD, `[PENDENTE JURÍDICO]`, ADR-016). Sem prazo, o endereço fica guardado indefinidamente após o pedido. Pergunta 419 vai ao usuário.
- **R9. Mapbox proibido.** A publicação com provedor real não será provada em dev (Rodada 74). Os testes usam provedor simulado.

---

## 10. Ambiguidades

- `[AMBIGUIDADE]` 08 §4.3 diz "aceite retirado perde a visão do pedido", mas o texto é marcado como `[PROPOSTA]` e cita "Rodada 8 nº 19". Não foi possível confirmar essa rodada nesta leitura.
- `[AMBIGUIDADE]` 88 §3 diz que o profissional "vê o centro da célula", enquanto 08 §9.2 diz que a UI "mostra apenas rótulo textual (sem pino de mapa)". Não é contradição se a API não devolver coordenada (pergunta 417).
- `[AMBIGUIDADE]` A linha de H-032 no backlog cita "telefone privado", mas telefone é de H-033 (#46). Tratado como garantia de ausência (§4).
- `[AMBIGUIDADE]` O texto da Issue #45 no GitHub não foi lido (§0).

---

## 11. Perguntas ao líder

Lista única, numerada a partir de **404** (última registrada: 403). Sem envio ao usuário, exceto a 419 (jurídico, LGPD, conforme `AGENTS.md`). Cada item traz a recomendação do PO e a decisão que destrava.

**404. Cifrar o endereço já nesta história?** A decisão 249 manda cifrar na #45. A alternativa seria manter texto puro e registrar dívida.
- (a) Cifrar na #45 (decisão 249, já adotada).
- (b) Manter texto e cifrar depois de produção.
- **Recomendação:** (a). É o que a decisão 249 já registrou. Destrava CA-12 e a migração.

**405. Onde a cifra acontece?** A API cifra antes de gravar, ou o banco cifra com chave guardada nele.
- (a) A API cifra e passa o texto cifrado para uma nova função de publicação (substitui `request_publish_commit`, concluída na #44).
- (b) O banco cifra, com chave guardada no próprio banco (chave e dado no mesmo lugar).
- **Recomendação:** (a). A chave fica fora do banco. Destrava a assinatura da nova função e CA-12.

**406. Onde fica a chave de cifra?** Variável `ADDRESS_ENC_KEY` (32 caracteres ou mais), sem rotação nesta fase.
- (a) Variável de ambiente em `.env.local` e no ambiente de implantação, sem rotação agora.
- (b) Cofre do banco (`vault`, `[NÃO VERIFICADO]` disponível no plano gratuito).
- **Recomendação:** (a), por ser o padrão já usado pelo projeto (`ADDRESS_HASH_KEY`, `REQUEST_PUBLISH_HMAC_KEY`). Destrava CA-12.

**407. O rascunho também cifra o endereço?** `request_draft.address_text` está em claro até expirar (no máximo 30 dias).
- (a) Manter em claro e registrar dívida (recomendado; a #43 está concluída e o rascunho expira).
- (b) Cifrar também o rascunho, mexendo na #43.
- **Recomendação:** (a). Destrava o escopo da migração (não toca a #43).

**408. De onde vem o rótulo público (bairro, cidade, UF)?** Sem Mapbox real (Rodada 74), não há origem confirmada.
- (a) O cliente informa bairro, cidade e UF no formulário (exige mudar a revisão da #43).
- (b) O rótulo sai do resultado da geocodificação permanente (já vem do fake em dev; real só em produção).
- (c) Deixar o rótulo vazio até produção, sem tela de rótulo.
- **Recomendação:** (b), porque não exige mudar a #43 e é o que o dado de origem permite. Destrava CA-14 e CA-15. Risco: o rótulo fica simulado em dev `[NÃO VERIFICADO]` se o geocodificador já devolve esse campo (#34 não confirmada nesta leitura).

**409. Quando o endereço exato é liberado ao participante?** Ao aceitar, ao ser selecionado, ou só quando o cliente compartilha de forma específica?
- (a) Só com compartilhamento específico (`address_share`), como diz 08 §4.3 (recomendado).
- (b) Automático ao selecionar.
- (c) Automático ao aceitar.
- **Recomendação:** (a), por ser a regra de 08 §4.3 e FA-030. Destrava CA-10 e a regra "após seleção".

**410. Quem cria `address_share` e a leitura do endereço compartilhado?** A tabela existe em 09 (RF-139), mas o dono na história não foi identificado.
- (a) #45 cria a tabela e a leitura.
- (b) A história dona da participação cria (E6 a E8); a #45 só garante a regra de negação.
- **Recomendação:** (b). A #45 não deve criar fluxo de consentimento. Destrava CA-10. `[NÃO VERIFICADO]` dono em 14-BACKLOG; o líder confere antes de decidir.

**411. Quem entrega a rota de detalhe do pedido para o profissional?** A descoberta é da #36 (só lista). O detalhe (descrição, urgência, rótulo, célula) precisa de rota.
- (a) #45 entrega a função e a rota de detalhe, com a lista fechada (recomendado).
- (b) #36 entrega junto com a lista.
- **Recomendação:** (a), porque H-032 cita "resposta de API a profissional". Destrava CA-01, CA-18 e a ordem de Desenvolvimento.

**412. Descrição livre com telefone ou endereço.** O cliente pode digitar dado de contato na descrição, que o profissional lê.
- (a) Aviso na revisão e registro, sem filtro automático (recomendado; a #43 está concluída).
- (b) Validação que recusa telefone e CEP na descrição (mexe na #43 e na #44).
- **Recomendação:** (a). Destrava o texto da revisão (fora de #45) e R1.

**413. Ordem de Desenvolvimento em relação à #36.** A #45 altera a mesma leitura de profissional que a #36 usa.
- (a) Desenvolvimento da #45 só depois que a #36 sair de QA (recomendado; AGENTS §3, sem arquivos em comum em paralelo).
- (b) Paralelo, com risco de conflito.
- **Recomendação:** (a). Destrava o início do Desenvolvimento. Arquitetura pode começar já.

**414. Tamanho e forma da célula mostrada.** A grade v1 tem 500 m.
- (a) Célula de 500 m, distância arredondada a 0,5 km (recomendado).
- (b) Distância exata ao centro (não recomendado; facilita triangulação).
- (c) Faixa de 1 km.
- **Recomendação:** (a). Destrava RN-06, RN-07, CA-16.

**415. Admin lê endereço exato?** 09 diz "admin com caso".
- (a) Não nesta história; a leitura administrativa entra na história de caso de acesso (recomendado).
- (b) Incluir leitura admin nesta história, com auditoria.
- **Recomendação:** (a). Destrava CA-06 para o papel admin.

**416. Telefone na #45.** H-032 cita telefone privado, mas o telefone é da #46.
- (a) #45 só garante que nenhuma leitura de profissional tem coluna de telefone (recomendado).
- (b) #45 cria a coluna de telefone.
- **Recomendação:** (a). Destrava CA-11 (sem telefone).

**417. A resposta ao profissional pode trazer o centro da célula (coordenada)?** 88 §3 diz que o profissional "vê o centro da célula"; 08 §9.2 diz que a UI não mostra pino.
- (a) Não devolver coordenada. Devolver rótulo, célula generalizada (nome da célula ou só distância) e distância arredondada (recomendado).
- (b) Devolver o centro da célula, sem ponto exato.
- **Recomendação:** (a). É a regra mais segura e não impede o casamento, que fica no banco. Destrava CA-02.

**418. Pedido fechado pelo prazo: o profissional perde o detalhe?** Confirmar que a visão do profissional acaba no prazo, como 08 §4.3 e FA-007.
- **Recomendação:** sim (RN-08). Destrava CA-08. Sem risco de decisão de produto (já coberto por 08 §4.3).

**419. Retenção do endereço exato depois do fim do pedido.** Sem prazo, o endereço fica guardado indefinidamente (ADR-016 `[PENDENTE JURÍDICO]`). **Vai ao usuário (LGPD).**
- (a) Prazo definido pelo usuário (jurídico). Não há prazo proposto nesta etapa.
- (b) Adiar a definição até a história de retenção (E13).
- **Recomendação:** (b), para não bloquear a #45. O usuário responde o prazo quando a retenção for tratada. Destrava só R8, não a #45.

---

## 12. Próximos passos

1. Líder confere o texto da Issue #45 no GitHub e a coluna no quadro (ainda em Product Owner).
2. Líder responde 404 a 418 (adota as recomendações, registra em `11-DECISOES.md`) e envia 419 ao usuário.
3. Atualizar este refino com as respostas que mudarem regra.
4. Mover #45 para Arquitetura só depois de confirmar no quadro. Não mover por inferência.
5. Arquitetura desenha a migração, a função de detalhe, a cifra e os testes (§8). Desenvolvimento só depois da regra 413.
