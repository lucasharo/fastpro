# Refino H-012 — Consumo do link por POST (Issue #25, WF-03, coluna Product Owner)

- **Issue:** #25 · **História:** H-012 ("[E1] Consumo do link por POST") · **Workflow:** WF-03 · **Coluna:** Product Owner · **Data:** 2026-11-11 · **Papel:** Product Owner
- **Natureza:** somente documento. Nenhum código, teste, conta, chave ou envio. O status no Project não foi conferido nesta etapa.
- **Etiquetas:** `[APROVADO]` vem de PRD, FA ou decisão registrada · `[DELEGADO]` vem de decisão delegada (D8, ADR-005) · `[PROPOSTA]` é texto deste refino, a validar.
- **Fontes:** 14-BACKLOG (H-012); 04-PRD (RF-035 a RF-041); 05-CRITERIOS-ACEITE (FA-003); 10-ADRS (ADR-005, §3 e D8); 11-DECISOES (D8); 39-DESENHO-H011 (§1 DD-6, §2.1 funções 2 e 3, §3, §5 e R-8/R-9); 38-REFINO-H011 (CA-H011-07 a 12).

## 1. Escopo

Consumo do link de acesso pelo cliente. O GET da página não altera nada: a página não recebe o token na requisição (ele fica no fragmento da URL). O consumo acontece só por POST, após clique explícito do usuário. Quem consome é a função `auth_challenge_consume_link` entregue pelo H-011 (39 §2.1, item 2), que marca o link como usado e devolve o e-mail cifrado para a etapa seguinte.

Fatos do H-011 que este refino usa: link `/acesso#t=<token>` (39 §2); validade de 15 min; uso único; toda situação que não seja "ativo" devolve o mesmo resultado `invalido` (39 DD-7).

## 2. Critérios de aceite (Given/When/Then)

### 2.1 GET sem efeito
- **CA-H012-01 [DELEGADO, D8; RF-037; FA-003].** Dado um link válido, quando a página é aberta (GET) ou um leitor de e-mail faz GET no endereço, então nenhum desafio é consumido e o link continua válido para o cliente real.
- **CA-H012-02 [DELEGADO, D8].** Dado a página do link aberta, quando ela carrega, então nenhuma chamada de consumo é feita sem o clique explícito do usuário no botão de confirmação (sem envio automático ao carregar).
- **CA-H012-03 [PROPOSTA, 39 §2].** Dado o endereço da página, quando a requisição é feita, então o token não aparece na requisição (fica só no fragmento). Após a página ler o fragmento, ele sai da barra de endereço (substituição do histórico) [PROPOSTA].

### 2.2 Consumo por POST
- **CA-H012-04 [DELEGADO, D8; RF-037].** Dado um link válido, quando o usuário confirma (POST), então o link é consumido uma única vez e a etapa de identificação é aberta (ver dúvida D-H012-1 sobre o que exatamente é aberto).
- **CA-H012-05 [APROVADO, FA-003].** Dado um link já consumido, quando é enviado de novo por POST, então a resposta é a de link inválido (CA-H012-07).
- **CA-H012-06 [APROVADO, RF-039; FA-003].** Dado um link expirado (mais de 15 min), inexistente ou adulterado, quando enviado por POST, então a resposta é idêntica à de CA-H012-07 (mesmo status, corpo e cabeçalhos) e nenhuma sessão é criada. Os três casos seguem o mesmo caminho no banco (uma chamada, mesma quantidade de operações) [PROPOSTA].
- **CA-H012-07 [APROVADO, RF-039; 39 DD-7].** Dado qualquer situação em que o link não pode ser usado, quando o POST é processado, então a resposta é uma só: mensagem genérica, sem revelar se o e-mail existe ou se o link já foi usado, com orientação para pedir um novo acesso [PROPOSTA de texto].
- **CA-H012-08 [APROVADO, D8; FA-003].** Dado dois POSTs simultâneos com o mesmo link válido, quando processados, então exatamente um consome o link e o outro recebe a resposta de CA-H012-07.

### 2.3 Limite do POST
- **CA-H012-09 [APROVADO, D8; 39 §2.1 item 3].** Dado um POST que contém um código de 6 dígitos (ou qualquer campo além do token), quando recebido, então é recusado com erro de formato (422), o link não é consumido e nenhuma sessão é criada. O código de 6 dígitos é tratado só em H-013.

### 2.4 Cabeçalhos e registros
- **CA-H012-10 [PROPOSTA, RF-039; H-012 do backlog].** Dado a página e a resposta do POST, quando inspecionados, então trazem `Cache-Control: no-store` e `Referrer-Policy: no-referrer`.
- **CA-H012-11 [APROVADO, 39 CA-H011-13/15].** Dado qualquer log, erro ou registro do GET ou do POST, quando inspecionado, então o token não aparece em texto legível.

## 3. Fora desta história
- Entrada e validação do código de 6 dígitos, nonce de navegador e vínculo com o rascunho: **H-013**.
- Sessão de 7 dias, "sair", "sair de todos" e step-up de 30 min: **H-014**.
- Anti-enumeração avançada (limites por IP, global e respostas globais): **H-015**.
- Texto final do e-mail, cota e degradação: **H-094** e **H-097**.
- Criação ou ativação de conta do profissional: **H-016**.

## 4. Dúvidas ao Orquestrador

Numeração provisória `D-H012-n`; o Orquestrador a encaixa na lista contínua da sessão.

1. **[BLOQUEANTE para o desenho do POST] O que o POST abre.** O backlog diz "sessão de identificação"; o ADR-005 §3 diz que a API cria a sessão de 7 dias no consumo; H-014 é a sessão de 7 dias. **Alternativas:** (a) POST cria uma etapa de identificação de curta duração (até o fim da validade do desafio), e H-014 a converte em sessão de 7 dias; (b) POST cria direto a sessão de 7 dias e H-014 só adiciona revogação e step-up. **Recomendação: (a)**, para manter H-014 como história própria; o ADR-005 precisa de ajuste de texto.
2. **[BLOQUEANTE para o desenho do POST] Criação da conta no consumo.** O desenho do H-011 (39 §0.2 e §2.1) prevê que a conta do cliente nasce no consumo, com o e-mail decifrado e devolvido por `auth_challenge_consume_link`. Não há regra de negócio contra isso, mas depende do resultado do S-01 (CA-S01-14/16). **Recomendação:** o POST cria ou vincula o usuário do cliente depois de consumir o link; se a criação falhar, o link já consumido não é restaurado e o cliente pede novo acesso (aceito, conforme 39 R-9).
3. **[NÃO BLOQUEANTE] Leitor de e-mail que executa JavaScript.** Um leitor que roda o script da página poderia clicar no botão. **Recomendação:** o botão é o único gatilho do POST; o script não envia nada ao carregar. Risco residual registrado para o QA (teste de leitura sem clique).
4. **[NÃO BLOQUEANTE] Conteúdo da página em link expirado ou usado.** **Recomendação:** a página do GET é igual para qualquer token; o resultado só aparece depois do POST (CA-H012-07). Assim o GET não revela estado nenhum.
5. **[NÃO BLOQUEANTE] Código enviado no POST (CA-H012-09).** Retornar 422 sem consumir informa ao cliente o erro de formato, mas não revela estado do link. **Recomendação:** aceitar.

## 5. Commit e push

Pendente. Nesta execução não havia ferramenta de shell disponível (nem git, nem Python), então não houve commit nem push. Mensagem de commit sugerida, para quem tiver acesso ao git:

```
docs(H-012): refino do consumo do link por POST

Refs: #25
Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01A8KvVP1ECgDzoXA3WLyBux
```

## Resumo em linguagem simples

O cliente abre o link sem que nada aconteça; só ao clicar no botão de confirmação o acesso é usado, uma única vez. Link usado, vencido ou inexistente recebe sempre a mesma resposta, e o código de 6 dígitos fica para a próxima etapa.
Faltam duas definições antes do desenho do POST: o que exatamente ele abre e se a conta nasce ali; o restante é ajuste pequeno.
