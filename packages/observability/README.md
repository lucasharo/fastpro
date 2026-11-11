# @fastpro/observability

Logger estruturado sem PII (H-007; ADR-013; P8; RF-163).

## Ajuste ao plano tecnico

`packages/observability` **nao esta listado** em `docs/factory/19-PLANO-TECNICO-DEV.md` §1. E um
ajuste ao plano (registrar no PR da historia): o pacote concentra o logger e evita que
`packages/domain` precise fazer I/O.

## Como funciona

- Saida em JSON, uma linha por evento. Entram **somente** os campos de `src/allowlist.json`.
  Campo fora da lista e descartado; em `dropped_fields` aparece apenas o NOME do campo, e so se
  ele tiver formato simples de nome (`[a-z][a-z0-9_]{0,39}`). Qualquer outro nome vira
  `[invalid-key]`: a chave original nunca e emitida.
- Valores aceitos: texto curto (ate 200 caracteres), numero, booleano ou nulo. Objetos, listas e
  funcoes sao descartados.
- Textos passam por redacao **antes** do corte em 200 caracteres. Se o corte cair no meio de uma
  palavra, o pedaco final e descartado e o texto termina com `[truncated]`.
- Identificadores (`principal_id`, `session_id`, `resource_id`, `request_id`...) precisam ser UUID
  ou ter prefixo curto + sufixo (`p_1`, `req-abc`); qualquer outra coisa vira `[invalid-id]`.
- Erros: so `error_name` (nome da classe, terminado em `Error`) e `error_code`. Mensagem e stack
  nunca saem, porque podem conter dados pessoais.
- `runWithContext` propaga `request_id` e `correlation_id` entre chamadas assincronas.
- `findPii(texto)` serve para varrer os logs de teste (T-11).
- O pacote nao le `process.env`; quem chama passa o valor de `LOG_LEVEL` para `levelFromEnv`.

## Limites importantes (leia antes de confiar na redacao)

A **barreira principal e a lista de campos permitidos**: o que nao esta na lista nao e gravado.
A redacao automatica e uma segunda camada, baseada em padroes, e **nao e infalivel**:

- **Nome proprio** (de pessoa, empresa, rua) **nao e detectavel** por padrao. "Maria Silva"
  em uma mensagem livre passa. Por isso o logger descarta campos como `name`/`nome` e a varredura
  estatica reprova interpolar nomes na mensagem.
- **Endereco em texto livre** so e detectado quando segue formatos comuns (Rua/Av./R. + nome,
  CEP, bloco/apto). Enderecos escritos de outro jeito passam.
- Telefones, CPF, CNPJ, cartoes e e-mails sao detectados nos formatos usuais (inclusive com
  espacos e e-mail ofuscado simples como `a [at] b [dot] c`); variacoes incomuns podem escapar.
- Numeros longos soltos em texto podem ser redigidos por engano (falso positivo); isso e
  intencional: na duvida, o log perde informacao em vez de vazar dado.

Regra pratica: **nunca** coloque dado pessoal na mensagem nem em valores; use identificadores.

## Varredura estatica

`pnpm check:logs` (`scripts/check-logs.mjs`) roda no CI e reprova, em `apps/*/src`, `apps/*/api`
e `packages/*/src`: qualquer uso de `console`, `process.stdout/stderr.write` fora deste pacote,
metodos que o logger nao tem (`.log`, `.trace`, `.verbose`), campos fora da allowlist,
interpolacao de dados sensiveis e `check-logs:ignore` sem motivo. A regra ESLint `no-console`
tambem vale para esses diretorios (exceto este pacote).

## Pendente (prazo aceito)

Helper reutilizavel `assertNoPii` para os testes de outros pacotes: sera criado junto das
historias de API.
