# H-017 — Refino: exclusividade de papéis

- **Issue:** #30 "[E1] Exclusividade de papéis" · **Backlog:** H-017 · **Dependências:** H-016 (cadastro e login do profissional) e H-011 (cadastro e login do cliente), ambas concluídas segundo a instrução do líder · **Destrava:** H-045 (acesso comercial derivado, que usa H-017 como dependência no backlog)
- **Etapa:** specification (WF-03, Product Owner) · **Data:** 2026-11-12 · **Papel:** Product Owner · **Status:** refino para validação do líder, sem decisão de produto tomada
- **Etiquetas:** `[DECIDIDO]` aprovado nos documentos · `[DELEGADO]` decisão delegada, revogável · `[VERIFICADO]` conferido no backlog, PRD ou quadro · `[PROPOSTA]` sugestão deste refino, a validar · `[NÃO VERIFICADO]` depende de documento não lido nesta tentativa ou de ação ainda não feita

**Fontes consultadas nesta tentativa (seis arquivos, por limite de leitura):** `roles/factory-product-owner.md`; `14-BACKLOG.md` (H-016, H-017, H-035, H-036, H-045, linhas de Onda 1, S-01, S-11); `04-PRD.md` (RF-013, RF-016, RF-065 a RF-070, RF-077, RF-080, RF-136 a RF-139 não lidos, tabela de papéis admin); `07-AMBIGUIDADES.md` (AMB-08); `quadro-status.md` (busca por #30 e pelas seções); `98-REFINO-H036.md` (formato). Não foram lidos `08-ARQUITETURA.md`, `09-MODELO-DADOS.md`, `11-ARQ-RISCOS-E-TESTES.md` nem `05-CRITERIOS-ACEITE.md`; as referências a esses documentos vindas do backlog estão marcadas como `[NÃO VERIFICADO]`.

## 1. Objetivo

Garantir, por regra de dados e não só pela tela, que:
1. cada pessoa tem um único identificador de conta (`app_user`), mesmo que tenha perfil de cliente e de profissional;
2. um profissional nunca tem participação (aceite) no próprio pedido, na condição de cliente desse pedido;
3. um administrador não tem perfil de cliente nem de profissional.

Backlog (H-017): "Constraint ou trigger impede profissional aceitar no próprio pedido e admin com perfil de cliente". `[VERIFICADO]` 14-BACKLOG H-017. Risco aceito: "mesma pessoa com dois e-mails (limitação aceita)". `[VERIFICADO]` 14-BACKLOG H-017.

Esta história não entrega a tela de aceite, a seleção, a publicação de pedido nem a tela administrativa. Ela entrega as regras que essas telas e as APIs futuras precisam respeitar.

## 2. Situação de partida

- Papéis do sistema: cliente (login por link mágico, sem senha), profissional (e-mail e senha, verificação obrigatória de e-mail) e admin (com MFA). `[VERIFICADO]` RF-035, RF-045; 04-PRD tabela de papéis ("Admin | Superadmin, Verificação, Moderador, Financeiro, Suporte, Auditor; MFA | [APROVADO]").
- Não existe ainda, no repositório, participação (aceite) nem pedido publicado que a regra possa testar de ponta a ponta. A Onda 2 (pedido, H-025 a H-034) e a Onda 3 (aceite, H-055 a H-073) não estão construídas. `[VERIFICADO]` 14-BACKLOG (tabela de ondas); quadro (#30 aparece antes da seção "Concluído", sem coluna confirmada nesta busca).
- Perfil profissional com CPF/CNPJ cifrado e único por HMAC já existe (H-035). `[VERIFICADO]` 14-BACKLOG H-035 e 98-REFINO-H036 §2.
- O backlog cita I-19, 09 §3.1 e 08 §5.2 como fontes desta regra. `[NÃO VERIFICADO]` nesta tentativa: não li esses documentos. Antes do DEV, o Architect confirma o desenho de tabelas e papéis contra eles.

## 3. Escopo

### 3.1 Identidade única (`app_user`)
- Cada pessoa autenticada tem um único registro `app_user`. Perfis de cliente, de profissional e de admin apontam para esse registro. `[PROPOSTA]` (leitura de "app_user único", H-017); o desenho de tabelas é do Architect.
- Não é possível criar um segundo `app_user` para a mesma identidade de autenticação. `[PROPOSTA]`
- Uma pessoa pode ter perfil de cliente e de profissional no mesmo `app_user`, a confirmar (Q1).

### 3.2 Profissional não participa do próprio pedido
- Regra: se o `app_user` do cliente de um pedido é o mesmo do profissional, a participação (aceite) é recusada. A recusa vale no banco, independentemente da tela ou da API. `[VERIFICADO]` H-017 ("constraint ou trigger"); `[PROPOSTA]` a comparação por identificador de `app_user` (Q3).
- A regra só impede o aceite. Não impede publicar pedido nem ver o próprio pedido. Uma pessoa que é cliente e profissional continua podendo ser profissional em pedidos de outros. `[PROPOSTA]`
- A regra não depende do estado do pedido: vale em pedido aberto, encerrado, selecionado ou cancelado. `[PROPOSTA]` (mais restritivo, a confirmar com Q5 se houver dados antigos).

### 3.3 Administrador sem perfil de cliente ou profissional
- Um `app_user` com papel admin não pode ter perfil de cliente nem de profissional, e o inverso também é recusado. `[VERIFICADO]` H-017 ("admin sem perfil de cliente ou profissional"); `[PROPOSTA]` o sentido inverso (Q2).
- A atribuição do papel admin não pode ser feita pela própria conta. `[PROPOSTA]` (Q4).
- Telas e permissões por papel admin seguem em aberto na AMB-08 (recomendação A, revogável). `[VERIFICADO]` 07-AMBIGUIDADES AMB-08. Esta história não decide a matriz de telas.

### 3.4 Erro e registro
- Quando a regra recusa uma operação, a resposta tem texto fixo que não revela qual regra foi violada nem dados de outra pessoa. `[PROPOSTA]` (Q6).
- Não aparecem nome, e-mail, CPF ou identificador do outro usuário na mensagem nem no log. `[PROPOSTA]` com base em RF-039 (não revelar existência de conta) e RF-013 (localização e identidade privadas).

## 4. Fora de escopo (e por que)

- **Aceite de pedido (botão "Aceitar trabalho", vaga, idempotência):** depende das histórias da Onda 3 (H-055 a H-073, incluindo H-069 para o aceite); ainda não construídas. Esta história só garante a regra que o aceite precisará chamar. `[VERIFICADO]` 14-BACKLOG (onda 3) e RF-069, RF-070.
- **Publicação de pedido pelo cliente:** depende da Onda 2 (H-025 a H-034). Nos testes desta história, o pedido é criado por fixture direta no banco de teste.
- **Seleção, conclusão e cancelamento:** RF-080 a RF-086, depois da Onda 3. A regra de "não participar do próprio pedido" também se aplica à seleção, porque só pode ser selecionado quem aceitou; a implementação da seleção é outra história.
- **Retirada do aceite e "não aceitar de novo":** RF-077. `[VERIFICADO]` 04-PRD. Depende do aceite.
- **Tela administrativa e matriz de papéis:** AMB-08, e a matriz de visibilidade (RF-136 a RF-139, não lidos nesta tentativa).
- **Mesma pessoa com dois e-mails:** limitação aceita. Não há teste de bloqueio para esse caso. `[VERIFICADO]` 14-BACKLOG H-017.
- **Verificação do documento e unicidade por CPF/CNPJ:** H-035 e H-040. Não reutilizada aqui, salvo Q3.

**Dependência explícita:** H-017 não entrega nenhum aceite de pedido. O critério "profissional não aceita o próprio pedido" pode ser testado nesta história apenas no nível do banco, com inserção direta de uma participação. O teste pela API e pela tela só será possível quando a Onda 3 existir. `[PROPOSTA]`

**Dependência de H-102 (RBAC), Onda 1:** o papel admin e a checagem de permissões dependem de H-102, que não foi verificada nesta tentativa. `[NÃO VERIFICADO]`

## 5. Fluxos

**F1 — Pessoa com perfil de cliente e de profissional.**
1. A pessoa tem um `app_user`.
2. Ela cria um pedido como cliente. O pedido é publicado normalmente (regra 3.2 não impede).
3. Ela tenta aceitar o próprio pedido como profissional. A regra recusa.
4. Outro profissional elegível aceita o mesmo pedido. A regra permite.

**F2 — Tentativa de aceite no próprio pedido.**
1. Pedido P tem cliente C (`app_user` U).
2. Profissional com `app_user` U tenta registrar participação em P.
3. O banco recusa; nenhuma participação e nenhuma vaga consumida são gravadas.
4. A API responde com texto fixo (3.4).

**F3 — Admin com perfil indevido.**
1. Um `app_user` com papel admin tenta criar perfil de cliente (ou de profissional).
2. O banco recusa.
3. O inverso (perfil de cliente já existente e papel admin pedido) também é recusado, se Q2 for a opção A.

**F4 — Mesma identidade de autenticação com dois `app_user`.**
1. Uma tentativa de criar segundo `app_user` para a mesma identidade é recusada pelo banco.

## 6. Estados de interface (quando a tela existir)

Esta história não cria tela. Os estados abaixo são o que a tela da Onda 3 precisará mostrar, para que a regra não fique sem resposta na interface. `[PROPOSTA]`

- **Botão "Aceitar trabalho" em pedido próprio:** não aparece. Se a tela for carregada por URL direta, mostra mensagem fixa "Você não pode aceitar este pedido." sem detalhe. Não é mostrado "pedido seu" nem nome do cliente.
- **Erro de aceite recusado pela regra:** mesma mensagem fixa do estado anterior; não mostra contadores (RF-071, sem contadores).
- **Papel admin com perfil indevido:** a tela administrativa não abre para quem tem perfil de cliente ou de profissional; a mensagem é genérica.

## 7. Critérios de aceite (testáveis)

- **CA-01 Identidade única.** Dado um `app_user` existente, quando uma segunda identidade de autenticação tenta apontar para o mesmo `app_user` ou um segundo `app_user` é criado para a mesma identidade, então a gravação é recusada pelo banco. `[PROPOSTA]`
- **CA-02 Um app_user com dois perfis.** Dado um `app_user` U, quando U cria perfil de cliente e perfil de profissional, então ambos são gravados apontando para o mesmo U e nenhum deles é recusado. `[PROPOSTA]` (Q1)
- **CA-03 Aceite no próprio pedido recusado no banco.** Dado pedido P cujo cliente é U, quando é inserida participação de U em P diretamente no banco de teste, então a inserção é recusada, nada é gravado e a contagem de vagas de P não muda. `[VERIFICADO]` H-017; `[PROPOSTA]` teste direto no banco.
- **CA-04 Aceite no pedido de outro permitido.** Dado pedido P cujo cliente é U1 e profissional elegível U2 (diferente), quando U2 registra participação em P, então a inserção é aceita. `[PROPOSTA]`
- **CA-05 Pessoa dupla em pedido alheio permitido.** Dado U com perfil de cliente e de profissional, quando U registra participação em pedido de outro cliente, então a inserção é aceita. `[PROPOSTA]`
- **CA-06 Pessoa dupla publica pedido.** Dado U com perfil de cliente e de profissional, quando U cria pedido, então o pedido é criado normalmente, e a regra de 3.2 não o impede. `[PROPOSTA]`
- **CA-07 Admin com perfil de cliente recusado.** Dado `app_user` com papel admin, quando é criado perfil de cliente para ele, então a gravação é recusada. `[VERIFICADO]` H-017; `[PROPOSTA]` teste direto no banco.
- **CA-08 Admin com perfil de profissional recusado.** Dado `app_user` com papel admin, quando é criado perfil de profissional, então a gravação é recusada. `[VERIFICADO]` H-017 ("admin sem perfil de cliente ou profissional"); `[PROPOSTA]` a inclusão do perfil profissional além do cliente (confirmar em Q2).
- **CA-09 Inverso recusado.** Dado `app_user` com perfil de cliente, quando recebe papel admin, então a gravação é recusada. `[PROPOSTA]` (Q2, opção A)
- **CA-10 Corrida na regra de admin.** Dado `app_user` sem perfis, quando dois pedidos concorrentes tentam criar, ao mesmo tempo, perfil de cliente e papel admin, então no fim apenas uma das combinações proibidas não existe (nunca as duas juntas). `[PROPOSTA]`
- **CA-11 Mensagem fixa.** Dado uma recusa por qualquer regra desta história, quando a API responde, então a mensagem é a fixa (3.4), sem nome, e-mail, CPF nem identificador de terceiros. `[PROPOSTA]`
- **CA-12 Migração com dados existentes.** Dado que já existe participação de um profissional no próprio pedido antes da regra, quando a migração é aplicada, então a migração não apaga nada, falha com lista de casos para revisão manual ou registra os casos (Q5). `[PROPOSTA]`
- **CA-13 Limitação aceita documentada.** Dado a mesma pessoa com dois e-mails e dois `app_user`, quando aceita o próprio pedido, então a regra não a impede; o teste registra a limitação e não a trata como falha. `[VERIFICADO]` 14-BACKLOG H-017.

## 8. Casos de borda

- **Dados antigos:** participação própria existente antes da regra (Q5). Não se apaga nada automaticamente.
- **Mudança de papel:** profissional que vira admin enquanto tem participação ativa. Pela regra 3.3, o perfil de profissional não pode coexistir com admin; o que fazer com a participação ativa depende de Q4 e Q5.
- **Pedido cancelado, encerrado ou expirado:** a regra vale mesmo assim (3.2), para não abrir brecha em pedidos já encerrados. `[PROPOSTA]`
- **Cliente anonimizado ou excluído (retenção):** a regra precisa continuar válida para pedidos ainda existentes. Retenção é H-040 e não entra aqui. `[NÃO VERIFICADO]`
- **Corrida entre criação de perfil e aceite:** o aceite e o cadastro de perfil podem ocorrer ao mesmo tempo. A checagem precisa ser no banco, com garantia sob concorrência (CA-10). `[PROPOSTA]`
- **Duas identidades de e-mail para a mesma pessoa:** limitação aceita (CA-13).

## 9. Dependências

- **H-016 e H-011 (concluídas segundo o líder):** cadastro e login existem. `[VERIFICADO]` 14-BACKLOG (dependências da H-017). **Nota:** a busca no quadro nesta tentativa não mostrou as linhas individuais dessas histórias (o quadro lista por número de Issue e seção); o status foi aceito como informado. `[NÃO VERIFICADO]` na linha do quadro.
- **Onda 2 (H-025 a H-034) e Onda 3 (H-055 a H-073):** não construídas. Pedido e aceite são necessários para testes de ponta a ponta; ficam fora do escopo (seção 4).
- **H-102 (RBAC), Onda 1:** `[NÃO VERIFICADO]` status.
- **H-045 depende de H-017:** acesso comercial derivado só deve ser feito depois desta história. `[VERIFICADO]` 14-BACKLOG H-045.
- **Documentos de desenho (I-19, 09 §3.1, 08 §5.2, 11 T-04):** `[NÃO VERIFICADO]` nesta tentativa; o Architect confirma antes do DEV.

## 10. Perguntas abertas (para o líder consolidar; numeração local deste documento)

**Q1 — Uma pessoa pode ter perfil de cliente e de profissional no mesmo `app_user`?**
- A. Sim, um `app_user` com dois perfis (recomendação do PO; é o que "app_user único" sugere).
- B. Não, contas separadas por papel, com e-mails diferentes (contradiz "app_user único" e aumenta a limitação de duas contas).
- **Destrava:** CA-02, CA-05, CA-06, desenho de tabelas.

**Q2 — Admin pode ter perfil de cliente ou de profissional? E o inverso?**
- A. Não, em nenhum sentido (recomendação do PO; é o que o título da H-017 diz).
- B. Admin pode ser cliente, mas nunca profissional (pior para a separação de funções).
- **Destrava:** CA-07 a CA-09.

**Q3 — Como identificar "o mesmo profissional e o mesmo cliente" na regra?**
- A. Pelo identificador de `app_user` (recomendação do PO; a limitação de dois e-mails já foi aceita).
- B. Também pelo documento (HMAC de CPF/CNPJ de H-035). Mais forte, mas o cliente pode não ter CPF e cria dependência de H-035.
- **Destrava:** CA-03, CA-13.

**Q4 — Como o papel admin é atribuído?**
- A. Somente por ferramenta administrativa de linha de comando ou seed, com registro em auditoria; nenhuma conta se atribui papel (recomendação do PO).
- B. Por tela administrativa, por outro admin, com auditoria (depende de AMB-08 e H-102).
- **Destrava:** CA-09 e o fluxo de criação de admin.

**Q5 — O que fazer com dados que já violam a regra no momento da migração?**
- A. A migração não apaga nada. Se houver caso, falha com lista para revisão manual (recomendação do PO; nenhuma operação destrutiva sem decisão humana).
- B. Remover automaticamente a participação própria (rejeitado pelo PO: operação destrutiva sem decisão humana).
- **Destrava:** CA-12. Na prática, a base de dados atual provavelmente não tem casos, pois não há aceite construído; a pergunta é de desenho para o futuro.

**Q6 — O que a API responde e o que é registrado quando a regra recusa uma operação?**
- A. Texto fixo genérico, sem motivo, e registro de auditoria sem dados pessoais (recomendação do PO).
- B. Texto fixo genérico, sem registro (menos rastreável).
- C. Texto específico por regra (revela mais do que a regra de conta exige; não recomendado).
- **Destrava:** CA-11.

## 11. Resumo para o líder

- O refino está completo para as regras, critérios e casos de borda, com seis perguntas abertas (Q1 a Q6), cada uma com recomendação.
- O que não pode ser testado ainda: aceite e publicação de pedido (Ondas 2 e 3). Os critérios que dependem deles estão marcados e serão testados no banco com inserção direta, ou serão adiados.
- Não consultei `08`, `09`, `11` nem `05`. Antes do DEV, o Architect confirma o desenho contra esses documentos.
