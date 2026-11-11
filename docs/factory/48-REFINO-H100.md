# H-100 — Refino: teste de ausência de interruptor de e-mail (Issue #110)

- **Issue:** #110 (H-100, épico E11) · **Workflow:** WF-03 · **Etapa:** Product Owner (refinamento) · **Data:** 2026-11-11
- **Natureza:** SOMENTE documento. Nenhum código, migração, teste, Issue ou Project foi criado ou alterado.
- **Fontes:** `14-BACKLOG` (H-100, E11); `04-PRD` RF-122 (Rev. 4), RF-154, RF-115 a RF-120; `11-DECISOES` decisões 15, 21, 23, 27 e nota de 2026-11-11; `35-DESENHO-H092` (DD-7, CA-12, §5.1, §8); `supabase/migrations/20261111120000_notifications_create_pipeline.sql`; `packages/domain/src/notifications/ports.ts`.
- **Etiquetas:** `[APROVADO]` decisão do usuário · `[DELEGADO]` desenho aprovado ou adotado por delegação · `[PROPOSTA]` este refino.

## 1. Estado atual do repositório [VERIFICADO]

- A migração de H-092 cria `ops.email_outbox`, `ops.notification_item`, `ops.notification_cooldown` e `ops.external_quota`, com RLS habilitada e forçada.
- Busca por termos de interruptor (enable, disable, switch, toggle, flag, kill, backfill, reenvio, desliga, habilit) no repositório, fora de `docs/`, retornou só dois falsos positivos: `enable/force row level security` (RLS) e um comentário de idempotência ("reenvio com a mesma chave"). Nenhum interruptor existe hoje.

## 2. Definições usadas pelos critérios [PROPOSTA, base [APROVADO] RF-122 e decisão 27]

- **Interruptor de e-mail:** tabela, coluna, chave de configuração, variável de ambiente, constante, parâmetro, rota, tela, job ou função cujo efeito ligue, desligue, pause ou condicione o envio de e-mail, geral ou por tipo. Vale em português e inglês.
- **Padrão vedado:** nome que combine `mail|e-mail|email|notif|aviso` com `enable|disable|switch|toggle|flag|kill|pause|liga|desliga|habilit|ativ`, além de `feature_flag` e `*_enabled` em estruturas de e-mail. Busca sem diferença de caixa.
- **Reenvio ou backfill:** código que crie linha em `ops.email_outbox` ou `ops.notification_item` a partir de evento anterior à vigência, ou job/rota cujo nome contenha `backfill`, `retro`, `reenvi` ou `replay`. Base: RF-122 ("sem reenvio nem e-mails retroativos").
- **Exceções fixas (não são interruptor):** `enable|force row level security`; janelas e cotas (`notification.*.window_seconds`, limites de cota); credenciais e domínio do provedor; o estado `nao_configurado` do provedor (N-10), que é condição técnica e não decisão de negócio. Comentários são ignorados pelo verificador.

## 3. Critérios Given/When/Then (verificações automáticas)

Escopo da varredura: `apps/**`, `packages/**`, `supabase/migrations/**`, `supabase/rollbacks/**` e arquivos de configuração versionados. `.env.local` não é versionado e fica fora. A falha informa caminho e linha de cada ocorrência, nunca valor de segredo.

**CA-H100-01 [APROVADO] Tabelas e colunas.**
Dado as migrações versionadas, Quando a verificação lista tabelas e colunas criadas ou alteradas, Então nenhuma tem nome no padrão vedado (ex.: `email_flag`, `notification_switch`, `email_enabled`) e não existe tabela de flags de notificação.
Falha se: qualquer ocorrência.

**CA-H100-02 [APROVADO] Chaves de configuração.**
Dado as chaves de `ops.app_config` semeadas ou lidas pelo código, Quando a verificação procura chaves com prefixo de e-mail ou notificação, Então só existem chaves de janela e de cota; nenhuma tem semântica de ligar ou desligar.
Falha se: chave com semântica de interruptor.

**CA-H100-03 [APROVADO] Variáveis de ambiente e constantes.**
Dado o código que lê variáveis de ambiente ou constantes de configuração, Quando a verificação lista as relacionadas a e-mail ou notificação, Então nenhuma tem nome no padrão vedado e nenhum valor aceito pela variável de provedor significa "não enviar".
Falha se: nome vedado ou valor que desliga (ex.: `off`, `none`, `disabled`). Depende da dúvida D-H100-2.

**CA-H100-04 [APROVADO] Rotas, telas e endpoints.**
Dado as rotas da API, das telas web e do console admin (H-103), Quando a verificação lista os caminhos, Então nenhum combina com o padrão vedado ou com reenvio/backfill, e não existe tela de configuração de e-mail.
Falha se: qualquer ocorrência.

**CA-H100-05 [APROVADO] Jobs e handlers.**
Dado o registro de jobs (`JobRegistry`) e os handlers de envio, Quando a verificação lista os tipos (`kind`), Então nenhum combina com o padrão vedado, `backfill` ou reenvio. Os tipos de e-mail já existentes (`outbox.dispatch`, `notification.flush`, `email.send`) são permitidos.
Falha se: qualquer tipo vedado.

**CA-H100-06 [APROVADO] Escrita em tabelas de envio só pelo caminho aprovado.**
Dado todo SQL e TypeScript do repositório, Quando a verificação procura `insert` e `update` em `ops.email_outbox` e `ops.notification_item`, Então a escrita ocorre só nos arquivos da lista de permissões (funções `private.notification_*`, `private.email_quota_*` e adaptadores de `packages/db`), e nenhuma migração contém DML que crie ou mude linhas de envio.
Falha se: escrita fora da lista ou DML de envio em migração (backfill de envio). A lista de permissões é mantida pelo Reviewer.

**CA-H100-07 [APROVADO] Sem backfill em comportamento.**
Dado eventos de outbox anteriores à vigência (ver D-H100-1), Quando o despachante roda, Então nenhum item, linha de e-mail ou chamada ao provedor é criado.
Verificação: teste de banco local (`db:test`) com `FakeEmailProvider`.
Falha se: qualquer item, linha ou chamada.

**CA-H100-08 [APROVADO] Envio habilitado (contraprova).**
Dado um item válido, com apenas credenciais e domínio de teste configurados, Quando o despachante e o envio rodam, Então o `FakeEmailProvider` recebe exatamente 1 chamada.
Falha se: 0 chamadas. Garante que a verificação não passa porque o envio está desligado.

**CA-H100-09 [PROPOSTA] Autoteste do verificador.**
Dado fixtures com cada item vedado (tabela `email_flag`, rota `/admin/email/desligar`, variável `EMAIL_KILL_SWITCH`, migração com `insert into ops.email_outbox` fora da lista), Quando o verificador roda, Então falha em cada uma. Dada uma fixture limpa, Quando roda, Então passa.
Sem esse autoteste, a verificação não prova que falha.

**CA-H100-10 [PROPOSTA] Execução e registro.**
Dado o repositório, Quando `corepack pnpm check:all` roda localmente, Então inclui o verificador. Resultado (comando, contagem e código de saída) vai para a Issue #110. GitHub Actions não é evidência.

## 4. Fora de escopo

- Entrega do e-mail, textos, templates e adaptador do Resend (H-093, H-095 a H-099).
- Cota, alertas persistentes e painel (H-094, H-108).
- Expurgo de notificações e direitos do titular (09 §10; H-111).
- Configuração de provedor, domínio ou conta (BLQ-EXEC).
- Verificação de textos em `docs/`: decisões e PRD descrevem a regra; não são código.
- Qualquer interruptor, flag ou tela. Nenhuma alteração em RF-122, RF-154, decisões ou em Issues de outras histórias.

## 5. Dúvidas ao Orquestrador (não bloqueantes)

- **D-H100-1 Marco de vigência.** O desenho de H-092 (CA-12 e §8) manda despachar sem efeito eventos "anteriores à entrada em vigor", mas não define o marco nem como detectá-lo. *Recomendação:* o Architect define o marco; sugestão: eventos criados antes da migração de H-092 recebem só `dispatched_at` (sem item e sem e-mail). Destrava CA-H100-07.
- **D-H100-2 Variável do provedor (`EMAIL_PROVIDER`, H-093).** Se aceitar valor que signifique "não enviar", vira interruptor. *Recomendação:* a variável só escolhe o adaptador; sem domínio ou segredo, o caminho é `nao_configurado` (N-10), nunca desligamento. Destrava CA-H100-03.
- **D-H100-3 Mailpit removido.** A decisão de 2026-11-11 removeu o Mailpit, mas `14-BACKLOG` (H-093), `35-DESENHO-H092` (§4.2 e §12) e a decisão 27 ainda o citam. *Recomendação:* o Orquestrador registra a atualização nesses documentos, fora desta Issue. Não altera os critérios.
- **D-H100-4 Restrição "somente para a conta cadastrada"** (decisão 15 e RF-122). Se for implementada como lista de destinatários no código, pode ser lida como filtro de envio. *Recomendação:* aplicar pela própria conta do provedor, sem código; se houver código, tratar como destino fixo de teste, nunca como flag. Destrava CA-H100-03 e CA-H100-06.
- **D-H100-5 Exceções da varredura (§2).** *Recomendação:* aceitar RLS, janelas, cotas e comentários como exceções fixas; toda nova exceção passa pelo Reviewer.
- **D-H100-6 Local do verificador.** *Recomendação:* o Architect escolhe a linguagem; deve rodar em `check:all` e em teste, sem dependência nova.

## Resumo em linguagem simples

Este refino define como provar, de forma automática, que não existe nenhum botão, chave ou atalho para desligar os e-mails nem para reenviar avisos antigos. A verificação falha se algo assim aparecer no sistema, e também confere que o envio continua ativo.
