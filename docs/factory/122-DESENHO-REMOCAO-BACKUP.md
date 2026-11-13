# 122 — Desenho da Issue #151: remover backup, restauração e exportação de cópia do banco do escopo

- **Issue:** #151 — [E15] Remover backup, restauração e exportação de dados do escopo do projeto
- **Workflow:** WF-03, etapa Arquitetura (desenho)
- **Data:** 2026-11-13
- **Entradas:** `121-REFINO-REMOCAO-BACKUP.md` (seção 4, inventário; seção 7, CA-H151-01 a 16) e `11-DECISOES.md`, Rodada 75 (decisões 349 a 358, adotadas como recomendadas pelo líder).
- **Natureza desta entrega:** SOMENTE documento novo. Nenhum documento existente, código, script, migração ou teste foi alterado. Nenhum comando foi executado contra banco e nenhum serviço externo (Mapbox) foi chamado. As linhas citadas vêm do refino 121 e podem ter deslocado: o DEV localiza cada trecho pelo texto-âncora, nunca pelo número da linha.
- **Escopo do desenho:** plano de edição de documentos (CA-H151-01 a 10 e 12 a 16). O código de backup (`db:backup`, `backup.mjs`, `lib/backup.mjs`, `lib/export.mjs`, testes, papel `app_backup_reader`, grants) fica para Issue própria (decisões 351 e 352) e não entra aqui (CA-H151-11).

---

## 1. Regras de redação (valem para todo o plano)

Decorrem das decisões 349 a 358.

1. **Direitos do titular ficam (349).** H-111, RF-140, `dsr_case`, "acesso, correção, eliminação" não mudam. O que sai é backup, restauração e exportação de CÓPIA do banco.
2. **Numeração preservada (357).** Item com identificador (H-119, BK-7, RC-11, D-01, D-02, D-03, D-08, 12-TODO #1, nível 15 do plano de QA, TL-3) NÃO é apagado nem renumerado: a linha continua no lugar, com o mesmo identificador, e o conteúdo é trocado por uma **lápide**. Linha sem identificador (parágrafo, critério solto, diretriz) é removida de verdade.
3. **Lápide (formato único):** `<ID> — REMOVIDO(A) do escopo (Rodada 73/75, #151). Texto original no histórico do git.` Dentro de tabela, manter o mesmo número de colunas (ID na primeira, lápide na coluna de título, demais com "—"). A lápide não usa a palavra "backup" nem "restauração".
4. **Marca de superação (formato único):** `[SUPERADO — Rodada 73/75, #151]` no início da linha ou do parágrafo, com o texto original mantido. Usada onde o refino diz SUPERADO (histórico dentro de documento vivo).
5. **Toda linha restante que contenha termo de backup carrega `#151`** (lápide, marca de superação, ou texto de risco aceito). Isso torna a prova por busca (seção 5) simples: o que não tem `#151` e casa com o termo tem de estar na lista permitida (seção 5.4).
6. **"Sem backup" como fato de fornecedor só em `13-VERIFICACAO-SERVICOS.md` (355).** Nas listas de limites do Supabase Free (08 §16.7, 09 §9, 18-PLANO A4, 19 V-10, 10-ADRS ADR-020) a expressão sai; ficam pausa de projeto e demais limites. Exceção: R-08 (risco aceito, regra 7).
7. **R-08 vira risco aceito (350).** O registro de perda de dados no plano gratuito permanece, sem mitigação de backup, com a frase "Risco aceito pelo usuário (Rodada 73; decisão 350; #151)". Os valores de probabilidade e impacto existentes não mudam; o DEV só troca a coluna de mitigação e de situação. Mitigações que permanecem: keep-alive (H-010, D-04) e migração compensatória.
8. **Gates sem a condição "backup" (356).** Retirar a palavra e ajustar a pontuação da lista. Não acrescentar condição nova, não afrouxar nenhuma outra, e registrar no commit que a retirada é a decisão 356.
9. **Keep-alive intacto.** Onde keep-alive e backup estão juntos (H-010, 0.12, §16.7, §9 D-04), tirar só a parte de backup.
10. **Docker (358).** O texto de 08 §17 sobre "Supabase CLI + Docker" NÃO é tocado.
11. **Fora do alcance de edição:** `11-DECISOES.md` linhas antigas (append-only), `quadro-status.md`, `quadro-dados.js` (só o líder), e qualquer código, migração, teste, `package.json`, `.gitignore`.

---

## 2. Plano de edição documento a documento

Cada linha da tabela corresponde a UM commit (seção 3). A coluna "Âncora" é o texto para localizar o trecho.

### 2.1 `docs/factory/09-MODELO-DADOS.md` (primeiro, por causa da #59)

| Seção / âncora | Atual (resumo) | Ação / nova redação |
|---|---|---|
| Tabela de classes de dados, linha "Backups / destino de backup / RC-11" | Classe de dado "Backups" | Remover a linha da tabela (é linha de classe, não ID de regra). Não mexer nas demais classes. |
| Regras de retenção, item **RC-11** "Backups: rotação, sobrescrever, [PENDENTE JURÍDICO] L1" | Regra de retenção de backup | Manter o item na mesma posição, trocar o conteúdo pela lápide (regra 3): `RC-11 — REMOVIDA do escopo (Rodada 73/75, #151). Texto original no histórico do git.` Não renumerar RC-12 em diante. |
| §9 Supabase Free, lista de limites com "sem backup" | Lista com "sem backup" | Tirar apenas o item "sem backup". Pausa e demais limites ficam. |
| **§3.8 / `dsr_case`** e **§3.10** | Direitos do titular; §3.10 será tocado pela #59 | NÃO TOCAR (CA-H151-14). §3.10 é território da #59 (seção 4). |

### 2.2 `docs/factory/14-BACKLOG.md` (segundo, por causa da #59)

| Âncora | Atual | Ação / nova redação |
|---|---|---|
| Gate M4 (condições) | Lista inclui "backup" | Retirar "backup" da lista (regra 8). |
| **H-010** "Keep-alive diário e backup manual (dump criptografado)"; referências a BK-7, 12-TODO #1, D-01, ADR-020 | Mistura keep-alive e backup | Título: "Keep-alive diário". Retirar "backup manual (dump criptografado)", BK-7, 12-TODO #1 e D-01 do texto e dos critérios dessa linha. Manter ADR-020 e R-08 apenas se a linha os citava por causa do keep-alive ou do risco aceito. |
| **H-054** (gate de cobrança) | Condição "backup"; depende de H-010 | Retirar "backup" da condição. Dependência de H-010: manter só se o texto original a justificar por keep-alive; se a única razão era backup, retirar e registrar no commit (pergunta 367). |
| **H-111** (direitos do titular) | Acesso, correção, eliminação | NÃO TOCAR (CA-H151-02, 14). |
| **H-114** (incidente) | "reconciliação pós-restauração (MP e e-mail), periodicidade do backup"; depende de H-010 e H-119 | Manter o runbook de incidente. Tirar "pós-restauração" e "periodicidade do backup". Retirar a dependência de H-119; H-010 fica só se o motivo for keep-alive. |
| **H-119** "Restauração de backup..." (RTO, D-01, D-02) | História inteira | Lápide (regra 3): `H-119 — REMOVIDA do escopo (Rodada 73/75, #151). Texto original no histórico do git.` Manter a linha com o mesmo ID. |
| **H-121** (gate de release) | Checklist com "backup" | Retirar "backup" (regra 8). |
| **BLQ-JUR L5** "evidências: WCAG, testes, backup e observabilidade" | | Retirar "backup". |
| **BK-7** "periodicidade do backup manual" | Decisão pendente | Lápide (regra 3), mesmo ID. |

Antes de editar as linhas de H-119 e da #130, o líder resolve a pergunta 354 (número 128/130). O DEV NÃO corrige o número (pergunta 365).

### 2.3 `docs/factory/12-TODO.md`

| Âncora | Atual | Ação |
|---|---|---|
| Item 1 "Periodicidade do backup manual do Supabase gratuito" | Pendência | Manter o item 1 com marca: `1. [REMOVIDO do escopo — Rodada 73/75, #151]` e o texto original mantido riscado ou na mesma linha. Itens 2 em diante com o mesmo número (CA-H151-03). |

### 2.4 `docs/factory/16-MANIFESTO-ISSUES.md`

| Âncora | Atual | Ação |
|---|---|---|
| Issue 21 (H-010) "[E0] Keep-alive e backup manual" | | Título: "[E0] Keep-alive". Referências a ADR-020 e R-08 ficam sem a palavra backup. |
| Issue 125 (H-114) "incidente e pós-restauração"; dependências H-010 e H-119 | | Objetivo: "incidente". Retirar "pós-restauração" e as dependências de H-119 (e de H-010 pelo critério da pergunta 367). |
| Linha "130 \| H-119 \| Teste de restauração de backup" | | Lápide mantendo o número da linha e o ID: `130 \| H-119 \| REMOVIDA do escopo (Rodada 73/75, #151)`. Não corrigir a divergência 128/130 (pergunta 365). |

### 2.5 `docs/factory/08-ARQUITETURA.md`

| Âncora | Atual | Ação |
|---|---|---|
| §16.7 item 7, Supabase Free "sem backup (recomendado supabase db dump)"; mitigação "backup manual periódico (12-TODO #1)" | | Manter pausa, limites e keep-alive. Tirar "sem backup", o `supabase db dump` e a mitigação de backup. A perda de dados sem cópia aparece só em R-08 (11). |
| Título §17 "Ambientes, migrações, backup e recuperação" | | Novo título: "Ambientes e migrações". Procurar âncoras `#17-...` em outros documentos (seção 5.6). |
| Migrações: "reversão = nova migração compensatória ou restauração" | | "reversão = nova migração compensatória". |
| Parágrafo "Backup/recuperação (resumo; testes em 11 §9)": RPO, RTO, cópias criptografadas, expurgo, teste trimestral | | Remover o parágrafo inteiro (sem ID). |
| "Reprocessamento pós-restauração: webhooks do MP e e-mails são reconciliados; jobs idempotentes" | | Manter só "jobs são idempotentes"; tirar "pós-restauração" e a frase sobre reconciliação por restauração. |
| Notas das Rodadas 8 e H3 (backup manual periódico, cerca das linhas 18, 31, 38) | Histórico | Acrescentar no início da frase `[SUPERADO — Rodada 73/75, #151]`; texto mantido. |
| "Supabase CLI + Docker" (ambientes) | | NÃO TOCAR (regra 10, decisão 358). |
| "conversas anteriores restauradas se permitido" (cerca da linha 238) | Falso positivo | NÃO TOCAR. |

### 2.6 `docs/factory/10-ADRS.md`

| Âncora | Atual | Ação |
|---|---|---|
| Bloco de retenção "Backups: rotação definida pelo jurídico" | | Marca de superação (regra 4); texto mantido. |
| ADR-020 "Supabase backups: VERIFICADO sem backup no Free; backup diário só no Pro; recomendado supabase db dump; mitigação backup manual + teste de restauração" | | Reescrever: fato de plataforma sai (regra 6; fica em 13). Nova redação: "Supabase gratuito: ver `13-VERIFICACAO-SERVICOS.md` para limites verificados. Perda de dados: risco aceito pelo usuário (Rodada 73; decisão 350; R-08; #151). Mitigação de cópia removida do escopo." Manter keep-alive. |
| ADR-020 "Armazenamento de backup manual (H3)" | | Marca de superação. |
| ADR-020 §20.1: gatilho "(a) backup e recuperação adequados"; "(H3 ... backup manual)" | | Retirar o item (a) do gatilho e a frase de H3, mantendo a letra dos demais itens como estão (letras não são renumeradas: o item (a) fica como `(a) [REMOVIDO — decisão 356, #151]`). |
| SD-17 "ADIADA (Rodada 8 nº 18): backup manual ... vai para 12-TODO.md" | | Marcar `[SUPERADA — Rodada 73/75, #151]`; texto mantido. |
| Notas de rodada que citam ADR-020 e backup manual (cerca das linhas 13, 18, 21, 25, 31) | Histórico | NÃO TOCAR (lista permitida L-3). |

### 2.7 `docs/factory/11-ARQ-RISCOS-E-TESTES.md`

| Âncora | Atual | Ação |
|---|---|---|
| **R-08** "Supabase gratuito: pausa de projeto, sem backup gerenciado (H3 aceito)"; mitigação backup manual | | Reescrever (regra 7): "Supabase gratuito: pausa de projeto e perda de dados. **Risco aceito pelo usuário** (Rodada 73; decisão 350; #151). Sem mitigação de cópia. Mitigações mantidas: keep-alive (D-04), migrações compensatórias." Probabilidade e impacto: não alterar. |
| **R-17** "Backup contém dados excluídos" | | Marca de superação; texto mantido. |
| **R-32** "Backup manual atrasado ou perdido" | | Marca de superação; texto mantido. |
| Resumo de revisão "R-08/R-10/R-11 revistos ... backup manual" | Histórico | Marca de superação no início. |
| §9 metas RPO (exports semanais) e RTO ≤ 8 h | | Remover as duas linhas (sem ID). |
| **D-01**, **D-02** | Restauração de banco e de Storage | Lápide (regra 3), mesmo ID. |
| **D-03** "Pós-restauração: webhooks e e-mails" | | Lápide (regra 3). A reconciliação de webhooks/e-mails em incidente fica em H-114 (14). |
| **D-04** "Projeto pausado: retomar, keep-alive" | | NÃO TOCAR (CA-H151-15). |
| **D-05, D-06, D-07, D-09** | | NÃO TOCAR. |
| **D-08** "Exclusão do titular × backups" | Depende de backup | Lápide (regra 3). Eliminação do titular continua em H-111 (14). |
| Linha "Teste de restauração: antes do lançamento e periodicamente" | | Remover (sem ID). |

### 2.8 `docs/factory/17-CHECKLIST-REVISAO.md`

| Âncora | Ação |
|---|---|
| **B-53** gate de lançamento "(... backup, tarifas MP ...)" | Retirar "backup" da lista (regra 8). |
| Gate M4 "Itens de H-054 e H-121: ... backup ..." | Retirar "backup" (regra 8). |

### 2.9 `docs/factory/18-PLANO-QA.md`

| Âncora | Atual | Ação |
|---|---|---|
| Nível 15 "Recuperação" (restauração de dump sintético, reconciliação de Storage) | Nível numerado | Lápide mantendo o número do nível (regra 2); níveis seguintes não mudam. |
| A4 "sem backup" na lista de limites Supabase Free | | Tirar "sem backup" (regra 6); manter pausa e limites. |
| Suíte do M3 "D-01; D-02"; critério "restauração testada" | | Tirar D-01, D-02 e "restauração testada". |
| Critério "Recuperação: D-01 e D-02 com dump restaurado" (cerca da linha 276) | Sem ID | Remover a linha. |
| L5 Evidências "backup" e "D-01" | | Tirar ambos. |
| **TL-3** "Backup manual com periodicidade definida e restauração testada" | | Lápide (regra 3), mesmo ID. |

### 2.10 `docs/factory/19-PLANO-TECNICO-DEV.md`

| Âncora | Atual | Ação |
|---|---|---|
| 0.12 H-010 "[P] keep-alive + backup manual" | | "[P] keep-alive". |
| Gate M4 (bloqueado) "backup" | | Tirar "backup" (regra 8). |
| V-10 "Supabase Free: pausa em 1 semana e sem backup"; mitigação backup manual, H-119 | | Manter pausa e keep-alive. Tirar "sem backup", a mitigação de backup e a referência a H-119. |
| Diretrizes "BK-7 (b) backup semanal e antes de migração destrutiva" | Diretriz sem ID próprio | Remover a linha. |
| "exportando o handler do Express" | Falso positivo | NÃO TOCAR. |

### 2.11 `README.md` (raiz) e `supabase/README.md`

| Arquivo / âncora | Ação |
|---|---|
| `README.md`, seção "Banco de desenvolvimento": texto "cópias de segurança feitas à mão"; "O que o backup faz"; comando `alter role app_backup_reader ...` | Remover essas partes. Manter keep-alive e o comando de `app_keepalive`. Como o código de backup ainda existe até a Issue de código, acrescentar uma linha neutra: "Backup e restauração de dados estão fora do escopo do projeto (Rodada 73/75, #151). Não use `db:backup`; a remoção do mecanismo antigo segue em Issue própria." |
| `supabase/README.md` (cerca das linhas 62 e 67): papel `app_backup_reader` e teste `backup-roles.dbtest.mjs` | Mesma redação: tirar a instrução de uso, manter a nota única acima com `#151`. Não afirmar que o papel foi removido, porque ainda existe no banco. Ver pergunta 359 (conflito com CA-H151-11). |
| `.env.example`, `.gitignore`, `package.json` | NÃO TOCAR. O DEV só informa o que achou (pergunta 360). |

### 2.12 Históricos (apenas nota de superação)

| Arquivo | Ação |
|---|---|
| `27-REFINO-H010.md`, `28-DESENHO-H010.md`, `119-REFINO-H119.md` | Inserir UMA linha de nota logo abaixo do título: `> [SUPERADO em parte — Rodada 73/75, #151] A parte de backup/restauração deste documento saiu do escopo; o keep-alive continua válido. Texto original abaixo mantido.` (no 119: "#128 removida do escopo"). Nada mais é alterado. |
| `10-RELATORIO-INGESTAO.md` (linha L5 "WCAG, testes, backup e observabilidade") | Mesma nota de uma linha. |
| `111-REFINO-TRIAGEM-DBTEST.md`, `112-TRIAGEM-DBTEST-LINHA-DE-BASE.md`, `117`, `118`, demais refinos e desenhos, `spikes/*`, `13-VERIFICACAO-SERVICOS.md` | NÃO TOCAR. O teste T-BK-09 ainda existe e a triagem continua verdadeira até a Issue de código. |

### 2.13 `docs/factory/11-DECISOES.md` (último commit)

Acrescentar, no fim, uma rodada nova (append-only; o DEV confere o número da última rodada antes, hoje 75, e usa o seguinte, tentativamente 76) com o título "Aplicação da #151 (desenho 122)". Conteúdo: lista dos documentos alterados; que a decisão 147 (papel de backup não lê `professional_area`, `professional_area_history` e `professional_service`) perde efeito porque o backup saiu do escopo, mantendo-se o código até a Issue de código; que H-119, BK-7, RC-11, D-01 a D-03, D-08 e 12-TODO #1 ficam como lápide. NÃO editar linhas antigas (CA-H151-16). Perguntas 359 a 367 respondidas entram nesta rodada com o mesmo número.

---

## 3. Ordem de execução do DEV (passos pequenos, um commit por documento)

Branch: `feature/init` (regra do projeto). Antes de cada commit: abrir só o arquivo do passo, editar por âncora, rodar `git diff --stat` (deve listar exatamente 1 arquivo) e `git diff` (revisar). Commits com mensagem `docs(#151): <resumo> — <arquivo>` e o trailer padrão do projeto. Nenhum `git add .`; sempre `git add <caminho explícito>`.

**Passo 0 — pré-condições (sem commit).**
1. `git status --short` limpo para os arquivos do plano; `git rev-parse --abbrev-ref HEAD` = `feature/init`. Anotar `BASE=$(git rev-parse HEAD)`.
2. Confirmar com o líder que a #59 não tem edição pendente em `09-MODELO-DADOS.md` e `14-BACKLOG.md` (seção 4) e que a pergunta 354 foi respondida (precisa antes do passo 2).
3. Gerar a linha de base (seção 5) em arquivo fora do repositório (pasta temporária da sessão) para comparar depois.
4. Verificar se algum teste lê os documentos ou o README: `git grep -n -E "README|docs/factory|\.md" -- packages/db/tests/backup.test.mjs packages/db/tests/backup-static.test.mjs packages/db/tests/keepalive.test.mjs`. Se algum teste afirma conteúdo de README ou documento, PARAR e informar o líder (pergunta 366). Não editar teste.

**Passos de commit** (cada um: um arquivo, um commit):

1. `docs/factory/09-MODELO-DADOS.md` (2.1)
2. `docs/factory/14-BACKLOG.md` (2.2) — depois deste, avisar o líder: a #59 está liberada para §3.10 e 14-BACKLOG.
3. `docs/factory/12-TODO.md` (2.3)
4. `docs/factory/16-MANIFESTO-ISSUES.md` (2.4)
5. `docs/factory/08-ARQUITETURA.md` (2.5)
6. `docs/factory/10-ADRS.md` (2.6)
7. `docs/factory/11-ARQ-RISCOS-E-TESTES.md` (2.7)
8. `docs/factory/17-CHECKLIST-REVISAO.md` (2.8)
9. `docs/factory/18-PLANO-QA.md` (2.9)
10. `docs/factory/19-PLANO-TECNICO-DEV.md` (2.10)
11. `README.md` (2.11)
12. `supabase/README.md` (2.11, sujeito à pergunta 359)
13. `docs/factory/27-REFINO-H010.md` (2.12)
14. `docs/factory/28-DESENHO-H010.md` (2.12)
15. `docs/factory/119-REFINO-H119.md` (2.12)
16. `docs/factory/10-RELATORIO-INGESTAO.md` (2.12)
17. `docs/factory/11-DECISOES.md` (2.13) — último.

Após o passo 17: rodar toda a verificação da seção 5 e anexar os resultados à Issue. Não mover cartão (só o líder).

Se uma âncora não for encontrada ou o texto atual diferir do refino de forma que mude o sentido, o DEV NÃO improvisa: registra e devolve ao líder (limite de 3 tentativas por etapa).

---

## 4. Conflito com a Issue #59

- A #59 vai atualizar `09-MODELO-DADOS.md` §3.10 e `14-BACKLOG.md`. A #151 também edita esses dois arquivos. Os dois trabalham no mesmo branch e na mesma árvore de arquivos, então a corrida é de edição simultânea e de reordenação de linhas.
- **Regra:** a #151 faz primeiro os passos 1 e 2 (09 e 14), em dois commits pequenos e consecutivos. A #59 só edita `09 §3.10` e `14-BACKLOG` depois do commit do passo 2 e relê os arquivos antes de editar. Os demais arquivos da #59 não são afetados.
- Os números de linha do refino 121 ficam velhos assim que o passo 1 acontece; por isso o plano usa âncoras de texto.
- A #151 não toca §3.10 de 09 (nem o §3.8 de direitos do titular). Se o líder disser que a #59 já editou algum desses arquivos, o DEV começa por `git log -p --follow -n 3 -- <arquivo>` e adapta as âncoras; não desfaz nada da #59.
- Se a #59 estiver no meio de uma edição quando o passo 1 começar, o líder pausa uma das duas por arquivo (não é bloqueio no quadro).

---

## 5. Como o DEV prova que não sobrou referência ativa

### 5.1 Conjunto vivo e conjunto histórico

```bash
# Conjunto VIVO = tudo que não é histórico, quadro ou fato de fornecedor
LIVE=$(git ls-files docs README.md supabase/README.md .env.example \
  | grep -v -E '^docs/factory/(spikes/|[0-9]+-(REFINO|DESENHO|TRIAGEM|SPIKE)|11-DECISOES|13-VERIFICACAO|10-RELATORIO|quadro-)')
```

### 5.2 Buscas (devem retornar zero linha fora da lista permitida)

```bash
# A. Termos de backup e restauração (sem a marca #151 na linha)
git grep -n -i -E "backup|restaura|restore|dump|c[óo]pia de seguran|app_backup_reader|db:backup|T-BK" -- $LIVE | grep -v '#151'

# B. RPO e RTO (siglas, sensível a maiúsculas)
git grep -n -w -E "RPO|RTO" -- $LIVE | grep -v '#151'

# C. Identificadores removidos: só podem aparecer em lápide (linha com #151)
git grep -n -E "H-119|BK-7|RC-11|\bD-0[1238]\b|12-TODO #1|#128|#145" -- $LIVE | grep -v '#151'

# D. Exportação (classificar cada ocorrência: código/catalogo = permitido; direitos do titular = deve ficar;
#    cópia do banco = deve ter saído)
git grep -n -i -E "exporta|portabilidade" -- $LIVE | grep -v '#151'
```

`D-02b` não casa em C (não há fronteira de palavra entre "2" e "b"). A busca C com `#128|#145` serve para ver quem ainda cita as Issues descartadas; cada hit deve ser lápide ou referência histórica explícita.

### 5.3 Prova de que nada foi perdido

```bash
# Direitos do titular intactos (CA-H151-14): saída vazia
git diff $BASE..HEAD -- docs README.md | grep -E '^[-+].*(H-111|RF-140|dsr_case|direitos do titular)'

# Keep-alive intacto (CA-H151-15): cada linha removida com keep-alive deve ter par reescrito
git diff -U0 $BASE..HEAD -- docs README.md supabase/README.md | grep -E '^[-+].*(keep-?alive|app_keepalive|D-04)'

# Numeração: IDs que devem continuar existindo (como lápide)
git grep -n -E "^.*(H-119|BK-7|RC-11|D-01|D-02|D-03|D-08|TL-3)" -- docs/factory/14-BACKLOG.md docs/factory/09-MODELO-DADOS.md docs/factory/11-ARQ-RISCOS-E-TESTES.md docs/factory/18-PLANO-QA.md
git grep -n -E "^\s*(2|3|4)\. " -- docs/factory/12-TODO.md   # itens 2 em diante com o mesmo número

# Historico preservado (CA-H151-16): nenhuma linha antiga removida de 11-DECISOES e dos refinos/desenhos
git diff $BASE..HEAD --numstat -- docs/factory/11-DECISOES.md docs/factory/27-REFINO-H010.md \
  docs/factory/28-DESENHO-H010.md docs/factory/119-REFINO-H119.md docs/factory/10-RELATORIO-INGESTAO.md
# a coluna "removidas" deve ser 0 em todos

# Âncoras quebradas pelo novo título de 08 §17
git grep -n -i -E "17-ambientes|migra(ç|c)(õ|o)es-backup" -- docs README.md
```

### 5.4 Lista permitida de ocorrências (exaustiva)

Sem marca `#151`, o resultado das buscas A a D só pode conter:

- **L-1.** `05-CRITERIOS-ACEITE.md`: "conversas anteriores restauradas" (restauração de conversa).
- **L-2.** `06-CATALOGO-PROPOSTO.md`: "restauração de taco", "restauração de bolsa", "consultoria de importação/exportação" (catálogo de serviços, cerca de 4 linhas).
- **L-3.** `10-ADRS.md`: notas de rodada antigas que citam ADR-020 e backup manual (cerca das linhas 13, 18, 21, 25, 31). Histórico.
- **L-4.** `08-ARQUITETURA.md`: "restauradas se permitido" (conversas).
- **L-5.** `19-PLANO-TECNICO-DEV.md`: "exportando o handler do Express".
- **L-6.** Qualquer "exportação" de código e de conteúdo do titular classificada como falso positivo ou direito do titular, cada uma listada no registro do DEV com arquivo, linha e motivo.
- **L-7.** Os arquivos do conjunto histórico (fora do LIVE por construção): `11-DECISOES.md`, `13-VERIFICACAO-SERVICOS.md` (fato de fornecedor, decisão 355), `10-RELATORIO-INGESTAO.md` (com a nota), refinos, desenhos e triagens numerados, `spikes/*`, `quadro-*`.

Qualquer ocorrência fora desta lista é falha: o DEV corrige ou devolve ao líder (não amplia a lista sozinho).

### 5.5 Verificação de que só documentos mudaram (CA-H151-11, 12, 13)

```bash
git diff --name-only $BASE..HEAD
git diff --name-only $BASE..HEAD | grep -E '^(packages|apps|scripts|\.github)/|^package\.json$|^pnpm-lock|^supabase/(migrations|rollbacks|tests|config)' # saída vazia
git diff --name-only $BASE..HEAD | grep -E 'quadro-'                                                    # saída vazia
git grep -n -E "#(128|145|23|126|130)\b" -- docs/factory/quadro-status.md                               # só leitura; colunas conferidas pelo líder
```

CA-H151-12: o registro do DEV lista os comandos usados; só aparecem `git`, `grep` e, se aplicável, `corepack pnpm lint|typecheck|test`. Nenhum `npx supabase`, `db:*`, psql ou chamada ao Mapbox.

### 5.6 Verificação local de qualidade

`corepack pnpm lint`, `corepack pnpm typecheck`, `corepack pnpm test` (testes unitários sem banco). NÃO rodar `db:test` nem `check:all` completo, porque tocam o banco (proibido nesta Issue) e o `db:test` ainda reprova `T-BK-09` por motivo alheio à #151 (decisão 352). Registrar comando, contagem e código de saída na Issue (regra de builds locais).

---

## 6. Plano de verificação (CA-H151)

| CA | Como se prova | Passo / evidência |
|---|---|---|
| 01 | Buscas A a D da seção 5.2; resultado dentro da lista 5.4 | Saída das buscas colada na Issue |
| 02 | Leitura de `14-BACKLOG.md`: H-119 e BK-7 só como lápide; H-010 só keep-alive; H-114, H-054, H-121 sem "backup"; H-111 igual | Busca C + diff de H-111 vazio |
| 03 | `12-TODO.md`: item 1 marcado; itens 2 em diante com o mesmo número | Comando da 5.3 |
| 04 | `08` §17: título novo, sem RPO, RTO nem parágrafo de backup; §16.7 sem mitigação de backup; sem "ou restauração" | Buscas A e B restritas a `08` |
| 05 | `09`: sem linha "Backups"; RC-11 lápide; RC-12 em diante intactas; §9 sem "sem backup" | Busca A em `09` + leitura |
| 06 | `10-ADRS`: ADR-020 sem mitigação nem gatilho (a); SD-17 marcada; texto original presente | Busca A + diff sem linha removida em SD-17 |
| 07 | `11-ARQ`: §9 sem RPO, RTO, D-01, D-02, D-03, D-08 (lápides), D-04 e D-05 a D-07 e D-09 intactos; R-08 risco aceito; R-17 e R-32 superados | Buscas A, B, C + leitura |
| 08 | `17`: B-53 e Gate M4 sem "backup" | Busca A em `17` |
| 09 | `16`, `18`, `19`: sem backup/restauração como requisito, critério ou gate; keep-alive permanece | Buscas A a C + diff de keep-alive |
| 10 | `README.md` e `supabase/README.md`: sem instrução de cópia de segurança nem de `app_backup_reader`; `app_keepalive` permanece | Busca A + diff de keep-alive |
| 11 | Só `.md`; nenhum arquivo de código, migração, teste ou `package.json` | 5.5 |
| 12 | Registro sem comando de banco e sem Mapbox | 5.5 |
| 13 | #128 e #145 em Descartado; #23 em Concluído; #126 e #130 sem mover | Leitura de `quadro-status.md` (líder) |
| 14 | H-111, RF-140, `dsr_case` sem diferença no diff | 5.3 |
| 15 | Keep-alive igual em comportamento | 5.3 |
| 16 | Históricos: zero linhas removidas, só notas inseridas | `--numstat` da 5.3 |

---

## 7. Riscos do desenho

- **Corrida com a #59** em 09 e 14: tratada na seção 4.
- **Âncoras deslocadas:** as linhas do refino mudam depois do primeiro commit; usar texto.
- **Lápide com número de coluna errado** quebra tabela Markdown: conferir a renderização (contagem de `|` por linha) nas tabelas de 14, 09, 11, 16 e 18.
- **Teste que afirma conteúdo de documento:** passo 0.4.
- **Afrouxar gate sem querer:** regra 8 (retirar só a palavra; sem condição nova).
- **Tirar keep-alive junto:** buscas de 5.3.
- **Âncora de título quebrada:** busca de 5.3 após renomear §17.

---

## 8. Perguntas ao líder (numeração contínua a partir de 359)

- **359. Conflito entre CA-H151-10 e CA-H151-11.** O 10 exige reescrever `supabase/README.md`; o 11 diz que nada em `supabase/` muda. *Alternativas:* (a) exceção para arquivos `.md` (só documentação); (b) não tocar `supabase/README.md` e deixar a instrução para a Issue de código. *Recomendação:* (a), com a nota neutra "ainda existe no código; não use", porque o README é documento e deixar instrução de backup viva contradiz a decisão 349 a 358.
- **360. `.env.example`, `.gitignore`, `quadro-dados.js`.** O refino não leu as ocorrências. *Alternativas:* (a) o DEV só informa o que achou e nada é editado; (b) editar comentários de `.env.example`. *Recomendação:* (a); itens vão para a Issue de código (351). `quadro-dados.js` é do líder.
- **361. Sequência com a #59.** *Alternativas:* (a) a #151 faz 09 e 14 primeiro e a #59 espera esse commit; (b) a #59 primeiro, depois a #151. *Recomendação:* (a), porque a #151 é só de remoção em linhas pontuais e a #59 insere conteúdo (menos risco de reescrever o trabalho dela).
- **362. Formato de lápide e de marca de superação** (seção 1, regras 3 e 4). *Recomendação:* aprovar como estão; permite a prova por `grep -v '#151'`.
- **363. Nova rodada em `11-DECISOES.md`** (seção 2.13) registrando a aplicação e que a decisão 147 perde efeito. *Recomendação:* sim, rodada append-only, sem editar linhas antigas.
- **364. Escopo das notas de superação em históricos.** *Alternativas:* (a) só 27, 28, 119 e 10-RELATORIO-INGESTAO; (b) também 111 e 112 (triagem de T-BK-09). *Recomendação:* (a); 111 e 112 continuam verdadeiros enquanto o teste existir e recebem nota na Issue de código.
- **365. Divergência do número 128/130 no manifesto.** *Alternativas:* (a) o DEV só aplica a lápide na linha como está e o líder corrige o número em outra Issue de documentação; (b) corrigir junto. *Recomendação:* (a), depois da conferência da 354.
- **366. Teste que leia README/documento.** Se `backup-static.test.mjs` ou outro testar o conteúdo dos README, a edição de README quebraria teste. *Alternativas:* (a) parar e abrir a Issue de código antes; (b) adiar só os passos 11 e 12 e seguir com os demais. *Recomendação:* (b).
- **367. Dependência de H-054 e H-114 em H-010.** Depois da remoção, a dependência só fica se o motivo for keep-alive. *Recomendação:* o DEV decide pelo texto original da linha e registra no commit; se não estiver claro, devolve ao líder. Não é pergunta ao usuário.

---

## 9. Próximo passo sugerido (para o líder)

1. Responder 359 a 367 (nenhuma exige o usuário, salvo se o líder discordar das recomendações) e a 354 (conferência no GitHub).
2. Mover #151 para Desenvolvimento, respeitando a ordem de colunas, e liberar o passo 0.
3. Avisar a #59 do passo 2 (seção 4).
4. Manter a Issue de código (351) separada e só abri-la com autorização para mexer no banco.
