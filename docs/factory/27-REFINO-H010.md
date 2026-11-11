# Refino H-010 — Keep-alive e backup manual (Issue #23, WF-03, Product Owner)

- **Rastro:** Issue #23 `[E0] Keep-alive e backup manual` (21-ISSUES-CRIADAS, linha H-010; 16-MANIFESTO item 21); 14-BACKLOG H-010 e H-119; 12-TODO item 1; 08-ARQUITETURA §16.2 (D) e §16.7, §17; 10-ADRS ADR-020 (linha Supabase projeto inativo; §20.3, H3); 11-ARQ-RISCOS-E-TESTES R-08, R-32, D-01; 17-CHECKLIST-REVISAO B-44; 24-DESENHO-H008 (D e CRON_SECRET); spikes/S-02-RESULTADO (nomes de variáveis, sem valores); spikes/S-10-RESULTADO (keep-alive independente, S10-2); 26-REFINO-S08 (CA-S08-02b).
- **Natureza:** SOMENTE documento. Nenhum código, conta, projeto, chave, branch, PR ou Project foi criado ou alterado. Nenhum export, restauração ou chamada ao banco foi executado neste refino.
- **EXEC-ID:** não atribuído. Esta sessão não tem ferramenta de shell; não há execução a registrar.
- **Etiquetas:** `[APROVADO]` decisão do usuário (H3) · `[DELEGADO]` adotado por delegação · `[PROPOSTA]` proposta deste refino · `[NÃO VERIFICADO]` fato sem fonte oficial lida nesta sessão.
- **Status:** rascunho para validação do Orquestrador (líder). Não movimenta Project. Não é decisão de CONCLUIR.

---

## 0. Contexto e premissas

| Premissa | Origem | Estado |
|---|---|---|
| Supabase Free pausa o projeto após 1 semana sem atividade | 08 §16.7; ADR-020; 26 (CA-S08-02b, herdado do doc 13) | VERIFICADO (herdado; reconfirmação pelo S-08) |
| Supabase Free não tem backup; backup diário só no Pro | 08 §16.7; ADR-020 | VERIFICADO (herdado) |
| Keep-alive diário e backup manual periódico são a mitigação aceita (H3) | 10-ADRS ADR-020; 08 §16.7 | [APROVADO] (H3) |
| Periodicidade do backup: **semanal e antes de migração destrutiva** | BK-7 (b); 12-TODO #1; 19-PLANO-TECNICO-DEV §4 | [DELEGADO] pela recomendação do Architect. Ver Q2 |
| Nesta história só há dados sintéticos | H-010 (critério de aceite) | [APROVADO] |
| Migração destrutiva = DROP, TRUNCATE ou ALTER com perda de dado, fora do padrão expand/contract | 17-CHECKLIST B-44 | [PROPOSTA] (definição usada aqui) |
| Vercel Hobby: cron de no máximo 1 execução por dia, precisão ±59 min | 08 §16.2; 26 (CA-S08-01d, herdado) | VERIFICADO (herdado) |
| O keep-alive não pode depender do tick (pg_cron, H-008) | 24-DESENHO-H008; S-10 (S10-2) | [PROPOSTA] |

Nota: a periodicidade semanal implica RPO de até 7 dias (08 §17). Isso é aceito pelo H3 e precisa constar do procedimento.

---

## 1. Critérios de aceite — backup manual do banco de desenvolvimento

Escopo: **exportação do esquema e dos dados** do banco de desenvolvimento, com verificação de integridade, retenção local e cifragem.

- **BK-01 Exportação completa [PROPOSTA].** Dado o banco de desenvolvimento com as migrações aplicadas e apenas dados sintéticos, quando o operador executa o procedimento escrito, então é gerado artefato cifrado que contém o esquema (tabelas, funções, políticas RLS, extensões) e os dados das tabelas de domínio. O procedimento declara explicitamente quais schemas da plataforma entram e quais ficam de fora, e o manifesto registra essa lista.

- **BK-02 Verificação de integridade [PROPOSTA].** Dado o artefato gerado, quando a verificação roda, então:
  - (a) o hash SHA-256 do artefato cifrado é calculado e registrado no manifesto;
  - (b) o artefato é decifrado em área temporária fora do repositório e o hash do texto claro confere com o registrado na exportação;
  - (c) a listagem do conteúdo contém todas as tabelas de domínio presentes nas migrações;
  - (d) a contagem de linhas por tabela, capturada no momento da exportação, bate com a contagem do conteúdo exportado.

  A restauração completa e os monitores de invariantes I-xx **não** fazem parte deste critério (ver §3, H-119).

- **BK-03 Falha não vira backup [PROPOSTA].** Dado que a exportação ou a verificação falha em qualquer etapa, quando o procedimento termina, então o artefato da execução é removido ou marcado como inválido, o registro mostra a etapa e a data da falha, e **nenhum backup válido anterior é sobrescrito**. A última exportação válida continua sendo a referência. Repetições seguem o limite de 3 tentativas técnicas (AGENTS, item 6).

- **BK-04 Cifragem e chave [PROPOSTA].** Dado o artefato gravado, quando é inspecionado, então está cifrado com chave que não está no repositório, não está no próprio artefato e não aparece no manifesto. O manifesto registra apenas o **nome** e a localização lógica da chave, nunca o valor. Sem a chave, o artefato não é legível (teste negativo de decifragem).

- **BK-05 Retenção local fora do repositório [PROPOSTA].** Dado o destino de gravação, quando o procedimento inicia, então **recusa** caminho dentro da árvore do repositório `D:\projetos\fastpro` ou de qualquer caminho versionado. Dado que já existem exportações válidas, quando uma nova exportação válida é feita, então nenhuma exportação antiga é apagada automaticamente; apagar exige ação explícita do operador (AGENTS, item 5). A quantidade retida é a Q3.

- **BK-06 Nada de segredo em arquivo versionado [APROVADO: regra AGENTS item 9 e B-39; PROPOSTA: forma de verificação].** Dado qualquer arquivo versionado (procedimento, scripts, exemplos), quando varrido após a execução, então não contém string de conexão, senha, chave, token, identificador de projeto ou valor de variável de ambiente. O procedimento cita apenas **nomes** de variáveis (ex.: `DATABASE_URL_MIGRATIONS`, já citada no S-02). O manifesto de execução e os logs ficam **fora** do repositório. A varredura de segredos do H-004 cobre o caso.

- **BK-07 Periodicidade [DELEGADO; ver Q2].** Dado a periodicidade semanal, quando passam 7 dias desde a última exportação válida, então o registro exibe "vencido" e o operador executa nova exportação. Esta história não cria alerta automático (automação é a opção (c) de BK-7, fora de escopo).

- **BK-08 Antes de migração destrutiva [DELEGADO; PROPOSTA de verificação].** Dado uma migração classificada como destrutiva, quando o operador vai aplicá-la, então antes da aplicação existe exportação válida posterior à última alteração de esquema, registrada no manifesto. Sem ela, a migração não é aplicada.

- **BK-09 Alvo restrito [PROPOSTA].** Dado o procedimento, quando configurado, então só exporta o projeto de **desenvolvimento** registrado. Qualquer outro alvo é recusado. Exportação de dado real está fora desta história (§3).

- **BK-10 Procedimento reproduzível [PROPOSTA].** Dado o procedimento escrito, quando um segundo operador ou o DEV, sem conhecimento prévio, o segue, então obtém artefato válido pelos critérios BK-01 a BK-03, sem passo manual não documentado.

---

## 2. Critérios de aceite — keep-alive

Objetivo: manter atividade real no projeto de desenvolvimento **sem criar dados**, para que o projeto gratuito não seja pausado por inatividade.

- **KA-01 Cadência [APROVADO: H3 diário; PROPOSTA: tolerância].** Dado a rotina configurada, quando passam 24 h mais a tolerância de agenda (±59 min no Hobby), então houve pelo menos uma execução registrada. Não há exigência de horário exato.

- **KA-02 Atividade real [PROPOSTA].** Dado uma execução, quando roda, então executa uma consulta de leitura **ao banco** (não apenas ao endpoint) e registra somente: data, hora, resultado (ok ou falha) e etapa, se falhou. Nenhuma credencial, string de conexão ou dado pessoal entra no registro.

- **KA-03 Sem criar dados [PROPOSTA].** Dado uma execução, quando termina, então não há INSERT, UPDATE, DELETE, CREATE nem ALTER. Três evidências:
  - (a) o papel usado não tem privilégio de escrita (consulta de privilégios registrada);
  - (b) antes e depois de N execuções, as contagens de linhas de todas as tabelas e o conjunto de objetos de esquema são idênticos;
  - (c) não existe tabela de heartbeat, nem tabela de log no banco para a rotina.

- **KA-04 Falha visível e sem efeito colateral [PROPOSTA].** Dado que o banco está indisponível, quando a rotina roda, então registra a falha com etapa e data, não grava nada no banco e a falha fica visível ao operador. O canal de alerta está em aberto (Q1). Não há repetição além do limite de 3 tentativas.

- **KA-05 Endpoint protegido [PROPOSTA; mecanismo em Q1].** Dado uma chamada à rota de keep-alive sem o segredo de agendamento (nome da variável `CRON_SECRET`, conforme 24-DESENHO-H008), quando recebida, então responde negação e **não** abre conexão com o banco. A rota é separada da rota de tick (H-008).

- **KA-06 Independente do tick [PROPOSTA].** Dado o tick de jobs (H-008, pg_cron) desativado ou pausado, quando o keep-alive roda, então continua executando. O keep-alive não depende de pg_cron nem de H-008 (S-10, S10-2).

- **KA-07 Efeito observável [PROPOSTA; NÃO VERIFICADO quanto ao efeito].** Dado a rotina rodando diariamente por 7 dias seguidos, quando o status do projeto de desenvolvimento é conferido no painel depois desse período, então o projeto está ativo, não pausado. **Não é verificado que a consulta conta como atividade para o Supabase** (08 §16.2 e 24-DESENHO-H008 presumem que sim; pg_cron presumido como não contando). Se o critério falhar, o caso volta ao Architect e a decisão de plano (ADR-020) é reavaliada.

- **KA-08 Sem dado real [APROVADO: H-010; PROPOSTA: forma].** Dado o projeto de desenvolvimento, quando a rotina roda, então o único dado acessado é o de sistema ou sintético. Nenhum dado de produção ou real é lido, copiado ou exibido.

---

## 3. O que fica fora

- **Restauração completa, monitores I-xx e reconciliação de Storage:** H-119 (D-01, D-02). Aqui só vale a integridade (BK-02).
- **Backup automático, diário ou PITR, e plano Pro:** opção (c) de BK-7, gatilho de upgrade (ADR-020). Só é reavaliado antes de cobrar ou usar dados reais.
- **Backup dos objetos do Storage** (fotos e documentos de verificação): Q4.
- **Exportação de dado real ou de produção:** bloqueada até o gate de lançamento (H-054, M4) e decisão humana.
- **Escolha da ferramenta de exportação e de cifragem:** DEV e Architect. O critério é o resultado (BK-01 a BK-04), não a ferramenta.
- **Alertas automáticos e painel operacional:** H-108. Esta história só registra e torna visível localmente.
- **Rotação de chaves (D-06) e expurgo de backups** (eliminação de dado do titular em cópias de segurança): política `[PENDENTE JURÍDICO]` (L1).
- **Criação de conta, projeto Vercel ou chave:** BLQ-EXEC (SD-14). Ver Q1.
- **Pausa e monitoramento do status no painel como função do produto:** H-108.

---

## 4. Rastreabilidade

| Item | Liga-se a |
|---|---|
| BK-01 a BK-10 | H-010; ADR-020 (H3); R-08; R-32; 12-TODO #1; B-39; B-44 |
| KA-01 a KA-08 | H-010; ADR-020 (H3); R-08; 24-DESENHO-H008; S-10 |
| Verificação de integridade | D-01 (parte de integridade), H-119 (restauração completa) |
| Recuperação (RTO) | 08 §17: RTO ≤ 8 h [PROPOSTA]; medido em H-119, não aqui |

---

## 5. Dúvidas ao Orquestrador (numeração local; o líder consolida na lista única)

**Q1 — BLOQUEANTE para implementar o keep-alive; não bloqueia aprovar este refino.**
- **Problema:** H-010 declara dependência só de H-003. O agendamento recomendado (Vercel Cron, 08 §16.2 item D; 24-DESENHO-H008) exige projeto na Vercel, que é H-009 e depende de BLQ-EXEC.
- **Alternativas:** (a) H-010 passa a depender de H-009 para o keep-alive, e o backup manual segue sem essa dependência; (b) agendador externo gratuito, por exemplo um workflow agendado do CI, que precisa de alcance ao pooler e de limites `[NÃO VERIFICADO]`; (c) execução manual até H-009, com periodicidade de no máximo 5 dias, por margem em relação aos 7 dias de pausa.
- **Recomendação:** separar a entrega. Backup manual avança já. Keep-alive fica em (c) como contingência documentada, com (a) como caminho definitivo.

**Q2 — Não bloqueante. Registro de decisão.**
- **Problema:** H-010 (14-BACKLOG) diz "periodicidade definida pelo usuário"; BK-7 diz "pendente"; 12-TODO #1 diz "a definir". Este refino trata a periodicidade como [DELEGADO] pela recomendação do Architect (semanal e antes de migração destrutiva).
- **Recomendação:** registrar a delegação em `11-DECISOES` com a mesma numeração, para o critério de aceite não ficar em aberto. Revisável pelo usuário.

**Q3 — Não bloqueante.**
- **Pergunta:** quantas exportações válidas manter localmente.
- **Recomendação [PROPOSTA]:** as 4 semanais mais as anteriores a qualquer migração destrutiva, sem apagamento automático (BK-05). Os dados são sintéticos nesta fase.

**Q4 — Não bloqueante.**
- **Pergunta:** o backup de objetos do Storage entra em H-010?
- **Recomendação:** não. Fica fora. Reavaliar antes de dados reais, junto a H-119 (reconciliação de Storage) e 12-TODO #10.

**Q5 — Não bloqueante (decisão de DEV e Architect).**
- **Pergunta:** qual papel de banco usa o keep-alive e a exportação. O S-02 mostra que o papel atual tem `rolbypassrls = true`.
- **Recomendação:** papel de somente leitura para o keep-alive; exportação com papel de leitura. Nenhum uso de `service_role` (08 §4.2).

**Q6 — Não bloqueante. Ajuste de escopo.**
- **Problema:** H-010 cita D-01 como teste, mas D-01 é restauração (11-ARQ §9), e a restauração está em H-119, que é da Onda 5. Um aceite de restauração na Onda 0 não é possível.
- **Recomendação:** H-010 cobre integridade (BK-02). D-01 completo fica em H-119. Ajustar a referência no 14-BACKLOG.

**Q7 — Não bloqueante, mas precisa de decisão do usuário antes de qualquer backup com dado real.**
- **Pergunta:** custódia da chave de cifragem. Chave perdida torna o backup inútil (10-ADRS, risco de backup manual).
- **Recomendação:** a chave não fica no disco de trabalho. Deve haver cópia de custódia fora do disco, sob controle do usuário. Só o nome da chave aparece nos documentos.

---

## 6. Evidências esperadas na Issue #23 (quando o DEV executar)

- Procedimento escrito versionado, sem valores (BK-06), com a lista de schemas incluídos e excluídos.
- Manifesto de uma exportação válida e de uma inválida provocada, fora do repositório (BK-02, BK-03).
- Teste negativo de destino dentro do repositório (BK-05) e de decifragem sem chave (BK-04).
- Registro de execuções do keep-alive, com antes e depois de contagens e privilégios (KA-03).
- Status do projeto conferido após 7 dias de rotina (KA-07). Só esse critério comprova o efeito contra a pausa.

Nada disso foi executado. Este documento não afirma nenhum resultado.

---

## Resumo em linguagem simples

Este documento define o que significa "backup pronto" e "banco sempre ativo" para o banco de desenvolvimento gratuito: uma cópia cifrada, conferida, guardada só no computador do operador, feita toda semana e antes de qualquer mudança destrutiva, e uma rotina diária que só faz uma leitura para o banco não ser pausado. Falta decidir como a rotina diária será agendada antes da Vercel existir (Q1) e confirmar a periodicidade no registro de decisões (Q2); o resto não bloqueia.

---

## Pendência técnica de entrega

Esta sessão não tem ferramenta de shell. Não foi possível executar `git add`, `git commit` com `Refs: #23` e os trailers, nem `git push`. Nada foi commitado nem enviado. Pedido ao Orquestrador: conferir este arquivo e fazer o commit e o push com a ferramenta adequada (sem force push).
