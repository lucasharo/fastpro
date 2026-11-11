# Decisão de caminho do spike S-09 sem publicar em produção (Issue #8, WF-03, Arquitetura)

- **Data:** 2026-11-11 · **Branch:** `feature/init` · **Entradas:** `40-SPIKE-S09-DESENHO.md`, `spikes/S-09-RESULTADO.md`, ADR-018, S-08 (fatos de plano Hobby).
- **Natureza:** SOMENTE documento. Nada foi executado na Vercel nem em outro host. Nenhum valor de `.env.local` foi lido.
- **Restrição nova do titular:** nenhum envio de produção, nem o "primeiro" de um projeto novo. A Vercel atribui o primeiro envio por CLI a produção (resultado do DEV, §4 do resultado parcial).
- **Decisão do Architect:** `AJUSTES_NECESSARIOS` no plano do spike (não no desenho do app). Recomendação: **opção 1** (§2).

## 1. Opções

| # | Opção | Prós | Contras |
|---|---|---|---|
| 1 | **Manter o teste local, completar o que dá localmente e registrar o resto como NAO VERIFICADO**, com verificação obrigatória na primeira pré-visualização real da H-009 | Custo zero; nenhum envio; respeita a restrição; o script do spike é reaproveitado; o pooler e o `sharp` podem ser exercitados sem a Vercel | Cold start, teto de 300 s, 413 e memória na plataforma continuam sem medida; ADR-018 A fica provisória |
| 2 | **Projeto Vercel ligado ao Git, envio de ramo que não é o de produção** (pré-visualização por push) | É o fluxo real que a H-009 usará; mede tudo que falta | Contraria a regra 3 do desenho 40 (sem integração Git); exige nova autorização escrita; se o projeto novo tratar o primeiro envio como produção (comportamento do Git **NAO VERIFICADO**), o titular teria uma publicação não autorizada. Só testável executando, o que não é permitido agora |
| 3 | **`vercel build` local e inspeção da saída** (`.vercel/output/functions`) | Confirma localmente o número de funções e o tamanho do pacote (CA-S09-01) sem enviar nada | Não mede nada de runtime; exige `vercel pull` (leitura de configuração na Vercel), que precisa de OK explícito do Orquestrador. Complementar à opção 1, não substituta |
| 4 | **Host gratuito equivalente** (Netlify, Render, Cloudflare Workers, Fly, Koyeb) | Mede cold start e memória em nuvem | Não é equivalente: teto de função, corpo máximo e Fluid compute são da Vercel; Netlify limita função síncrona a ~26 s, Workers não rodam NestJS+`pg` sem adaptação, Render/Koyeb são contêiner que dorme (outro tipo de cold start); Cloud Run/Lambda/Fly pedem cartão (fere "sem orçamento"). Resultado não confirmaria ADR-018 A |
| 5 | Enviar um app vazio uma vez como produção, sem domínio, e usar os envios seguintes como pré-visualização | Mede tudo | **Vetada pelo titular.** O endereço `*.vercel.app` de produção é público no Hobby |
| 6 | Sandbox da Vercel (MCP) | Isolada, sem produção | Máquina virtual, não função; não mede cold start, teto nem 413 da função. Não serve |

## 2. Recomendação

**Opção 1, com a opção 3 como complemento opcional (se o Orquestrador autorizar o `vercel pull`).** Opções 2 e 4 ficam registradas: a 2 vira o primeiro passo da H-009 (com autorização própria, na hora); a 4 é descartada por não provar o que o ADR-018 precisa.

**O que a decisão libera para o ADR-018:**
- Libera: H-008 (endpoint protegido do tick; já verificado localmente e independente de host); início do esqueleto da H-009 com "função única" como premissa **provisória**; regras de cliente `pg` (`max: 1`, consultas simples) se o passo L1 (§3) passar.
- Libera condicionalmente: H-027/H-056 (`sharp`) só se L2 carregar o binário `linux-x64`; sem isso ficam presas à primeira pré-visualização.
- **Não libera:** confirmar a contingência A como "VERIFICADA"; limiares de cold start (3 s/6 s); teto de 300 s; 413 acima de 4,5 MB; memória em plataforma; proteção de deploy e URL estável de pré-visualização; uso de cota. Esses limites seguem apenas como **fato de documentação (S-08), não medido**.
- Estado sugerido do ADR-018: "A adotada, provisória; limites de runtime NAO VERIFICADO; verificação obrigatória na primeira pré-visualização real; B/C/D mantidas como contingência".
- Risco aceito: se o cold start ou o pacote falharem, a descoberta vem na H-009 e o custo de trocar para B/C/D é maior. Mitigação: o gate de pré-visualização é o **primeiro** item da H-009, antes de módulos de negócio em volume.

## 3. O que muda no plano do DEV

Substitui os passos 2 (parte Vercel) a 10 do desenho 40. Passos 0 e 1 e as medições locais já feitas ficam válidos.

1. **Encerrar toda ação na Vercel.** Nenhum `deploy`, `env add`, `link` novo ou chamada de MCP de escrita.
2. **L1 – Pooler, a partir da máquina local** (leitura somente): obter o host do pooler (modo transação) pelo MCP do Supabase, sem imprimir senha; `ping-db` com 50 concorrentes e `ping-db-claims` com 200 (0 vazamento de `set_config`); consulta agregada em `pg_stat_activity`. Papel: o de menor privilégio do keep-alive; se não conectar no pooler, parar e perguntar (dúvida 2). Vale como prova do **comportamento do pooler**, não da latência Vercel-banco. Sem DDL.
3. **L2 – `sharp` linux-x64:** instalar em pasta de rascunho com `--os=linux --cpu=x64 --libc=glibc` e medir o tamanho total do pacote (meta ≤ 250 MB). Carregar o binário em WSL **se já existir** (sem Docker, sem instalar nada novo). Sem WSL: registrar "carga NAO VERIFICADO; empacotamento medido".
4. **L3 – Defesa de corpo:** limite de 4 MB no parser do Nest com resposta 413 própria (testável localmente), para a API não depender do 413 da plataforma.
5. **L4 – Opcional (opção 3):** `vercel build` local e contagem de funções, só após OK do Orquestrador.
6. **Reescrever `S-09-RESULTADO.md`** com status "PARCIAL ENCERRADO", marcando como NAO VERIFICADO: cold start, aquecido na plataforma, teto 300 s, 413 de plataforma, memória na plataforma, proteção de deploy, webhook externo, URL estável, cota. Manter o texto de que os valores locais não são da Vercel.
7. **Preparar o script do spike para reuso** na H-009 (medições dos passos 4 a 9 do desenho 40), com a pergunta de região resolvida.
8. **Higiene:** encerrar o servidor local da porta 3900 e registrar a pendência de apagar o projeto `fastpro-spike-s09` (sem deployments e sem variáveis; exige o titular ou autorização).
9. `git add` por caminho; não tocar nos arquivos pendentes da #24.

## 4. Dúvidas ao Orquestrador (numeração provisória `D-S09-C-n`)

1. **[BLOQUEANTE]** Aprovar a opção 1 e registrar em `11-DECISOES.md`, encerrando o S-09 como PARCIAL com o ADR-018 provisório. **Recomendação:** aprovar.
2. **[BLOQUEANTE para L1]** Autorizar a leitura somente do host/região do pooler pelo MCP do Supabase e o uso do papel keep-alive no pooler (sem DDL). Alternativa: papel novo (DDL, exige autorização). **Recomendação:** papel existente.
3. **[NÃO BLOQUEANTE]** Autorizar `vercel pull` e `vercel build` locais (leitura de configuração, sem envio) para a opção 3. **Recomendação:** autorizar.
4. **[NÃO BLOQUEANTE]** Perguntar ao titular, no início da H-009 e não agora, se aceita o experimento da opção 2 (projeto ligado ao Git, só ramo de pré-visualização), com regra de parada se aparecer produção. **Recomendação:** pedir nessa hora, com o texto exato da regra.
5. **[REGISTRO]** Apagar o projeto `fastpro-spike-s09` (painel pelo titular) e encerrar o servidor local da porta 3900.
6. **[REGISTRO]** Atualizar a linha do ADR-018 (estado provisório) e a nota de H-009 (gate de pré-visualização como primeiro item).

## Resumo em linguagem simples

Sem publicar nada de verdade, o teste na hospedagem não consegue medir tempo de despertar, limite de duração e tamanho de envio. Vamos fazer o que dá no computador (conexão com o banco, imagens, proteção contra envios grandes) e deixar o resto marcado como "não verificado" até o primeiro teste real da construção da API, com autorização própria.
