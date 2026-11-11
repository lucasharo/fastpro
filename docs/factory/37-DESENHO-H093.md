# Desenho H-093 — EmailProviderPort: Mailpit e Resend (Issue #103, WF-03, coluna Arquitetura)

- **Issue:** #103 · **História:** H-093 (E11) · **Workflow:** WF-03 · **Coluna:** Arquitetura · **Data:** 2026-11-11 · **Papel:** Software Architect
- **Base:** `36-REFINO-H093.md` (CA-H093-01..14); `08-ARQUITETURA.md` §12.5 e §12.6; `10-ADRS.md` (ADR-011, ADR-022, SD-03); `11-ARQ-RISCOS-E-TESTES.md` (I-27, N-09, N-10); `spikes/S-11-RESULTADO.md`; `packages/domain/src/notifications/ports.ts` e `packages/db/src/notifications.ts` (somente leitura).
- **Natureza:** somente documento. Nenhum código, teste, chave, domínio, instalação ou envio. Valores de variáveis nunca aparecem; só nomes.
- **Etiquetas:** `[APROVADO]` já registrado ou decidido pelo Orquestrador · `[PROPOSTA]` deste desenho · `[NÃO VERIFICADO]` sem fonte nesta rodada (nenhuma página oficial consultada; nenhuma chamada externa feita).

## 0. Decisões adotadas (Orquestrador) e como entram

| Id | Decisão | Efeito neste desenho |
|---|---|---|
| D1 | Resend só ativo quando variável marcada pelo titular indicar domínio verificado; sem consulta à API | §3.1: variável `RESEND_VERIFIED_DOMAIN` (nome `[PROPOSTA]`) |
| D2 | Adotar S-11 e 08 §12.5; sem modo de teste do Resend | §0.1 abaixo e §1 |
| D3 | Retentativa é do pipeline H-092, não do adaptador | §4: adaptador só classifica; sem estado, sem laço de retentativa |
| D4 | Cota excedida tratada como `limite_taxa` até confirmação | §4.2 |
| D5 | Instalação real do Mailpit é pendência de ambiente | §6.2; nada é instalado agora |

### 0.1 Correção da decisão 15 (a ser refletida pelo Orquestrador em `11-DECISOES.md`)

A decisão 15 diz "Mailpit local + **modo de teste do Resend (T8)**", e 11-ARQ (cabeçalho, I-27 na revisão anterior) fala em "redirecionamento único do Resend em modo de teste". Isso **está superado**: a S-11 mostrou que o Resend só aceita teste para o e-mail da própria conta e com `onboarding@resend.dev`, e 08 §12.5 já registra que o redirecionamento não está confirmado. **Texto que vale:** "Lançamento real bloqueado até existir domínio; até lá Mailpit local em dev/CI e **nenhum envio pelo adaptador Resend**. O adaptador Resend não tem modo de teste nem redirecionamento." O script do spike (`spikes/s11/s11-send.mjs`) continua sendo a única forma de teste real, fora do produto. Este desenho não edita `11-DECISOES.md`.

## 1. Escolha do adaptador pelo ambiente (CA-H093-01, 02; I-27)

**Onde mora o código `[PROPOSTA]`:** novo pacote `packages/email` (`@fastpro/email`), que depende só dos tipos de `@fastpro/domain`. `domain` continua sem I/O; `db` não conhece provedor. Quem monta o `NotificationDeps` (api/jobs) chama a função de seleção uma vez, na partida.

**Função de seleção** `[PROPOSTA]`: `createEmailProvider(env, deps): EmailProviderPort`, função pura sobre um objeto de variáveis (testável sem `process.env`). Variáveis: `APP_ENV`, `EMAIL_PROVIDER`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `RESEND_API_KEY`, `RESEND_VERIFIED_DOMAIN` (nova; entra no `.env.example` só como nome). Todas já existem em `.env.example`, exceto a nova.

| `APP_ENV` | `EMAIL_PROVIDER` | Resultado |
|---|---|---|
| desenvolvimento ou teste/CI | `mailpit` | `MailpitProvider` (`name = 'mailpit'`) |
| desenvolvimento ou teste/CI | `resend` | **recusa a partida** (I-27: zero chamada externa em dev/CI) |
| homologação ou produção | `resend` | `ResendProvider` (`name = 'resend'`), que ainda aplica §3 a cada envio |
| homologação ou produção | `mailpit` | **recusa a partida** (evita descartar e-mail em silêncio) |
| qualquer | ausente, vazio ou desconhecido | **recusa a partida**; nunca provedor padrão |
| `APP_ENV` ausente ou desconhecido | qualquer | **recusa a partida** |

- A recusa é erro de configuração com **código fixo** (`email_provider_invalido`, `email_provider_incompativel_com_ambiente`, `app_env_invalido`), sem valores no texto.
- Os valores aceitos de `APP_ENV` ainda não estão definidos no repositório (`.env.example` só tem o nome). **Pendência de H-093 para o DEV:** fixar a lista fechada e registrá-la em `.env.example` como comentário.
- Homologação hospedada sem domínio: `EMAIL_PROVIDER=resend` parte, mas todo envio volta `nao_configurado` (§3), então nada sai e nada se perde. Se for preciso ver e-mails nesse ambiente, é decisão futura (não há Mailpit hospedado); fora de H-093.
- A mesma instância serve ao e-mail de login direto na requisição (H-097): o resultado `nao_configurado` ali segue a regra de 08 §12.6(v) (resposta uniforme e item na fila).

## 2. Duas implementações atrás da mesma porta (CA-H093-03, 04, 07, 13, 14)

Contrato inalterado: `send(message): Promise<SendResult>`; nenhuma exceção sai do adaptador (qualquer falha vira um `SendResult`). Os dois adaptadores recebem, por injeção: um **renderizador** de modelo, um **transporte** (SMTP ou HTTP) e um **relógio** (para o recuo de cota). Isso permite testar tudo com dublês.

### 2.1 Renderizador `[PROPOSTA]`
O `EmailMessage` traz `templateKey` e `params`, e o adaptador precisa de assunto e corpo. Para não bloquear H-093 nos textos (H-095..H-099), cria-se a interface `EmailRenderer.render(templateKey, params) -> { subject, text, html? }`. H-093 entrega só um **renderizador mínimo** (assunto e texto genéricos por `templateKey`, sem usar `params` além de contagem e referências opacas já validadas por `assertSafeTemplateParams`). Os textos finais entram nas histórias H-095..H-099, sem mudar os adaptadores. O renderizador não recebe o endereço de destino.

### 2.2 Mailpit (contrato SMTP local)
- **Protocolo:** SMTP em `SMTP_HOST:SMTP_PORT`, sem autenticação e sem TLS (padrão do Mailpit local). O envio de verdade usa uma biblioteca SMTP atrás da interface `SmtpTransport.sendMail(envelope, raw)`; a escolha da biblioteca é do DEV (`[PROPOSTA]`: `nodemailer`, licença MIT, gratuita; versão não verificada).
- **Falha fechada local:** na partida, `SMTP_HOST` precisa ser endereço de laço local (`localhost`, `127.0.0.1`, `::1`); qualquer outro host recusa a partida. Garante I-27 mesmo com variável trocada por engano.
- **Conteúdo enviado:** remetente `EMAIL_FROM`, destinatário `message.to`, assunto e corpo do renderizador, cabeçalho `X-FastPro-Template: <templateKey>` e `Message-ID` derivado da chave de idempotência (§4.3). Nenhum outro dado.
- **Retorno:** `aceito` com `providerMessageId` = `Message-ID` usado (o Mailpit não devolve identificador próprio de forma garantida; `[NÃO VERIFICADO]`).
- **Sem deduplicação no Mailpit** `[NÃO VERIFICADO]`: reenvio com a mesma chave pode aparecer duas vezes na caixa local. Em dev isso é aceitável; a garantia de "um e-mail só" (CA-H093-12) vale para o Resend (§4.3) e é provada por dublê (§5).
- **Supabase CLI:** a porta SMTP do Mailpit embutido na pilha local e o nome da seção de configuração `[NÃO VERIFICADO]`; o DEV confere no ambiente (§6.2).

### 2.3 Resend (API)
- **Chamada:** `POST https://api.resend.com/emails` (o mesmo ponto usado no spike S-11), `Authorization: Bearer <RESEND_API_KEY>` lido da variável no momento do envio, corpo com `from` (`EMAIL_FROM`), `to`, `subject`, `text`.
- **Tempo limite:** 10 s por chamada `[PROPOSTA]`, via cancelamento da requisição; estouro vira `indisponivel`.
- **Cabeçalho de idempotência:** `Idempotency-Key` com a chave derivada (§4.3). Que a API do Resend aceite esse cabeçalho, o prazo de validade e o formato dos conflitos **`[NÃO VERIFICADO]`** (o doc 13 e a S-11 não confirmam; é a pendência R-2 herdada de H-092). O desenho funciona nos dois casos (§4.3).
- **Retorno:** `aceito` com o `id` devolvido. **Nunca** inclui o corpo da resposta no código de erro nem em log.
- **Limite de taxa próprio:** o `SendPacer` do pipeline (200 ms, ≤ 5/s) já fica abaixo dos 10 req/s confirmados na S-11; o adaptador não duplica esse controle.

### 2.4 Dados sensíveis (CA-H093-13, 14)
- O adaptador não recebe nem grava endereço de pedido, telefone, corpo de mensagem, link ou código: o conteúdo vem do renderizador, limitado ao que `assertSafeTemplateParams` já valida em H-092.
- `message.to` só existe em memória durante a chamada. Não vai a log, a código de erro nem a nenhuma tabela. Códigos de erro são fixos e passam pelo filtro `^[a-z][a-z0-9_]{0,59}$` que o pipeline já aplica (`reasonOf`).
- `RESEND_API_KEY` nunca é interpolada em mensagem de erro; o objeto de configuração tem `toJSON` que omite segredos `[PROPOSTA]`.

## 3. Falha fechada do Resend e da configuração (CA-H093-05, 06; N-10)

Ordem de verificação em **cada** envio do `ResendProvider`, antes de qualquer chamada externa:

1. `RESEND_VERIFIED_DOMAIN` vazia ou ausente ⇒ `{ kind: 'nao_configurado', code: 'dominio_nao_verificado' }`. **Este é o estado de hoje.**
2. `EMAIL_FROM` ausente, ou cujo domínio não seja exatamente o de `RESEND_VERIFIED_DOMAIN`, ou o domínio `resend.dev` ⇒ `dominio_nao_verificado`. O remetente de teste `onboarding@resend.dev` do spike **nunca** é aceito em produto.
3. `RESEND_API_KEY` ausente ou vazia ⇒ `{ kind: 'nao_configurado', code: 'segredo_ausente' }`.
4. Só então a chamada HTTP.

### 3.1 O marcador de domínio (D1)
- `RESEND_VERIFIED_DOMAIN` guarda o **nome do domínio** que o titular conferiu no painel do Resend e escreveu na configuração do ambiente. Vazia = não verificado. Escolheu-se o nome do domínio, e não um simples "sim/não", porque permite conferir `EMAIL_FROM` contra ele (passo 2) e evita que um "sim" esquecido libere remetente errado.
- **Sem consulta à API** para verificar domínio: nenhuma chamada externa é feita pela simples seleção do adaptador.
- Somente o titular a preenche; nenhuma automação do projeto a escreve. Texto de agente não é controle de segurança (AGENTS.md): o controle real é a combinação de passos 1 a 3 mais a recusa do próprio Resend (item seguinte).

### 3.2 Defesa em profundidade
Se o marcador estiver preenchido por engano e o Resend responder **403 `validation_error`** (formato de recusa visto na S-11 §1), o adaptador devolve `nao_configurado/dominio_nao_verificado`, não `recusa_permanente`. Assim a mensagem **não é perdida** e o item volta a `pendente`.

### 3.3 Efeito no pipeline (já existente, sem mudança)
`processOutbox` trata `nao_configurado` com `requeue('pendente', attempts inalterado, +3600 s, code, releaseQuota=true)`: não consome tentativa, devolve a reserva de cota (H-094 não conta o que não saiu) e reavalia a cada hora. Quando o titular preencher a configuração e reiniciar a aplicação, os itens pendentes saem sozinhos. Ou seja, **nada em H-092 precisa mudar** para CA-H093-05, 06 e 11.

### 3.4 Falha de configuração na partida versus por envio
- **Na partida (aplicação não sobe):** problemas de seleção do §1 (provedor ausente/desconhecido/incompatível, `APP_ENV` inválido, `SMTP_HOST` não local no Mailpit).
- **Por envio (aplicação sobe, e-mail fica pendente):** domínio não verificado e segredo ausente do Resend. Motivo: faltar domínio é o estado normal de desenvolvimento do produto e não pode derrubar o site.

## 4. Mapeamento de erros: retentativa ou falha definitiva (CA-H093-07..12; D3, D4)

O adaptador **só classifica**. Número de tentativas, recuo e teto são do pipeline H-092 (`MAX_SEND_ATTEMPTS = 8`, recuo `60·2^(n−1)` s até 3600 s; `limite_taxa` com piso de 60 s; `nao_configurado` com 3600 s). Isso torna os valores de CA-H093-08..11 configuráveis em um só lugar (a configuração do pipeline) e deixa o adaptador sem estado (D3).

### 4.1 Resend (HTTP) para `SendResult`

| Resposta do Resend | `SendResult` | Efeito do pipeline |
|---|---|---|
| 200 com `id` | `aceito` | `markSent` com o identificador |
| 429 comum (taxa) | `limite_taxa`, `retryAfterSeconds` = cabeçalho de espera, ou 60 se ausente | volta a `pendente`, sem gastar tentativa |
| 429 de cota diária ou mensal (D4) | `limite_taxa`, `retryAfterSeconds` = segundos até 00:00 UTC do dia seguinte (cota diária) | idem; ver risco R-3 |
| 403 `validation_error` | `nao_configurado/dominio_nao_verificado` (§3.2) | `pendente`, +1 h |
| 401 (chave ausente, inválida ou revogada) | `nao_configurado/segredo_ausente` | `pendente`, +1 h; nada se perde |
| 400, 422 (parâmetro ou destinatário inválido) | `recusa_permanente`, código `resend_http_<status>` | `falha`, sem nova tentativa |
| 404, 405 e demais 4xx (exceto os acima e 408/409) | `recusa_permanente`, `resend_http_<status>` | `falha` |
| 409 de requisição concorrente com a mesma chave `[NÃO VERIFICADO]` | `indisponivel`, `resend_conflito` | nova tentativa com recuo |
| 408, 5xx | `indisponivel`, `resend_http_<status>` | recuo até 8 tentativas, depois `falha` |
| tempo esgotado, falha de rede, resposta sem JSON ou sem `id` | `indisponivel`, `timeout` / `rede` / `resposta_invalida` | idem |
| qualquer coisa não prevista | `indisponivel`, `resend_inesperado` | idem (limitado pelas 8 tentativas) |

Regras: a decisão usa o **status HTTP**; o texto do erro devolvido pelo Resend é lido só para distinguir 429 de cota e 403 de domínio, e **nunca** é copiado para o código. Os nomes exatos dos erros de cota excedida e de conflito de idempotência **não estão verificados** (S-11 §5): a classificação por texto é feita por dublê e fica em uma tabela de uma linha por caso, fácil de corrigir após o primeiro caso real. Enquanto não verificado, 429 de qualquer tipo cai em `limite_taxa` (D4).

### 4.2 Mailpit (SMTP) para `SendResult`

| Situação | `SendResult` |
|---|---|
| Resposta 2xx ao fim do `DATA` | `aceito` |
| Conexão recusada, tempo esgotado, ou 4xx de SMTP | `indisponivel`, `mailpit_indisponivel` / `timeout` / `smtp_4xx` |
| 5xx de SMTP (endereço ou mensagem rejeitados) | `recusa_permanente`, `smtp_5xx` |

O Mailpit nunca devolve `nao_configurado` nem `limite_taxa`.

### 4.3 Mesma chave de idempotência em todas as tentativas (CA-H093-12; R-2)
- O adaptador **não gera chave**: usa `message.idempotencyKey`, que o pipeline já preenche com `dedupe_key` da linha, igual em toda tentativa (`processOutbox` lê `row.dedupeKey` a cada claim).
- Para não expor identificadores de usuário e escopo (a chave tem a forma `nc:<evento>:<usuário>:...`), o adaptador envia ao provedor `idem = hex(SHA-256(chave))` (64 caracteres, determinístico, dentro de qualquer limite razoável de tamanho `[PROPOSTA]`). A mesma chave ⇒ o mesmo `idem`. No Mailpit, o `Message-ID` é `<idem@fastpro.invalid>`.
- Efeito esperado no Resend, **se** o cabeçalho for aceito: uma segunda chamada com o mesmo `idem` devolve a resposta original, sem segundo e-mail. A janela de validade `[NÃO VERIFICADO]`: o pipeline tenta no máximo 8 vezes com recuo até 1 h (soma aproximada de 5 h), portanto cabe dentro de qualquer janela de 24 h típica; mas `limite_taxa`, `nao_configurado` e `adiado_cota` podem alongar o intervalo. Duplicata só ocorre se a primeira chamada **chegou** e a resposta se perdeu **e** a nova tentativa passar da janela: raro, e aceito no pior caso (R-2).
- **Se o Resend não aceitar o cabeçalho** (hipótese a confirmar): o desenho degrada para o pior caso já aceito em H-092 (R-2), sem alteração de contrato. A confirmação é uma pendência do teste de integração futuro, não bloqueia H-093.

## 5. O que é testado com o provedor simulado

Regra: **nenhum teste de H-093 faz chamada externa nem abre conexão real**. Dublês: `FakeHttp` (resposta roteirizada, registra o pedido) e `FakeSmtp` (idem), mais o `FakeClock` e o `FakeEmailProvider` já existentes no `@fastpro/testkit` (este último continua sendo o provedor dos testes do pipeline H-092).

| Grupo | O que se prova | CA / teste |
|---|---|---|
| Seleção | Todas as linhas da tabela do §1: dev/CI + `mailpit` ok; dev/CI + `resend` recusa; produção + `mailpit` recusa; ausente/desconhecido recusa; `SMTP_HOST` não local recusa; mensagens de erro sem valores | CA-01, 02; N-09; I-27 |
| Mailpit | Envelope e cabeçalhos corretos (sem dados fora da lista do §2.2); `name = 'mailpit'`; mapeamento do §4.2; nenhum acesso HTTP | CA-03, 04, 07 |
| Resend, falha fechada | Marcador vazio ⇒ `nao_configurado/dominio_nao_verificado` e **zero chamadas** no `FakeHttp`; `EMAIL_FROM` fora do domínio ou `resend.dev` idem; chave ausente ⇒ `segredo_ausente` e zero chamadas; ordem dos passos | CA-05, 06; N-10 |
| Resend, mapeamento | Cada linha da tabela do §4.1 com a resposta roteirizada (status, cabeçalho de espera, formato de 403 da S-11, cota excedida hipotética); 429 de cota calcula espera até 00:00 UTC com o `FakeClock` | CA-07..11 |
| Idempotência | Duas chamadas com a mesma `idempotencyKey` produzem o mesmo `idem` no cabeçalho e no `Message-ID`; chaves diferentes produzem `idem` diferentes; o `idem` não contém trecho da chave original | CA-12 |
| Segurança | Varredura dos pedidos registrados, retornos de erro, mensagens de exceção e logs: não contêm endereço de destino, valor de `RESEND_API_KEY` nem `params` fora da lista; códigos casam o filtro `^[a-z][a-z0-9_]{0,59}$` | CA-13, 14 |
| Integração com o pipeline | `processOutbox` + adaptador real sobre `FakeHttp`/`FakeSmtp`, com o banco de teste existente (`db:test`): `nao_configurado` deixa a linha `pendente` sem gastar tentativa; `recusa_permanente` ⇒ `falha`; `indisponivel` ×8 ⇒ `falha`; `aceito` ⇒ `enviado` com o `provider` correto (`mailpit` ou `resend`) | CA-07..11 ponta a ponta |

Execução local (`corepack pnpm check:all`, `db:test`, `lint`, `typecheck`, `test`), sem GitHub Actions (AGENTS.md). A evidência é o resultado local registrado na Issue #103.

**Fora do teste desta história:** chamada real à API do Resend (só o script do spike, e só para a conta do titular); servidor Mailpit real (D5); webhook de bounce; leitura de cabeçalhos de cota.

## 6. Riscos e pendências

### 6.1 Riscos
| Id | Risco | Mitigação |
|---|---|---|
| R-1 | Adaptador Resend implementado e nunca testado contra a API real: formato de resposta pode diferir do dublê | Dublê baseado nos fatos da S-11 (403 `validation_error`); classificação por status HTTP, não por texto; texto só em 2 casos, em tabela corrigível; teste real só após domínio |
| R-2 | Duplicata de e-mail se a resposta se perder e a chave de idempotência não for aceita ou tiver expirado | Chave estável por linha, enviada em hash; pior caso já aceito em H-092 (R-2); confirmar o cabeçalho no primeiro teste real |
| R-3 | **Cota excedida tratada como `limite_taxa` (D4)**: o pipeline não conta `limite_taxa` como tentativa, então uma cota diária estourada poderia gerar tentativa a cada 60 s durante horas | O adaptador devolve `retryAfterSeconds` até 00:00 UTC quando reconhece cota diária; o contador próprio (H-094) e os cortes de `QUOTA_CUTS` já seguram antes de chegar ao provedor. Se a cota **mensal** for atingida, o adaptador devolve espera de 1 dia (`[PROPOSTA]`) até haver verificação. Sem teto de tentativas para `limite_taxa` no pipeline: **recomendo ao DEV/Revisor conferir se vale um teto de segurança em H-092/H-094**, sem alterá-lo agora |
| R-4 | Marcador de domínio preenchido por engano antes de o domínio estar verificado | Passo 2 do §3 (remetente tem de pertencer ao domínio) + recusa 403 do Resend vira `nao_configurado` (§3.2): a mensagem não se perde e nada é enviado a terceiros fora das regras do Resend |
| R-5 | `APP_ENV` não definido de forma fechada no repositório | Lista fechada e recusa de partida (§1); pendência de H-093 para o DEV |
| R-6 | E-mail de login (H-097) em ambiente sem domínio ficará sempre `pendente` | Já assumido: login real é bloqueio de lançamento (decisão 15); dev usa Mailpit |
| R-7 | Biblioteca SMTP nova (dependência) | Atrás de `SmtpTransport`; só em `packages/email`; gratuita; escolha final e auditoria de licença do DEV |
| R-8 | Mailpit sem deduplicação: duplicata local invisível ao teste de idempotência | Idempotência provada no dublê do Resend; Mailpit só captura |

### 6.2 Pendências de ambiente (D5)
- **Mailpit real não será instalado em H-093.** Fica registrado como pendência de ambiente local, sem conta, a ser feita em item próprio ou dentro de H-003 (confirmação do Orquestrador). Enquanto isso, CA-H093-04 é satisfeito pelo dublê do transporte; a **prova com o programa real** é a etapa que destrava o fechamento completo de CA-H093-03.
- `[NÃO VERIFICADO]` e a conferir no ambiente: porta SMTP do Mailpit na pilha local do Supabase CLI e seu nome de seção; ausência de autenticação e TLS no modo local.
- **Domínio verificado** (BK-10; decisão 15) continua pendência do titular; sem ele o Resend permanece em `nao_configurado`. Quando houver: preencher `RESEND_VERIFIED_DOMAIN`, `EMAIL_FROM` e `RESEND_API_KEY` no ambiente alvo; fazer **um** envio de verificação para a conta do titular pelo script do spike ou pelo adaptador; confirmar então `Idempotency-Key` (§2.3), resposta de cota excedida e significado de `x-resend-*-quota`.
- Webhook de bounce e supressão (`email_suppression`, `RESEND_WEBHOOK_SECRET`): fora de H-093; segue `[NÃO VERIFICADO]` (S-11 §5).

## 7. Plano para o DEV (resumo implementável)
1. `packages/email`: `createEmailProvider`, `MailpitProvider`, `ResendProvider`, interfaces `SmtpTransport`, `HttpTransport`, `EmailRenderer` (+ renderizador mínimo), hash de idempotência, mapeadores de erro (tabelas do §4) e códigos de configuração (§1). Sem I/O no módulo de decisão.
2. Fixar a lista fechada de `APP_ENV` e documentar `RESEND_VERIFIED_DOMAIN` no `.env.example` (somente nome).
3. Ligar a seleção ao ponto de composição que hoje monta `NotificationDeps` (provedor deixa de ser só o simulado fora dos testes).
4. Testes do §5 com dublês; registrar na Issue #103 comando, contagem e código de saída.
5. Nenhuma mudança em `packages/domain/src/notifications/ports.ts` nem em `packages/db/src/notifications.ts`; se o DEV julgar necessário, devolve ao Arquiteto.

## 8. Decisão do Arquiteto
**APROVADO_ARQUITETURA.** As decisões D1 a D5 cabem sem alterar a porta nem o pipeline. Dúvidas em aberto (nenhuma bloqueia o DEV): (a) lista fechada de `APP_ENV`; (b) confirmar o teto de segurança de `limite_taxa` (R-3); (c) local da instalação do Mailpit (D5).

## Resumo em linguagem simples
O desenho define como o sistema escolhe sozinho entre o programa de e-mails de teste (no computador, para desenvolver) e o serviço de envio real, e como ele se recusa a enviar de verdade enquanto não houver domínio verificado, sem perder nenhum aviso. Também define o que fazer quando o envio falha (tentar de novo ou desistir) e que um mesmo aviso nunca chega duas vezes ao cliente; tudo será testado com serviços de mentira, sem enviar e-mail nenhum.
