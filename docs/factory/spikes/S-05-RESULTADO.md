# S-05 — Resultado: Realtime com canais privados e limites do plano gratuito

- **Issue:** #12 ("[Spike] Realtime: canais privados e limites"). **Data:** 2026-11-10. **Branch:** `feature/init`. **Workflow:** WF-03 adaptado a spike, coluna Arquitetura.
- **Refs:** ADR-010 (08 §11), F-06, TL-8 (18), plano 19 (S-05), 13-VERIFICACAO-SERVICOS. **Bloqueia/libera:** H-070 (e informa H-065 a H-069).

## Resumo em linguagem simples

O Realtime do Supabase permite canais privados em que só entra quem a regra de segurança do banco autoriza, e os limites gratuitos conferem com o que já estava anotado (200 conexões, 2 milhões de mensagens por mês, 256 KB por mensagem); serve ao chat como aviso curto, com busca do texto pela API.
Não foi testado de ponta a ponta (não entra quem não é membro), porque isso exigiria criar política e canal, o que este spike não podia fazer; o plano de reserva (consulta periódica) continua obrigatório.

## 1. Fontes (lidas em 2026-11-10)

A ferramenta WebFetch não estava disponível; as páginas oficiais foram baixadas com `curl` na versão Markdown (sufixo `.md`), que é o mesmo conteúdo do site.

| Tema | URL |
|---|---|
| Autorização (canais privados + RLS) | https://supabase.com/docs/guides/realtime/authorization |
| Limites por plano | https://supabase.com/docs/guides/realtime/limits |
| Broadcast (envio pelo servidor, REST, `realtime.send`) | https://supabase.com/docs/guides/realtime/broadcast |
| Preços e cotas | https://supabase.com/docs/guides/realtime/pricing |
| Como as mensagens são contadas | https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages |

## 2. Limites do plano Free (VERIFICADO na documentação, 2026-11-10)

| Item | Free | Fonte |
|---|---|---|
| Conexões simultâneas | **200** | limits; pricing (cota de picos) |
| Mensagens por mês (cota) | **2 milhões** (sem cobrança de excedente no Free: coluna "Over-Usage" = "-") | pricing; manage-your-usage |
| Tamanho máximo de mensagem Broadcast | **256 KB** | limits |
| Mensagens por segundo | 100 | limits |
| Entradas em canal por segundo | 100 | limits |
| Canais por conexão | 100 | limits |
| Payload de mudança do Postgres | 1.024 KB | limits |
| Presence (chaves/objeto; msgs/s; chamadas/cliente/30 s) | 10; 20; 5 | limits |
| Replay de Broadcast | 72 h; 25 mensagens por requisição (só para mensagens enviadas pelo banco, canais privados) | limits; broadcast |

Contagem de mensagens (manage-your-usage): cada Broadcast conta **1 enviada + 1 por cliente inscrito que recebe**. Numa conversa com 2 participantes conectados, cada sinal custa cerca de 3 mensagens (1 + 2; o remetente só entra na conta se usar *self-send*). Estimativa: 2 milhões / 3 ≈ 660 mil sinais por mês. Todo cliente inscrito conta como destinatário, inclusive o servidor; por isso o servidor deve publicar pela **API REST de Broadcast**, não inscrito no canal.

Erros ao exceder: `too_many_connections`, `too_many_joins`, `too_many_channels`, `tenant_events` (desconecta quando passa de mensagens/s; o `supabase-js` reconecta sozinho).

## 3. Decisão sobre canal privado + RLS

**Decisão: VIÁVEL (pela documentação). Adotar canal privado `conv:{id}` como sinal, autorizado por política sobre `realtime.messages`, com polling (`since_id`/ETag) como contingência permanente (F-06).** Isto confirma o ADR-010 sem alterá-lo. Base documental:

1. A autorização é feita por RLS em `realtime.messages`; o cliente abre o canal com `config: { private: true }`. A política usa `realtime.topic()` (o nome do canal) e o JWT do usuário (`auth.uid()`, `request.jwt.claims`). Para entrar é preciso ao menos permissão de leitura (`select`) no tópico; enviar exige política de `insert`. Para o FastPro, só `select` para participantes; nenhum `insert` para clientes (publicação só pelo servidor).
2. Servidor publica por `POST /realtime/v1/api/broadcast/{topic}/events/{event}?private=true` (cabeçalho `apikey`) ou por `realtime.send(..., private => true)` no banco. O `private` do envio e o do canal do cliente **precisam coincidir**; envio público não chega a canal privado.
3. É obrigatório **desligar "Allow public access"** em Realtime Settings do projeto para impor canais privados (ação manual no painel; ver riscos).
4. As permissões são calculadas na entrada no canal e **ficam em cache durante a conexão**; são recalculadas ao entrar e quando chega novo JWT (`access_token`). Revogar a participação não derruba quem já está conectado até o JWT expirar. Mitigação já prevista no desenho: o canal leva só IDs e o conteúdo vem pela API, que decide a autorização a cada leitura (08 §11); JWT de vida curta.
5. `realtime.messages` já tem RLS ligada; a documentação manda **não** usar `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` nela (falha com 42501 e aborta a migração) e informa que só é permitido gerenciar políticas, não criar tabelas ou funções no esquema `realtime`.

### Consulta de leitura no banco de desenvolvimento (2026-11-10, transação somente leitura, sem criar nada)

| Verificação | Resultado |
|---|---|
| Versão do Postgres | 17.11 |
| `realtime.messages` existe | sim (particionada, `relkind = p`) |
| RLS em `realtime.messages` | ligada (`relrowsecurity = true`), sem *force* |
| Políticas atuais em `realtime.messages` | 0 (ou seja, nenhum canal privado é autorizado hoje) |
| Funções `realtime.topic`, `send`, `send_binary`, `broadcast_changes` | presentes |
| Publicação `supabase_realtime` | presente |
| Extensões `pg_net`, `pg_cron` | ausentes neste projeto (irrelevante ao Realtime; relevante a H-008) |

O teste local com Supabase CLI/Docker não foi feito: `docker` não está instalado nesta máquina.

## 4. Impacto no épico E7 (chat) e nas histórias

| História | Impacto |
|---|---|
| H-065 a H-069 (conversa, mensagens, bloqueio de anexos, mensagem automática, etc.) | Nenhum acoplamento ao Realtime: persistência e autorização seguem no NestJS. Podem ser feitas e testadas só com polling. |
| H-070 (Realtime como sinal) | Liberada para implementação com escopo: política `select` em `realtime.messages` por participação em `conv:{id}`; publicação pelo servidor via REST (`private=true`); cliente com `private: true`; polling de contingência. Teste obrigatório T-02/F-06 e prova de que não membro não entra (ver §6). |
| Notificações (E7/E8) | O mesmo mecanismo serve a um canal privado por usuário (`user:{id}`), mas cada conexão aberta consome 1 das 200 e cada sinal conta como mensagem. Recomendação: sinal de notificação só com o app/site aberto; e-mail segue pela cota própria (Resend). |
| Política de membro | A subconsulta da política roda como `authenticated`; como o 08 §5 não concede `grant` nas tabelas de domínio, a política deve chamar uma função `SECURITY DEFINER` com `search_path` fixo (`é_membro(conversation_id)`), em vez de ler a tabela de domínio. O desenho exato é decisão de H-070 `[NÃO VERIFICADO]`. |

## 5. Riscos

| # | Risco | Mitigação |
|---|---|---|
| R1 | 200 conexões simultâneas: cada aba/dispositivo aberto conta; picos podem esgotar | Uma conexão por cliente, canais por conversa abertos só na tela do chat; alerta em 70% (10-ADRS); cair para polling ao receber `too_many_connections` |
| R2 | 2 milhões de mensagens/mês (≈ 3 por sinal com 2 participantes) | Publicar só 1 sinal por mensagem persistida; não usar Presence nem indicador "digitando"; servidor não inscrito no canal; medir uso real |
| R3 | Autorização em cache: quem perde acesso continua recebendo sinais até o JWT expirar | Canal só com IDs; conteúdo pela API; JWT curto; reenviar `access_token` quando a sessão mudar |
| R4 | RLS complexa em `realtime.messages` aumenta latência de entrada | Função simples e indexada por `(conversation_id, user_id)`; sem junções pesadas |
| R5 | "Allow public access" ligado no painel anula a imposição de canal privado | Passo manual obrigatório no checklist de H-070/H-003; conferir por consulta de configuração `[NÃO VERIFICADO: como automatizar]` |
| R6 | Identidade: JWT do FastPro precisa ser aceito pelo Realtime | Depende de S-01/S-02 (caminho de sessão); se for JWT próprio, confirmar `setAuth`/`access_token`; senão polling (ADR-005/010) |
| R7 | Mensagens podem chegar fora de ordem ou duplicadas | Ordenar por `created_at,id`; cliente idempotente por `message_id` |

## 6. NÃO VERIFICADO

- Que um não membro **não consegue entrar nem receber** no canal (passo 4 do plano): exige criar política e abrir canal; fora do escopo deste spike. Fica como teste de H-070 e como critério de TL-8.
- Aceitação, pelo Realtime, do JWT emitido pelo FastPro (depende de S-01/S-02).
- Comportamento do plano Free ao ultrapassar 2 milhões/mês (a documentação mostra que não há cobrança de excedente no Free, mas não foi lido o que acontece com o projeto: bloqueio, aviso ou degradação).
- Estado da opção "Allow public access" neste projeto (é configuração de painel; não consultada).
- Latência de entrada no canal e de entrega com a política real; derrubada do Realtime e comportamento do polling (passo 5 do plano) — a testar com H-070.
- Comportamento local (Supabase CLI/Docker): Docker ausente nesta máquina.
- Os valores dos limites refletem a documentação em 2026-11-10 e podem mudar; reconferir antes de H-070 e antes de qualquer lançamento.

## 7. Conclusão

Realtime privado com RLS atende ao ADR-010 como **sinal**, no plano gratuito, desde que o polling permaneça como caminho de reserva e os limites sejam monitorados. TL-8 permanece parcialmente aberto até o teste de não membro em H-070.
