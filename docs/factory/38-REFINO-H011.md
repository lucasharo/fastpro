# Refino H-011 — Desafio de acesso do cliente (Issue #24, WF-03, coluna Product Owner)

- **Issue:** #24 · **História:** H-011 ("[E1] Desafio de acesso do cliente") · **Workflow:** WF-03 · **Coluna:** Product Owner · **Data:** 2026-11-11 · **Papel:** Product Owner
- **Natureza:** somente documento. Nenhum código, teste, conta, chave ou envio. A coluna e as decisões já tomadas vieram do Orquestrador; o status no Project não foi conferido nesta etapa.
- **Etiquetas:** `[APROVADO]` vem de PRD, FA ou decisão registrada · `[DELEGADO]` vem de decisão delegada (D8, ADR-005, 08 §5.1) · `[PROPOSTA]` é texto deste refino, a validar.
- **Fontes:** 14-BACKLOG (H-011 a H-015, H-092, H-093, H-097); 04-PRD (RF-035 a RF-041); 05-CRITERIOS-ACEITE (FA-003); 10-ADRS (ADR-005); 08 §5.1 e §5.3; 11-DECISOES (D8); `spikes/S-01-RESULTADO.md` (§5 e §8); `25-REFINO-S01.md` (CA-S01-14 a 18).

## 1. Escopo

Emissão do desafio do cliente: pedido com resposta uniforme, envio de link e código pelo pipeline de notificações, validade de 15 min, uso único, limite de tentativas do código e limites mínimos de frequência por e-mail. A validação do link é definida aqui; o consumo por POST é H-012.

## 2. Critérios de aceite (Given/When/Then)

### 2.1 Pedido com resposta uniforme
- **CA-H011-01 [DELEGADO, RF-039; 08 §5.1 item 1].** Dado um e-mail cadastrado ou não, quando o pedido de desafio é feito, então a resposta tem o mesmo status (202) e o mesmo corpo, e o tempo de resposta não permite distinguir os dois casos. Limite de diferença de tempo `[PROPOSTA]` (Arquiteto).
- **CA-H011-02 [APROVADO, RF-039; S-01 Q2].** Dado um e-mail sem conta, quando o pedido é feito, então nenhuma conta é criada no pedido. A conta só é criada depois de consumo válido (H-012).
- **CA-H011-03 [APROVADO, RF-039].** Dado qualquer resposta ao pedido, quando lida, então nenhuma mensagem informa se o e-mail existe.

### 2.2 Envio pelo pipeline
- **CA-H011-04 [APROVADO, RF-041; decisão 27].** Dado um pedido aceito, quando o desafio é criado, então o e-mail entra no pipeline de notificações (H-092) com prioridade máxima, sem esperar o tick, e é enviado pelo adaptador de e-mail (H-093): Mailpit em desenvolvimento e CI.
- **CA-H011-05 [APROVADO, H-093 CA-05].** Dado o provedor real sem domínio verificado, quando o envio é tentado, então nada sai, o item fica `pendente` e a resposta ao pedido continua 202. Ver dúvida D-H011-3.
- **CA-H011-06 [APROVADO, H-093 CA-12].** Dado uma falha de provedor após o envio, quando há nova tentativa, então o destinatário não recebe um segundo link ou código do mesmo desafio.

### 2.3 Link de uso único com validade
- **CA-H011-07 [DELEGADO, RF-036; FA-003].** Dado um link com mais de 15 min, quando é usado, então é rejeitado, nenhuma sessão é criada e é oferecido novo envio.
- **CA-H011-08 [APROVADO, RF-039; FA-003].** Dado um link já usado, quando é reutilizado, então é rejeitado.
- **CA-H011-09 [APROVADO, RF-039; FA-003].** Dado um link inexistente ou adulterado, quando é usado, então a resposta é a mesma de link expirado: não revela se o e-mail existe e não expõe pedidos de terceiros.
- **CA-H011-10 [PROPOSTA, 08 §5.1 item 2].** Dado um segundo pedido para o mesmo e-mail e intenção, quando o link do primeiro é usado, então é rejeitado: só o desafio mais recente fica ativo. Ver D-H011-5.

### 2.4 Código de 6 dígitos com limite de tentativas
- **CA-H011-11 [DELEGADO, D8, RF-037; FA-003].** Dado um desafio emitido, quando o código de 6 dígitos é gerado, então ele vale pelo mesmo prazo de 15 min, é de uso único e não é diferente do link em validade.
- **CA-H011-12 [DELEGADO, D8; ADR-005; 08 §5.1 item 2].** Dado um desafio com 5 códigos errados, quando o quinto erro ocorre, então o desafio é invalidado, nenhuma sessão é criada e é preciso novo pedido. Ver D-H011-4.
- **CA-H011-13 [DELEGADO, 08 §5.1 item 2].** Dado o desafio guardado, quando inspecionado, então link e código não aparecem em texto legível nem em registros de log.

### 2.5 Nenhum dado sensível no e-mail
- **CA-H011-14 [APROVADO, RF-120; H-093 CA-13].** Dado o e-mail de desafio, quando inspecionado, então contém apenas: link de uso único, código de 6 dígitos, prazo de 15 min e a orientação de ignorar a mensagem se o pedido não foi feito pela pessoa. Não contém nome, endereço ou descrição de pedido, telefone, nome de profissional, valor, status de cadastro ou qualquer dado de terceiro. Assunto genérico `[PROPOSTA]`.
- **CA-H011-15 [APROVADO, H-093 CA-14].** Dado qualquer registro de envio, log ou erro do desafio, quando inspecionado, então o endereço de destino, o link e o código não aparecem.

### 2.6 Limites de frequência (por e-mail)
- **CA-H011-16 [PROPOSTA, RF-040].** Dado um novo pedido para o mesmo e-mail antes de 60 s do anterior, quando é feito, então responde 429 com o tempo de espera e nenhum e-mail é enviado.
- **CA-H011-17 [PROPOSTA, RF-040].** Dado mais de 5 pedidos para o mesmo e-mail em 1 h, quando o próximo é feito, então responde 429 com o tempo de espera e nenhum e-mail é enviado.
- **CA-H011-18 [PROPOSTA, RF-039].** Dado um limite atingido, quando a resposta é dada, então ela é igual para e-mail cadastrado ou não, porque a contagem não depende da existência da conta.

## 3. Fora desta história
- Consumo do link por POST, página do link, GET sem efeito, `no-store` e `Referrer-Policy`: **H-012** (história seguinte; não esta).
- Entrada do código na tela, nonce de navegador e vínculo com o rascunho: **H-013**.
- Sessão de 7 dias, "sair", "sair de todos" e step-up: **H-014**.
- Anti-enumeração avançada (limites por IP, origem compartilhada, respostas globais): **H-015**. Ver D-H011-1.
- Texto final dos e-mails, cota e degradação por cota: **H-094** e **H-097**.
- Envio real a qualquer destinatário: depende de domínio verificado (decisão 15; H-093).
- Login do profissional: H-016.

## 4. Dúvidas ao Orquestrador

Numeração provisória `D-H011-n`; o Orquestrador a encaixa na lista contínua da sessão.

1. **[NÃO BLOQUEANTE] Identificador da anti-enumeração.** O pedido cita H-028 para anti-enumeração avançada, mas no backlog H-028 é "Remoção de EXIF e metadados". Anti-enumeração e limites são H-015. **Recomendação:** H-015; corrigir a referência.
2. **[NÃO BLOQUEANTE] Dependência não listada.** H-011 depende de H-005, S-01 e H-093 no backlog, mas o envio usa o pipeline H-092 (informado como concluído). **Recomendação:** incluir H-092 nas dependências de H-011.
3. **[BLOQUEANTE para o teste de envio real] Destinatário real.** A decisão "envio real limitado ao e-mail da conta cadastrada" conflita com H-093 CA-05 (sem domínio verificado, o adaptador não chama o provedor) e com a regra do projeto de não enviar e-mail em desenvolvimento. Alternativas: (a) H-011 não exige envio real; em desenvolvimento e CI o envio vai ao Mailpit, e o envio real vira decisão própria antes do lançamento; (b) alterar H-093 CA-05 para permitir envio só ao e-mail da conta. **Recomendação: (a).** Este refino segue (a): nenhum critério exige envio real.
4. **Dono do limite de 5 tentativas do código.** Pode ficar em H-011 (é dado do desafio) ou em H-013 (entrada do código). **Recomendação:** H-011 define o contador e a invalidação; H-013 implementa a entrada e o nonce.
5. **Novo pedido invalida o anterior?** **Recomendação:** sim, um único desafio ativo por e-mail e intenção (08 §5.1). Sem isso, o link antigo continua valendo.
6. **Valores de frequência e dono do limite por e-mail.** Propostos: 60 s entre pedidos e 5 por hora por e-mail (CA-H011-16 e 17). RF-040 deixa os valores ao Arquiteto, e H-015 também cita intervalo e teto por e-mail. **Recomendação:** H-011 guarda o limite por e-mail; H-015 guarda o limite por IP e o global.
7. **Prioridade do e-mail de desafio.** CA-H011-04 repete parte de H-097 (prioridade máxima e fora do tick). **Recomendação:** H-011 cobre o envio; H-097 cobre cota e degradação.
8. **Limite de diferença de tempo (CA-H011-01).** Não há número na documentação. **Recomendação:** o Arquiteto define o limite e o teste de tempo.

## 5. Commit e push

Pendente. Nesta execução não havia ferramenta de shell disponível, então não houve commit nem push. Mensagem de commit sugerida, para quem tiver acesso ao git:

```
docs(H-011): refino do desafio de acesso do cliente

Refs: #24
Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01A8KvVP1ECgDzoXA3WLyBux
```

## Resumo em linguagem simples

O cliente pede o acesso informando o e-mail, e a resposta é sempre a mesma, exista ou não cadastro. O link e o código valem 15 minutos, funcionam uma vez e têm limite de tentativas, sem nenhum dado pessoal no e-mail.
Restam oito pontos de ajuste para o Orquestrador confirmar; só o envio real a clientes depende de decisão de fundo, e ele exige domínio verificado.
