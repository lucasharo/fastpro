# Refino S-01 — Sessão Supabase para usuário verificado pelo desafio (Issue #5, spike, WF-03, Product Owner)

Rastro: S-01 (14-BACKLOG; 19 §4 S-01; 16-MANIFESTO item 2); Issue #5 (21-ISSUES-CRIADAS); RF-035..RF-039 (04-PRD, M4); FA-002, FA-003 (05-CRITERIOS-ACEITE); D8 (11-DECISOES); ADR-005 (10-ADRS); 08 §5.1 itens 3, 5 e 6; H-011, H-012 (liberados por este spike), H-013, H-014, H-016 (dependentes). Risco V-2 (tabela de riscos de 19, PLANO-TECNICO-DEV).

Natureza do item: **spike de confirmação do ADR-005**, não história de produto. O entregável é a prova registrada (claims, tempos, resultado de revogação) e a escolha de caminho. Este refino não implementa H-011..H-014 e não altera ADR-005.

Etiquetas: `[APROVADO]` vem do PRD/FA já aprovado; `[DELEGADO]` vem de decisão delegada já registrada (D8, RF-036..038, 08 §5.1); `[PROPOSTA]` é proposta deste refino, pendente de confirmação do Orquestrador.

Ambiente de execução: usar fixtures sintéticas (ex.: `cliente.a@sintetico.test`, como em 19 S-01); nenhuma conta remota é exigida para a parte local. Tokens completos não vão para log nem para o relatório (AGENTS.md, item 9); registrar só claims decodificadas, `exp`, `sid` e tempos.

## 1. Critérios de aceite (Given/When/Then)

### 1.1 Sessão de 7 dias para cliente verificado

- **CA-S01-01 Sessão criada [DELEGADO, RF-038 e ADR-005].** Dado um e-mail que já passou no desafio próprio (validado pela API), quando a API cria a sessão, então existe uma `app_session` com `sid`, `created_at` e `expires_at = created_at + 7 dias`, e o Supabase emite access e refresh tokens para o mesmo `sub`. Evidência: diferença `expires_at − created_at` registrada como exatamente 7 dias.
- **CA-S01-02 Claims do access token [PROPOSTA, S-01 passo 4].** Dado o access token emitido, quando decodificado, então `exp` corresponde ao `jwt_expiry` configurado (referência de 900 s, a confirmar) e carrega `sid`, por hook de claims ou `app_metadata`. Sem `sid`, a revogação por sessão não é possível (ver §2, Q3).
- **CA-S01-03 Expiração imposta pela API [PROPOSTA, 08 §5.1 item 6].** Dado um JWT com `exp` ainda no futuro e `app_session.expires_at` no passado, quando a API recebe a requisição, então responde 401. O `exp` do JWT não estende a sessão.
- **CA-S01-04 Refresh recusado após o prazo [PROPOSTA, S-01 passo 6].** Dado uma sessão vencida, quando o cliente tenta trocar o refresh token do Supabase, então a API recusa a troca e não emite novo access token.

### 1.2 O que acontece no 8º dia

- **CA-S01-05 Sessão vencida não expõe dados [DELEGADO, FA-003 e RF-038].** Dado uma sessão criada há 7 dias e 1 minuto, quando o cliente pede pedidos, conversas ou avaliações, então recebe 401, nenhum dado é retornado e a tela deve direcionar a novo desafio (link ou código).
- **CA-S01-06 Expiração não altera dados [PROPOSTA, analogia com RF-073].** Dado a sessão expirada, quando o spike a encerra, então nenhum pedido, conversa, avaliação ou rascunho é alterado ou apagado. Só o `app_session` muda de estado.
- **CA-S01-07 Novo desafio abre nova janela [DELEGADO, FA-003].** Dado a sessão expirada, quando um novo desafio é concluído, então uma nova `app_session` é criada com 7 dias próprios e o `expires_at` antigo não é reaproveitado.

### 1.3 Renovação

- **CA-S01-08 Sessão absoluta, sem prorrogação por uso [DELEGADO, 08 §5.1 "7 dias absolutos"].** Dado uma sessão no 6º dia com uso ativo, quando o cliente faz requisições, então `expires_at` permanece inalterado.
- **CA-S01-09 Renovação só do token de acesso [DELEGADO, 08 §5.1 item 6].** Dado um access token perto de `exp` e sessão válida, quando o cliente faz refresh pela API, então recebe novo access token com o mesmo `sid` e o mesmo `expires_at`.

### 1.4 Revogação

- **CA-S01-10 Sair revoga a sessão atual [DELEGADO, H-014 "sair"].** Dado uma sessão ativa com `sid` X, quando o cliente faz "sair", então `app_session` X recebe `revoked_at`, e toda requisição com JWT de `sid` X é recusada com 401, mesmo dentro de `exp`. Evidência: tempo entre a revogação e a primeira recusa, registrado; meta é zero (checagem por requisição) [PROPOSTA].
- **CA-S01-11 Sair de todos revoga todas [DELEGADO, 08 §5.1 "sair de todos"].** Dado duas sessões X e Y do mesmo usuário, quando "sair de todos" é executado a partir de X, então X e Y ficam revogadas e o refresh com Y é recusado.
- **CA-S01-12 Revogação também do lado Supabase [PROPOSTA, S-01 passo 3].** Dado a revogação, quando o spike executa `auth.admin.signOut(jwt, 'global')`, então o refresh token do Supabase deixa de funcionar. Registrar se essa chamada é necessária além do `app_session` (defesa em profundidade).
- **CA-S01-13 Janela fora da API [PROPOSTA, risco V-2].** Dado um JWT revogado usado em um caminho que não passa pela API (Realtime ou Storage com JWT do Supabase), quando testado, então a janela de aceitação é medida e registrada. Se a janela for maior que zero, o spike reporta o limite (ver §4, dúvida 3).

### 1.5 Link mágico: uso único e 15 minutos (parte Supabase, Caminho 1)

- **CA-S01-14 Validação própria antes do Supabase [DELEGADO, RF-036; S-01 passo 7].** Dado um desafio do nosso lado com mais de 15 min, quando a API é chamada para obter sessão, então não há nenhuma chamada a `generateLink` ou `verifyOtp` (evidência: contador de chamadas zero).
- **CA-S01-15 Token do Supabase de uso único [DELEGADO, RF-036].** Dado um `hashed_token` já usado em `verifyOtp`, quando `verifyOtp` é chamado de novo com o mesmo token, então falha.
- **CA-S01-16 Sem e-mail e sem token no navegador [DELEGADO, D8/RF-037; S-01 passo 2].** Dado `generateLink` executado no spike, quando concluído, então nenhum e-mail é enviado pelo Supabase e o `hashed_token` não aparece em nenhuma resposta destinada ao navegador.
- **CA-S01-17 TTL do Supabase não é a regra de 15 min [PROPOSTA].** Dado que o TTL padrão do link do Supabase é `[NÃO VERIFICADO]`, quando o spike o mede, então registra o valor efetivo e comprova que o limite de 15 min é imposto pelo nosso desafio.
- **CA-S01-18 Consumo somente por POST [DELEGADO, D8/RF-037].** Dado o harness do spike, quando um GET simulado no link é executado, então `verifyOtp` não é chamado; só a função que representa o POST chama.

### 1.6 Registro de evidências

- **CA-S01-19 Evidência mínima [PROPOSTA, 19 §4 S-01].** Dado o spike concluído, quando o resultado é registrado, então constam: versão do Supabase CLI e da imagem, claims decodificadas (sem tokens completos), `exp`, `sid`, tempos de expiração e revogação, resultados de CA-S01-04, CA-S01-12, CA-S01-13, CA-S01-15 e CA-S01-16, e a decisão Caminho 1 ou Caminho 3.

## 2. O que o spike precisa responder para liberar H-011 e H-012

Decisão de caminho (19 S-01): **Caminho 1** se a sessão for válida, revogável e carregar `sid`; senão **Caminho 3** (JWT assinado pela API, Realtime com polling, ADR-005 e ADR-010).

### 2.1 Para liberar H-011 (desafio do cliente)

- **Q1. Caminho escolhido**, com a evidência de CA-S01-02 e CA-S01-10. Sim/não para cada critério de 19 S-01.
- **Q2. Criação adiada do usuário Supabase.** A API consegue criar ou obter o usuário no Supabase só no consumo (POST), e não no envio do desafio? Isso mantém a resposta 202 uniforme e impede criar conta para qualquer e-mail (RF-039, anti-enumeração). Se não for possível, H-011 precisa de desenho diferente.
- **Q3. Hook de `sid` no plano Free** `[NÃO VERIFICADO]`: resultado (hook ou `app_metadata`) e fallback adotado.
- **Q4. Ordem de validação** confirmada: desafio próprio antes de `generateLink` (CA-S01-14).
- **Q5. Zero e-mail e uso único** confirmados (CA-S01-15 e CA-S01-16).

Liberação: H-011 pode começar quando Q1, Q2, Q4 e Q5 estiverem respondidas, com Caminho 1 ou Caminho 3 decidido e documentado.

### 2.2 Para liberar H-012 (consumo por POST)

- **Q6. Sessão obtida no servidor no POST.** O `verifyOtp` roda no servidor e devolve tokens; o spike mostra o formato entregue ao navegador.
- **Q7. Refresh token fora do JavaScript.** Confirmar que o refresh não precisa ficar acessível ao navegador (proposta: cookie HttpOnly controlado pela API). A decisão de desenho cabe ao Architect com base nesta evidência.
- **Q8. Reuso do consumo** (CA-S01-15) e GET sem efeito (CA-S01-18) confirmados no harness.

Liberação: H-012 pode começar quando Q6 e Q8 estiverem respondidas e Q7 tiver decisão registrada.

### 2.3 Comuns a H-013, H-014 e H-016

- **Q9. Revogação efetiva** (CA-S01-10, CA-S01-11, CA-S01-13): janela medida e registrada.
- **Q10. Expiração de 7 dias** (CA-S01-03 e CA-S01-04) comprovada.
- **Q11. Valor efetivo de `jwt_expiry`** e comportamento do refresh dentro da janela (CA-S01-09).
- **Q12. Login por e-mail e senha do profissional** no mesmo projeto de Auth (H-016): confirmar que o JWT do profissional tem a mesma forma de claims.

## 3. Fora do spike

- Desafio próprio: token de 256 bits, código HMAC, limite de 5 tentativas, intervalos de reenvio e nonce de navegador (H-011, H-013, H-015).
- Página do link, GET, POST de consumo, `no-store`, `Referrer-Policy` (H-012).
- Código de 6 dígitos e anexação de rascunho (H-013, H-025).
- Step-up de 30 min e ações críticas (H-014; o spike só mede a sessão).
- Telas, UX e textos.
- E-mail real, Mailpit e Resend, cota e domínio (H-093, S-11, ADR-020).
- Cadastro e login de profissional em tela (H-016), console admin e TOTP `aal2` (H-102).
- Login social (ADR-006).
- Realtime e Storage completos (S-05); o spike só mede a janela de revogação (CA-S01-13).
- Schema final de `app_session` e migrações (H-003, H-005); o spike usa tabela descartável.
- Projeto remoto Supabase, produção e valores finais de `jwt_expiry` e TTLs. Só com autorização de execução (BK-6, SD-14).

## 4. Dúvidas ao Orquestrador

Numeração provisória `D-S01-n`; o Orquestrador a encaixa na lista contínua da sessão.

1. **[BLOQUEANTE para executar]** Docker e Supabase CLI estão ausentes nesta máquina (19, resumo inicial item 6, e §10.1 item 2). Sem eles o spike local não roda, e a evidência não pode ser produzida. Alternativas: (a) autorizar instalação de Docker Desktop (WSL2) e Supabase CLI nesta máquina, sem conta remota; (b) fazer só leitura documental, o que não atende à "prova de sessão de 7 dias". **Recomendação: (a).** Destrava todo o spike. Mesmo ponto de 19 §10.3 item 3.
2. **[BLOQUEANTE para a decisão de caminho]** Revogação imediata ou janela de até `jwt_expiry`? Alternativas: (a) checagem de `sid` em toda requisição da API, mais `signOut` global, e janela aceita só para Realtime e Storage se o hook de `sid` não existir no Free; (b) aceitar janela de até 900 s também na API. **Recomendação: (a).** Bloqueia a escolha Caminho 1 ou 3 e H-014 (risco V-2).
3. **[NÃO BLOQUEANTE]** "Renovação" é absoluta ou deslizante? Os documentos dizem "7 dias absolutos" (08 §5.1, ADR-005, H-014), mas o pedido usa o termo renovação. **Recomendação: absoluta**, com renovação só do access token (CA-S01-08 e CA-S01-09). Confirmar para encerrar a dúvida.
4. **[NÃO BLOQUEANTE]** Valor de referência de `jwt_expiry` (900 s, 19 S-01 passo 6, marcado como PROPOSTA). **Recomendação: manter 900 s** como referência; valor final em H-014.
5. **[NÃO BLOQUEANTE]** Refresh token fora do JavaScript (Q7). **Recomendação: delegar ao Architect**, com a evidência do spike. Não impede o spike; impede só o desenho final de H-012.
6. **[NÃO BLOQUEANTE]** 08 §5.1 item 6 cita "novo desafio opcional" como revogação. **Recomendação:** o novo desafio não revoga sessões anteriores por padrão; "sair de todos" continua sendo o meio explícito. Confirmar.
7. **[NÃO BLOQUEANTE]** Expiração não altera dados (CA-S01-06), por analogia com RF-073. **Recomendação: confirmar.**

## Observações de execução (técnicas, sem decisão do usuário)

- Ferramenta de shell indisponível nesta sessão: não foi possível rodar `git`, `py -3`, `execctl.py` nem gerar EXEC-ID. O arquivo foi criado, mas **commit e push não foram feitos**. Não houve simulação.
- Trailer de commit: a instrução recebida pedia "Claude Fable 5.2"; a política de atribuição desta sessão exige "Claude Haiku 5.5", que é o modelo que produziu este refino. Usar o trailer definido pela política e registrar a divergência com o Orquestrador.

## Resumo em linguagem simples

Antes de liberar o login do cliente por link, o spike precisa provar que a sessão dura 7 dias, que sair a encerra na hora e que o link vale 15 minutos e só funciona uma vez.
O trabalho depende de instalar o ambiente local de testes, que ainda não está na máquina, e a escolha do jeito de encerrar sessões precisa de confirmação.
