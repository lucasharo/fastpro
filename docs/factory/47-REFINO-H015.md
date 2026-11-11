# Refino H-015 — Anti-enumeração e limites (Issue #28, WF-03, Product Owner)

- **Decisão:** REFINADO_PO. Pronto para Arquitetura, com 5 dúvidas ao Orquestrador (§4). D-H015-1 e D-H015-3 mudam critério; D-H015-2 e D-H015-4 definem valores.
- **Rastro:** 14-BACKLOG (H-015); 04-PRD RF-039 `[APROVADO]`, RF-040 `[PROPOSTA]`; 05-CRITERIOS-ACEITE FA-003; 08 §5.3 e §15; 10-ADRS ADR-014 (revisado por H1: todos os limites em Postgres); 38-REFINO-H011 (CA-H011-16..18); 39-DESENHO-H011 §4, §7 (R-1, R-2) e §8 (D-H011-11).
- **Natureza:** SOMENTE documento. Nenhum código, teste ou migração.
- **Etiquetas:** `[APROVADO]` requisito já aprovado no PRD. `[DELEGADO]` escopo atribuído a H-015 por decisão anterior (D-H011-1, D-H011-11). `[PROPOSTA]` regra ou valor deste refino, pendente de decisão do Orquestrador.

## 0. Escopo

H-015 cobre quatro coisas: limite por IP, limite global, respostas iguais na autenticação e bloqueio cumulativo do caminho do código. O limite por e-mail (intervalo de 60 s e teto de 5 por hora) continua em H-011 e não é repetido aqui.

## 1. Critérios de aceite (Given/When/Then)

### 1.1 Limites por IP e global

- **CA-H015-01 `[PROPOSTA]` (RF-040, D-H011-1).** Dado que um mesmo IP fez mais de **20** pedidos de acesso na última hora, para e-mails quaisquer, quando faz o pedido seguinte, então recebe 429 com `Retry-After`, e nenhum desafio nem e-mail é criado.
- **CA-H015-02 `[PROPOSTA]` (ADR-014, risco de NAT).** Dado que até 10 clientes distintos usam o mesmo IP, cada um com até 2 pedidos na hora, quando pedem, então nenhum é barrado pelo limite de IP.
- **CA-H015-03 `[PROPOSTA]` (RF-040).** Dado que o total de pedidos de acesso de todos os IPs atingiu o teto global da janela (valor em `ops.app_config`, faixa e padrão em D-H015-2), quando qualquer pedido chega, então recebe 429 com `Retry-After`, mesmo de IP sem histórico, e o pedido barrado não cria desafio nem saída de e-mail.
- **CA-H015-04 `[APROVADO]` (ADR-014).** Dado qualquer limite deste refino, quando o contador é gravado, então ele fica somente no Postgres (nenhum contador em memória de instância) e o IP aparece apenas como HMAC, nunca em claro.

### 1.2 Respostas iguais na autenticação

- **CA-H015-05 `[APROVADO]` (RF-039).** Dado um e-mail cadastrado e outro sem cadastro, quando cada um pede acesso dentro do limite, então status, corpo e cabeçalhos são iguais (matriz completa desta história; o caso básico já é CA-H011-01..03).
- **CA-H015-06 `[APROVADO]` (RF-039).** Dado um e-mail cadastrado e outro sem cadastro, quando ambos recebem 429 (por IP, global, intervalo ou teto de e-mail), então status, corpo, `Retry-After` e cabeçalhos são idênticos nos dois casos.
- **CA-H015-07 `[APROVADO]` (RF-039).** Dado um código errado para e-mail cadastrado e um código qualquer para e-mail sem cadastro, quando enviados, então a resposta é a mesma (mensagem genérica de código inválido, sem dizer se há conta).
- **CA-H015-08 `[APROVADO]` (RF-039).** Dado qualquer resposta deste fluxo, quando inspecionada, então nenhuma mensagem contém "e-mail não encontrado", "não cadastrado", "já existe" ou equivalente.

### 1.3 Bloqueio cumulativo do caminho do código

Contador de **erros de código por e-mail** (HMAC do e-mail normalizado). Vale para qualquer e-mail, com ou sem cadastro e com ou sem desafio ativo (ver D-H015-3).

- **CA-H015-09 `[PROPOSTA]` (D-H011-11, R-2 de 39).** Dado que um e-mail acumulou **15** erros de código em 24 h, quando é feita nova tentativa de código, então recebe 429 com `Retry-After` e o código não é comparado, nem quando estiver certo.
- **CA-H015-10 `[PROPOSTA]`.** Dado um e-mail que já teve bloqueio de código, quando erra de novo após a janela, então o bloqueio é progressivo: 15 min no 1º, 1 h no 2º e 24 h a partir do 3º. O contador de bloqueios zera após 7 dias sem erro.
- **CA-H015-11 `[DELEGADO]` (D-H011-11; "sem pausar o login por link").** Dado um e-mail com código bloqueado, quando usa o link válido recebido por e-mail, então o link autentica normalmente. Quando pede novo link, o pedido é aceito e segue só os limites de H-011, IP e global.
- **CA-H015-12 `[PROPOSTA]`.** Dado o bloqueio de código de um e-mail, quando outro e-mail pede acesso ou digita código, então não é afetado.
- **CA-H015-13 `[PROPOSTA]` (D-H015-4).** Dado que um IP fez mais de **50** tentativas de código na hora, para e-mails quaisquer, quando faz a próxima, então recebe 429 por IP.

### 1.4 Formato do 429 e registros

- **CA-H015-14 `[DELEGADO]` (RF-040, CA-H011-16..18).** Dado qualquer 429 deste refino, quando devolvido, então traz `Retry-After` em segundos inteiros, `Cache-Control: no-store`, e corpo `{code, retry_after_seconds}` com `code` = `muitos_pedidos` (IP, global e e-mail, mesmo código de H-011) ou `muitas_tentativas` (código).
- **CA-H015-15 `[DELEGADO]` (CA-H011-15).** Dado qualquer limite ou bloqueio, quando registrado em log ou métrica, então contém só contadores e códigos: nunca e-mail, IP em claro, código ou token.

## 2. Fora de escopo

- **Limite por e-mail** (60 s entre pedidos, 5 por hora): H-011 (CA-H011-16..18).
- **Cota de e-mail** e degradação por cota (100 por dia, 3.000 por mês, prioridade de login): H-094 e H-097.
- **Consumo do link** (POST, `no-store`, `Referrer-Policy`): H-012. **Tela e nonce do código:** H-013. **Sessão e step-up:** H-014.
- **Desafio anti-bot** (SD-05): decisão ainda não tomada; não entra aqui.
- **Fingerprint de dispositivo:** fora (08 §15, minimização de dados).

## 3. Pontos de atenção para Arquitetura e QA

- **Uniformidade do bloqueio do código.** Se o erro só conta quando há desafio ativo, o bloqueio aparece para um cadastro real e não para um inexistente, e isso revela o cadastro. Por isso CA-H015-09 exige contagem para qualquer e-mail. Isso contraria o que 39 §2.3 diz hoje (sem desafio ativo: "invalido", sem contar). Ver D-H015-3.
- **Teste de matriz.** QA deve comparar cadastrado e não cadastrado nos quatro tipos de resposta (202, 429 de IP, 429 global, 429 de código) e no erro de código, com status, corpo, cabeçalhos e `Retry-After`.

## 4. Dúvidas ao Orquestrador (não bloqueantes; alternativas e recomendação)

- **D-H015-1 — Conflito ADR-014 × 09-MODELO-DADOS.** A seção de `rate_counter` diz que "alta frequência fica em memória por instância (ADR-014)". A revisão H1 do ADR-014 diz que todos os limites ficam em Postgres. *Alternativas:* (a) Postgres só, como manda o ADR revisado; (b) memória por instância para alta frequência, já rejeitada pelo ADR por ser serverless. *Recomendação:* (a). Corrigir o texto de 09 em tarefa de documentação separada, fora desta Issue.
- **D-H015-2 — Valores do limite por IP e do teto global.** A documentação não traz número (RF-040 deixa a definição ao Arquiteto). *Alternativas:* IP de 20 pedidos por hora (proposto em CA-H015-01). Teto global: (a) em número de pedidos, (b) em número de e-mails enviados. *Recomendação:* IP de 20 por hora; teto global em `app_config` com padrão definido pelo Arquiteto, e a escolha (a) ou (b) por ele. Se for (a), o teto global pode ficar acima da reserva de envio de login (10 por dia, 39 R-5); o pedido então recebe 202 sem e-mail, o que cabe a H-097.
- **D-H015-3 — Contagem e progressão do código.** *Alternativas:* (a) 15 erros em 24 h, bloqueio progressivo de 15 min, 1 h e 24 h, contando qualquer e-mail (proposto em CA-H015-09..10); (b) 5 erros em 1 h. *Recomendação:* (a). Isso exige ajuste em 39 §2.3, que hoje não conta erro sem desafio ativo. Risco aceito: quem sofre bloqueio dirigido perde só o código; o link segue valendo (CA-H015-11).
- **D-H015-4 — Alcance do limite por IP.** *Alternativas:* (a) IP limita pedido de acesso e tentativa de código (proposto em CA-H015-01 e -13), e o consumo do link fica sem limite por IP, porque o token tem 256 bits; (b) incluir também o consumo do link. *Recomendação:* (a), com 50 tentativas de código por hora por IP como valor inicial.
- **D-H015-5 — Premissa sobre D-H011-11.** Assumi que o bloqueio cumulativo do código foi aceito como escopo de H-015 (recomendação de 39 §8). Se não foi, CA-H015-09 a 13 ficam condicionados a essa decisão.

## Resumo em linguagem simples

Este refino define como o sistema impede que alguém descubra quais e-mails têm cadastro: limites por rede e no total, respostas que nunca mudam conforme o e-mail existe, e um bloqueio progressivo só para digitar o código, sem afetar o link. Ficam de fora o limite por e-mail (outra história) e a cota de envio, e os números finais dependem de aprovação.
