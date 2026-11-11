# Decisão de caminho do gate de pré-visualização da H-009 sem produção (Issue #22, WF-03, Arquitetura)

- **Data:** 2026-11-11 · **Branch:** `feature/init` · **Entradas:** `41-DECISAO-S09-CAMINHO.md`, `42-REFINO-H009.md`, `spikes/S-09-RESULTADO.md` §3.
- **Natureza:** SOMENTE documento. Nada foi executado na Vercel, no GitHub nem no banco. Nenhum valor de `.env.local` foi lido.
- **Decisão do Architect:** **BLOQUEADO_AUTORIZACAO** para o gate de pré-visualização (envio à plataforma). O restante da H-009 que não envia nada pode seguir (§3).

## 0. O que é fato e o que é suposição

- **Verificado (S-09 §3):** `vercel deploy --environment preview -y` num projeto novo, sem Git, foi respondido como `first_deployment_production`. Nenhum deployment foi criado.
- **Não verificado:** qualquer comportamento além disso. Em particular, se a regra do "primeiro envio" vale também para o primeiro push via Git, e se ela depende do ramo. Não há como provar sem enviar, e enviar é o que está vetado.

## 1. Opções

| # | Caminho | O que é verificado | O que é suposição | Risco de produção |
|---|---|---|---|---|
| a | Projeto sem Git, envio por CLI como preview (`--environment preview`, `--target preview`, `--prebuilt`) | Já tentado: a Vercel respondeu que o primeiro envio vira produção | Que outra flag ou `--prebuilt` mude isso. Provavelmente não, pois a regra é do projeto (nenhum deployment anterior) e não da flag | **Alto.** Já provado que falha com a flag de preview; repetir não ajuda |
| a2 | Medir sem envio: `vercel deploy` com confirmação prévia | A resposta de S-09 veio no momento do envio, não antes. Não há comando de simulação conhecido (dry-run) | Que exista um "dry-run". NAO VERIFICADO | Não elimina o risco; só detectaria depois do pedido |
| b | Integração Git, com ramo de produção configurado para um ramo que nunca recebe push (ex.: `main` sem uso) e push só de `feature/init` | Plano Hobby aceita repositório GitHub (documentação S-08) | Que o primeiro push em ramo não produtivo seja preview. A regra de "primeiro deployment é produção" pode valer para qualquer ramo. NAO VERIFICADO | **Desconhecido.** Só testável executando |
| c1 | `vercel build` local + inspeção de `.vercel/output` | Possível sem envio; mede número de funções e tamanho do pacote (CA-06) | Não mede runtime | Nenhum. Precisa de `vercel pull` (leitura de configuração) com OK do Orquestrador |
| c2 | Deploy Hooks, `vercel promote`, `vercel alias`, Rolling Releases | Dependem de um deployment já existente | Nenhuma | Não resolvem o primeiro envio |
| c3 | Primeiro envio inerte (app vazio, sem variáveis, sem código de negócio) aceito como produção, depois só preview | Funciona por construção: depois do primeiro, os próximos são preview | Que o endereço `*.vercel.app` de produção seja protegido ou público no Hobby (a decisão 41 diz público; não conferido) | **É uma produção**, ainda que inerte. Precisa de autorização explícita do titular |
| c4 | Host equivalente fora da Vercel, sandbox da Vercel | Já descartados na decisão 41 (não provam ADR-018 A) | | Nenhum, mas sem valor de prova |

**Conclusão:** nenhum caminho dentro do Hobby comprovadamente evita produção no primeiro envio. O único que talvez evite (b) só pode ser descoberto executando, e a falha dele é uma produção não autorizada. O único garantido para depois do primeiro envio (c3) é, por definição, uma produção.

## 2. Recomendação

1. **Manter o gate de pré-visualização BLOQUEADO** (`BLOQUEADO_AUTORIZACAO`) até o titular responder à pergunta do §4. Nenhum envio, nenhum `link` novo, nenhuma chamada de escrita na Vercel.
2. **Recomendação de fundo para o titular (§4): autorizar o caminho c3 reduzido**, com conteúdo inerte. É o único com resultado previsível e custo de dano próximo de zero. A alternativa (b) fica como segunda escolha, aceitando que o teste pode, ele mesmo, criar produção.
3. Dentro do que o titular autorizou (criar o projeto Hobby), nada impede **manter** o projeto já criado, ou criá-lo vazio, desde que não se envie nada.

## 3. O que o gate pode fazer sem produção (liberado já)

Tudo isto é local ou de leitura. Não cria deployment.

- Estrutura do app e `vercel.json` (região, rewrites `/api/*`, função única), validados com `tsc` e testes locais.
- Variáveis: definir só os **nomes** exigidos (CA-14); valores só na plataforma, e só após autorização.
- CA-07 parte local (4 MB vs 4,5 MB, já feito em S-09 §7) e CA-08 local (`/health`, tick 401/200).
- CA-05 parte local: empacotamento do `sharp` linux-x64 (51 MB já medido). Carga em Linux continua NAO VERIFICADO.
- CA-06 por opção c1 (`vercel build` local), só com OK do Orquestrador para o `vercel pull`.
- CA-11: executar `pooler-check.cjs` assim que o Orquestrador obtiver o host do pooler (D-H009-4). Prova o comportamento do pooler, não a latência Vercel-banco.
- Redigir o texto da regra de parada (CA-02) e o roteiro do primeiro envio, prontos para o dia da autorização:
  - conteúdo do primeiro envio: rota `/health` fixa, sem variáveis, sem acesso ao banco;
  - se aparecer destino "production": parar, sem promoção nem alias, avisar o Orquestrador, registrar na Issue.
- Fica **bloqueado** até a autorização: CA-01, CA-03, CA-04, CA-09 e CA-10 (dependem de envio), parte de CA-05, CA-06 e CA-07 na plataforma.

## 4. Pergunta ao titular (via Orquestrador)

**P-H009-1 [BLOQUEANTE para o gate].** O primeiro envio de um projeto novo na Vercel pode ser tratado como produção, e eu não consigo provar o contrário sem enviar. Você autoriza **um único** envio inicial **inerte** (uma página de saúde, sem variáveis, sem banco, sem domínio) mesmo que a Vercel o classifique como produção? Depois dele, todos os envios seriam de pré-visualização, e o envio inerte pode ser apagado ao final.

- **Recomendação:** autorizar. É a forma de testar a hospedagem sem expor nada seu; o risco é só aparecer um endereço público que mostra "ok".
- **Se a resposta for não:** o gate fica bloqueado, o ADR-018 A permanece provisório, e a H-009 segue só com o que é local (§3). Opção alternativa (b) só com nova autorização, porque a falha dela também é produção.

## 5. Efeitos nos documentos (a cargo do Orquestrador)

- `42-REFINO-H009.md`: D-H009-1 passa a ser respondida por esta decisão (BLOQUEADO até P-H009-1). CA-02 mantém a regra de parada.
- ADR-018: continua "A adotada, provisória; limites de runtime NAO VERIFICADO".

## Resumo em linguagem simples

A hospedagem trata o primeiro envio de um projeto novo como versão pública final, e não há como testar isso sem enviar. Por isso o teste na hospedagem fica parado até você decidir se aceita um primeiro envio vazio e inofensivo, e o que dá para fazer no computador segue andando.
