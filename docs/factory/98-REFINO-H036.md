# H-036 — Refino: perfil profissional (serviços, base e raio)

- **Issue:** #49 "[E4] Perfil: serviços, base e raio" · **Backlog:** H-036 · **Dependências:** H-035 (#48, Concluída), H-021 (#34, Concluída), H-018 (#31, Concluída) · **Destrava:** #36 (H-023, descoberta por raio, em Arquitetura) e #37 (H-024, cobertura), decisão 91
- **Etapa:** specification · **Data:** 2026-11-12 · **Papel:** Product Owner · **Status:** refino para validação do líder
- **Etiquetas:** `[DECIDIDO]` aprovado nos documentos (PRD, decisões, critérios) · `[DELEGADO]` decisão delegada, revogável · `[VERIFICADO]` conferido em documento de arquitetura, backlog, quadro ou código existente, sem decisão de produto · `[PROPOSTA]` sugestão do PO, a validar · `[NÃO VERIFICADO]` depende de medição ou de ação externa não feita
- **Fontes lidas:** 14-BACKLOG (H-036, H-035, H-021, H-018, H-023, H-024, H-042, H-043, H-038, BK-2, BLQ-EXEC); 16-MANIFESTO-ISSUES (item 47); quadro-status (#49 em Product Owner; #48, #34, #31 em Concluído; #36 em Arquitetura; #37 em Product Owner); 04-PRD (RF-004, RF-051, RF-065); 03-JORNADAS (passo 4); 06-CATALOGO-PROPOSTO (legenda PR, ON, HI); 07-AMBIGUIDADES (AMB-15); 08-ARQUITETURA §4.3, §9.1 (incluindo o item 4 e a linha 318 sobre mudança de base e raio), §9.3; 09-MODELO-DADOS §3.3 (`professional_profile`, `professional_area`, `professional_service`, `app_config`, auditoria); 11-ARQ-RISCOS-E-TESTES (I-16, I-28, T-03, T-11, G-07); 11-DECISOES (46, 54, 56 (duplicidade), 57, 91, 105, 106); 68-DESENHO-H021 §2 e §3.5 (porta de geocodificação permanente simulada nos testes); 88-DESENHO-H022 §1 e §5 (origem da busca pelo centro da célula da base); 96-REFINO-H023 (§2.2, §5, D-H023-2, D-H023-3, D-H023-5, D-H023-6); 92-REFINO-H027 (padrão deste documento).

## 1. Objetivo

Permitir que o profissional declare os serviços que atende (presencial, online ou ambos) e, para os serviços presenciais, a base de atendimento com coordenada permanente e o raio de atendimento de 5 a 100 km. Esta história entrega o cadastro dessas informações e as regras de validação. Ela não entrega a descoberta de pedidos, a cobertura para o cliente nem a visibilidade pública da base. `[DECIDIDO]` RF-051 (base e raio de 5 a 100 km para serviços presenciais); `[VERIFICADO]` 14-BACKLOG H-036 e 09 §3.3.

## 2. Situação de partida

- **Perfil existe (H-035, #48, Concluída):** o cadastro profissional já grava o documento cifrado e a unicidade por identidade. `[VERIFICADO]` quadro-status; decisão 54; 09 §3.3.
- **Coordenada permanente (H-021, #34, Concluída):** existe a porta de geocodificação permanente. Nos testes ela é simulada, e nenhum teste chama o serviço real. `[VERIFICADO]` 68-DESENHO-H021 §2 e §3.5; quadro-status.
- **Catálogo (H-018, #31, Concluída):** os serviços têm flags ON (online), PR (presencial) e HI (híbrido, o profissional escolhe). `[VERIFICADO]` quadro-status; 06 (legenda).
- **Ainda não existem no repositório** as tabelas `professional_area` e `professional_service`. `[VERIFICADO]` 96-REFINO-H023 §2.2.
- **A base precisa de célula no banco.** A descoberta de H-023 busca a partir do centro da célula da base, lido das colunas de casamento (`match_*`) da própria linha da base. Por isso a base guarda essas colunas, geradas no banco, como o pedido faz. `[VERIFICADO]` 88-DESENHO-H022 §1 e §5; decisão 57; 96 (D-H023-3). O modo de geração é desenho do Architect.

## 3. Escopo

### 3.1 Serviços declarados

- O profissional declara serviços do catálogo ativo, com uma modalidade por linha: presencial, online ou ambos. "Ambos" são duas linhas, uma de cada modalidade. `[PROPOSTA]` (D-H036-1).
- A modalidade declarada precisa ser compatível com a flag do serviço: PR aceita só presencial; ON aceita só online; HI aceita presencial, online ou ambos. `[PROPOSTA]` com base em 06 (legenda PR, ON e HI) e RF-004.
- O profissional pode remover um serviço ou trocar a modalidade. `[PROPOSTA]`
- Serviço regulamentado (flag REG) pode ser declarado. A certificação é de H-038, e o alcance nacional de serviço online regulamentado fica para L4 (D-H036-7). `[VERIFICADO]` 14-BACKLOG H-038; 96 (D-H023-6).

### 3.2 Base com coordenada permanente

- A base é um endereço escolhido na sugestão do autocomplete temporário (H-020). Antes de salvar, só o texto existe. `[VERIFICADO]` 14-BACKLOG H-020.
- Ao salvar a base, o sistema faz **uma** chamada permanente. A coordenada vai para `base_point`, privado, e o texto para o campo de rótulo da base. Nenhuma coordenada temporária é gravada. `[VERIFICADO]` G-07 (1 chamada permanente, limitada em taxa); I-28; 09 §3.3; 08 §9.1 (item 4).
- A base é obrigatória só quando há serviço presencial. Perfil só com serviços online pode não ter base. `[DECIDIDO]` RF-051 ("para serviços presenciais").
- Sem chamada para visitante anônimo. `[VERIFICADO]` G-07.

### 3.3 Raio de atendimento

- O raio é informado em km inteiros, de 5 a 100, e gravado em metros (5.000 a 100.000). Quando há serviço presencial, raio e base são obrigatórios juntos. `[DECIDIDO]` RF-051; `[PROPOSTA]` km inteiros (D-H036-4).
- A faixa é imposta também no banco (CHECK), não só na tela. `[VERIFICADO]` 09 §3.3 (CHECK 5.000–100.000); 14-BACKLOG H-036.
- Mudança de base ou de raio é limitada em taxa e registrada em auditoria. `[VERIFICADO]` 09 §3.3; 08 §9.1.
- Mudança de base, raio ou serviço vale só para pedidos novos: não altera pedido publicado nem a participação já existente. `[DECIDIDO]` AMB-15 A (07; 08 §9.1 linha 318); 14-BACKLOG H-036. O efeito sobre pedidos já publicados na descoberta está em D-H036-2.

### 3.4 Privacidade e status

- Base, raio e texto completo do endereço são privados, visíveis só ao próprio profissional e ao sistema. A base não aparece no perfil público nem em respostas a visitantes ou clientes. `[VERIFICADO]` 09 §3.3 (`base_point` privado); 08 §4.3; 11-ARQ I-16.
- O rótulo generalizado (bairro, cidade ou UF) visível ao cliente é de H-032, não desta história. `[VERIFICADO]` 96 §3.
- Editar serviços, base e raio não concede elegibilidade. Quem decide se o profissional vê pedidos é H-042 e H-055. `[VERIFICADO]` 14-BACKLOG H-042; RF-065.

## 4. Fora de escopo

- Rota e regra de descoberta por raio e online: H-023 (#36) e H-055 (#68).
- Cobertura do cliente ("com" ou "sem"): H-024 (#37).
- Rótulo de bairro, cidade ou UF e ponto generalizado visível: H-032 (#45).
- Perfil público, selo e média: H-043 (#56).
- Certificações de atividade regulamentada: H-038 (#51). Restrição territorial de serviço regulamentado: L4.
- Verificação, aprovação, fila e retenção: H-039, H-040, H-041.
- Mostrar distância ou raio exato a outros usuários: não prometido (D-H023-7).

## 5. Critérios de aceite (Given/When/Then)

- **CA-01 Serviço declarado com modalidade.** Dado um serviço ativo do catálogo, quando o profissional o declara como presencial, online ou ambos, então a declaração fica salva e aparece só na própria área. Em "ambos", ficam duas linhas. `[DECIDIDO]` RF-051; `[PROPOSTA]` "ambos" (D-H036-1).
- **CA-02 Modalidade compatível com o catálogo.** Dado um serviço PR, quando é declarado como online; ou um serviço ON, quando é declarado como presencial; ou um serviço inativo ou inexistente, então a declaração é recusada com texto fixo e nada é gravado. `[PROPOSTA]` regra de 06 (PR, ON, HI).
- **CA-03 Remoção e troca de modalidade.** Dado um serviço já declarado, quando é removido, então some do perfil e da própria área. Quando a modalidade é trocada (por exemplo, de presencial para online), então a linha anterior sai e a nova fica. Trocar para "ambos" acrescenta a outra linha. `[PROPOSTA]`.
- **CA-04 Base e raio só quando há serviço presencial.** Dado um perfil com ao menos um serviço presencial, quando é salvo sem base ou sem raio, então é recusado com texto fixo. Dado um perfil só com serviços online, quando é salvo sem base, então é aceito e não tem alcance por raio. `[DECIDIDO]` RF-051; `[PROPOSTA]` detalhe da recusa.
- **CA-05 Base com uma chamada permanente.** Dado um endereço escolhido na sugestão, quando a base é salva, então ocorre exatamente uma chamada permanente, a coordenada fica só em `base_point` privado, o texto fica no rótulo privado e nenhuma coordenada temporária é gravada. `[VERIFICADO]` G-07; I-28; 09 §3.3.
- **CA-06 Falha de geocodificação não grava base.** Dado uma geocodificação sem resultado, com tempo esgotado, com erro do serviço, com limite atingido, com resultado fora do Brasil ou de tipo grosseiro, quando o profissional salva a base, então a base anterior (ou a ausência de base) é mantida, nenhuma coordenada parcial é gravada e a mensagem não expõe detalhe técnico. `[VERIFICADO]` 68-DESENHO-H021 §2 (cenários da porta); `[PROPOSTA]` a mensagem e a manutenção da base anterior.
- **CA-07 Raio entre 5 e 100 km.** Dado um raio de 4.999 m, de 100.001 m, zero, negativo ou ausente, quando é salvo com base presencial, então é recusado com texto fixo, e o banco também recusa a gravação. Dado um raio de 5.000 m ou de 100.000 m, então é aceito. `[DECIDIDO]` RF-051; 14-BACKLOG H-036 ("raio fora de 5–100 km recusado").
- **CA-08 Mudança de base ou raio limitada em taxa.** Dado um profissional que já alterou a base ou o raio além do limite da janela, quando tenta alterar de novo, então a mudança é recusada com mensagem de espera e nada muda. O valor do limite vem de parâmetro administrável. `[VERIFICADO]` 09 §3.3 e `app_config`; `[PROPOSTA]` valor (D-H036-3).
- **CA-09 Mudança não altera pedido nem participação já existentes.** Dado um pedido publicado em que o profissional já participa, quando ele muda base, raio ou serviço, então a participação existente permanece como estava. Só a configuração nova vale para pedidos publicados depois da mudança. `[DECIDIDO]` AMB-15 A; 14-BACKLOG H-036 ("mudança não altera pedido publicado"). O efeito sobre a descoberta de pedidos já publicados está em D-H036-2.
- **CA-10 Auditoria sem localização.** Dado qualquer alteração de base, raio ou serviço, quando é gravada, então existe um registro de auditoria com ator, data e tipo de mudança, sem coordenada e sem endereço completo. `[VERIFICADO]` 09 §3.3 ("histórico em auditoria"); 11-ARQ T-11.
- **CA-11 Base e raio só para o dono.** Dado outro profissional, um visitante ou um cliente, quando consulta perfil público ou API, então não recebe `base_point`, texto do endereço, raio nem coordenada. O perfil público mostra só o que H-043 libera. `[VERIFICADO]` 09 §3.3; 08 §4.3; I-16; H-043.
- **CA-12 Sem dado de localização em log ou erro.** Dado qualquer salvamento, quando grava log ou responde com erro, então não aparecem coordenada, texto do endereço, raio junto com identificador do profissional, nem documento. Os erros têm texto fixo. `[VERIFICADO]` 88-DESENHO-H022 §7 item 4; 11-ARQ T-11.
- **CA-13 Editar não concede elegibilidade.** Dado um profissional que não está aprovado, quando edita serviços, base ou raio, então a edição é salva (conforme D-H036-6), mas nenhum pedido aparece para ele por causa disso. A elegibilidade continua dependendo de H-042 e H-055. `[VERIFICADO]` 14-BACKLOG H-042; RF-065; `[PROPOSTA]` regra de status (D-H036-6).

## 6. Dependências e condições antes do Desenvolvimento

- **H-035 (#48), Concluída:** perfil existe. `[VERIFICADO]` quadro-status.
- **H-021 (#34), Concluída:** porta de coordenada permanente existe. A chamada real a Mapbox depende de BLQ-EXEC (conta, cartão e limite de gasto, decisão 46). Não verifiquei neste refino se essa etapa foi feita, e não consultei credenciais. Por isso o DEV usa a porta simulada, como em #34. `[NÃO VERIFICADO]` (D-H036-8).
- **H-018 (#31), Concluída:** catálogo e flags. `[VERIFICADO]` quadro-status.
- **Esquema da declaração de serviço:** a chave de `professional_service` precisa aceitar duas linhas para o mesmo serviço (D-H036-1). Condição do DEV.
- **Consumidores:** #36 (H-023) precisa de `match_*` e do raio da base; #37 (H-024) precisa das bases e do raio (decisão 91). Ambos esperam esta história. `[VERIFICADO]` 96 §5; 11-DECISOES 91.
- **Quadro:** #49 está em Product Owner. O refino 96 cita #49 como Backlog, mas o quadro atual já mostra Product Owner. O Orquestrador usa o quadro, não o refino 96. `[VERIFICADO]` quadro-status.

## 7. Evidência exigida

Registrada na Issue #49, com comando, contagem e código de saída de cada execução local. Não declarar CI verde. Nenhum teste chama o Mapbox real.

- `corepack pnpm check:all` e `corepack pnpm db:test`: código de saída e contagem de passou e falhou.
- **CA-01 a CA-03:** um caso por modalidade (presencial, online, ambos) e um caso de compatibilidade recusada por serviço PR, ON, inativo e inexistente; remoção e troca de modalidade.
- **CA-04 e CA-07:** raio de 4.999 m, 5.000 m, 100.000 m, 100.001 m, zero e ausente; base ausente com e sem serviço presencial. A recusa tem de vir também do banco.
- **CA-05 e CA-06:** porta simulada com contador. Uma chamada por gravação de base. Nos cenários de falha (sem resultado, tempo esgotado, erro, limite, fora do Brasil, tipo grosseiro), nenhuma coordenada gravada e a base anterior mantida.
- **CA-08:** tentativa além do limite recusada; valor lido de parâmetro.
- **CA-09:** mudança com participação existente: a participação não muda. A parte sobre pedido publicado depende de H-031 (#44), `[NÃO VERIFICADO]` até lá.
- **CA-10 a CA-12:** varredura da resposta pública, da resposta própria, da auditoria, do log e dos erros, sem coordenada, texto do endereço nem documento.
- **CA-13:** edição em status não aprovado salva sem gerar elegibilidade.

## 8. Dúvidas para o líder

Sem perguntas ao usuário. Cada dúvida tem recomendação. Os números serão consolidados pelo líder em lista única.

- **D-H036-1 (modalidade "ambos" e chave de `professional_service`).** O 09 §3.3 diz "PK composta", sem dizer se a modalidade entra na chave. Se a chave for (profissional, serviço), "ambos" não cabe. **Recomendação:** chave (profissional, serviço, modalidade), com duas linhas para "ambos", e a regra da decisão 105 na descoberta (online vale sobre presencial). **Alternativa:** uma linha com modalidade `ambos`, o que muda o enum do 09. Destrava o esquema do DEV e não bloqueia o desenho.
- **D-H036-2 (mudança e pedido já publicado).** A descoberta de H-023 compara com a base vigente no momento da consulta. Sem registro próprio, um pedido publicado mudaria de visibilidade quando o profissional muda a base, o que contraria "só para pedidos novos". **Recomendação:** guardar o histórico de base e raio com "vigente desde", e cada pedido usa a configuração vigente na publicação. O histórico já é previsto em 09 (auditoria). **Alternativa:** a mudança vale já para a descoberta de pedidos abertos, e "só para novos" fica restrito à participação (AMB-15 A). Mais simples, mas contraria o critério. Destrava o desenho de #36 (Architect). Não bloqueia o cadastro.
- **D-H036-3 (limite de taxa de mudança).** **Recomendação:** [PROPOSTA] até 3 mudanças de base ou raio a cada 24 h por profissional, com valor em `app_config`. Serviços ficam fora desse limite e seguem o limite geral de escrita. **Alternativa:** limite semanal. Não bloqueia.
- **D-H036-4 (unidade do raio).** **Recomendação:** km inteiros de 5 a 100 na tela, gravados em metros. **Alternativa:** aceitar meio km. Mais preciso, sem ganho para o produto. Não bloqueia.
- **D-H036-5 (texto do endereço).** O texto completo do endereço fica privado para o profissional e para o sistema, e nunca sai desse círculo. **Recomendação:** guardar o texto escolhido, para o profissional conferir a própria base. **Alternativa:** guardar só bairro, cidade e UF, o que reduz dado pessoal, mas o profissional não confere o que cadastrou. Não bloqueia.
- **D-H036-6 (edição em status suspenso ou revogado).** **Recomendação:** edição permitida em qualquer status, exceto suspenso, que recusa a alteração. Em nenhum status a edição gera elegibilidade. **Alternativa:** permitir em todos os status. Não bloqueia.
- **D-H036-7 (serviço regulamentado).** **Recomendação:** permitir declarar serviço REG (presencial ou online) no cadastro; o alcance nacional de online regulamentado fica para L4 (D-H023-6), e a certificação é de H-038. **Alternativa:** bloquear a declaração de REG até H-038. Não bloqueia.
- **D-H036-8 (chamada real a Mapbox).** **Recomendação:** os testes de H-036 usam a porta simulada, como em #34. A chamada real fica para a validação final, depois que BLQ-EXEC estiver registrado pelo líder. **Alternativa:** chamada real em teste, o que consome cota paga e viola a regra de testes sem custo. Não bloqueia o DEV.

**Observação de registro (não é pergunta ao usuário):** em `11-DECISOES.md` existem duas decisões com número 56 (linhas 210 e 212: duplicidade e fotos em quarentena). Recomendo que o líder renumere a segunda antes de citar a 56 em novos documentos. A decisão 56 citada neste refino é a da duplicidade e da cobertura.

## 9. Próximo passo

O líder valida D-H036-1 e D-H036-2, que afetam o esquema do DEV e o desenho de #36. As demais dúvidas seguem para o Architect com as recomendações acima. O cartão #49 permanece em Product Owner até essa validação; a movimentação é do Orquestrador, não deste refino.
