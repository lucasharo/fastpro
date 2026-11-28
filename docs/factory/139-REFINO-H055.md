# Refino H-055 — Descoberta de pedidos elegíveis (Issue #68)

- **Issue:** #68 `[E6] Descoberta de pedidos elegíveis` · **História:** H-055 · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner (primeira coluna do quadro).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-14.
- **EXEC-ID:** não atribuído (não informado pelo líder).
- **Natureza:** somente documento. Nenhum código, migração, teste, banco de dados ou alteração no quadro foi realizado. O cartão permanece em Product Owner até decisão humana/Orquestrador.
- **Etiquetas:** `[DECIDIDO]` decisão do dono ou do líder, com número · `[VERIFICADO]` lido no repositório ou no quadro · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada.

---

## 0. Fontes e limitações

Fontes lidas:
- `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`.
- `docs/factory/quadro-status.md` (atualizado em 2026-11-13 12:30 UTC e refletido no histórico recente).
- `14-BACKLOG.md` (H-055, H-056, H-057, H-023, H-042, H-045, H-058 e §2 Ondas).
- `04-PRD.md` (RF-018, RF-029, RF-031, RF-051, RF-062, RF-065, RF-066, RF-109, RF-110, RF-136 a RF-139).
- `05-CRITERIOS-ACEITE.md` (FA-007, FA-010, FA-025, FA-030).
- `08-ARQUITETURA.md` (§1.1, §4.2, §6, §7.2, §9.3, §10.3).
- `09-MODELO-DADOS.md` (§3.4, §3.8, §3.10, §6, §7).
- `11-ARQ-RISCOS-E-TESTES.md` (I-16, T-03, T-04, T-07, T-11).
- `11-DECISOES.md` (Rodadas 31, 61, 62, 68, 74, 91, 102, 119, 121, 123, 124; decisões 57, 101 a 108, 267 a 279, 320 a 328, 420 a 426, 563 a 582, 640 a 645).
- `96-REFINO-H023.md` e `97-DESENHO-H023.md` (descoberta por raio da #36 CONCLUÍDA; decisão 101, recomendação de cursor opaco assinado).
- `113-REFINO-H045.md` e `114-DESENHO-H045.md` (acesso comercial derivado da #58 CONCLUÍDA).
- `126-REFINO-H032.md` e `127-DESENHO-H032.md` (visibilidade de localização da #45 em QA; decisões 420, 421, 424, 426).
- `117-REFINO-REMOCAO-HISTORICO-ACESSO.md` (#150 CONCLUÍDA; sem histórico de acesso a fotos).
- `137-REFINO-H042.md` e `142-DESENHO-H042.md` (guarda de elegibilidade da #55 em Arquitetura; decisões 563 a 582, 640 a 645).
- Modelos: `113-REFINO-H045.md` (padrão de estrutura e rigor).

Limitações `[NÃO VERIFICADO]`:
- O texto da Issue #68 no GitHub não foi lido por comando de rede (este agente não tem acesso a ferramentas de rede/shell externo com chamadas ao GitHub). O objetivo e escopo foram reconstruídos a partir da linha H-055 do backlog oficial e do cruzamento com todas as fontes documentais e decisões técnicas do repositório.
- Nenhum comando de banco de desenvolvimento foi executado (ambiente preservado; sem consultas ou migrações rodadas).
- Não há menção a backup (fora do escopo do projeto por decisão explícita do usuário registrada na Rodada 73/85 e #151).

---

## 1. Verificação de fila

- `[VERIFICADO]` O quadro mostra a Issue #68 (`[E6] Descoberta de pedidos elegíveis`) na coluna "Product Owner (3)", junto de #56 e #51.
- `[VERIFICADO]` Concluídas até o momento: #43, #44, #50, #52, #57, #58, #59, #36, #119, #141, #150, #151.
- `[VERIFICADO]` Em QA: #45, #46, #53.
- `[VERIFICADO]` Em Arquitetura: #55 (guarda parte A), #54, #47.
- `[VERIFICADO]` Em Desenvolvimento: #37.
- `[VERIFICADO]` Dependências declaradas de H-055 (`14-BACKLOG.md`):
  1. **H-023 (#36):** `Concluído` no quadro. Entrega a primitiva de casamento geográfico por raio e online nacional (`private.discover_scan` e `private.discover_requests`).
  2. **H-045 (#58):** `Concluído` no quadro. Entrega o livro de concessões `billing.access_grant`, `billing.subscription` mínima e a função `private.commercial_access(p_professional_id, p_at)`.
  3. **H-042 (#55):** `Arquitetura` no quadro. Entrega a guarda única de elegibilidade (`private.professional_access_guard` modo `descoberta_aceite` e a sobrecarga com `p_now` de `private.discover_requests`). **Ainda não construída no banco nem em código**.
- `[VERIFICADO]` A última decisão registrada nas rodadas consolidadas é a 582 (com decisões de desenho até a Rodada 124). As perguntas deste refino usam a numeração **603 a 622** (conforme instrução oficial).

---

## 2. Objetivo

Permitir que o **profissional elegível** (com verificação aprovada, conta ativa, e-mail verificado e acesso comercial vigente — trial, pago ou em carência de 72 h) consulte a lista paginada de pedidos de serviço abertos para atendimento que correspondam aos serviços declarados em seu perfil e estejam dentro do seu raio de atuação presencial (5 km a 100 km da base) ou que sejam de modalidade online nacional declarada.

A história H-055 expõe a rota HTTP autenticada da aplicação (`GET /v1/professional/discovery/requests`), aplica a guarda unificada de elegibilidade (H-042), projeta os campos públicos e generalizados autorizados do pedido, implementa a paginação por cursor keyset com **token opaco assinado e cifrado** (AEAD, impedindo o vazamento da distância interna métrica e bloqueando manipulações de navegação) e protege rigorosamente a privacidade do cliente contra qualquer vazamento de dados pessoais (sem nome, e-mail, telefone, endereço exato, ponto exato ou coordenadas de celular/célula).

Resultado de negócio: o profissional que cumpre todos os requisitos regulatórios e comerciais descobre oportunidades reais de trabalho em sua região de forma fluida e segura, sem que o FastPro exponha contatos, endereços exatos ou a situação financeira/cadastral de quem busca.

---

## 3. Escopo (dentro de H-055)

1. **Rota HTTP de descoberta:** criação do endpoint autenticado `GET /v1/professional/discovery/requests` na API, exigindo sessão válida do profissional (`SESSION_COOKIE_NAME`).
2. **Integração com a Guarda de Elegibilidade (H-042):** verificação obrigatória de que o profissional está em modo `descoberta_aceite` elegível (`verification_status = 'aprovada'`, `account_state = 'ativo'`, `email_verified = true` e `commercial_access` em `{trial_ativo, ativa, em_carencia, cancelada_com_acesso_ate_fim_do_periodo}`).
3. **Silêncio financeiro e anti-enumeração:** resposta uniforme de lista vazia (200 OK com `items: []`, `next_cursor: null`, `has_more: false`) quando o profissional não cumpre qualquer um dos requisitos de elegibilidade ou não possui perfil profissional ativo, sem vazar a razão da ausência de pedidos (decisão 569, 114 §privacidade).
4. **Token de cursor opaco assinado e cifrado (AEAD):** empacotamento criptográfico do cursor de banco `(out_cursor_group, out_cursor_key, out_request_id)` usando cifra autenticada AES-256-GCM via `node:crypto`, com chave derivada de variável de ambiente `DISCOVERY_CURSOR_KEY` e AAD vinculado ao contexto do profissional. O profissional recebe apenas uma string opaca segura; a distância métrica interna (`out_cursor_key`) nunca sai para a API nem para o cliente (decisões 107, 108; T-H055-cursor).
5. **Decodificação e validação do cursor recebido:** validação estrita da query string `?cursor=...`. Token inválido, adulterado, truncado ou forjado resulta em recusa imediata com 400 `{code: "cursor_invalido"}` sem executar consulta pesada no banco.
6. **Parâmetro de paginação `limit`:** suporte a `?limit=N` (padrão 50, mínimo 1, máximo 200). Valores fora da faixa ou não inteiros devolvem 400 `{code: "parametro_invalido"}`.
7. **Projeção autorizada de dados do pedido:** serialização dos campos estritamente autorizados para o profissional elegível antes de aceitar:
   - `id`: identificador do pedido (UUID);
   - `service_id`: identificador do serviço cadastrado (UUID);
   - `service_name`: nome do serviço no catálogo;
   - `urgency`: urgência declarada (`imediato`, `proximas_semanas`, `proximo_mes`, `nao_definido`);
   - `description`: descrição informada pelo cliente;
   - `public_label`: rótulo público generalizado ("Cidade - UF" ou nulo se não derivável, conforme regra estrita da #45 / decisão 420);
   - `distance_km`: distância esférica arredondada para cima em passos de 0,5 km, mínimo 0,5 km (decisão 426) para modalidade presencial; `null` para modalidade online;
   - `modality`: modalidade do pedido em relação ao atendimento (`presencial` ou `online`);
   - `published_at`: timestamp da publicação;
   - `acceptance_deadline_at`: timestamp do encerramento da admissão de aceites (7 dias da publicação);
   - `has_photos`: indicador booleano se o pedido possui fotos anexadas (sem expor URLs ou metadados de mídia nesta história).
8. **Blindagem estrita de privacidade e dados pessoais (PII):** garantia por código, tipos e testes de que NENHUM dado pessoal do cliente (primeiro nome, e-mail, telefone, endereço exato em texto, endereço cifrado, ponto geográfico exato, coordenadas `match_lon`/`match_lat` ou índice de grade `match_cell`) seja retornado na descoberta (RF-137, I-16, T-03).
9. **Rate limit anti-abuso/anti-raspagem:** limite de requisições por profissional na rota de descoberta (ex.: 60 requisições por minuto por IP/sessão) para impedir varredura sistemática e triangulação automatizada.
10. **Cabeçalhos de segurança:** envio compulsório de `Cache-Control: no-store`, `Referrer-Policy: no-referrer` e `Content-Type: application/json; charset=utf-8`.
11. **Testes automatizados completos:** testes unitários de domínio (validações de cursor, limites e projeção), testes de cifra do cursor, testes de integração de rota (com relógio injetado `p_now`) e testes de contrato do adaptador de banco.

---

## 4. Fora de escopo

- **Geração de URLs assinadas de fotos e marca d'água:** pertence à história H-056 (#69). H-055 não serve fotos nem gera tokens de visualização de mídia.
- **Contador de visualizações e sinal de raspagem de fotos:** pertence à história H-057 (#70) e respeita a exclusão definitiva do histórico de acesso a fotos definida na Issue #150 (`117-REFINO-REMOCAO-HISTORICO-ACESSO.md`).
- **Ação de aceitar trabalho ("Aceitar trabalho"):** pertence à história H-058 (#71). H-055 é estritamente consulta e descoberta.
- **Controle de vagas 4+4, contadores de aceites e botão de 2ª onda:** pertencem às histórias H-059 (#72) e H-060 (#134). A descoberta não expõe vagas, contadores nem ondas (RF-066, FA-010).
- **Abertura e envio de mensagens de chat:** pertencem a H-065 (#76) e H-066 (#77).
- **Criação da guarda única de elegibilidade no banco:** entregue pela parte A de H-042 (#55). H-055 apenas a consome.
- **Criação da primitiva de banco `discover_scan` e grade geográfica:** já entregues e concluídas em H-023 (#36).
- **Cadastro, edição de raio de atendimento ou base do profissional:** pertencem a H-036 (#49).
- **Pagamento, checkout e gestão de planos do Mercado Pago:** pertencem a H-046 (#59), H-047 (#60), H-048 (#61) e H-049 (#62).
- **Chamadas a provedores externos de mapas ou geocodificação:** proibição total de chamadas reais ao Mapbox (decisões da Rodada 74). Toda a operação é local e autossuficiente no Postgres.
- **Backup, restauração ou exportação de banco:** formalmente removido do escopo do projeto (decisão do usuário na Rodada 73/85 e Issue #151). Não citar nem planejar.

---

## 5. Fluxos e estados

### 5.1 Rota e controle de acesso

1. O cliente HTTP envia `GET /v1/professional/discovery/requests` acompanhado do cookie de sessão `fastpro_session` e, opcionalmente, dos parâmetros de query `limit` e `cursor`.
2. A API valida a presença do cookie:
   - Sem cookie ou com cookie inválido: responde `401 Unauthorized` com `{code: "sessao_necessaria"}`.
3. A API resolve a sessão e identifica o `user_id`:
   - Se o usuário autenticado não possui papel profissional (`app.professional_profile`), a rota responde `403 Forbidden` com `{code: "perfil_profissional_obrigatorio"}` (ou 404 uniforme anti-enumeração, conforme definido na pergunta 607).
4. A API valida os parâmetros de consulta:
   - Se `limit` for fornecido e não for inteiro entre 1 e 200: responde `400 Bad Request` com `{code: "parametro_invalido"}`.
   - Se `cursor` for fornecido, a API tenta decodificar e autenticar o token opaco com a chave `DISCOVERY_CURSOR_KEY`:
     - Se falhar na verificação de integridade AEAD (tag inválida, alteração de bytes, token malformado ou versão desconhecida): responde `400 Bad Request` com `{code: "cursor_invalido"}`.
5. Se a taxa de requisições exceder o teto estipulado para a rota:
   - Responde `429 Too Many Requests` com `{code: "muitas_requisicoes"}` e cabeçalho `Retry-After`.

```
[Cliente Profissional]
        |
        | GET /v1/professional/discovery/requests?limit=50&cursor=...
        v
[API: Auth & Session] ---> (Sem sessão) ----------------------> 401 sessao_necessaria
        |
        +-----------------> (Não profissional) ---------------> 403 perfil_profissional_obrigatorio
        |
[API: Cursor Decrypt] ----> (Token adulterado/inválido) ------> 400 cursor_invalido
        |
[API: Rate Limiter] ------> (Excesso de chamadas) ------------> 429 muitas_requisicoes
        |
        v
[Banco: Guarda H-042] ----> (Não aprovado / Sem acesso) ------> 200 OK: { items: [], next_cursor: null }
        |
        | (Elegível)
        v
[Banco: discover_scan] ---> (Casamento geográfico e serviço)
        |
        v
[API: Projeção & Token] --> Cifra cursor do último item (se houver mais)
        |
        v
200 OK: { items: [...], next_cursor: "token_opaco", has_more: true }
```

### 5.2 Guarda de elegibilidade e silêncio financeiro

A guarda de elegibilidade (construída na Issue #55 / H-042) é avaliada para o `professional_id` em tempo real na consulta com relógio injetado (`p_now`):

| Requisito do Profissional | Estado do Registro | Avaliação na Guarda | Efeito na Descoberta |
|---|---|---|---|
| Verificação cadastral | `aprovada` | `true` | Continua avaliação |
| Verificação cadastral | `pendente`, `em_revisao`, `recusada`, `retida_duplicidade`, `suspensa` | `false` | Retorna lista vazia (200 OK) |
| Conta do profissional | `ativo` | `true` | Continua avaliação |
| Conta do profissional | `bloqueado`, `suspenso`, `encerrado` | `false` | Retorna lista vazia (200 OK) |
| E-mail de cadastro | `email_verified = true` | `true` | Continua avaliação |
| E-mail de cadastro | `email_verified = false` | `false` | Retorna lista vazia (200 OK) |
| Acesso comercial vigente | `ativa` ou `trial_ativo` | `true` | Acesso concedido |
| Acesso comercial vigente | `em_carencia` (até `ends_at + 72 h`) | `true` | Acesso concedido durante a carência |
| Acesso comercial vigente | `cancelada_com_acesso_ate_fim_do_periodo` | `true` | Acesso concedido até `ends_at` |
| Acesso comercial vigente | `expirada`, `trial_expirado`, `sem_acesso` | `false` | Retorna lista vazia (200 OK) |

**Invariante de Anti-enumeração e Silêncio Financeiro (decisão 569):** O profissional não elegível recebe exatamente a mesma estrutura de resposta de um profissional elegível que não possui pedidos disponíveis no momento (`items: []`). O endpoint de descoberta jamais revela se a ausência de pedidos se deve a atraso de pagamento, trial vencido, recusa de documento ou ausência de demanda na região. O profissional verifica seu status cadastral na rota `/v1/professional/verificacao` (H-041) e seu status comercial nas rotas de assinatura/faturamento.

### 5.3 Projeção de dados e blindagem de PII

A consulta junta os pedidos retornados por `discover_requests` com as tabelas de pedidos (`app.service_request`) e catálogo (`app.service`).

Para cada pedido retornado na lista:
- **`id`**: UUID do pedido;
- **`service_id`**: UUID do serviço no catálogo;
- **`service_name`**: Nome textual do serviço;
- **`urgency`**: Urgência informada pelo cliente;
- **`description`**: Texto descritivo da necessidade;
- **`public_label`**: Rótulo geográfico generalizado derivado pela função pura de domínio da #45 ("Cidade - UF" ou `null`);
- **`distance_km`**: Para modalidade presencial, distância esférica entre centros de célula calculada pelo banco e arredondada para cima em passos de 0,5 km, com piso mínimo de 0,5 km (`ceil(dist_m / 500) * 0.5`). Para modalidade online, valor `null`;
- **`modality`**: `'presencial'` se o casamento ocorreu pelo ramo com raio (`group = 0`); `'online'` se o casamento ocorreu pelo ramo online nacional (`group = 1`);
- **`published_at`**: Timestamp de publicação do pedido;
- **`acceptance_deadline_at`**: Timestamp limite de aceites (7 dias corridos após publicação);
- **`has_photos`**: Booleano indicando presença de fotos no pedido.

**Campos Proibidos na Descoberta (Blindagem Estrita):**
- `first_name` (primeiro nome do cliente): PROIBIDO na descoberta; liberado apenas aos participantes após aceite ativo (H-058, RF-110, I-16, RC-03).
- `email` (e-mail do cliente): ESTRITAMENTE PROIBIDO em qualquer visualização de profissional (RF-137, I-16, RC-02).
- `phone_enc` / telefone: PROIBIDO na descoberta; acessível somente com consentimento expresso e participação ativa (H-046, RF-138).
- `address_text` / `address_text_enc` (endereço completo): PROIBIDO na descoberta; acessível somente após seleção com compartilhamento explícito (H-032, RF-139).
- `exact_point` (coordenada exata de geocodificação): ESTRITAMENTE PROIBIDO no retorno da API ou em visualizações (08 §9.2, RC-03).
- `match_cell`, `match_lon`, `match_lat` (coordenadas numéricas da célula e centro): PROIBIDAS no retorno JSON ao front-end para evitar triangulação (decisão 417, 127 §0.6).
- Contadores de vagas, status de onda ou total de aceites já realizados: PROIBIDOS na descoberta (RF-066, FA-010).

### 5.4 Token de cursor opaco assinado e cifrado

Conforme determinado em `97-DESENHO-H023.md` (§4.4, decisões 107 e 108) e confirmado na Rodada 91:
- A função de banco devolve `(out_request_id uuid, out_cursor_group smallint, out_cursor_key integer)`.
- `out_cursor_key` contém a distância arredondada em metros e **é material estritamente interno**. Se fosse transmitida em claro no cursor base64, permitiria que um atacante decodificasse distâncias exatas e triangulasse pedidos.
- A API empacota `group`, `key` e `requestId` em um payload compacto:
  `payload = Buffer.from(JSON.stringify({ g: group, k: key, id: requestId }))` (ou serialização binária equivalente).
- O payload é cifrado e autenticado via **AES-256-GCM** com `node:crypto`:
  - Chave derivada por HKDF-SHA-256 a partir da variável `DISCOVERY_CURSOR_KEY` (`ikm` = chave do ambiente, `salt` = `fastpro-discovery-cursor-v1`, `info` = `cursor-aead`);
  - Nonce aleatório de 12 bytes gerado a cada emissão;
  - AAD (Additional Authenticated Data) amarrado à versão do formato e ao `professional_id` do usuário logado: `aad = "cur1|" + professionalId`;
  - Tag de autenticação GCM de 16 bytes;
  - Formato do token final: `base64url([1 byte de versão = 1][12 bytes nonce][16 bytes tag][texto cifrado])`.
- Propriedades de segurança:
  - **Opacidade:** o cliente não consegue inspecionar o conteúdo nem descobrir a distância métrica.
  - **Integridade / Autenticidade:** qualquer alteração de bits invalida a tag e gera 400 `{code: "cursor_invalido"}`.
  - **Vinculação de identidade:** o cursor de um profissional não pode ser reutilizado na sessão de outro profissional (falha de AAD).
  - **Anti-tampering:** o profissional não pode forjar chaves de grupo, distância ou IDs para pular páginas arbitrariamente.

### 5.5 Paginação keyset e ciclo de vida do pedido

1. A consulta utiliza paginação estável keyset baseada na tupla `(out_cursor_group, out_cursor_key, out_request_id)`.
2. Grupo 0: pedidos presenciais dentro do raio, ordenados por distância esférica métrica e desempate por UUID do pedido.
3. Grupo 1: pedidos online de abrangência nacional (fora do raio ou sem distância), ordenados por UUID do pedido.
4. Quando o cursor atinge o fim do Grupo 0, a página seguinte transiciona naturalmente para o Grupo 1 sem interrupções nem duplicatas.
5. Inserção de novos pedidos no banco entre a navegação de páginas: pedidos novos com distância menor que o cursor já percorrido não aparecem na página atual (não deslocam posições de itens subsequentes, ao contrário de paginações por `OFFSET`).
6. Encerramento de pedidos (pedidos aceitos por 8 profissionais, selecionados, cancelados ou cujo prazo de 7 dias expirou entre a leitura da página 1 e a página 2): somem silenciosamente da página seguinte, garantindo que nenhum pedido encerrado seja descoberto (CA-H055-11).

---

## 6. Regras de negócio e invariantes

| Ref. | Regra | Fonte | Como H-055 atende |
|---|---|---|---|
| RN-H055-01 | **Elegibilidade total mandatória.** Só descobre pedidos o profissional aprovado na verificação, com conta ativa, e-mail verificado e acesso comercial vigente (trial, pago, carência de 72 h ou cancelado em vigência). | RF-065, FA-010, FA-025, T-04; `08` §9.3 | Integração com guarda de H-042; CA-H055-03 a 07 |
| RN-H055-02 | **Anti-enumeração e silêncio financeiro.** Não elegíveis e inexistentes recebem lista vazia com código 200 OK. Nenhum erro divulga inadimplência ou reprovação. | Decisão 569, `114` §privacidade, RF-137 | Resposta uniforme `{ items: [], next_cursor: null, has_more: false }`; CA-H055-04 e 05 |
| RN-H055-03 | **Casamento de serviço e território.** Presencial: centro de célula da base a até o raio (5–100 km) do centro de célula do pedido. Online: serviço declarado online não regulamentado tem alcance nacional. | RF-051, RF-065, decisões 105 e 106 | Execução via `discover_scan` (#36); CA-H055-08 a 10 |
| RN-H055-04 | **Admissão aberta estrita.** Apenas pedidos em `status = 'publicado'` e `p_now < acceptance_deadline_at`. Pedidos selecionados, concluídos, cancelados ou vencidos não aparecem. | RF-018, RF-072; `08` §7.2; FA-010 | Filtro SQL de admissão; CA-H055-11 |
| RN-H055-05 | **Blindagem total de PII.** Proibição absoluta de vazar nome, e-mail, telefone, endereço em texto/cifrado, ponto exato ou coordenadas de célula na resposta. | RF-137, RF-138, RF-139, I-16, T-03 | Serializador rígido com exclusão explícita de campos sensíveis; CA-H055-12 |
| RN-H055-06 | **Distância generalizada.** Distância presencial arredondada para cima em passos de 0,5 km, mínimo de 0,5 km. Online sem distância (`null`). Metro exato nunca exposto. | Decisão 426, D-07 da #45 | Função pura de formatação e projeção; CA-H055-13 |
| RN-H055-07 | **Rótulo geográfico seguro.** Cidade e UF derivadas da publicação ("Cidade - UF"), sem rua, número ou CEP. Se nulo, sai `null`. | Decisão 420, D-08 da #45 | Projeção direta de `public_label`; CA-H055-14 |
| RN-H055-08 | **Cursor opaco assinado e cifrado (AEAD).** O cursor keyset é cifrado com AES-256-GCM. A distância métrica interna não vaza e o cursor é imutável a adulterações. | Decisões 107 e 108; T-H055-cursor | Módulo criptográfico `discovery-cursor-crypto.ts`; CA-H055-15 e 16 |
| RN-H055-09 | **Paginação determinística sem OFFSET.** Navegação por `(group, key, id)` estável contra inserções e remoções de pedidos concorrentes. | `08` §9.3; CA-12 de #36 | Keyset pagination com limite de 1 a 200 (padrão 50); CA-H055-17 e 18 |
| RN-H055-10 | **Ocultação de vagas e concorrência.** A resposta de descoberta não exibe contagem de aceites já efetuados, vagas restantes (4+4) nem ondas abertas. | RF-066, FA-010 | Ausência total de campos de vagas no contrato de resposta; CA-H055-12 |
| RN-H055-11 | **Rate limit anti-raspagem.** Proteção contra enumeração automatizada e triangulação de coordenadas por chamadas repetitivas. | `08` §10.3, R-03; ADR-009 | Limitador de taxa por sessão profissional na rota; CA-H055-19 |
| RN-H055-12 | **Relógio controlado.** Todos os prazos e comparações usam `p_now` fornecido pela aplicação, garantindo testes determinísticos e independência de cron. | Decisão 517, P4; `08` §1.1 | Injeção de `Clock` de domínio; CA-H055-20 |

Invariantes citadas:
- **I-16** (nenhuma consulta a profissional retorna e-mail; telefone só com consentimento; endereço exato só com compartilhamento): H-055 cumpre integralmente na listagem de pedidos.
- **T-03** (visibilidade da matriz de dados): profissional elegível não participante não vê primeiro nome nem dados privados do pedido.
- **T-04** (estado × elegibilidade): profissional suspenso, não aprovado ou expirado não descobre novos pedidos.
- **P4** (tempo resolvido no uso, sem dependência de cron/job): o status de admissão aberta e vigência de acesso comercial é avaliado no instante `p_now` da leitura.
- **T-H055-cursor** (critério herdado da #36, decisões 107 e 108): o token de cursor é cifrado/assinado e não expõe distância interna.

---

## 7. Critérios de aceite (Given / When / Then)

Todos os critérios são testáveis e mensuráveis. Testes de banco e rota devem rodar com relógio controlado (`p_now`) e dados sintéticos identificados com marcadores de teste.

- **CA-H055-01 (Autenticação da rota de descoberta).**
  - **Dado** uma requisição a `GET /v1/professional/discovery/requests` sem o cookie de sessão `fastpro_session` ou com cookie cuja sessão não existe no banco ou está expirada,
  - **Quando** a rota é acionada,
  - **Então** responde HTTP `401 Unauthorized` com corpo `{ code: "sessao_necessaria" }`, cabeçalho `Cache-Control: no-store` e nenhuma consulta de pedidos é disparada.

- **CA-H055-02 (Perfil não profissional recebe recusa).**
  - **Dado** uma sessão válida pertencente a um usuário que é apenas cliente (`app.customer_profile`) e não possui perfil profissional em `app.professional_profile`,
  - **Quando** requisita a rota de descoberta de pedidos,
  - **Então** responde HTTP `403 Forbidden` com `{ code: "perfil_profissional_obrigatorio" }` (ou 404 conforme decisão 607), impedindo que clientes usem o motor de busca de profissionais.

- **CA-H055-03 (Profissional elegível descobre pedidos compatíveis).**
  - **Dado** um profissional com verificação `aprovada`, conta `ativo`, `email_verified = true`, acesso comercial `ativa` (ou `trial_ativo`), serviço "Eletricista" declarado presencial com base e raio de 20 km,
  - **E** existindo um pedido publicado de "Eletricista" com prazo válido e centro de célula a 12 km da base,
  - **Quando** o profissional consulta a descoberta sem cursor,
  - **Então** responde HTTP `200 OK` contendo o pedido na lista `items`, com `distance_km` presente, `modality = "presencial"`, `public_label` correspondente e cabeçalhos `Cache-Control: no-store`.

- **CA-H055-04 (Silêncio financeiro: não aprovado recebe lista vazia).**
  - **Dado** um profissional cuja verificação cadastral está em `pendente`, `em_revisao`, `recusada`, `retida_duplicidade` ou `suspensa`,
  - **E** existindo pedidos publicados elegíveis na sua região,
  - **Quando** ele consulta a rota de descoberta,
  - **Então** responde HTTP `200 OK` com `{ items: [], next_cursor: null, has_more: false }`, sem qualquer indício ou menção à pendência documental na resposta.

- **CA-H055-05 (Silêncio financeiro: acesso comercial expirado recebe lista vazia).**
  - **Dado** um profissional aprovado e com e-mail verificado, mas cujo acesso comercial está em `expirada`, `trial_expirado` ou `sem_acesso` no instante `p_now`,
  - **Quando** consulta a descoberta,
  - **Então** responde HTTP `200 OK` com `{ items: [], next_cursor: null, has_more: false }`, sem código de erro financeiro (anti-enumeração e preservação da privacidade financeira).

- **CA-H055-06 (Carência de 72 h permite descoberta normalmente).**
  - **Dado** um profissional com assinatura cujo período pago terminou há 48 horas (estado `em_carencia`, dentro das 72 h de tolerância da decisão 267 e RF-059),
  - **Quando** consulta a descoberta no instante `p_now`,
  - **Então** os pedidos elegíveis dentro do raio aparecem normalmente na lista (a carência preserva plenamente a capacidade de descoberta).

- **CA-H055-07 (Cancelamento com acesso até o fim permite descoberta).**
  - **Dado** um profissional que solicitou cancelamento da assinatura (`cancel_at_period_end = true`), mas cujo período pago corrente ainda não terminou (`p_now < ends_at`),
  - **Quando** consulta a descoberta,
  - **Então** visualiza os pedidos disponíveis normalmente até o exato instante `ends_at`.

- **CA-H055-08 (Serviço presencial fora do raio não aparece).**
  - **Dado** um profissional com serviço presencial e raio de 10 km,
  - **E** um pedido publicado do mesmo serviço localizado a 25 km de sua base (fora da faixa de incerteza da decisão 104),
  - **Quando** o profissional consulta a descoberta,
  - **Então** o pedido não é incluído na listagem.

- **CA-H055-09 (Serviço online nacional não regulamentado aparece em qualquer UF).**
  - **Dado** um profissional com serviço declarado na modalidade `online` cujo serviço não é regulamentado (`regulated = false`),
  - **E** um pedido publicado desse serviço em outro estado a 2.000 km de distância,
  - **Quando** consulta a descoberta,
  - **Então** o pedido aparece na lista com `modality = "online"` e `distance_km = null`.

- **CA-H055-10 (Serviço regulamentado só online não ganha alcance nacional).**
  - **Dado** um profissional que declarou serviço regulamentado (`regulated = true`) exclusivamente na modalidade `online`,
  - **Quando** consulta a descoberta,
  - **Então** pedidos fora do seu raio ou em outras UFs não aparecem (cumprindo a decisão 106 de retenção territorial até definição L4).

- **CA-H055-11 (Pedido com admissão encerrada não aparece).**
  - **Dado** pedidos com status `selecionado`, `concluido`, `cancelado` ou com `status = 'publicado'` porém com `p_now >= acceptance_deadline_at` (prazo de 7 dias atingido ou expirado),
  - **Quando** qualquer profissional elegível consulta a descoberta,
  - **Então** nenhum desses pedidos aparece no resultado.

- **CA-H055-12 (Blindagem absoluta de dados pessoais na resposta).**
  - **Dado** qualquer resultado de descoberta com pedidos publicados,
  - **Quando** a resposta JSON é inspecionada campo por campo,
  - **Então** não existem as propriedades `first_name`, `email`, `phone`, `phone_enc`, `address_text`, `address_text_enc`, `exact_point`, `match_cell`, `match_lon`, `match_lat`, nem contadores de vagas (`acceptances_count`, `wave`). Prova: teste estático de esquema e teste de integração com sentinelas.

- **CA-H055-13 (Distância formatada e arredondada em passos de 0,5 km).**
  - **Dado** um pedido presencial cujo centro de célula dista 4.120 metros do centro de célula da base do profissional,
  - **Quando** retornado na descoberta,
  - **Então** o campo `distance_km` tem o valor `4.5` (arredondamento para cima em passos de 0,5 km); se a distância for inferior a 500 m, o valor é `0.5` (mínimo de 0,5 km, decisão 426). A distância inteira em metros não é exposta.

- **CA-H055-14 (Rótulo público "Cidade - UF").**
  - **Dado** um pedido publicado que possui `public_label` gravado ("Campinas - SP"),
  - **Quando** retornado na descoberta,
  - **Então** o campo `public_label` exibe exatamente `"Campinas - SP"`; caso o pedido possua `public_label` nulo, o campo é retornado como `null`.

- **CA-H055-15 (Cursor opaco assinado e cifrado: round-trip íntegro).**
  - **Dado** uma listagem de descoberta com mais de 50 pedidos disponíveis,
  - **Quando** a primeira página é retornada,
  - **Então** o campo `next_cursor` é uma string base64url não vazia, impossível de ser decodificada sem a chave secreta, e que, ao ser enviada na requisição seguinte (`?cursor=...`), entrega a segunda página exatamente a partir do 51º pedido, sem repetições nem omissões.

- **CA-H055-16 (Cursor adulterado ou inválido devolve 400).**
  - **Dado** uma requisição contendo `?cursor=token_alterado`, com payload corrompido, tag violada ou gerado para outro profissional,
  - **Quando** a API processa a consulta,
  - **Então** responde HTTP `400 Bad Request` com `{ code: "cursor_invalido" }`, sem executar a consulta pesada no Postgres.

- **CA-H055-17 (Paginação keyset estável entre grupos presencial e online).**
  - **Dado** um profissional que atende tanto pedidos presenciais quanto online,
  - **Quando** navega por todas as páginas disponíveis,
  - **Então** todos os pedidos do Grupo 0 (presencial) são entregues primeiro em ordem de distância e UUID, seguidos por todos os pedidos do Grupo 1 (online), atravessando a fronteira de grupos sem pular nenhum pedido e sem apresentar duplicatas.

- **CA-H055-18 (Validação do parâmetro limit).**
  - **Dado** requisições com `?limit=0`, `?limit=201`, `?limit=-5` ou `?limit=abc`,
  - **Quando** recebidas pela API,
  - **Então** respondem HTTP `400 Bad Request` com `{ code: "parametro_invalido" }`. Requisições sem `limit` adotam o valor padrão de 50.

- **CA-H055-19 (Rate limit anti-abuso na descoberta).**
  - **Dado** um cliente que dispara requisições repetitivas de descoberta excedendo a cota permitida por minuto (ex.: 60 req/min),
  - **Quando** a cota estoura,
  - **Então** a API responde HTTP `429 Too Many Requests` com `{ code: "muitas_requisicoes" }` e cabeçalho `Retry-After`.

- **CA-H055-20 (Relógio injetado e determinismo temporal).**
  - **Dado** duas chamadas idênticas com o mesmo cursor e o mesmo `p_now` fornecido em momentos distintos,
  - **Quando** executadas contra a mesma base de dados congelada,
  - **Então** devolvem exatamente o mesmo conjunto de pedidos e cursores.

- **CA-H055-21 (Cabeçalhos de proteção e no-store).**
  - **Dado** qualquer resposta de sucesso ou erro da rota de descoberta,
  - **Quando** os cabeçalhos HTTP são verificados,
  - **Então** contêm `Cache-Control: no-store`, `Referrer-Policy: no-referrer` e `Content-Type: application/json; charset=utf-8`.

- **CA-H055-22 (Execução sem serviços externos nem Mapbox real).**
  - **Dado** o ambiente de desenvolvimento e testes sem chaves do Mapbox no `.env.local` e sem rede externa,
  - **Quando** a suíte de testes de H-055 é executada,
  - **Então** todos os testes passam sem registrar chamadas HTTP externas e sem depender de provedor de mapas em tempo de execução.

---

## 8. Matriz de cenários de teste e cobertura

| Identificador | Cenário de Teste | Condição / Fixture | Resultado Esperado | Critério de Aceite |
|---|---|---|---|---|
| CT-01 | Sessão anônima | Sem cookie na requisição | 401 `{code: "sessao_necessaria"}` | CA-H055-01 |
| CT-02 | Sessão de cliente | Usuário autenticado sem registro em `professional_profile` | 403 `{code: "perfil_profissional_obrigatorio"}` | CA-H055-02 |
| CT-03 | Profissional elegível no raio | Aprovado, ativo, e-mail ok, pago, raio 20 km, pedido a 10 km | 200 OK com pedido, `distance_km = 10.0`, `modality = 'presencial'` | CA-H055-03 |
| CT-04 | Verificação pendente | Perfil com `verification_status = 'pendente'` | 200 OK com `{ items: [], next_cursor: null }` | CA-H055-04 |
| CT-05 | Verificação recusada | Perfil com `verification_status = 'recusada'` | 200 OK com `{ items: [], next_cursor: null }` | CA-H055-04 |
| CT-06 | Retenção por duplicidade | Perfil com `verification_status = 'retida_duplicidade'` | 200 OK com `{ items: [], next_cursor: null }` | CA-H055-04 |
| CT-07 | Perfil suspenso | Perfil com `verification_status = 'suspensa'` | 200 OK com `{ items: [], next_cursor: null }` | CA-H055-04 |
| CT-08 | E-mail não verificado | Perfil aprovado, mas `app_user.email_verified = false` | 200 OK com `{ items: [], next_cursor: null }` | CA-H055-04 |
| CT-09 | Assinatura expirada | `commercial_access` devolve `expirada` (após 72 h de carência) | 200 OK com `{ items: [], next_cursor: null }` | CA-H055-05 |
| CT-10 | Trial expirado | `commercial_access` devolve `trial_expirado` | 200 OK com `{ items: [], next_cursor: null }` | CA-H055-05 |
| CT-11 | Em carência de 72 h | `commercial_access` devolve `em_carencia` (+48 h do fim do período) | 200 OK com pedidos visíveis normalmente | CA-H055-06 |
| CT-12 | Cancelada em vigência | Assinatura cancelada com `p_now < ends_at` | 200 OK com pedidos visíveis até o encerramento | CA-H055-07 |
| CT-13 | Presencial além do raio | Pedido localizado a 50 km para profissional com raio de 15 km | Pedido não retornado na listagem | CA-H055-08 |
| CT-14 | Online não regulamentado | Pedido a 3.000 km em outra UF de serviço online não regulamentado | 200 OK com pedido, `modality = 'online'`, `distance_km = null` | CA-H055-09 |
| CT-15 | Online regulamentado | Pedido em outra UF de serviço online regulamentado (`regulated = true`) | Pedido não retornado (sem alcance nacional) | CA-H055-10 |
| CT-16 | Serviço não declarado | Pedido de serviço que o profissional não marcou em seu perfil | Pedido não retornado, mesmo dentro do raio | CA-H055-10 |
| CT-17 | Prazo de admissão vencido | Pedido com `acceptance_deadline_at <= p_now` | Pedido não retornado (expirado para aceites) | CA-H055-11 |
| CT-18 | Pedido selecionado | Pedido em `status = 'selecionado'` | Pedido não retornado na descoberta | CA-H055-11 |
| CT-19 | Pedido cancelado | Pedido em `status = 'cancelado'` | Pedido não retornado na descoberta | CA-H055-11 |
| CT-20 | Inspeção de PII | Resposta completa serializada em JSON | Sem `first_name`, `email`, `phone`, `address`, `point`, `cell` | CA-H055-12 |
| CT-21 | Arredondamento de distância | Distâncias reais: 4.100 m, 4.600 m, 300 m | Devolve 4.5 km, 5.0 km e 0.5 km (piso mínimo) | CA-H055-13 |
| CT-22 | Rótulo público | Pedido com rótulo "Santos - SP" | Devolve "Santos - SP"; se nulo, devolve `null` | CA-H055-14 |
| CT-23 | Keyset round-trip | Navegação paginada por 120 pedidos sintéticos | Página 1 (50), Página 2 (50), Página 3 (20) sem perda/duplicidade | CA-H055-15, 17 |
| CT-24 | Cursor adulterado | Modificação de 1 byte na string base64 do cursor | 400 Bad Request `{code: "cursor_invalido"}` | CA-H055-16 |
| CT-25 | Cursor de outro usuário | Token gerado com AAD de P1 enviado na sessão de P2 | 400 Bad Request `{code: "cursor_invalido"}` | CA-H055-16 |
| CT-26 | Limites inválidos | `limit` com valores 0, 250, -1, "dez" | 400 Bad Request `{code: "parametro_invalido"}` | CA-H055-18 |
| CT-27 | Rate limit estourado | Disparo de 70 requisições seguidas pelo mesmo profissional | 429 Too Many Requests `{code: "muitas_requisicoes"}` | CA-H055-19 |
| CT-28 | Prova de determinismo | Mesma consulta repetida em instantes reais diferentes com `p_now` fixo | Resposta idêntica byte a byte | CA-H055-20 |
| CT-29 | Ausência de chamadas externas | Execução com provedores de rede desconectados | 100% dos testes passam localmente no Postgres | CA-H055-22 |

---

## 9. Dependências

Estado real conferido em `docs/factory/quadro-status.md` e no histórico de decisões:

- **H-023 (#36) — Descoberta por raio e online nacional:** `Concluído` no quadro. Fornece a função de banco `private.discover_scan` e `private.discover_requests`, com o índice parcial em `geocode_point` e a fórmula de casamento.
- **H-045 (#58) — Acesso comercial derivado:** `Concluído` no quadro. Fornece o livro `billing.access_grant` e a função estável `private.commercial_access(p_professional_id, p_at)`.
- **H-042 (#55) — Guarda de elegibilidade na API e no banco:** `Arquitetura` no quadro. O desenho técnico da Parte A foi aprovado (`142-DESENHO-H042.md`), prevendo a migração `20261113400000_eligibility_expand_professional_access_guard.sql` que cria `private.professional_access_guard` e altera `private.discover_requests` para receber `p_now` e invocar a guarda internamente. **Condição mandatória para o início do Desenvolvimento de H-055**.
- **H-032 (#45) — Visibilidade de localização:** `QA` no quadro. Padronizou a rota `GET /v1/professional/requests/:id`, a derivação do rótulo público `public_label` e o arredondamento de distância em 0,5 km (decisão 426).
- **H-031 (#44) — Publicação idempotente de pedidos:** `Concluído` no quadro. Fornece a tabela `app.service_request` com status `publicado` e `acceptance_deadline_at`.
- **H-036 (#49) — Perfil profissional, serviços e raio:** `Concluído` no quadro. Fornece `app.professional_area` e `app.professional_service`.
- **H-150 — Remoção do histórico de acesso a fotos:** `Concluído` no quadro. Determinou a eliminação total de `media_access_log` e resumos diários.
- **Consumidores que aguardam H-055 (#68):**
  - **H-056 (#69, Backlog):** Fotos a elegíveis antes de aceitar.
  - **H-058 (#71, Backlog):** Aceitar trabalho (botão "Aceitar trabalho", consumo de vagas e criação de chat).
- **Condição de início de Desenvolvimento de H-055:** **NÃO PODE COMEÇAR AGORA**. O Desenvolvimento de H-055 depende da conclusão de H-042 (#55), que se encontra na etapa de Arquitetura.

---

## 10. Riscos e mitigações

- **R1. Vazamento da distância interna métrica via token de cursor.** O cursor de banco contém a distância arredondada em metros (`out_cursor_key`). Se exposta ao front-end ou em base64 simples, permitiria a um profissional malicioso mapear a posição exata da célula do cliente.
  *Mitigação:* Empacotamento obrigatório com cifra autenticada AES-256-GCM (`DISCOVERY_CURSOR_KEY`) com AAD do profissional (RN-H055-08, CA-H055-15).
- **R2. Desempenho e latência na consulta com grande volume de pedidos.** A descoberta executa cruzamento geoespacial e junção com serviços e tabela de elegibilidade.
  *Mitigação:* Reuso estrito do índice parcial `geocode_point_match_cell_idx` entregue em #35/#36, janela de células de `match_janela`, ordenação keyset sem `OFFSET` e limite rígido de página (máx. 200).
- **R3. Raspagem automatizada (scraping) do catálogo de pedidos.** Profissionais ou scripts que varrem continuamente a API para capturar todas as oportunidades e contatos antes de outros.
  *Mitigação:* Rate limit estrito na rota de descoberta por sessão/IP (CA-H055-19) e resposta uniforme anti-enumeração.
- **R4. Dessincronização entre a guarda de H-042 e a execução de H-055.** Divergência se a guarda for checada na API e a consulta de banco usar lógica diferente.
  *Mitigação:* A guarda de elegibilidade roda internamente na própria função `private.discover_requests` no banco (decisão 567 e 641), garantindo avaliação única e atômica.
- **R5. Mudança de status ou expiração de pedidos durante a navegação.** Um pedido que expira ou atinge 8 aceites entre a página 1 e a página 2 poderia reaparecer ou quebrar a ordem.
  *Mitigação:* Paginação keyset por tupla `(group, key, id)`. Pedidos alterados somem naturalmente na página seguinte sem provocar pulos ou travamentos (RN-H055-09).
- **R6. Ausência ou fraqueza da chave `DISCOVERY_CURSOR_KEY` no ambiente.** Se a chave de cifra não estiver configurada ou tiver menos de 32 caracteres, a rota falharia em tempo de execução.
  *Mitigação:* Verificação estrita na inicialização (`check:env` / composição da API). Ausência da chave bloqueia a montagem da rota e responde 503 fixo `descoberta_indisponivel`, com aviso nominal em pendências de ambiente.
- **R7. Contaminação do banco de desenvolvimento com resíduos de testes sintéticos.** Testes concorrentes inserindo profissionais e pedidos sintéticos sem limpeza.
  *Mitigação:* Todos os testes de banco e integração de H-055 devem rodar em transação desfeita (`rollback`) ou com marcadores sintéticos exclusivos (`h055-`), conferindo contagem limpa no pós-teste.
- **R8. Tentativa de chamada externa a provedores de mapa.** Risco de regressão chamando APIs de geocodificação em tempo real.
  *Mitigação:* Bloqueio total por desenho. A rota consome apenas dados pré-processados existentes em `geocode_point` e `service_request`. Testes em sandbox sem rede externa.

---

## 11. Perguntas ao líder

Lista única numerada de **603 a 622** (conforme orientação oficial, sucedendo o piso de decisões 582 e as decisões de refino de #56). Cada item apresenta alternativas, recomendação do PO e o impacto que destrava.

**603. Caminho exato da rota HTTP de descoberta.**
Qual caminho deve ser adotado na API NestJS/Node para a descoberta de pedidos pelo profissional?
- (a) `GET /v1/professional/discovery/requests` — explícito, alinhado ao prefixo `/v1/professional/` adotado na decisão 424 (#45) e `professional-*-route.ts`.
- (b) `GET /v1/professional/requests` — sucinto, porém colide conceitualmente com a coleção de pedidos onde o profissional já atua/aceitou.
- (c) `GET /v1/discovery/requests` — caminho original citado em `11-ARQ-RISCOS-E-TESTES.md` §2.2, porém fora do padrão com prefixo `/v1/professional/`.
- **Recomendação:** (a). Mantém o prefixo de escopo `/v1/professional/`, distingue claramente os pedidos a descobrir dos pedidos já aceitos e evita colisões de rota. Destrava o desenho de rotas e CA-H055-01.

**604. Formato e algoritmo criptográfico do token opaco de cursor.**
Como o material de cursor keyset `(group, key, requestId)` deve ser cifrado para gerar o token público?
- (a) Cifra autenticada AES-256-GCM com chave derivada via HKDF-SHA-256, nonce aleatório de 12 bytes e AAD contendo a versão e o `professional_id` do requisitante.
- (b) Assinatura HMAC-SHA-256 sobre JSON codificado em base64 simples, mantendo os dados legíveis para quem decodificar a base64.
- **Recomendação:** (a). Conforme determinado expressamente em `97-DESENHO-H023.md` (§4.4) e na decisão 107/108, o cursor deve ser assinado E cifrado para impedir que a distância métrica interna seja lida por terceiros. Destrava o módulo de cursor e CA-H055-15/16.

**605. Nome da variável de ambiente para a chave de cifra do cursor.**
Qual identificador deve constar em `.env.example` para a chave de criptografia do cursor de descoberta?
- (a) `DISCOVERY_CURSOR_KEY` (mínimo de 32 caracteres exigidos pela fábrica).
- (b) `CURSOR_SECRET_KEY`.
- **Recomendação:** (a), padronizado com `ADDRESS_ENC_KEY` e `PHONE_ENC_KEY` já existentes no repositório. Destrava a configuração do ambiente e `check:env`.

**606. Validade temporal (TTL) do token de cursor de descoberta.**
O token de cursor opaco deve expirar após um tempo determinado de emissão?
- (a) Sim, validade máxima de 24 horas embutida no payload cifrado (instante de criação `iat`), expirando tokens muito antigos.
- (b) Não, sem expiração temporal própria; a validade é regulada unicamente pela integridade criptográfica e pelo ciclo de vida do pedido no banco.
- **Recomendação:** (a). Evita que cursores antigos guardados em navegadores ou bots sejam utilizados indefinidamente dias depois, prevenindo anomalias de paginação. Destrava a estrutura do payload cifrado e CA-H055-16.

**607. Resposta HTTP para usuário autenticado que não possui perfil profissional.**
Quando um cliente autenticado (sem registro em `professional_profile`) acessa a rota de descoberta de profissionais, qual deve ser a resposta?
- (a) HTTP `403 Forbidden` com corpo `{ code: "perfil_profissional_obrigatorio" }`.
- (b) HTTP `404 Not Found` com corpo uniforme `{ code: "nao_encontrado" }` (anti-enumeração estrita).
- **Recomendação:** (a). O prefixo `/v1/professional/` é restrito ao papel profissional; o erro 403 orienta a aplicação cliente a redirecionar para o fluxo de cadastro profissional, sem vazar segredos. Destrava CA-H055-02.

**608. Estrutura do envelope de resposta JSON da descoberta.**
Qual deve ser o contrato de chaves retornado em HTTP 200 na listagem de pedidos?
- (a) `{ items: RequestDiscoveryItem[], next_cursor: string | null, has_more: boolean }`.
- (b) `{ requests: RequestDiscoveryItem[], cursor: string | null }`.
- **Recomendação:** (a), consistente com o padrão moderno de paginação keyset em APIs REST e facilitando o consumo em interfaces web e mobile. Destrava o contrato de API e os testes de integração.

**609. Indicador de presença de fotos na listagem de descoberta.**
Como a existência de fotos anexadas ao pedido deve ser sinalizada na descoberta (antecipando H-056)?
- (a) Apenas um indicador booleano `has_photos: boolean`, sem expor URLs, IDs ou contagens de mídia.
- (b) Um número inteiro `photos_count: number` informando quantas fotos o pedido possui.
- (c) Nenhum campo relativo a fotos na descoberta (omitir totalmente até a H-056).
- **Recomendação:** (a). Informa visualmente ao profissional que o pedido contém imagens na galeria (permitindo exibir um ícone de anexo), sem antecipar a lógica de emissão de URLs assinadas e marcas d'água de H-056. Destrava o esquema do item de resposta e CA-H055-03.

**610. Rate limit da rota de descoberta por profissional.**
Qual teto de requisições deve ser adotado na API para limitar a rota de descoberta e evitar raspagem?
- (a) 60 requisições por minuto por profissional autenticado (`rate_counter`), com resposta 429 `{ code: "muitas_requisicoes" }`.
- (b) 120 requisições por minuto.
- (c) Sem rate limit na aplicação, delegando unicamente à infraestrutura da Vercel.
- **Recomendação:** (a). 60 req/min é compatível com uso humano em paginação e protege contra scripts de raspagem em massa. Destrava CA-H055-19 e R3.

**611. Resposta para profissional não elegível (silêncio financeiro e anti-enumeração).**
Confirmar a recomendação de que o profissional não aprovado na verificação ou com acesso comercial expirado/sem acesso receba lista vazia com 200 OK.
- (a) Sim, 200 OK com `{ items: [], next_cursor: null, has_more: false }`.
- (b) Não, responder 403 com código indicando o motivo ("nao_aprovado" ou "acesso_vencido").
- **Recomendação:** (a). Segue estritamente a decisão 569 da Rodada 121 e as diretrizes de privacidade financeira da fábrica (`114` §privacidade), impedindo enumeração. O status deve ser consultado nas rotas próprias de verificação e faturamento. Destrava CA-H055-04 e CA-H055-05.

**612. Ordenação entre pedidos com raio presencial e pedidos online nacional.**
Confirmar a precedência de ordenação dos resultados: presencial primeiro (por proximidade e UUID), seguido por online (por UUID).
- (a) Sim, Grupo 0 (presencial: `distance_m ASC, id ASC`), seguido de Grupo 1 (online: `id ASC`), conforme definido no desenho de H-023 (#36).
- (b) Misturar pedidos presenciais e online por data de publicação (`published_at DESC`).
- **Recomendação:** (a). Prioriza o trabalho de campo próximo à base do profissional, mantendo fidelidade absoluta ao contrato entregue pela consulta de banco em H-023. Destrava CA-H055-17.

**613. Comportamento para profissional elegível sem base geográfica cadastrada.**
Como a descoberta deve se comportar se um profissional estiver aprovado e ativo, mas ainda não tiver cadastrado base presencial em `app.professional_area`?
- (a) Retorna apenas os pedidos dos serviços que ele declarou na modalidade `online` (ramo presencial vazio, sem erro).
- (b) Responde erro 400 exigindo o cadastro de base.
- **Recomendação:** (a). O profissional tem direito a atender serviços online mesmo sem base presencial física configurada, conforme já suportado por `discover_scan` (#36). Destrava o fluxo de consulta flexível.

**614. Tratamento do campo `description` na listagem de pedidos.**
O campo `description` deve ser retornado na íntegra na listagem de descoberta ou sofrer truncamento?
- (a) Texto completo original cadastrado pelo cliente (até 2.000 caracteres, conforme limite do rascunho em H-031).
- (b) Snippet truncado em 200 caracteres com reticências.
- **Recomendação:** (a). O profissional precisa ler a descrição completa do problema para avaliar se tem capacidade técnica e interesse de se deslocar para atender, antes de gastar tempo no detalhe. Destrava a projeção do pedido.

**615. Piso mínimo de distância exibido para pedidos presenciais na mesma célula.**
Para pedidos presenciais cujo centro de célula coincide com o centro de célula da base do profissional, qual distância deve ser exibida?
- (a) `0.5` km (mínimo de 0,5 km, evitando exibir "0 km" ou sugerir precisão milimétrica, conforme decisão 426 e D-07 da #45).
- (b) `0.0` km.
- **Recomendação:** (a). Garante consistência com a decisão 426 já adotada na história #45. Destrava CA-H055-13.

**616. Fronteira exata do encerramento da admissão de aceites (`acceptance_deadline_at`).**
No exato segundo em que `p_now == acceptance_deadline_at`, o pedido ainda é elegível para ser descoberto?
- (a) Não, intervalo aberto à direita: `p_now < acceptance_deadline_at`. No instante exato do prazo, o pedido já é considerado encerrado.
- (b) Sim, intervalo inclusivo: `<=`.
- **Recomendação:** (a). Segue o padrão de prazos de expiração adotado nas histórias H-023 (#36) e H-045 (#58). Destrava CA-H055-11.

**617. Exposição do nível de urgência do pedido.**
O campo `urgency` deve ser retornado com os valores literais do enum do modelo de dados?
- (a) Sim, string literal: `"imediato"`, `"proximas_semanas"`, `"proximo_mes"` ou `"nao_definido"`.
- (b) Tradução para rótulo amigável na API.
- **Recomendação:** (a). A API trafega contratos canônicos; a internacionalização e rótulos visuais pertencem à camada de apresentação/front-end. Destrava o contrato de tipos de domínio.

**618. Tratamento de query parameters desconhecidos ou espúrios.**
Como a rota deve reagir caso a requisição traga parâmetros não suportados (ex.: `?sort=data&filter=urgente`)?
- (a) Rejeição estrita com HTTP `400 Bad Request` `{ code: "parametro_invalido" }`.
- (b) Ignorar silenciosamente os parâmetros desconhecidos e processar com os válidos.
- **Recomendação:** (a). Segue a política estrita adotada nas histórias de API do FastPro (decisão 523 na #47), prevenindo poluição de chamadas e comportamentos não intencionais. Destrava a validação de rota.

**619. Política de cabeçalhos de cache HTTP.**
Todas as respostas da rota de descoberta devem conter cabeçalhos anti-cache obrigatórios?
- (a) Sim, `Cache-Control: no-store` e `Referrer-Policy: no-referrer` compulsórios em todas as respostas (200, 400, 401, 403, 429, 503).
- (b) Permitir cache privado curto (ex.: 15 segundos) no navegador.
- **Recomendação:** (a). Como o status dos pedidos e a vigência das assinaturas mudam em tempo real, respostas de descoberta não podem ser cacheadas em disco ou proxy compartilhado. Destrava CA-H055-21.

**620. Organização de pastas e arquivos de código na API.**
Onde devem ser organizados os novos arquivos de rota e serviço de descoberta na API?
- (a) Em `apps/api/src/requests/discovery-route.ts`, `discovery-service.ts` e `discovery-cursor-crypto.ts`, agrupados no domínio de `requests`.
- (b) Em diretório raiz próprio `apps/api/src/discovery/`.
- **Recomendação:** (a). Mantém o alinhamento com a estrutura já existente para pedidos (`publish-*`, `detail-*`) no módulo de requests. Destrava a organização do código para o Arquiteto.

**621. Fronteira de execução da guarda de elegibilidade (banco vs API).**
A guarda de elegibilidade deve ser chamada dentro da função de banco `private.discover_requests` ou como checagem prévia na API?
- (a) Chamada interna no banco, dentro de `private.discover_requests` (conforme desenhado na Parte A de H-042 / decisão 567 e 641), retornando 0 linhas se inelegível.
- (b) Checagem prévia na camada de serviço da API antes de chamar a consulta ao banco.
- **Recomendação:** (a). Centraliza a segurança no Postgres, garante que a consulta nunca seja executada sem autorização mesmo se chamada por outros adaptadores internos e mantém atomicidade. Destrava o contrato do adaptador de banco.

**622. Condição formal de início de Desenvolvimento de H-055 (#68).**
Confirmar se o Desenvolvimento de H-055 deve aguardar a conclusão formal da Issue #55 (H-042, guarda de elegibilidade).
- (a) Sim, o Desenvolvimento de H-055 só começa após H-042 estar concluída e aprovada em QA, pois consome a migração e as funções de guarda entregues por ela.
- (b) Iniciar o Desenvolvimento de H-055 imediatamente criando stubs temporários da guarda.
- **Recomendação:** (a). Criar stubs geraria dívida técnica e retrabalho de reconciliação de migrações; a ordem de dependências do backlog deve ser respeitada. Destrava o planejamento da fila do quadro.

---

## 12. Próximos passos

1. O líder (Orquestrador) revisa este refino, valida os limites de fronteira com H-056/H-058 e consolida as respostas às perguntas **603 a 622** na próxima rodada oficial de `11-DECISOES.md`.
2. A Issue #68 permanece na coluna "Product Owner" até que o líder execute a transição para "Arquitetura".
3. A Arquitetura desenhará o módulo de rota, o mecanismo de cifra de cursor (`DISCOVERY_CURSOR_KEY`), a projeção SQL e a montagem na API.
4. **O Desenvolvimento de #68 só poderá ser iniciado após a conclusão de H-042 (#55)** no fluxo da fábrica.
