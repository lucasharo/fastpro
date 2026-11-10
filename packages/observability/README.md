# @fastpro/observability

Logger estruturado sem PII (H-007; ADR-013; P8; RF-163).

- JSON por linha; so campos de `src/allowlist.json` (outros sao descartados e apenas o NOME entra
  em `dropped_fields`). Valores: string curta, numero, booleano ou null; objetos sao descartados.
- Redacao automatica (e-mail, telefone, CPF/CNPJ, JWT/Bearer, `sk_`/`whsec_`/`sb_`, cabecalhos,
  credenciais em URL, endereco, hex longo). Erros: apenas `error_name`/`error_code`.
- `runWithContext` propaga `request_id`/`correlation_id` por contexto assincrono.
- `findPii(texto)` serve para varrer logs de teste (T-11).
- `pnpm check:logs` (scripts/check-logs.mjs) reprova `console.*` e chamadas do logger com campo
  fora da allowlist ou interpolacao sensivel em `apps/*/src` e `packages/*/src`.
- Este pacote nao le `process.env`; o chamador passa `LOG_LEVEL` a `levelFromEnv`.
- Adicao de pacote nao listada em 19 §1 (registrar no PR): ele concentra o logger para evitar
  dependencia de I/O em `packages/domain`.
