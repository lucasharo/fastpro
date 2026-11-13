# Refino H-033 — Opt-in de telefone e WhatsApp no pedido (Issue #46)

- **Issue:** #46 `[E3] Opt-in de telefone no pedido` · **História:** H-033 · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner.
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-13.
- **EXEC-ID:** não atribuído.
- **Natureza:** somente documento. Nenhum código, migração, teste, consulta ao banco ou alteração no quadro. O cartão permanece em Product Owner até o líder decidir a movimentação.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com fonte · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada · `[PENDENTE JURÍDICO]` depende de parecer.

---

## 0. Fontes e limitações

Fontes lidas: `21-ISSUES-CRIADAS.md` (H-033 = #46), `quadro-status.md` (atualizado em 2026-11-13 12:30 UTC), `14-BACKLOG.md` (linha H-033 e referências a H-025, H-031 e H-032), `04-PRD.md` (RF-012, RF-016, RF-017, RF-025a, RF-070, RF-077, RF-101, RF-110, RF-120, RF-136 a RF-139, FA-030), `05-CRITERIOS-ACEITE.md` (FA-021 e FA-030), `07-AMBIGUIDADES.md` (AMB-17), `08-ARQUITETURA.md` (§4.3, tabela de dados da §7 e classes de retenção, RC-03), `09-MODELO-DADOS.md` (§3.5, §3.7 e §3.8), `11-DECISOES.md` (linha 30 sobre AMB-17; Rodadas 89, 90 e 92; decisões 404 a 426), `113-REFINO-H045.md` (formato), `126-REFINO-H032.md` (tabela de dependências, RN-03, RN-05) e `127-DESENHO-H032.md` (corpo do profissional, RN-10, T-03, perguntas 412 a 416).

Limitações:
- `[NÃO VERIFICADO]` O texto da Issue #46 no GitHub não foi lido nesta rodada. O líder deve conferir o texto antes da Arquitetura.
- `[NÃO VERIFICADO]` Nenhum teste, migração ou consulta ao banco foi executado. O estado real de `service_request` no banco de desenvolvimento não foi conferido.
- As perguntas 427 a 446 são novas. A decisão 416 foi lida na Rodada 90 (linha 795 de `11-DECISOES.md`).

---

## 1. Verificação de fila e dependências reais

- `[VERIFICADO]` Quadro: #46 está em "Product Owner (2)", junto com #51. A coluna está correta para esta etapa. A fila de "Aguardando aprovação" está vazia.
- `[VERIFICADO]` **#38 (H-025)**: Concluído. É a dependência declarada na linha H-033 do backlog. Sem bloqueio.
- `[VERIFICADO]` **#44 (H-031)**: Concluído. Citada na Rodada 92 como pré-requisito. A linha H-033 do backlog não a declara (ver ambiguidade A2). Sem bloqueio.
- `[VERIFICADO]` **#45 (H-032)**: em Desenvolvimento. A tabela de dependências de `126-REFINO-H032.md` (linha 37) diz que H-033 "não é dependência" de H-032 e que a #46 acrescenta `phone_*` por expansão. A Rodada 92 diz que a #46 depende da #45 "para a regra de visibilidade". Logo, a #45 não espera a #46, mas as duas mexem na mesma superfície (ver §8).
- `[VERIFICADO]` Limite de Issues ativas: Desenvolvimento tem #45 e #37; Code Review tem #52. São três ativas. A #46 seria a quarta.

**Pergunta do líder: o Desenvolvimento da #46 pode começar?** **Não, ainda.** Dois motivos:
1. A ordem de colunas exige Arquitetura antes de Desenvolvimento. A #46 está em Product Owner.
2. A #46 altera `service_request` (coluna `phone_enc`, `09` §3.5), a leitura do profissional e a rota de revelação. Essa superfície é a mesma que a #45 está alterando agora. Pela regra da fábrica, Issues em paralelo não podem ter arquivo em comum.

`[PROPOSTA]` A Arquitetura da #46 pode começar depois que o líder adotar este refino. O Desenvolvimento só começa depois que a #45 sair de Desenvolvimento (Aguardando aprovação ou concluída) e a Arquitetura confirmar os arquivos em comum.

---

## 2. Objetivo

Dar ao cliente que informou telefone um controle explícito, desmarcado por padrão, para liberar telefone e WhatsApp aos profissionais que aceitarem o pedido. O consentimento pode ser revogado para o futuro. O telefone nunca é revelado antes do aceite, e o e-mail do cliente nunca é revelado (RF-137, FA-030).

Resultado de negócio: o profissional só fala com o cliente fora da plataforma se o cliente quiser. O fluxo de fotos extras pelo WhatsApp (RF-025a) também depende desse consentimento.

---

## 3. Escopo (dentro de H-033)

1. Checkbox de liberação no formulário do pedido (RF-016), exibido só quando o cliente informou telefone, desmarcado por padrão.
2. Campo `phone_enc` (cifrado) em `service_request`, por expansão, a partir do telefone opcional de RF-012 (`09` §3.5).
3. Registro `contact_consent` (`09` §3.8) com escopo `todos_participantes` (opt-in do pedido) ou `profissional` (liberação individual, AMB-17 C).
4. Revelação por endpoint próprio e separado, só para participante com aceite ativo e consentimento ativo (`08` §7).
5. Registro de revelação em `contact_reveal_log` (`09` §3.8), sem gravar o valor do telefone.
6. Revogação geral e revogação individual, para o futuro (RF-017, AMB-17 C).
7. Republicação: consentimento nunca copiado, checkbox desmarcado (RF-017, FA-021).
8. Liberação individual no chat, só com aceite ativo (RF-138, FA-030).
9. Telefone ausente de listas, detalhe de profissional, e-mails, mensagens automáticas e logs (RF-120, `127` RN-10, I-16).

## 4. Fora de escopo

- Endereço completo e `address_share` (RF-139). Ficam com H-032 (#45) e com a trilha de revelação de H-112 (#121), conforme a ambiguidade A1.
- Envio de e-mail sobre opt-in ou revogação. Nenhum aviso por e-mail nesta história (a Resend segue sem envio em desenvolvimento).
- Mensagem automática do aceite (#136) e notificações (#105 a #109). O telefone não entra nelas.
- Fotos extras pelo WhatsApp (RF-025a). Esse fluxo consulta o consentimento, mas não é entregue aqui.
- Contato real por WhatsApp ou SMS (RF-121).
- Retenção e expurgo do telefone após o fim do pedido (RC-03). Dependem de parecer jurídico (pergunta 446).
- Leitura do telefone pelo admin, salvo caso autorizado (pergunta 441).

---

## 5. Regras

| Ref. | Regra | Fonte | Situação |
|---|---|---|---|
| R1 | Consentimento explícito: a caixa começa desmarcada. Não é pré-marcada. Aceitar os termos de uso não conta como consentimento. Enviar o formulário sem marcar não cria consentimento. | RF-016; FA-030; `[PROPOSTA]` para a parte de termos | `[DECIDIDO]` padrão; `[PROPOSTA]` termos |
| R2 | Quem recebe: participante com aceite ativo no pedido (escopo `todos_participantes`) ou profissional liberado por nome (escopo `profissional`). Elegível que não aceitou não recebe. | RF-016, RF-017, RF-138 | `[DECIDIDO]`; quem recebe em pergunta 427 |
| R3 | Quando: só depois do aceite ativo, nunca antes. Não aparece na descoberta, no detalhe antes do aceite, em seleção de quem não aceitou nem em notificação. | FA-030; `127` RN-02 | `[DECIDIDO]` |
| R4 | Como: por ação explícita do profissional ("ver telefone"), que chama um endpoint próprio. O telefone não vem no carregamento da página nem nas listas. | `08` §7 (endpoint de revelação separado) | `[PROPOSTA]` a forma da ação |
| R5 | Escopo: o consentimento vale só para o pedido em que foi dado. Republicação não copia (RF-017, FA-021). | RF-017; FA-021 | `[DECIDIDO]` |
| R6 | Revogação: vale para o futuro. Efeito na próxima leitura. O registro não é apagado: grava-se `revoked_at`. Cópia já salva fora da plataforma é irrevogável, e isso é informado ao cliente. | RF-017; `09` §3.8 | `[DECIDIDO]` |
| R7 | Liberação individual: só com aceite ativo, porque o chat só existe a partir do aceite (`09` §3.7). Cliente que não marcou no pedido pode liberar um profissional aceito pelo chat. | AMB-17 C; RF-138; `09` §3.7 | `[PROPOSTA]` |
| R8 | Liberar e revogar exigem autenticação recente (30 min). Sem ela, a resposta é 401 com `step_up_required`. | `08` (ações sensíveis com autenticação recente) | `[PROPOSTA]` (pergunta 433) |
| R9 | Telefone alterado ou apagado depois da liberação desfaz as liberações ativas do pedido. Um número novo não é liberado sem nova marcação. | `[PROPOSTA]` | pergunta 434 |
| R10 | Cada revelação gera uma linha em `contact_reveal_log` (profissional, pedido, instante, tipo), sem o número. | `09` §3.8 ("cada revelação") | `[PROPOSTA]` granularidade na pergunta 439 |
| R11 | Cifra: `phone_enc` cifrado na aplicação, com chave versionada. Nunca em claro em tabela, view, log, cache ou resposta de lista. A resposta de revelação não é armazenada em cache (`no-store`). | `08` §7 ("Enc") | `[DECIDIDO]` cifra; `[PROPOSTA]` cabeçalho; chave na pergunta 438 |
| R12 | Falha fechada: se a chave não estiver disponível, a revelação é recusada e o telefone não aparece. | Rodada 92 (padrão da #45: "sem a chave a rota fecha") | `[PROPOSTA]` |
| R13 | Fim do pedido: após conclusão, cancelamento ou expiração, a revelação é negada. | `08` (classes de retenção, RC-03) | `[PROPOSTA]` (pergunta 430) |
| R14 | Telefone não aparece em listas, detalhe do profissional (lista fechada, `127` RN-10), e-mails, mensagens automáticas (o corpo de evento não leva dados pessoais, `08`), logs (lista de campos permitidos) nem na descrição livre sem aviso (decisão 412). | RF-120; I-16; `127` RN-10 | `[DECIDIDO]` |
| R15 | Formato: DDD mais 8 ou 9 dígitos, guardado no formato internacional (+55). Telefone e WhatsApp são o mesmo número. | `[PROPOSTA]` | perguntas 435 e 437 |

---

## 6. Estados e fluxos

### 6.1 Estados do telefone no pedido

- **Sem telefone:** o checkbox não aparece. Nenhum consentimento pode ser criado (FA-030).
- **Telefone informado, sem consentimento:** estado padrão. Ninguém vê o telefone.
- **Consentimento ativo (`todos_participantes`):** participantes com aceite ativo podem revelar.
- **Consentimento revogado:** `revoked_at` preenchido. Revelações futuras são negadas.
- **Liberação individual (`profissional`):** ativa ou revogada, de forma independente para cada profissional.
- **Telefone alterado ou apagado:** liberações ativas são desfeitas (R9).

### 6.2 Estados da participação (condicionam a revelação)

- **Elegível, não aceitou:** sem telefone (FA-030, RF-016).
- **Aceite ativo, com consentimento ativo:** pode revelar.
- **Aceite ativo, sem consentimento:** não pode revelar.
- **Retirado (RF-077) ou removido por segurança:** sem telefone (pergunta 429).
- **Selecionado, ou seleção trocada:** o telefone segue enquanto o aceite estiver ativo (pergunta 428).
- **Pedido concluído, cancelado ou expirado:** sem telefone (pergunta 430).

### 6.3 Fluxos

- **F1 Formulário:** cliente informa telefone, o checkbox aparece, o cliente marca ou não. A revisão diz "será liberado aos profissionais que aceitarem" ou "não será compartilhado". O envio cria `contact_consent` ativo com `text_version`.
- **F2 Aceite e revelação:** profissional aceita. Por ação explícita ("ver telefone"), a API confere aceite ativo e consentimento ativo, registra a revelação e responde com o telefone.
- **F3 Revogação:** o cliente, em "meu pedido", revoga tudo ou por profissional. Pede autenticação recente, grava `revoked_at` e mostra o aviso sobre cópia salva.
- **F4 Liberação individual:** no chat, o cliente que não marcou libera um profissional aceito.
- **F5 Republicação:** o novo pedido vem com checkbox desmarcado e nenhum consentimento copiado. O telefone pode vir preenchido (pergunta 440).
- **F6 Telefone alterado ou apagado:** desfaz as liberações ativas.

---

## 7. Critérios de aceite (testáveis)

Todos os testes são locais, sem serviço externo, sem SMS, sem WhatsApp real e sem envio de e-mail.

- **CA-01 (padrão desmarcado).** Dado formulário com telefone, quando é exibido, então a caixa está desmarcada. Quando o pedido é enviado sem marcar, então nenhum `contact_consent` ativo é criado. Prova: teste de contrato e teste de banco.
- **CA-02 (sem telefone, sem caixa).** Dado pedido sem telefone, quando o formulário é exibido, então a caixa não aparece. Quando a API recebe consentimento sem telefone, então recusa. Prova: teste de contrato.
- **CA-03 (consentimento registrado).** Dado que a caixa foi marcada, quando o pedido é enviado, então existe `contact_consent` com `kind='telefone'`, `scope='todos_participantes'`, `granted_via='formulario_pedido'`, `text_version` e `granted_at`. O valor armazenado não contém o número em claro. Prova: teste de banco com varredura do valor armazenado.
- **CA-04 (nunca antes do aceite).** Dado elegível que não aceitou, com consentimento ativo, quando pede o telefone em qualquer rota, então recebe negativa uniforme e não vê o número. Prova: teste de contrato em todas as rotas de profissional.
- **CA-05 (revelação ao aceito).** Dado participante com aceite ativo e consentimento ativo, quando usa "ver telefone", então recebe o número e uma linha nova é criada em `contact_reveal_log`. Prova: teste de contrato e teste de banco.
- **CA-06 (sem consentimento, mesmo aceito).** Dado participante com aceite ativo e sem consentimento, quando pede o telefone, então é negado. Prova: teste de contrato.
- **CA-07 (outros pedidos e admin).** Dado profissional de outro pedido, ou admin sem caso autorizado, quando pede o telefone, então é negado. Prova: teste de contrato.
- **CA-08 (retirada e remoção).** Dado aceite retirado (RF-077) ou removido por segurança, quando pede o telefone, então é negado. O histórico de revelações anteriores permanece. Prova: teste de banco.
- **CA-09 (revogação para o futuro).** Dado consentimento ativo, quando o cliente revoga, então `revoked_at` é preenchido, a próxima revelação é negada e as revelações anteriores permanecem no registro. O aviso sobre cópia salva é exibido. Prova: teste de contrato e teste de banco.
- **CA-10 (revogação individual).** Dado duas liberações individuais, quando o cliente revoga uma, então a outra permanece ativa. Prova: teste de banco.
- **CA-11 (liberação individual no chat).** Dado cliente que não marcou no pedido, quando libera um profissional com aceite ativo pelo chat, então `contact_consent` com escopo `profissional` é criado. Antes do aceite, a liberação é recusada. Prova: teste de contrato.
- **CA-12 (republicação).** Dado pedido original com consentimento ativo, quando é republicado, então o novo pedido nasce com caixa desmarcada e nenhum consentimento copiado. Prova: teste de banco.
- **CA-13 (troca ou remoção do telefone).** Dado consentimento ativo, quando o cliente altera ou apaga o telefone, então as liberações ativas são desfeitas e o número novo não é liberado. Prova: teste de banco.
- **CA-14 (sem telefone em superfícies).** Telefone não aparece em listas, detalhe do profissional, e-mails, mensagens automáticas, respostas de erro ou logs. Prova: varredura de padrões de telefone brasileiro no corpo e nos logs de teste (T-03).
- **CA-15 (fim do pedido).** Dado pedido concluído, cancelado ou expirado, quando um participante pede o telefone, então é negado. Prova: teste de banco com relógio controlado.
- **CA-16 (cifra e falha fechada).** Dado `phone_enc`, quando lido direto do banco, então não contém o número em claro. Dado que a chave não está disponível, quando a revelação é pedida, então é recusada. Prova: teste de banco e teste de contrato.
- **CA-17 (autenticação recente).** Dado sessão sem autenticação recente, quando tenta liberar ou revogar, então recebe 401 com `step_up_required`. Prova: teste de contrato.
- **CA-18 (execução local).** Os testes rodam localmente, sem conta externa, sem chave de serviço e sem rede externa. A evidência é o resultado local registrado na Issue (comando, contagem e código de saída). Prova: linha de execução na Issue.

---

## 8. Dependências, superfície comum e concorrência

| Item | Situação real | Efeito sobre #46 |
|---|---|---|
| #38 (H-025) | Concluído | Dependência declarada. Sem bloqueio. |
| #44 (H-031) | Concluído | Pré-requisito citado na Rodada 92. Sem bloqueio. |
| #45 (H-032) | Em Desenvolvimento | Mesma superfície: `service_request`, leitura do profissional e rota de detalhe (`127` RN-10). O Desenvolvimento da #46 espera a #45 sair de Desenvolvimento. |
| #37 (H-024) e #52 (H-039) | Em Desenvolvimento e Code Review | Sem superfície comum conhecida. Não bloqueiam. |
| H-112 (#121) | Backlog | Lista `contact_consent` e `contact_reveal_log` como dela também. Ver ambiguidade A1. |

Consequência: a #46 pode avançar pela Arquitetura, mas o Desenvolvimento só começa depois da #45.

---

## 9. Riscos (LGPD e segurança)

- **R-L1. Telefone visível sem consentimento.** Dado pessoal de classe C3 (`08` §7). Mitigação: falha fechada (R12), negativa uniforme (CA-04, CA-06, CA-07) e varredura (CA-14).
- **R-L2. Consentimento sem prova.** Sem `text_version` e `granted_at`, não é possível provar o que o cliente aceitou. Mitigação: CA-03 e registro de texto versionado.
- **R-L3. Cópia salva fora da plataforma.** Não pode ser revogada. Mitigação: aviso ao cliente (RF-017, R6). Não é mitigável tecnicamente.
- **R-L4. Retenção do telefone após o fim do pedido.** A classe RC-03 está `[PENDENTE JURÍDICO]` (L1). Até o parecer, o desenvolvimento corta o acesso (CA-15), mas não apaga o dado. Mitigação: pergunta 446.
- **R-L5. Base legal do consentimento e texto.** O texto de consentimento (`text_version`) ainda não foi escrito nem revisado. Mitigação: pergunta 443. `[PENDENTE JURÍDICO]` antes de produção.
- **R-L6. Telefone em descrição livre.** O cliente pode digitar telefone na descrição, que o profissional lê. Mitigação: decisão 412 (aviso e bloqueio de padrões óbvios), já adotada.
- **R-L7. Herança indevida na republicação.** Mitigação: CA-12.
- **R-S1. Chave de cifra.** Sem a chave, o telefone fica ilegível. Mitigação: chave própria e versionada (pergunta 438), sem valor no repositório.
- **R-S2. Conflito com a #45.** Mesma superfície de dados. Mitigação: §8 (Desenvolvimento espera a #45).

---

## 10. Ambiguidades

- **A1. Dono de `contact_consent` e `contact_reveal_log`.** A linha H-033 do backlog cria o opt-in. A linha H-112 (#121) também lista `contact_consent` e `contact_reveal_log`, e a rastreabilidade (`15-RASTREABILIDADE`) liga RF-016 e RF-138 às duas histórias. `[PROPOSTA]` H-033 cria as tabelas e a revelação de telefone. H-112 estende para endereço (`address_share`). Ver pergunta 439.
- **A2. Pré-requisito #44.** A Rodada 92 cita #44, mas a linha H-033 do backlog declara só H-025 (#38). Ambas estão concluídas, então não há bloqueio. `[PROPOSTA]` registrar #44 na linha H-033 do backlog.
- **A3. Quem vê o telefone depois da seleção.** O texto de RF-016 diz "aos profissionais participantes", e FA-030 diz "dentro daquela participação". A regra de seleção não diz o que acontece com o telefone de quem perdeu a seleção. Ver pergunta 428.
- **A4. Granularidade já decidida.** AMB-17 = C (opt-in geral no pedido, com liberação individual e revogação), registrado em `11-DECISOES.md` linha 30. Não é pergunta nova.
- **A5. Texto do consentimento.** Não existe texto aprovado. Ver pergunta 443.

---

## 11. Perguntas ao líder (numeração 427 a 446)

Lista única, numerada a partir de 427, sem envio direto ao usuário. Cada item traz a recomendação do PO e a decisão que destrava. A pergunta 446 é a única de natureza jurídica (LGPD) e deve ser levada ao usuário depois de consultar os registros.

**427. Quem recebe o telefone.**
- (a) Todos os participantes com aceite ativo (escopo `todos_participantes`).
- (b) Só o profissional selecionado.
- (c) Só quem o cliente liberar por nome.
- **Recomendação:** (a), que segue o texto de RF-016 ("aos profissionais participantes"). Destrava CA-04 e CA-05.

**428. Seleção trocada ou desistida.** O profissional que perdeu a seleção, mas segue com aceite ativo, continua vendo o telefone?
- (a) Sim, enquanto o aceite estiver ativo.
- (b) Não, corta na troca.
- **Recomendação:** (a), porque FA-030 vincula o acesso à participação, não à seleção. Destrava R3 e §6.2.

**429. Retirada do aceite ou remoção por segurança.** Corta o acesso ao telefone imediatamente?
- (a) Sim, na próxima leitura, preservando o histórico de revelações.
- (b) Não, mantém até o fim do pedido.
- **Recomendação:** (a). Destrava CA-08.

**430. Fim do pedido.** Conclusão, cancelamento ou expiração encerram o acesso no mesmo instante?
- (a) Sim, sem prazo extra.
- (b) Sim, com prazo de 72 h.
- **Recomendação:** (a), para não criar regra de carência que não existe em FA-030. Destrava CA-15. Liga-se à pergunta 446.

**431. Revogação geral.** Revogar o opt-in do pedido também derruba as liberações individuais?
- (a) Sim, revoga todas as liberações ativas do pedido.
- (b) Não, cada liberação individual segue separada.
- **Recomendação:** (a), porque o cliente, ao revogar tudo, espera que nada mais seja visto. Destrava CA-09.

**432. Revogação individual.** O cliente pode revogar a liberação de um profissional pelo chat?
- (a) Sim, com o mesmo efeito para o futuro.
- (b) Não, só revogação geral.
- **Recomendação:** (a), que é a granularidade de AMB-17 C. Destrava CA-10.

**433. Autenticação recente para liberar e revogar.**
- (a) Exigir autenticação recente de 30 min para liberar e revogar, como prevê `08` para ações sensíveis.
- (b) Exigir só para revogar.
- **Recomendação:** (a), que segue a arquitetura já escrita em `08`. Destrava R8 e CA-17.

**434. Telefone alterado ou apagado depois da liberação.** Desfaz as liberações ativas?
- (a) Sim, e o número novo não é liberado sem nova marcação.
- (b) Não, a liberação segue para o número novo.
- **Recomendação:** (a), porque o cliente autorizou um número, não uma pessoa. Destrava R9 e CA-13.

**435. Telefone e WhatsApp.** São um número só ou dois campos?
- (a) Um número só, usado para telefone e WhatsApp.
- (b) Dois campos separados.
- **Recomendação:** (a), por simplicidade e porque o cliente informa um contato só (RF-012). Destrava R15 e o desenho de `phone_enc`.

**436. Caixa sem telefone.**
- (a) Não aparece.
- (b) Aparece desabilitada, com aviso.
- **Recomendação:** (a), que segue FA-030 ("não é exibido ou fica inativo", a escolha pela primeira). Destrava CA-02.

**437. Formato do telefone.**
- (a) DDD mais 8 ou 9 dígitos, guardado como +55.
- (b) Qualquer texto, sem validação.
- **Recomendação:** (a), porque o número precisa ser comparável e usável. Destrava R15.

**438. Chave de cifra do telefone.**
- (a) Chave própria, `PHONE_ENC_KEY`, com nome no `.env.example`, sem valor no repositório.
- (b) Reusar a chave do endereço (`ADDRESS_ENC_KEY`).
- **Recomendação:** (a), para separar as finalidades e permitir rotação sem afetar o endereço. Valor só no `.env.local` de desenvolvimento, fora do Git. Destrava R11 e CA-16.

**439. Dono e granularidade do registro de revelação.**
- (a) H-033 cria `contact_consent` e `contact_reveal_log` para o telefone, e H-112 estende para endereço. Cada leitura gera uma linha.
- (b) H-112 cria as tabelas; H-033 só usa. A leitura gera uma linha por participação, não por leitura.
- **Recomendação:** (a) quanto ao dono, porque o telefone precisa das tabelas para ser revelado. Quanto à granularidade, cada leitura, como manda `09` §3.8. Destrava A1 e R10.

**440. Telefone na republicação.**
- (a) Vem preenchido do original, com caixa desmarcada.
- (b) Vem em branco.
- **Recomendação:** (a), para o cliente não digitar de novo. Consentimento nunca vem junto (FA-021). Destrava F5.

**441. Admin e telefone.**
- (a) Admin vê o telefone só com caso autorizado e justificativa, com registro.
- (b) Admin nunca vê.
- **Recomendação:** (a), pelo mesmo critério de endereço da decisão 415. Destrava CA-07.

**442. Limite de leituras do telefone.**
- (a) Sim, com limite definido pela Arquitetura, como proteção contra raspagem.
- (b) Não, sem limite no MVP.
- **Recomendação:** (a), com o número definido na Arquitetura `[PROPOSTA]`. Destrava o desenho da rota de revelação.

**443. Texto do consentimento.**
- (a) Adotar o texto proposto agora como versão 1 para desenvolvimento, e revisar com o jurídico antes de produção.
- (b) Aguardar revisão jurídica antes de qualquer teste.
- **Recomendação:** (a), porque nada vai a produção nesta fase. O texto proposto: "Autorizo o FastPro a mostrar meu telefone/WhatsApp aos profissionais que aceitarem este pedido. Posso revogar quando quiser. Cópias já salvas fora da plataforma não podem ser apagadas." `[PROPOSTA]` Destrava CA-03 (`text_version`). `[PENDENTE JURÍDICO]` antes de produção.

**444. Aviso ao profissional quando o cliente revoga.**
- (a) Não avisar (sem e-mail nem notificação).
- (b) Avisar por notificação interna.
- **Recomendação:** (a), para não criar nova notificação sobre dado pessoal nesta história. Destrava CA-09.

**445. Fotos extras pelo WhatsApp.** O cliente que não marcou no pedido pode liberar depois só para receber fotos?
- (a) Sim, pelo mesmo fluxo de liberação individual (R7).
- (b) Não, fotos extras só com opt-in do pedido.
- **Recomendação:** (a), que segue RF-025a e AMB-17 C. Destrava a integração com o fluxo de fotos.

**446. Retenção e expurgo do telefone (LGPD, para o usuário).** Quanto tempo o telefone e o registro de revelação ficam guardados depois do fim do pedido? A classe RC-03 está `[PENDENTE JURÍDICO]` (L1).
- (a) Apagar o telefone ao fim do pedido e manter o registro mínimo de revelação, pelo prazo que o jurídico definir.
- (b) Manter o telefone até parecer jurídico.
- **Recomendação:** o desenvolvimento segue com corte de acesso (CA-15) e cifra (CA-16). A exclusão e o prazo de retenção ficam para o parecer jurídico. Destrava a exclusão automática de RC-03. Não bloqueia o desenvolvimento. `[PENDENTE JURÍDICO]` Confirmação do usuário necessária.

---

## 12. Próximos passos

1. O líder confere o texto da Issue #46 no GitHub (não lido nesta rodada).
2. O líder adota ou veta as perguntas 427 a 446 e registra as decisões em `docs/factory/11-DECISOES.md` com os mesmos números. Itens adotados como recomendação entram como "adotada pelo líder".
3. Atualizar este refino com as respostas.
4. A #46 permanece em Product Owner. Só move para Arquitetura depois de confirmar a coluna no quadro. O líder decide.
5. Arquitetura desenha `phone_enc`, `contact_consent`, `contact_reveal_log`, a rota de revelação e os testes. O Desenvolvimento só começa depois que a #45 sair de Desenvolvimento.
6. `[PROPOSTA]` Registrar #44 como pré-requisito na linha H-033 do `14-BACKLOG.md` (ambiguidade A2).
