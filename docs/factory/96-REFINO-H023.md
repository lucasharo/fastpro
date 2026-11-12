# H-023 — Refino: descoberta por raio e online nacional

- **Issue:** #36 "[E2] Descoberta por raio e online nacional" · **Backlog:** H-023 · **Dependências:** H-022 (#35, Concluída); H-036 (#49, Backlog); H-031 (#44, Backlog), ver §5 e D-H023-2
- **Etapa:** specification · **Data:** 2026-11-12 · **Papel:** Product Owner · **Status:** refino para validação do líder
- **Etiquetas:** `[DECIDIDO]` aprovado nos documentos (PRD, decisões, critérios) · `[DELEGADO]` decisão delegada, revogável · `[VERIFICADO]` conferido em documento de arquitetura, backlog, quadro ou código existente, sem decisão de produto · `[PROPOSTA]` sugestão do PO, a validar · `[NÃO VERIFICADO]` depende de medição não feita
- **Fontes lidas:** 14-BACKLOG (H-023, H-022, H-024, H-036, H-055, H-031, BLQ-SPK); 16-MANIFESTO-ISSUES (numeração do manifesto difere do quadro: H-023 é o item 34 e H-055 é o item 66; usei o quadro como referência); quadro-status (#36 e #37 em Product Owner; #35 Concluído; #49 e #44 em Backlog; H-055 = #68); 04-PRD (RF-003, RF-004, RF-018, RF-051, RF-065, FA-010); 07-AMBIGUIDADES (AMB-15 A, AMB-18); 08-ARQUITETURA §7.2, §9.1 a §9.3; 09-MODELO-DADOS (`professional_service`, §6); 11-ARQ-RISCOS-E-TESTES (§2.2 `GET /discovery/requests`, I-16, T-03, T-11, R-38); 11-DECISOES (46, 56 (duplicidade e cobertura), 57, 91); 88-DESENHO-H022 (§1, §2.3, §5, §6, §7, §8, §9); migração `supabase/migrations/20261112120500_geo_expand_match_point.sql` (função `private.match_points_within`); 94-REFINO-H024 (padrão, D-H024-4); 96 é o próximo número livre (último existente: 95-REFINO-H028).

## 1. Objetivo

Permitir que um profissional elegível veja os pedidos do serviço dele que estão dentro do raio de atendimento (serviço presencial, de 5 a 100 km) ou que são de serviço online declarado (alcance nacional, sem raio). Esta história entrega a **regra de casamento** e a consulta de banco que a executa. Não entrega a rota de descoberta, a guarda de aprovação e de acesso vigente, nem o que o profissional vê na resposta: isso é H-055 (#68), que depende desta história. `[DECIDIDO]` RF-051, RF-065; `[DELEGADO]` RF-004; `[VERIFICADO]` 08 §9.3, decisão 57 (D-2).

## 2. Escopo

### 2.1 Regra de descoberta

Um pedido aparece para um profissional quando cumpre todas as condições abaixo:

- **Serviço declarado:** o profissional declarou o serviço do pedido, em alguma modalidade. `[DECIDIDO]` RF-065 ("serviço compatível").
- **Presencial:** se declarou o serviço como presencial, o centro da célula do pedido está a até o raio do profissional (5.000 m a 100.000 m) do centro da célula da base. `[DECIDIDO]` RF-051, RF-065; `[VERIFICADO]` 08 §9.3.
- **Online:** se declarou o serviço como online, não há raio: vale em qualquer UF. `[DELEGADO]` RF-004; base em AMB-18 A (07) e 08 §9.3.
- **Admissão aberta:** o pedido está publicado e `now() < acceptance_deadline_at`. `[VERIFICADO]` 08 §7.2 e §9.3.
- **Origem da busca:** o centro da célula da base do profissional, nunca o ponto exato. `[DECIDIDO]` decisão 57 (D-2); `[VERIFICADO]` 88 §1.

### 2.2 O que já existe no repositório `[VERIFICADO]`

- A função `private.match_points_within` existe (migração `20261112120500_geo_expand_match_point.sql`, entregue na #35). Ela devolve `subject_id`, centro da célula do pedido e distância ao centro, filtrando `subject_kind = 'request'` e a versão da grade. Aceita raio de **1 a 100.000 m**: o piso de 5 km ainda não está imposto. Não tem cursor, filtro de serviço, de modalidade nem de status.
- Não existem `professional_area` nem `service_request` no repositório. Eles vêm de H-036 e H-031.
- 88 §3 cita a migração como `20261112120000`; o arquivo real é `20261112120500`.

### 2.3 Impacto em dados e APIs `[PROPOSTA]`

- Nenhuma rota nova nesta história. A consulta é função de banco, sem exposição a visitante nem a profissional até H-055.
- Ajustes de desenho para o Architect (não são decisões de produto): piso de 5.000 m na primitiva (CA-04); cursor por distância e identificador (CA-12); e a leitura de serviço e modalidade por junção com `professional_service` e `service_request`.
- O índice GiST citado em 14-BACKLOG (risco de H-023) e em 09 §6 foi substituído pelo índice parcial de 88 §6, pela decisão 57 (D-2). Não criar GiST.

## 3. Fora de escopo

- Rota `GET /discovery/requests`, guarda de aprovação e de acesso vigente, e resposta final ao profissional: H-055 (#68). `[VERIFICADO]` 14-BACKLOG H-055; 11-ARQ §2.2.
- Base, raio e serviços do profissional, e a restrição de 5 a 100 km no perfil (CHECK): H-036 (#49).
- Cobertura do cliente ("com" ou "sem"): H-024 (#37).
- Rótulo de bairro, cidade ou UF e ponto generalizado visível: H-032 (#45).
- Aceite, vagas e chat: H-058 a H-062.
- Fotos a elegíveis: H-056.
- Restrição territorial de serviço regulamentado: depende de L4 (D-H023-6).
- Distância exata ou em km apresentada ao profissional: não prometida (D-H023-7).

## 4. Critérios de aceite (Given/When/Then)

- **CA-01 Raio presencial.** Dado um profissional com serviço presencial declarado e base com raio entre 5 km e 100 km, quando consulta a descoberta, então recebe os pedidos desse serviço cujo centro de célula está a até o raio do centro de célula da base. `[DECIDIDO]` RF-051, RF-065; `[VERIFICADO]` 88 §5.

- **CA-02 Fora do raio não aparece.** Dado um pedido cujo centro de célula está a mais de (raio + 710 m + 0,3 % do raio) da base, quando o profissional consulta, então o pedido não aparece. `[PROPOSTA]` faixa de incerteza (D-H023-4). 710 m são duas metades da diagonal da célula (2 × 355 m, `[VERIFICADO]` 88 §2.3); 0,3 % é a diferença entre a esfera e o elipsoide (88 R4).

- **CA-03 Dentro do raio aparece.** Dado um pedido cujo centro de célula está a menos de (raio − 710 m − 0,3 % do raio) da base, quando o profissional consulta, então o pedido aparece. Na faixa entre os dois limites, o resultado pode ser qualquer um, e o teste não exige nenhum dos dois. `[PROPOSTA]` (D-H023-4).

- **CA-04 Limite do raio.** Dado um raio de 4.999 m, de 100.001 m, zero, negativo ou ausente, quando a consulta é feita, então ela é recusada com texto fixo, sem executar a busca. Dado um raio de 5.000 m ou de 100.000 m, então é aceito. `[DECIDIDO]` RF-051; 14-BACKLOG H-023 ("raio fora de 5–100 km recusado"). Ajuste de piso em §2.3.

- **CA-05 Online sem raio.** Dado um profissional que declarou o serviço como online, quando há pedido desse serviço em qualquer UF e a qualquer distância, então o pedido aparece. `[DELEGADO]` RF-004; AMB-18 A; `[VERIFICADO]` 08 §9.3. Serviços regulamentados: ver D-H023-6.

- **CA-06 Presencial não ganha alcance nacional.** Dado um profissional que declarou o serviço só como presencial, quando há pedido desse serviço fora do seu raio, então o pedido não aparece, porque o alcance nacional vale só para a modalidade online. `[PROPOSTA]` regra de modalidade (`professional_service.modality`, 09 §3.3; 08 §9.3).

- **CA-07 Serviço não declarado não aparece.** Dado um pedido de serviço que o profissional não declarou, quando consulta, então o pedido não aparece, mesmo dentro do raio. `[DECIDIDO]` RF-065.

- **CA-08 Só pedido com admissão aberta.** Dado um pedido selecionado, encerrado, cancelado ou expirado, quando o profissional consulta, então ele não aparece. Dado um pedido publicado e dentro do prazo de 7 dias, então ele aparece se cumprir CA-01 a CA-07. `[VERIFICADO]` 08 §7.2 e §9.3; RF-018; 14-BACKLOG H-055 ("expirado não aparece"). Depende de H-031 (D-H023-2).

- **CA-09 Só célula, nunca ponto exato.** Dado dois pedidos com pontos exatos diferentes na mesma célula, quando a mesma base consulta, então os dois resultados são iguais. Dado a base do profissional, a origem é o centro da célula dela; a consulta nunca lê ponto exato. `[DECIDIDO]` decisão 57 (D-2); `[VERIFICADO]` 88 §1, §5 e T-CA06.

- **CA-10 Resposta sem ponto e sem dado pessoal.** Dado o resultado da descoberta, quando examinado, então não contém ponto exato, coordenada da base, endereço, nome, e-mail ou telefone do cliente. Contém só o identificador do pedido e o que H-032 e H-055 liberarem. A distância fica interna (D-H023-7). `[VERIFICADO]` 88 §7 itens 1 e 2; 11-ARQ I-16, T-03.

- **CA-11 Log e erro sem localização.** Dado qualquer consulta, quando grava log ou erro, então não aparecem coordenada, célula, distância nem identificador de profissional; os erros têm texto fixo. `[VERIFICADO]` 88 §7 item 4; 11-ARQ T-11.

- **CA-12 Paginação estável.** Dado mais de uma página de pedidos para o mesmo profissional, quando ele pede a página seguinte, então recebe os pedidos seguintes sem repetir nem pular, em ordem de distância e identificador. `[VERIFICADO]` 08 §9.3 (paginação por cursor); `[PROPOSTA]` ordem (88 §5). O desenho de 88 §5 não tem cursor (D-H023-8).

- **CA-13 Desempenho medido, não condição de aceite.** Dado 50.000 pontos sintéticos e um raio de 100 km, quando a consulta é executada no banco local com `analyze`, então usa o índice parcial de 88 §6 (sem varredura sequencial de `geocode_point`) e o tempo é registrado. A meta de 200 ms é medida, não condição de aceite. `[PROPOSTA]` 88 §6 e T-CA08. No Supabase Free: `[NÃO VERIFICADO]`.

## 5. Dependências

- **#35 (H-022), Concluída:** fornece `match_cell`, `match_point`, `match_grid_version` e `match_points_within`. `[VERIFICADO]` quadro-status e migração `20261112120500`.
- **H-036 (#49), Backlog:** fornece a base do profissional com coordenada permanente (e, portanto, o centro de célula da base), o raio e os serviços com modalidade. Sem ela não há origem nem serviço. **Condição de Desenvolvimento.** `[VERIFICADO]` 14-BACKLOG H-036 e 11-DECISOES 91 (a 91 já registra que #37 depende de #36 e #49). O nome do tipo de assunto da base em `geocode_point` é definido por H-036.
- **H-031 (#44), Backlog: dependência não declarada.** Cria `service_request` (serviço, status, `acceptance_deadline_at` e vínculo com `subject_id`). Os filtros de CA-05 a CA-08 dependem dela. Não consta na lista de dependências de 14-BACKLOG nem de 16-MANIFESTO. `[VERIFICADO]` 88 §0 item 2 e §5 (filtros "entram juntando com `service_request`"). Ver D-H023-2.
- **H-055 (#68):** consome esta história. Sem ela o profissional não vê nada. A ordem é #36 antes de #68.
- **#37 (H-024):** depende desta história (11-DECISOES 91; 94 §5). Cobertura usa o mesmo caminho de regra, mas em sentido inverso.
- **Ajustes de documentos (Architect ou Orquestrador):** (a) piso de 5.000 m na primitiva (CA-04); (b) cursor (CA-12); (c) retirar GiST de 14-BACKLOG H-023 e de 09 §6 (decisão 57); (d) corrigir o nome da migração em 88 §3.
- **Numeração:** 16-MANIFESTO usa outra numeração. A referência é o quadro: #36 = H-023; #68 = H-055.

## 6. Evidência exigida

Registrada na Issue #36, com comando, contagem e código de saída de cada execução local. Não declarar CI verde.

- `corepack pnpm check:all` e `corepack pnpm db:test`: código de saída e contagem de passou e falhou.
- **CA-01 a CA-03:** testes de fronteira com centro de célula e faixa de incerteza de CA-02 e CA-03; valores de 5 km e de 100 km.
- **CA-04:** 4.999 m, 5.000 m, 100.000 m, 100.001 m, zero e ausente.
- **CA-05 a CA-07:** um caso por regra (online em UF distinta; presencial fora do raio; serviço não declarado).
- **CA-08:** um pedido em cada estado (selecionado, encerrado, cancelado, expirado) e um publicado dentro do prazo.
- **CA-09:** dois pontos exatos na mesma célula com resultado igual; varredura: nenhuma função do caminho de consulta lê `exact_point`.
- **CA-10 e CA-11:** varredura do resultado, do log e dos erros, sem coordenada, célula, distância ou identificador de profissional.
- **CA-12:** duas páginas sem repetir nem pular, com pedidos empatados em distância.
- **CA-13:** `explain` sem `Seq Scan` em `geocode_point` e tempo registrado; no Supabase Free, `NÃO VERIFICADO`.
- A tolerância de 10 m de 88 §5 vale só para o oráculo de esfera. A faixa de produto é a de CA-02 e CA-03.

## 7. Dúvidas para o líder

Sem perguntas ao usuário. Cada dúvida tem recomendação. Os números serão consolidados pelo líder em lista única.

- **D-H023-1 (escopo com H-055).** A 14-BACKLOG dá a H-023 o critério "pedido fora do raio não aparece", mas a rota e a guarda de elegibilidade estão em H-055. **Recomendação:** #36 entrega a regra e a consulta de banco, com testes no banco; a rota, a guarda e a resposta ao profissional são H-055 (#68). **Alternativa:** levar a rota para #36. Descartada: H-055 depende de #36, e a inclusão cria ciclo de escopo. Não bloqueia o desenho; define o nível dos testes.

- **D-H023-2 (H-031 não declarada).** Os filtros de serviço, de modalidade e de status (CA-05 a CA-08) dependem de `service_request`, que é de H-031 (#44, Backlog). **Recomendação:** declarar H-031 como condição de Desenvolvimento de #36 e atualizar 14-BACKLOG. A ordem de DEV fica H-036 e H-031 antes de #36. **Alternativa:** dividir #36 em (a) raio, CA-01 a CA-04 e CA-09 a CA-13, depois de H-036; e (b) serviço, modalidade online e status, depois de H-031. Bloqueia o DEV, não o desenho.

- **D-H023-3 (origem da busca da base).** **Recomendação:** o centro da célula da base, lido das colunas `match_*` da linha da base (H-036), nunca o ponto exato, como em 88 §1 e na decisão 57. **Alternativa:** usar o ponto exato da base, dentro do banco. Descartada: contraria CA-09. Não bloqueia.

- **D-H023-4 (faixa de incerteza do raio).** **Recomendação:** aceitar uma faixa de 710 m mais 0,3 % do raio (CA-02 e CA-03), com a margem registrada na Issue. **Alternativa:** usar só o erro de uma célula (355 m). Descartada: os dois lados da comparação têm erro. Não bloqueia.

- **D-H023-5 (mesmo serviço nas duas modalidades).** Um profissional pode declarar o mesmo serviço como presencial e online. **Recomendação:** vale o caminho online (sem raio), porque é o mais amplo e RF-065 aceita os dois. Confirmar que a chave de `professional_service` (09 §3.3) permite as duas linhas. **Alternativa:** vale o presencial. Descartada: exclui profissional que aceita atendimento remoto. Não bloqueia.

- **D-H023-6 (serviço online regulamentado).** AMB-18 C e 08 §9.3 deixam as exceções regulamentadas para L4. **Recomendação:** serviços online com flag de atividade regulamentada (RF-003) não ganham alcance nacional até L4 decidir; os demais seguem CA-05. **Alternativa:** aplicar CA-05 a todos. Mais simples, mas sem decisão de L4. Não bloqueia os não regulamentados; bloqueia a liberação dos regulamentados.

- **D-H023-7 (distância exposta ao profissional).** `match_points_within` devolve `distance_m`. **Recomendação:** não expor a distância; ela serve só para ordenar e para CA-02 e CA-03. Isso reduz a triangulação (R9 de 88). **Alternativa:** mostrar faixa arredondada de 1 km. Ajuda a decisão, mas aumenta o vazamento. Decisão final em H-055. Não bloqueia.

- **D-H023-8 (paginação).** 08 §9.3 pede paginação por cursor; 88 §5 só tem limite. **Recomendação:** cursor por (distância, identificador) em H-023, como em CA-12. **Alternativa:** só limite, aceitável enquanto o volume for pequeno. Não bloqueia.

## 8. Próximo passo

O líder valida D-H023-1 (escopo com H-055), D-H023-2 (dependência de H-031 e ordem do DEV) e D-H023-6 (serviços regulamentados). As demais dúvidas seguem para o Architect com as recomendações acima. O cartão #36 permanece na coluna Product Owner até essa validação; a movimentação é do Orquestrador, não deste refino.
