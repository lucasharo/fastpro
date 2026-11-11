# Refino H-016 — Cadastro e login do profissional (Issue #29, WF-03, coluna Product Owner)

- **Issue:** #29 · **História:** H-016 (E1, Onda 1) · **Workflow:** WF-03 · **Coluna:** Product Owner · **Data:** 2026-11-11 · **Papel:** Product Owner
- **Natureza:** somente documento. Nenhum código, teste, commit ou alteração de Project foi feito.
- **Etiquetas:** `[APROVADO]` vem do PRD, FA ou decisão do usuário · `[DELEGADO]` vem de decisão delegada registrada (ADR-006 A, D8, S-01) · `[PROPOSTA]` é texto deste refino, pendente do Orquestrador.
- **Fontes:** 14-BACKLOG (H-016, H-011 a H-017, §6); 04-PRD (RF-039, RF-040, RF-041, RF-045, RF-048 a RF-050, RF-053); 05-CRITERIOS-ACEITE (FA-002, FA-004); 10-ADRS (ADR-005, ADR-006); spikes/S-01-RESULTADO e 25-REFINO-S01; 29-REFINO-S11 e S-11-RESULTADO; 08 §5.2; 19 §2.3.

## 1. Escopo

Conta de profissional com e-mail e senha no Supabase Auth; e-mail de verificação obrigatório; bloqueio progressivo de tentativas; recuperação de senha; sessão; e garantia de que um profissional sem aprovação humana não publica nem aceita trabalho. Login social não entra (seção 3).

## 2. Critérios de aceite (Given/When/Then)

### 2.1 Cadastro

- **CA-H016-01 [APROVADO, RF-045].** Dado um visitante sem conta, quando envia e-mail e senha no cadastro de profissional, então a conta nasce com e-mail não verificado e verificação `pendente`, e um e-mail de verificação é enfileirado.
- **CA-H016-02 [APROVADO, RF-039].** Dado um e-mail já cadastrado, quando alguém tenta cadastrá-lo de novo, então a resposta e o tempo são iguais aos de cadastro novo, sem revelar a existência da conta.
- **CA-H016-03 [PROPOSTA].** Dado uma senha abaixo do mínimo, quando enviada, então é recusada com erro no campo, sem criar conta. Mínimo: valor pendente (D-H016-4).
- **CA-H016-04 [PROPOSTA].** Dado um cadastro com senha, quando a requisição é processada, então a senha não aparece em log, resposta ou tela de erro.

### 2.2 Verificação de e-mail

- **CA-H016-05 [APROVADO, FA-002; H-031].** Dado um profissional com e-mail não verificado, quando tenta publicar pedido ou aceitar trabalho, inclusive por chamada direta de API, então é recusado e nada é criado.
- **CA-H016-06 [DELEGADO, H-093; I-27].** Dado um cadastro em desenvolvimento, quando o e-mail de verificação é enviado, então ele chega ao Mailpit local e nenhum e-mail sai para endereço real.
- **CA-H016-07 [PROPOSTA].** Dado o link de verificação, quando o profissional o confirma com ação na página (POST), então o e-mail fica verificado; abrir o link (GET) não consome o link (padrão D8). Validade e uso único conforme D-H016-2.
- **CA-H016-08 [PROPOSTA].** Dado um link expirado ou já usado, quando aberto, então é recusado e a tela oferece reenvio, sem revelar se o e-mail existe.
- **CA-H016-09 [PROPOSTA, RF-040].** Dado reenvios seguidos do e-mail de verificação, quando excedem o intervalo mínimo ou o teto por e-mail e IP, então a resposta é 429 com `Retry-After`.

### 2.3 Login

- **CA-H016-10 [APROVADO, RF-045].** Dado uma conta com e-mail verificado e senha correta, quando o profissional entra, então abre sessão e vê o estado da verificação (RF-053).
- **CA-H016-11 [APROVADO, RF-039].** Dado senha errada ou e-mail inexistente, quando o login é tentado, então a mensagem é a mesma nos dois casos.
- **CA-H016-12 [APROVADO, H-016 "bloqueio progressivo"; PROPOSTA de valores].** Dado tentativas erradas consecutivas acima do limite (D-H016-4), quando o login é tentado de novo, então a espera cresce a cada nova falha, a resposta é 429 com `Retry-After`, e o login correto volta a funcionar só após a espera.
- **CA-H016-13 [PROPOSTA; D-H016-3].** Dado uma conta com e-mail não verificado e senha correta, quando o profissional entra, então a sessão é aberta só para concluir a verificação: nada é publicado nem aceito, e a tela oferece reenvio.
- **CA-H016-14 [DELEGADO, ADR-006 A; D9].** Dado a tela de login web, quando aberta, então não há botão de Google nem de Apple.

### 2.4 Recuperação de senha

- **CA-H016-15 [PROPOSTA; lacuna de RF].** Dado um e-mail cadastrado, quando o profissional pede recuperação, então recebe um e-mail com link (Mailpit em dev), e a resposta é a mesma para e-mail existente ou não.
- **CA-H016-16 [PROPOSTA].** Dado um link de recuperação válido, quando o profissional define nova senha, então o link fica inválido, a senha é trocada e as demais sessões são encerradas (D-H016-6).
- **CA-H016-17 [PROPOSTA, RF-040].** Dado pedidos de recuperação em excesso, quando passam do limite, então a resposta é 429 com `Retry-After`, sem revelar a existência do e-mail.

### 2.5 Sessão

- **CA-H016-18 [PROPOSTA, estende RF-038 e S-01 D3/D7; D-H016-5].** Dado um login do profissional, quando a sessão é criada, então vale 7 dias absolutos, sem prorrogação pelo uso; ao expirar, nenhum dado é alterado.
- **CA-H016-19 [DELEGADO, RF-038; H-014].** Dado uma sessão ativa, quando o profissional clica em "sair", então ela é revogada; quando clica em "sair de todos", então todas as sessões dele são revogadas.
- **CA-H016-20 [PROPOSTA, H-014 step-up].** Dado uma sessão com mais de 30 min sem reautenticação, quando o profissional tenta trocar senha ou e-mail, então é pedida nova confirmação antes da troca.

### 2.6 Antes da aprovação humana

- **CA-H016-21 [APROVADO, RF-048 e RF-050; FA-004].** Dado uma conta recém-criada e verificada por e-mail, quando o profissional consulta o próprio estado, então vê `pendente` com a explicação de que a aprovação é feita por pessoa e não tem prazo garantido (meta de 2 dias úteis, não promessa).
- **CA-H016-22 [APROVADO, RF-050; FA-004].** Dado um profissional com e-mail verificado e verificação `pendente`, `em_revisao`, `retida_duplicidade`, `recusada` ou `suspensa`, quando tenta aceitar trabalho pela interface ou por chamada direta de API, então é negado e nada é criado (sem aceite, conversa ou mensagem automática). A guarda completa fica em H-042; esta história garante só o estado inicial `pendente` e a recusa de publicação (CA-H016-05).

## 3. Fora desta história

- **Google e Apple:** fora do MVP web (ADR-006 A; D9). Voltam só com decisão própria e regras das lojas (H-124, S-07).
- **CPF/CNPJ e documentos de identidade:** H-035 e H-037. Certificações: H-038.
- **Aprovação humana, fila e meta de 2 dias úteis:** H-039; estado visível: H-041; guarda de descoberta e aceite: H-042.
- **Trial, assinatura e cobrança:** H-044 a H-053.
- **E-mail real a usuários:** depende de domínio verificado no Resend (BLQ-EXEC; BK-10). Nesta história, só Mailpit.
- **Login do cliente (link e código):** H-011 a H-013.
- **Painel admin e MFA:** H-102.

## 4. Achados para o Orquestrador (lacunas e dependências)

1. **Dependência faltando:** H-016 depende só de H-003 e S-11, mas a sessão do profissional depende de S-01 (caminho 1 ou 3) e de H-014. Sugestão: incluir S-01 em Dep.
2. **Recuperação de senha sem RF:** o PRD não tem requisito para ela; só 08 §5.2 a cita. CA-H016-15 a 17 são propostas do PO.
3. **Sessão do profissional sem RF:** RF-038 fala só do cliente.
4. **E-mails do próprio Supabase Auth** (verificação e recuperação): a rota de envio não foi decidida (18-PLANO-QA, N5; S-11). Proposta de desenho (19 §2.3): SMTP do Auth apontado ao Mailpit em dev.
5. **Execução local:** Docker e Supabase CLI não estão instalados nesta máquina (19 §2.4; S-01 D1). Sem eles, CA-H016-06 e os demais testes de Auth não rodam localmente. Não há autorização externa envolvida.

## 5. Dúvidas ao Orquestrador (numeração provisória D-H016-n)

1. **Recuperação de senha:** entra em H-016 ou em história nova em E1? Recomendação: H-016 (sem ela, o login por senha não tem saída). Alternativa: história separada.
2. **Validade do link de verificação do profissional:** (a) 15 min com consumo por POST, igual ao cliente (RF-036, D8); (b) 1 h, padrão do Supabase Auth. Recomendação: (a), por consistência.
3. **Login com e-mail não verificado (CA-H016-13):** (a) entra só para concluir a verificação; (b) bloqueia o login até verificar. Recomendação: (a), porque mostra o estado pendente sem criar atrito extra.
4. **Valores:** senha mínima e limite de tentativas com espera crescente. Proposta do PO: senha mínima de 8 caracteres; espera crescente a partir de 5 falhas; limite de reenvio conforme RF-040. Valores em configuração, confirmados pelo Architect.
5. **Sessão do profissional (CA-H016-18):** (a) mesmo `app_session` de 7 dias absolutos (recomendado); (b) sessão padrão do Supabase Auth, sem limite no plano gratuito. Recomendação: (a), e incluir RF próprio.
6. **Troca ou recuperação de senha encerra as demais sessões (CA-H016-16):** recomendado sim. Alternativa: manter as sessões.
7. **Execução local:** autorizar a instalação de Docker e Supabase CLI nesta máquina, sem conta remota. Recomendação: sim. Destrava os testes de Auth.

## Resumo em linguagem simples

Este documento descreve como o profissional cria a conta, confirma o e-mail, entra e recupera a senha, e por que ele ainda não pode oferecer trabalho até uma pessoa aprovar o cadastro.
Ficam de fora o login com Google e Apple, a checagem de documentos e a cobrança; há sete pontos que o responsável precisa decidir antes da execução.
