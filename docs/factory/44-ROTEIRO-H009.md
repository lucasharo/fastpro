# H-009 — Roteiro do primeiro envio e regra de parada (Issue #22, WF-03, Desenvolvimento)

- **Data:** 2026-11-11 · **Branch:** `feature/init` · **Entradas:** `42-REFINO-H009.md`, `43-DECISAO-H009-CAMINHO.md`, `spikes/S-09-RESULTADO.md`.
- **Estado:** parte local concluída. **Gate de pré-visualização BLOQUEADO** por autorização do titular (P-H009-1, D-H009-1). Nenhum envio, nenhuma ação na Vercel, nenhuma conexão com banco de produção.
- **Etiquetas:** [APROVADO] decisão do titular ou regra da fábrica · [PROPOSTA] a validar · NAO VERIFICADO = nada medido na plataforma ainda.

---

## 1. O que a parte local entrega (sem Vercel)

| Item | Onde | Verificação local |
|---|---|---|
| API de função única (healthcheck, tick protegido, limite de corpo) | `apps/api/src/app.ts`, `apps/api/src/vercel.ts`, `apps/api/api/index.ts` | `@fastpro/api` test: 16 testes passam |
| Configuração de exemplo da função (região, `maxDuration` 300) | `apps/api/vercel.json` | teste de leitura do JSON |
| Web estático e cabeçalhos de exemplo | `apps/web/public/index.html`, `apps/web/vercel.json` | teste de cabeçalhos e de ausência de CORS |
| Nomes de variáveis | `.env.example` (sem alteração: `APP_ENV`, `LOG_LEVEL`, `JOBS_TICK_SECRET` já existiam) | `check:env` |

Reaproveitamento do código existente: apenas o núcleo de autenticação do tick de `@fastpro/db` (`isTickAuthorized`, `TICK_PATH`, `TICK_BODY_LIMIT_BYTES`). Nenhum código do spike S-09 foi copiado. A API usa `node:http` puro, sem NestJS; a alternativa A da ADR-018 segue provisória até o gate.

### Critérios cobertos localmente (sem plataforma)

- **CA-08 (local):** `GET /health` 200; tick 401 sem segredo, 401 com segredo errado, 401 com segredo menor que 32 caracteres ou ausente, 200 com segredo correto. Testado com servidor local.
- **CA-07 (parte local):** limite de 4 MB inclusivo na leitura (4,0 MB aceito; 4,0 MB + 1 byte e 4,5 MB marcados como estouro). Corpo do tick acima de 1 KB recebe 413.
- **CA-09 (parte local):** `/api/health` e `/health` respondem a mesma rota; o web de exemplo não libera origem cruzada.
- **CA-06 (parte local):** `apps/api/vercel.json` declara uma função. O tamanho do pacote na plataforma continua NAO VERIFICADO.
- **CA-05 (parte local):** pacote `sharp` linux-x64 fica para a plataforma (já medido em S-09 como 51 MB no pacote, carga em Linux NAO VERIFICADO).

### Critérios bloqueados pela decisão (dependem de envio)

CA-01, CA-03, CA-04, CA-09 (na plataforma), CA-10, CA-11 (depende do host do pooler, D-H009-4), e as partes de CA-05, CA-06 e CA-07 medidas na plataforma. Tudo NAO VERIFICADO até a autorização.

### Itens de configuração de exemplo que a plataforma ainda não confirmou

- `regions: ["gru1"]`: suposição do S-09, NAO VERIFICADO.
- `functions: { "api/index.ts": { maxDuration: 300 } }`: reconhecimento do arquivo e do teto pela Vercel, NAO VERIFICADO.
- Rewrite `/api/*` do web para a função: **não incluído**. O destino depende de D-H009-2 (um projeto ou dois) e só pode ser definido com a plataforma confirmada.

---

## 2. Pré-condições antes de qualquer envio (todas obrigatórias)

1. **Autorização escrita específica do titular** para o caminho escolhido (P-H009-1 e D-H009-1 respondidas). A autorização dada em 2026-11-11 cobre só a criação do projeto Hobby, sem domínio e sem cobrança.
2. **Caminho escolhido** registrado em `43-DECISAO-H009-CAMINHO.md` (recomendação do Architect: c3 reduzido, envio inerte). A opção (b), integração Git, só com autorização própria.
3. **Projeto Hobby sem conexão Git** e sem variáveis de produção. Antes do envio, confirmar no painel (leitura) que nenhum projeto da conta está ligado ao repositório `lucasharo/fastpro`. Se houver ligação, uma nova ação em `feature/init` pode disparar deploy: parar e avisar o Orquestrador. Esta verificação NAO foi feita por este agente (proibição nesta etapa).
4. **Conteúdo do primeiro envio:** só a função da API de exemplo, **sem variáveis definidas** no ambiente de pré-visualização (sem `JOBS_TICK_SECRET`, sem banco, sem Resend, sem Mapbox). Sem essas variáveis, o tick responde 401 (fechado por padrão), e `/health` continua funcionando.
5. **Sem domínio, sem `--prod`, sem promoção, sem alias de produção, sem plano pago.** (CA-13)

## 3. Roteiro do primeiro envio (só após as pré-condições)

1. Registrar na Issue #22 o estado do projeto antes do envio (nome, plano, nenhum deployment, nenhuma variável). Sem valores de segredo.
2. Enviar **um** deployment de pré-visualização da função, conforme o caminho escolhido em 43. Não repetir o comando de S-09 (`--environment preview`), que já foi respondido como produção.
3. **Aplicar a regra de parada (§4) imediatamente** se a resposta indicar produção.
4. Se o envio for aceito como pré-visualização: listar os deployments com o destino de cada um (CA-01). Registrar comando, saída e data na Issue.
5. Chamar `GET /health` e o tick sem segredo (401) e com segredo de teste (200), no endereço de pré-visualização. O segredo de teste existe só na configuração do ambiente de pré-visualização e não é registrado (CA-08, CA-14).
6. Medir cold start e aquecido (CA-03, mínimo de 10 amostras cada, com p50 e p95; limiar só se o Architect aprovar, D-H009-3).
7. Medir o limite de 300 s (CA-04), o 413 da plataforma (CA-07), a memória (CA-05) e o tamanho do pacote (CA-06) com a função da API.
8. Só depois, e com outra autorização, decidir sobre o endereço público do envio inerte e a remoção do projeto.

## 4. Regra de parada (CA-02) — texto para o titular e para o Orquestrador

> Se **qualquer** resposta da Vercel (envio, listagem, painel ou log) indicar destino **"production"**, ou mostrar `first_deployment_production`, o gate **para na hora**:
> 1. não promover o deployment, não criar nem mover alias, não configurar domínio, não enviar outro deployment;
> 2. não apagar nada sem autorização (o envio pode ser removido só quando o titular pedir);
> 3. avisar o Orquestrador e registrar na Issue #22 a resposta literal, sem valores de variáveis ou segredos, com a hora da ocorrência;
> 4. o ADR-018 A continua provisório, e a H-009 segue só com o que é local.

## 5. Pendências deste roteiro

- **P-H009-1** (titular): autorizar ou não o envio inerte mesmo que a Vercel o classifique como produção. Recomendação: autorizar, com a regra de parada acima.
- **D-H009-1** (titular ou Orquestrador): caminho do primeiro envio (c3 reduzido ou b).
- **D-H009-2** (Orquestrador): um projeto (`fastpro-web` e função da API) ou dois. Nomes sugeridos sem sufixo de ambiente.
- **D-H009-3** (Architect): limiares de cold start (referência 3 s e 6 s, não validada).
- **D-H009-4** (Orquestrador, via MCP do Supabase): host do pooler, para o CA-11. Sem host, CA-11 fica NAO VERIFICADO.
- **Remoção do projeto `fastpro-spike-s09`** (titular, S-09 §9 item 3): fora desta história.

## 6. Resumo em linguagem simples

O código da hospedagem está pronto no computador e passou em todos os testes locais. Nada foi enviado para a Vercel, porque ela trata o primeiro envio de um projeto novo como versão pública, e isso ainda não foi autorizado. Este documento deixa o passo a passo pronto para o dia em que você decidir.
