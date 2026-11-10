# Refino H-006 — Auditoria append-only (Issue #19, WF-03, Product Owner)

Rastro: H-006 (14-BACKLOG); RF-154 [APROVADO]; FA-031; I-15; B-08 (17 §4.7); ADR-012; 09 `audit_event` e matriz (RC-07). Dependência: H-003. Consumidores futuros: H-039, H-073, H-076, H-079, H-090, H-104, H-105, H-107, H-109.

## 1. Critérios de aceite (Given/When/Then)

Campos do evento (09 `audit_event`) [APROVADO]: `id`, `at`, `actor_ref`, `actor_role`, `action`, `object_type`, `object_id`, `before_state`, `after_state`, `reason_code`, `correlation_id`, `prev_hash`, `row_hash`.

- **CA-01 Evento completo [APROVADO, RF-154]:** Dado uma ação crítica auditável executada por um ator, quando ela é concluída, então existe exatamente um `audit_event` com ação, ator (`actor_ref` e papel), objeto (`object_type`, `object_id`), estado anterior, estado posterior e data/hora.
- **CA-02 Mesma transação [APROVADO, I-15, B-08]:** Dado uma ação crítica, quando ela e a auditoria são gravadas, então ambas estão na mesma transação e só ficam visíveis juntas após o COMMIT.
- **CA-03 Rollback conjunto [APROVADO]:** Dado que a gravação da auditoria falha, quando a ação já foi executada na transação, então a transação inteira sofre rollback e a ação não persiste.
- **CA-04 Rollback inverso [APROVADO]:** Dado que a ação falha depois da auditoria, quando a transação é desfeita, então nenhum `audit_event` fica gravado.
- **CA-05 UPDATE negado [APROVADO]:** Dado um `audit_event` existente, quando qualquer papel (inclusive dono, `service_role` da aplicação e Superadmin) tenta UPDATE, então é negado por privilégio e por trigger, e a linha não muda.
- **CA-06 DELETE negado [APROVADO]:** Idem para DELETE e TRUNCATE; a linha permanece.
- **CA-07 Privilégio mínimo [APROVADO]:** Dado o papel de aplicação, quando consulta seus privilégios sobre `audit_event`, então tem somente INSERT (e SELECT onde for leitura permitida); nenhum UPDATE/DELETE/TRUNCATE (teste pgTAP).
- **CA-08 Encadeamento por hash [APROVADO, backlog]:** Dado eventos sucessivos, quando gravados, então cada `prev_hash` é o `row_hash` do anterior e `row_hash` cobre o conteúdo da linha; uma função de verificação detecta adulteração ou lacuna na cadeia.
- **CA-09 Sem PII em claro [APROVADO, 09 matriz]:** Dado `before_state`/`after_state`, quando gravados, então contêm só estado e IDs (sem e-mail, telefone, CPF, texto de chat); gravação com chave de PII conhecida é rejeitada ou redigida.
- **CA-10 Hora do banco [DELEGADO]:** Dado um evento, quando gravado, então `at` vem do relógio do banco (UTC), não do cliente.
- **CA-11 Correlação [DELEGADO]:** Dado uma ação com `correlation_id`, quando auditada, então o mesmo ID aparece no evento para rastrear requisição, outbox e log.
- **CA-12 Concorrência [PROPOSTA]:** Dado duas transações auditando ao mesmo tempo, quando ambas confirmam, então a cadeia permanece linear e sem bifurcação (serialização do encadeamento).
- **CA-13 Mecanismo reutilizável [DELEGADO]:** Dado as histórias futuras, quando precisam auditar, então usam uma única função/interface de gravação no banco; nenhuma tabela de auditoria paralela.
- **CA-14 Cobertura inicial [APROVADO RF-154]:** O catálogo de `action` aceita ao menos: suspensão, revisão de avaliação, correção de conclusão, estorno e consentimento. Cada história consumidora liga seu evento; nesta história basta o mecanismo e um exemplo de teste por ação do catálogo.

## 2. Casos negativos mínimos

1. UPDATE em `audit_event` por papel de aplicação, Auditor e Superadmin: negado, linha intacta.
2. DELETE e TRUNCATE: negados.
3. Falha forçada na gravação da auditoria: ação revertida (sem efeito colateral persistido).
4. Falha forçada após a ação auditada: nenhum evento órfão.
5. Evento sem ator, sem ação, sem objeto ou sem `at`: rejeitado (NOT NULL/CHECK).
6. Adulteração da cadeia por superusuário em ambiente de teste: verificação de integridade reporta a quebra.
7. Estado com PII (e-mail, CPF, telefone): rejeitado ou redigido.
8. Mudança de `row_hash`/`prev_hash` fornecida pelo chamador: ignorada ou rejeitada (calculada no banco).
9. Auditor tentando gravar ou alterar qualquer dado: negado (a consulta em si é H-104).
10. Duas inserções simultâneas: cadeia sem bifurcação.
11. Migração que tente remover trigger/privilégio: reprovada por teste pgTAP no CI.

## 3. Fora desta história

- Tela/API de consulta do Auditor e papéis/MFA: H-104, H-102/H-103.
- Os eventos de cada fluxo (verificação H-039, troca H-076, correção H-079, moderação H-090, estorno H-105/H-106, catálogo H-107, acesso excepcional H-073): cada história liga seu evento.
- Retenção, anonimização de atores e expurgo (RC-07, H-109, BLQ-JUR L1); arquivamento comprimido.
- Log de acesso a mídia (`media_access_log`) e logs estruturados (H-007).
- Auditoria de flag de e-mail (inexistente, decisão 23/RF-154).
- Assinatura externa/ancoragem do hash, particionamento mensal (09 [PROPOSTA]; pode ser adiado).

## 4. Dúvidas ao Orquestrador

1. **Não bloqueante.** Superusuário/dono do banco consegue contornar o trigger; append-only absoluto não é garantido no Free. Alternativas: (a) aceitar e depender do hash para detectar (recomendado); (b) ancorar o hash em fonte externa (fora do escopo). Recomendação: (a), registrando o limite como risco.
2. **Não bloqueante.** Particionamento mensal (09 [PROPOSTA]) nesta história ou depois. Recomendação: depois (M), tratando só o risco de 500 MB (R-22) com estimativa de 0,5–1 KB/evento.
3. **Não bloqueante.** Algoritmo de hash e lista de chaves proibidas (PII) em `before/after_state`: delegar ao Arquiteto (SHA-256, serialização canônica). Recomendação: DELEGADO.
4. **Não bloqueante.** Catálogo inicial de `action` e `reason_code`: recomendação, definir nomes mínimos aqui (CA-14) e ampliar nas histórias consumidoras.

Não há dúvida bloqueante.

## Resumo em linguagem simples
Toda ação importante do sistema gera um registro (quem fez, o quê, antes e depois, quando) gravado junto com a própria ação; se uma falhar, a outra também é desfeita.
Esse registro não pode ser alterado nem apagado por ninguém pelo sistema, e qualquer adulteração é detectada pelo encadeamento de hashes.
