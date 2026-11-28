# Refino H-043 — Perfil público e selo verificado (Issue #56)

- **Issue:** #56 `[E4] Perfil público e selo verificado` · **História:** H-043 · **Épico:** E4 — Verificação e perfis · **Workflow:** WF-03 (Feature) · **Etapa:** Product Owner (primeira coluna do quadro).
- **Repositório:** `D:\projetos\fastpro`, branch `feature/init`. **Data:** 2026-11-14.
- **EXEC-ID:** não atribuído (não informado pelo líder).
- **Natureza:** somente documento (`docs/factory/138-REFINO-H043.md`). Nenhum código, migração, teste, consulta ao banco, chamada externa (Mapbox proibido) ou alteração no quadro. O cartão permanece em Product Owner até o líder decidir a movimentação.
- **Etiquetas:** `[DECIDIDO n]` decisão registrada · `[VERIFICADO]` lido no repositório, no quadro ou em documento · `[PROPOSTA]` deste refino, a validar · `[AMBIGUIDADE]` fonte conflitante ou lacuna · `[NÃO VERIFICADO]` não confirmado nesta rodada · `[PENDENTE JURÍDICO]` depende de parecer (BLQ-JUR L7).

---

## 0. Fontes e limitações

Fontes lidas: `D:\Fabrica\AGENTS.md`, `roles/factory-product-owner.md`, `docs/factory/quadro-status.md` (atualizado em 2026-11-13 12:30 UTC), `21-ISSUES-CRIADAS.md` (H-043 = #56, H-036 = #49, H-039 = #52, H-040 = #53, H-041 = #54, H-042 = #55, H-033 = #46, H-088 = #98), `14-BACKLOG.md` (linhas H-043, H-035, H-036, H-039, H-040, H-041, H-042, H-086 a H-088, E10 e §2 Ondas), `04-PRD.md` (RF-001, RF-005, RF-006, RF-051, RF-120, RF-125 a RF-130, RF-137), `05-CRITERIOS-ACEITE.md` (FA-001, FA-019, FA-030), `08-ARQUITETURA.md` (§4.3, §7 matriz de sensibilidade C0 vs C3, §9.1), `09-MODELO-DADOS.md` (§3.3 `professional_profile`, `professional_service`, `professional_area`, §7 C0 vs C3), `11-DECISOES.md` (Rodadas até 119; decisões 4, 14, 22, 34, 54, 109 a 116, 170, 274, 420, 518, 541, 563 a 582), `113-REFINO-H045.md` (modelo de rigor e estrutura), `123-REFINO-H039.md`, `131-REFINO-H040.md`, `128-REFINO-H033.md`, `136-REFINO-H041.md` e `137-REFINO-H042.md`.

Conferido no repositório (somente existência e leitura de cabeçalho; nada alterado):
- `supabase/migrations/20261111400000_identity_create_professional_account.sql`: tabela `app.professional_profile` básica (`user_id`, `verification_status`, `verified_at`, `suspended_at`).
- `supabase/migrations/20261111420000_identity_professional_profile_document.sql`: campos `public_name` (2 a 80 chars), `slug` (`^[a-z0-9][a-z0-9-]{0,99}$`), `document_type`, `document_enc`, `document_hmac`.
- `supabase/migrations/20261112160000_profile_expand_services_area.sql`: tabelas `app.professional_service` (serviços do profissional por modalidade `presencial` e `online`) e `app.professional_area` (área privada com base e raio; estritamente privada, CA-11 da H-036).
- `supabase/migrations/20261113200000_verification_create_case_queue.sql`: fila de verificação humana e gravação definitiva de `verification_status = 'aprovada'`.
- `apps/api/src/professional-profile-route.ts`: leitura autenticada privada do próprio profissional (`GET /v1/professional/profile`). Não existe rota pública de perfil para visitantes/clientes.
- `packages/contracts/src/catalog.ts`: modelo de allowlist (`CATALOG_PUBLIC_FIELDS`) e denylist (`CATALOG_FORBIDDEN_PUBLIC_FIELDS`), padrão a ser adotado no contrato do perfil público.
- `packages/tokens/` e `apps/web/public/tokens.css`: tokens do Design System EDS.
- `apps/web/public/`: módulos de apresentação existentes (`pedido.html`, `profissional-documentos.html`). Não existe página pública de perfil de profissional.

Limitações `[NÃO VERIFICADO]`:
- O texto da Issue #56 no GitHub não foi lido diretamente (este agente não tem acesso a ferramentas de rede/gh). O objetivo e escopo foram reconstruídos canonicamente da linha de H-043 no backlog, no PRD e nos critérios de aceite. O líder deve conferir o texto da Issue antes da etapa de Arquitetura.
- Nenhum banco de desenvolvimento foi consultado nem alterado. A existência de esquemas e funções baseia-se exclusivamente no histórico de migrações aplicadas.
- O módulo de avaliações (E10, H-086 a H-088) ainda não foi implementado no repositório (está em Backlog). A integração é tratada por contrato e estado padrão.

---

## 1. Verificação de fila e dependências reais

- `[VERIFICADO]` O quadro (`docs/factory/quadro-status.md`) mostra #56 na coluna **Product Owner** (junto de #68, #54, #55 e #51). A ordem de colunas está correta para esta etapa de refino documental.
- `[VERIFICADO]` A numeração de decisões em `11-DECISOES.md` alcançou o piso 582 com o refino `137-REFINO-H042.md`. As perguntas deste refino iniciam estritamente em **583** e vão até **602**.
- `[VERIFICADO]` Concluídas registradas e confirmadas: #43, #44, #50, #52, #57, #58, #59, #36, #119, #141, #150, #151. Em QA: #45, #46, #53.
- `[VERIFICADO]` Dependências declaradas de H-043 no `14-BACKLOG.md`: **H-036 (#49)** e **H-039 (#52)**. Ambas estão **Concluídas** no quadro:
  - **H-036 (#49, Concluído):** tabela `app.professional_service` (serviços declarados e modalidades) e funções de oferta.
  - **H-039 (#52, Concluído):** fila de verificação humana, máquina de estados de verificação e gravação de `verification_status = 'aprovada'`.
- `[VERIFICADO]` Dependências de fundação já entregues e usadas:
  - **H-035 (#48, Concluído):** `public_name` e `slug` único em `app.professional_profile`.
  - **H-016 (#29, Concluído):** conta profissional e status do usuário (`app.app_user.status = 'ativo'`).
- `[VERIFICADO]` Relação com outras histórias:
  - **H-040 (#53, em QA):** retenção por duplicidade. O perfil com `retida_duplicidade` não deve ter perfil público exibido (devolve 404).
  - **H-033 (#46, em QA):** opt-in de telefone no pedido. O telefone NUNCA é revelado antes do aceite e JAMAIS é exibido no perfil público institucional (RF-120, RF-137, FA-030).
  - **H-042 (#55, em Product Owner):** guarda de elegibilidade para descoberta de pedidos e aceite. H-043 não altera a descoberta nem o aceite; trata exclusivamente da visualização do perfil público.
  - **E10 — Avaliações (H-086 a H-088, em Backlog):** as tabelas de avaliações não existem ainda. H-043 define o contrato de exibição e entrega o estado obrigatório `"Ainda sem avaliações"` (RF-005, RF-130).

### 1.1 Resposta à pergunta de início de Desenvolvimento

- **O Desenvolvimento de #56 NÃO pode começar agora.** Motivos:
  1. O fluxo oficial de desenvolvimento da fábrica (WF-03) estabelece que uma Feature aprovada na etapa de Product Owner avança primeiro para a etapa de **Arquitetura** (para desenho técnico de rotas, DTOs, SQL e interfaces de apresentação). Somente após o Desenho e sua aprovação pelo líder o cartão é movido para Desenvolvimento.
  2. As dependências declaradas (H-036 e H-039) estão **Concluídas** no quadro. Portanto, **a Arquitetura de #56 está plenamente liberada para iniciar** assim que o líder acolher este refino.
  3. A pendência de redação legal do selo verificado (`BLQ-JUR L7`) não impede a Arquitetura técnica (pode usar o texto proposto neste refino como padrão comutável via configuração ou constante de contrato).

---

## 2. Objetivo

Disponibilizar a visualização pública do perfil do profissional para qualquer visitante da internet sem exigência de conta ou autenticação (RF-001), apresentando nome público, slug amigável, serviços oferecidos com respectivas modalidades (online / presencial), selo "verificado" exclusivo para conferência documental de identidade (RF-005, RF-006, BLQ-JUR L7), e resumo de reputação (exibindo `"Ainda sem avaliações"` enquanto não houver avaliações válidas da E10, ou média aritmética com 1 casa decimal e lista de avaliações recentes quando existirem, com autor fixo `"Cliente do FastPro"`).

Garantir proteção absoluta de privacidade (T-03, RF-120): telefone, e-mail, número de CPF/CNPJ (cifrado ou em claro) e endereço residencial/base exata jamais são expostos no perfil público ou em qualquer payload de API associado.

Resultado de negócio: visitantes e clientes conseguem consultar a idoneidade cadastral de identidade e os serviços de um profissional antes ou durante o ciclo do pedido, com transparência de que o selo atesta conferência documental humana, e não garantia ou certificação de qualidade dos serviços (RF-006).

---

## 3. Escopo (dentro de H-043)

1. **Contrato público de leitura de perfil:** definição do contrato na camada `packages/contracts` com lista de permissão estrita (`PUBLIC_PROFILE_FIELDS`) e lista de campos expressamente proibidos (`FORBIDDEN_PROFILE_FIELDS`).
2. **Rota pública na API:** rota `GET /v1/public/professionals/:slug` (ou `GET /v1/professionals/:slug`) aberta aos papéis `anon` e `authenticated`, sem necessidade de cookie de sessão, com resposta JSON restrita aos dados permitidos.
3. **Consulta de banco otimizada e segura:** função SQL ou consulta via repositório/adaptador que lê de `app.professional_profile`, `app.professional_service`, `app.service` e `app.service_group`. A leitura só retorna dados se `verification_status = 'aprovada'` e `app_user.status = 'ativo'`. Para qualquer outro estado ou slug inexistente, devolve resposta uniforme de "não encontrado" (404), sem vazar o status confidencial do profissional.
4. **Selo "Verificado" com disclaimer jurídico (BLQ-JUR L7):** entrega do indicador de identidade verificada (`verified: true`) acompanhado de rótulo e texto explicativo claro de que a verificação refere-se unicamente à checagem de documento oficial (CPF/CNPJ), sem constituir seguro, afiança ou garantia técnica de qualidade (RF-006).
5. **Resumo de avaliações em conformidade com RF-130:** formato estruturado devolvendo `rating_average` (null ou decimal), `rating_count` (0), `rating_label` (`"Ainda sem avaliações"`) e array de avaliações recentes (vazio nesta história, pronto para quando a E10 for entregue).
6. **Módulo de apresentação web e acessibilidade:** tela pública do perfil do profissional em `apps/web/public/` (ou módulo de componentes conforme padrão adotado nas histórias #47, #57 e #54) consumindo design tokens EDS (`tokens.css`), responsiva (mobile-first), com suporte a leitor de tela (WCAG 2.2 AA) e estados de carregamento, sucesso e perfil inexistente/indisponível.
7. **Suíte de testes de regressão e segurança:** testes de rota pública, testes de contrato com rejeição de campos confidenciais (T-03), teste de perfil não aprovado retornando 404, e testes de acessibilidade e semântica HTML.

---

## 4. Fora de escopo

- Criação, submissão, antifraude e filtro automático de avaliações pelo cliente (E10, H-086 a H-088).
- Resposta do profissional a avaliações, contestações e denúncias (E10, H-089, H-090).
- Avaliação sem prazo comercial e revisão por cancelamento (E10, H-091).
- Edição do perfil, alteração de nome público, slug ou documento (H-035, #48).
- Declaração, alteração ou exclusão de serviços, base e raio pelo profissional (H-036, #49).
- Visualização do estado interno da verificação pelo próprio profissional (H-041, #54).
- Guarda de elegibilidade para descoberta de pedidos e aceite de trabalho (H-042, #55).
- Liberação e revelação de telefone ou WhatsApp (H-033, #46) — proibido no perfil público.
- Exibição de coordenadas geográficas, mapa interativo pesado, raio de atendimento ou endereço residencial/base exato (CA-11 de H-036). Serviços do Mapbox são proibidos nesta história.
- Checkout, pagamentos ou contratação direta a partir do perfil público (o FastPro apenas conecta através do fluxo de pedidos publicados pelo cliente).
- Backup e restauração de dados (fora do escopo do projeto, decisão #151).

---

## 5. Fluxos e estados

### 5.1 Visibilidade do perfil público por estado cadastral

O perfil público somente pode ser consumido publicamente se o profissional estiver plenamente aprovado e com conta ativa. Se um visitante ou cliente acessar a URL de um profissional cujo perfil não atenda a esses requisitos, o sistema deve responder com HTTP 404 de forma uniforme, sem indicar se o perfil existe em análise, se foi recusado ou se está suspenso.

Matriz de visibilidade pública:

| `verification_status` | `app_user.status` | Resposta da Rota Pública | Exibição na Interface |
|---|---|---|---|
| `pendente` | `ativo` | HTTP 404 `professional_not_found` | Tela neutra "Perfil não encontrado ou indisponível" |
| `em_revisao` | `ativo` | HTTP 404 `professional_not_found` | Tela neutra "Perfil não encontrado ou indisponível" |
| `retida_duplicidade` | `ativo` | HTTP 404 `professional_not_found` | Tela neutra "Perfil não encontrado ou indisponível" |
| `recusada` | `ativo` | HTTP 404 `professional_not_found` | Tela neutra "Perfil não encontrado ou indisponível" |
| `suspensa` | `ativo` | HTTP 404 `professional_not_found` | Tela neutra "Perfil não encontrado ou indisponível" |
| qualquer | `bloqueado` | HTTP 404 `professional_not_found` | Tela neutra "Perfil não encontrado ou indisponível" |
| `aprovada` | `ativo` | **HTTP 200 OK** | **Perfil público completo com selo verificado** |

> [!IMPORTANT]
> **Anti-enumeração e confidencialidade:** nenhum visitante pode descobrir se um documento foi recusado, retido por duplicidade ou suspenso investigando a rota pública. O código HTTP retornado é sempre 404 uniforme para qualquer situação em que o perfil não esteja ativo e aprovado.

### 5.2 Anatomia dos dados do perfil público (Allowlist estrita)

Seguindo o princípio de menor privilégio e a matriz de dados sensíveis da Arquitetura (§7, C0 vs C3):

#### Campos permitidos (C0 — Público):
- `public_name`: Nome profissional cadastrado (2 a 80 caracteres).
- `slug`: Identificador único amigável para a URL (ex: `joao-silva-eletricista`).
- `verified`: Booleano `true` (somente emitido se `verification_status = 'aprovada'`).
- `verification_badge`:
  - `label`: `"Identidade Verificada"`.
  - `disclaimer`: Texto legal informativo da verificação documental (BLQ-JUR L7).
- `services`: Lista dos serviços ativos oferecidos pelo profissional, contendo:
  - `id`: Identificador público do serviço.
  - `name`: Nome do serviço (ex.: "Instalação de Chuveiro Elétrico").
  - `group_name`: Nome da categoria/grupo (ex.: "Eletricista").
  - `modality`: `"presencial"`, `"online"` ou ambas.
- `location_label`: Rótulo generalizado de localidade (ex.: `"São Paulo - SP"`, conforme a generalização segura aprovada na decisão 420; ou nulo se não houver base ou se o serviço for exclusivamente online). Jamais exibe logradouro, número, bairro ou coordenadas.
- `rating`:
  - `average`: Média numérica com 1 casa decimal (null nesta história).
  - `count`: Quantidade de avaliações (0 nesta história).
  - `label`: `"Ainda sem avaliações"` (mandatório pelo RF-005 e RF-130 enquanto `count === 0`).
- `recent_reviews`: Array de avaliações (vazio nesta história; quando povoado pela E10, cada item possui `rating`, `comment`, `published_at` e `author_name` fixo `"Cliente do FastPro"`).

#### Campos terminantemente proibidos na resposta pública (Denylist):
- `user_id` (identificador interno de conta).
- `email` (e-mail do profissional).
- `phone` (telefone/WhatsApp do profissional).
- `document_type`, `document_enc`, `document_hmac` (CPF/CNPJ cifrado ou hash).
- `base_point`, `radius_m`, `geocode_point_id` (coordenadas, raio de atendimento e ponto geoespacial exato — estritamente privados conforme CA-11 da H-036).
- `verification_status`, `suspension_reason`, `suspended_at` (status e anotações internas de auditoria/moderação).
- `commercial_access` (detalhes de faturamento, trial, cartão ou assinatura do profissional).

### 5.3 O Selo "Verificado" e o aviso de responsabilidade (BLQ-JUR L7)

Em estrita obediência ao **RF-006** ("O selo 'verificado' nunca é apresentado como certificação de qualidade, garantia ou seguro") e ao risco **BLQ-JUR L7**:

1. **Elemento visual:** um distintivo com ícone de verificação EDS e o texto claro `"Identidade Verificada"`.
2. **Aviso explícito e acessível (Disclaimer L7):**
   - Ao lado ou abaixo do selo (e acessível via foco, clique ou leitor de tela), exibe-se a seguinte redação proposta:
   > *"Identidade verificada: este profissional apresentou documento oficial (CPF ou CNPJ) validado pela equipe do FastPro. O selo comprova apenas a conferência de identidade e não constitui garantia sobre a qualidade do serviço, certificação técnica, afiança ou seguro."*
3. **Proibições terminológicas:** o selo e seus textos associados jamais utilizam expressões como "Profissional Garantido", "Qualidade Certificada", "Super Profissional", "Verificado pelo FastPro com garantia" ou "Seguro FastPro".

### 5.4 Reputação e avaliações: estado padrão e compatibilidade futura

Conforme **RF-005**, **RF-130** e **FA-019**:
- Como as avaliações são implementadas no Épico E10 (H-086 a H-088), nesta história H-043 o perfil nasce sem nenhuma avaliação registrada.
- O sistema deve renderizar o estado de reputação exibindo:
  - Estrelas neutras / indicador não preenchido.
  - Texto textual claro: `"Ainda sem avaliações"`.
- A API pública retorna o contrato estruturado para que a casca web não precise de alteração quando a E10 for ligada:
  ```json
  {
    "rating": {
      "average": null,
      "count": 0,
      "label": "Ainda sem avaliações"
    },
    "recentReviews": []
  }
  ```

### 5.5 Módulo de apresentação web e acessibilidade

1. **Arquitetura de apresentação:** em consonância com as decisões 518 (Issue #47), 541 (Issue #57) e refino 136 (Issue #54), não há casca web SPA completa no repositório. A entrega de frontend compõe-se de:
   - Uma página pública acessível via navegador em `apps/web/public/profissional-perfil.html` (e scripts complementares `profissional-perfil.js` / CSS estrutural).
   - Um módulo de apresentação desacoplado que renderiza o estado a partir do JSON da rota pública.
2. **Acessibilidade WCAG 2.2 AA:**
   - Uso de tags semânticas estruturadas (`<main>`, `<header>`, `<section>`, `<h1>`, `<h2>`, `<ul>`, `<li>`).
   - Contraste visual estritamente baseado nos tokens de `tokens.css` (relação de contraste ≥ 4.5:1 para texto padrão e ≥ 3:1 para elementos de destaque).
   - Indicador de foco evidente (`:focus-visible`) para todos os elementos interativos.
   - Textos alternativos para ícones e marcação ARIA adequada para o selo verificado e o tooltip explicativo (`aria-describedby` ou `aria-label`).

---

## 6. Regras de negócio e invariantes

| Ref. | Regra | Fonte | Como H-043 atende |
|---|---|---|---|
| RN-H043-01 | **Navegação pública sem conta.** O perfil público de qualquer profissional aprovado é acessível sem login ou autenticação. | RF-001; FA-001 | Rota pública com permissão `anon` e `authenticated`. |
| RN-H043-02 | **Conteúdo obrigatório do perfil.** Nome público, serviços, selo verificado e média/resumo de avaliações. | RF-005; FA-019 | Schema de resposta pública com todos os campos exigidos. |
| RN-H043-03 | **Selo exclusivo de identidade.** O selo atesta apenas a verificação de documento oficial e nunca garantia ou qualidade. | RF-006; BLQ-JUR L7 | Texto explicativo fixo; sem alegações de garantia ou qualidade. |
| RN-H043-04 | **Condição para exibição do selo.** O selo só é exibido para perfil com `verification_status = 'aprovada'`. | RF-005; H-039 | Filtro rígido na montagem do perfil; não aprovado não tem selo. |
| RN-H043-05 | **Perfil público restrito a aprovados.** Perfis em análise, recusados, retidos ou suspensos não são exibidos publicamente. | H-035 (decisão 3); H-040; H-041 | Retorna HTTP 404 neutro para qualquer status diferente de `aprovada`. |
| RN-H043-06 | **Conta bloqueada oculta perfil.** Se `app_user.status = 'bloqueado'`, o perfil público não é retornado. | RF-050; 08 §4.3 | Verificação conjunta de `app_user.status = 'ativo'`. |
| RN-H043-07 | **Proibição absoluta de telefone.** O telefone jamais aparece no perfil público institucional. | RF-120; RF-137; FA-030; H-033 | Campo excluído da resposta SQL e do contrato da rota. |
| RN-H043-08 | **Proibição de dados pessoais confidenciais (PII).** E-mail, CPF/CNPJ (em claro ou cifrado) não entram no payload público. | RF-120; T-03; 08 §7 | Denylist rigorosa; teste automatizado de ausência de PII. |
| RN-H043-09 | **Privacidade da base e raio.** Coordenadas, endereço exato e raio em metros não são expostos publicamente. | 09 §3.3; 08 §4.3; CA-11 H-036 | Apenas cidade/UF generalizada (decisão 420) pode ser exibida. |
| RN-H043-10 | **Formato da reputação sem notas.** Enquanto não existirem notas válidas da E10, o perfil exibe `"Ainda sem avaliações"`. | RF-005; RF-130; FA-019 | Resposta traz `count: 0`, `average: null` e label padrão. |
| RN-H043-11 | **Formato futuro da média.** Quando existirem notas válidas, a média aritmética é formatada com exatamente 1 casa decimal. | RF-130; FA-019 | Contrato numérico com formatação fixa (ex: `4.8`). |
| RN-H043-12 | **Anonimato do avaliador.** Toda avaliação futura exibida no perfil identifica o autor fixo como `"Cliente do FastPro"`. | RF-129; FA-019 | Contrato do item de avaliação impede nome ou e-mail de cliente. |
| RN-H043-13 | **Ordenação das avaliações.** Quando existirem avaliações, são exibidas das mais recentes para as mais antigas. | RF-005; 09 §5 | Ordenação `published_at DESC` no contrato de dados. |
| RN-H043-14 | **Identificação por slug amigável.** O perfil público é resolvido primariamente pelo `slug` único registrado em H-035. | RF-001; 09 §3.3 | Rota baseada em `:slug` indexado por índice único. |
| RN-H043-15 | **Ausência de serviços externos pesados.** Mapbox é proibido; nenhuma chamada externa é feita para renderizar o perfil. | Restrição de projeto | Perfil leve, autossuficiente e sem dependências externas pagas. |

---

## 7. Critérios de aceite (testáveis)

- **CA-H043-01 (Acesso anônimo à rota pública).** Dado um visitante sem cookie de sessão ou autenticação, quando faz uma requisição `GET /v1/public/professionals/:slug` para um profissional aprovado, então a API responde com status HTTP 200 OK e os dados públicos do perfil. Prova: teste de rota com cliente anônimo.
- **CA-H043-02 (Conteúdo da resposta pública).** Dado um profissional aprovado com serviços cadastrados, quando seu perfil público é consultado, então o payload JSON contém exatamente os campos permitidos: `publicName`, `slug`, `verified` (true), `verificationBadge` (com label e disclaimer L7), lista de `services` (com nome do serviço, categoria e modalidade), e objeto `rating` com `label: "Ainda sem avaliações"`. Prova: validação de schema e valores esperados.
- **CA-H043-03 (Ausência estrita de dados confidenciais — T-03).** Dado o payload retornado pela rota pública de perfil, quando inspecionado contra a denylist de segurança, então nenhum dos seguintes campos ou fragmentos de dados está presente: `user_id`, `email`, `phone`, `document_type`, `document_enc`, `document_hmac`, `base_point`, `geocode_point_id`, `radius_m`, `verification_status` interno ou dados de cobrança/cartão. Prova: asserção automatizada de exclusão estrita no JSON de resposta.
- **CA-H043-04 (Ausência de telefone — RF-137 / H-033).** Dado um profissional cujo telefone foi informado no cadastro ou perfil, quando qualquer visitante acessa o perfil público, então o telefone NÃO é retornado na API nem renderizado na tela. O telefone permanece confidencial e exclusivo para revelação condicional após aceite de pedido. Prova: teste estático de busca de telefone no body e no HTML.
- **CA-H043-05 (Selo 'verificado' e disclaimer jurídico L7).** Dado o perfil público exibido, quando o usuário inspeciona o selo "verificado", então visualiza o distintivo de identidade verificada e o texto explicativo contendo a mensagem de que o selo atesta conferência de documento de identificação oficial e não constitui garantia de qualidade, certificação técnica ou seguro. Nenhuma menção a "qualidade garantida" ou "seguro" afirmativo existe. Prova: teste de texto e snapshot do componente do selo.
- **CA-H043-06 (Perfil não aprovado retorna 404 neutro).** Dado um profissional com `verification_status` em `pendente`, `em_revisao`, `retida_duplicidade`, `recusada` ou `suspensa`, quando sua URL pública é acessada, então a API responde com HTTP 404 e código de erro `"professional_not_found"`. Nenhum indício do status real ou da existência do cadastro é revelado. Prova: cinco requisições de teste para cada um dos status não aprovados comprovando resposta 404 idêntica.
- **CA-H043-07 (Conta de usuário bloqueada retorna 404).** Dado um profissional com verificação aprovada, mas cuja conta foi bloqueada na moderação (`app_user.status = 'bloqueado'`), quando sua URL pública é acessada, então a API responde com HTTP 404 `"professional_not_found"`. Prova: teste com usuário bloqueado recebendo 404.
- **CA-H043-08 (Slug inexistente).** Dado um slug aleatório que não existe no banco de dados, quando a rota pública é consultada, então a API responde com HTTP 404 `"professional_not_found"`. Prova: consulta de slug sintético inexistente.
- **CA-H043-09 (Estado padrão de avaliações — RF-130).** Dado que o profissional ainda não possui avaliações publicadas (cenário padrão do MVP nesta fase), quando o perfil é renderizado, então a seção de avaliações apresenta o texto `"Ainda sem avaliações"`, `rating.count` é 0 e `rating.average` é null. Prova: asserção de schema e teste de renderização da mensagem neutra.
- **CA-H043-10 (Contrato compatível com avaliações futuras — E10).** Dado um payload contendo avaliações sintéticas simulando a integração futura com a E10, quando processado pelo componente de apresentação, então a média aritmética é exibida com exatamente 1 casa decimal (ex: `4.5`), e cada avaliação é renderizada com autor fixo `"Cliente do FastPro"`, sem e-mail ou nome pessoal do cliente. Prova: teste de unidade do componente com fixture de avaliações.
- **CA-H043-11 (Lista de serviços por modalidade).** Dado um profissional com serviços presenciais e serviços online cadastrados em `app.professional_service`, quando o perfil público é montado, então todos os serviços ativos são listados com indicação clara da sua modalidade (`Presencial` ou `Online`). Prova: teste com múltiplos serviços comprovando exibição correta.
- **CA-H043-12 (Localidade pública generalizada — decisão 420).** Dado um profissional com área presencial configurada, quando a localidade pública é exibida no perfil, então apenas a informação de `"Cidade - UF"` generalizada é visível. Rua, número, bairro e raio de atendimento em metros jamais aparecem. Prova: teste de conformidade de localização pública.
- **CA-H043-13 (Acessibilidade WCAG 2.2 AA).** Dado o módulo de apresentação web do perfil público, quando avaliado contra os critérios de acessibilidade, então atende a contraste mínimo de 4.5:1 para textos normais, possui hierarquia de cabeçalhos semântica (`<h1>` para nome do profissional, `<h2>` para seções), textos alternativos adequados para ícones, rótulo acessível para o selo e navegação por teclado funcional. Prova: verificação estática de acessibilidade e ausência de violações WCAG.
- **CA-H043-14 (Tokens EDS).** Dado o CSS do módulo de apresentação do perfil, quando analisado, então todas as cores, espaçamentos, tipografia e raios de borda provêm exclusivamente de variáveis CSS de `tokens.css`. Nenhuma cor em código hexadecimal ou RGB está hardcoded no arquivo CSS/HTML. Prova: varredura `check:all` sem violações de tokens.
- **CA-H043-15 (Responsividade mobile-first).** Dado o módulo de apresentação, quando renderizado em viewport móvel de 320 px de largura e em viewport desktop de 1280 px, então o conteúdo adapta-se fluidamente sem quebras de layout, sem sobreposição de textos e sem barra de rolagem horizontal indesejada. Prova: teste visual responsivo.
- **CA-H043-16 (Desempenho e cache da rota pública).** Dado que o perfil público recebe consultas anônimas frequentes de visitantes, quando a rota pública responde com sucesso (200), então os cabeçalhos HTTP incluem diretivas de cache controladas (conforme decisão 593), e a consulta de banco utiliza índices existentes em `slug`, executando em tempo compatível sem varredura sequencial de tabela (`Seq Scan`). Prova: verificação dos cabeçalhos HTTP e plano de execução da query.
- **CA-H043-17 (Sem chamadas externas).** Dado o carregamento e renderização do perfil público, quando monitorada a atividade de rede, então nenhuma requisição a provedores externos (como Mapbox, CDNs externas de fontes ou APIs de terceiros) é executada. Prova: asserção de chamadas restritas ao domínio próprio da aplicação.
- **CA-H043-18 (Execução em ambiente local de testes).** Todos os testes de unidade, domínio e rotas de H-043 executam localmente em desenvolvimento sem dependência de contas pagas, chaves externas ou conexão de internet. Prova: execução da suíte de testes com código de saída 0.

---

## 8. Matriz de privacidade e segurança (T-03, T-04, C0 vs C3)

Comparativo rigoroso entre o que é público no perfil (C0) versus o que é privado do dono e interno do sistema:

| Informação / Campo | Perfil Público (C0) | Próprio Profissional (Dono) | Admin / Suporte | Fundamentação de Segurança |
|---|---|---|---|---|
| Nome público (`public_name`) | **Visível** | Visível / Editável (H-035) | Visível | Nome profissional intencionalmente público (RF-005). |
| Slug na URL (`slug`) | **Visível** | Visível (H-035) | Visível | Identificador público na web (09 §3.3). |
| Selo verificado | **Visível** (se aprovado) | Visível com status detalhado (H-041) | Visível na fila (#52) | Atestado de identidade checada (RF-005, RF-006). |
| Serviços e modalidades | **Visível** | Visível / Gerenciável (H-036) | Visível | Oferta comercial disponível ao público (RF-005). |
| Localidade (Cidade - UF) | **Generalizada** | Endereço completo / Raio | Visível via caso | Decisão 420; endereço exato é confidencial (08 §4.3). |
| Raio em metros e ponto geo | **PROIBIDO** | Visível (H-036) | Não visível | Segredo estratégico e privacidade residencial (CA-11 H-036). |
| Telefone / WhatsApp | **PROIBIDO** | Visível no perfil | Revelação por opt-in | **RF-137 / H-033:** nunca antes do aceite; nunca no perfil. |
| E-mail | **PROIBIDO** | Visível na conta | Visível via auditoria | Prevenção contra spam e engenharia social (RF-120). |
| Documento (CPF / CNPJ) | **PROIBIDO** | Visível apenas tipo | Documento cifrado na fila (#52) | Dado sensível C3 protegido por cifra AES-256-GCM. |
| Motivo de análise / fila | **PROIBIDO** | Visível na área restrita (H-041) | Fila de verificação (#52) | Informação administrativa restrita. |
| Status de acesso comercial | **PROIBIDO** | Painel financeiro restrito | Financeiro | Situação de assinatura/pagamento é sigilosa. |

---

## 9. Dependências e impactos

### 9.1 Matriz de histórias relacionadas

| Issue | História | Estado no Quadro | Relação com H-043 | Situação verificada |
|---|---|---|---|---|
| #48 | H-035 Cadastro e slug | Concluído | Fornece `public_name`, `slug` único e base documental. | `[VERIFICADO]` Migração `20261111420000`. Cumprida. |
| #49 | H-036 Serviços e área | Concluído | Fornece `app.professional_service` (serviços ativos e modalidade). | `[VERIFICADO]` Migração `20261112160000`. Cumprida. |
| #52 | H-039 Fila de verificação | Concluído | Fornece aprovação humana e `verification_status = 'aprovada'`. | `[VERIFICADO]` Migração `20261113200000`. Cumprida. |
| #53 | H-040 Retenção duplicidade | QA | Garante que `retida_duplicidade` não seja exibido publicamente. | `[VERIFICADO]` Regra de 404 em H-043 cobre o caso. |
| #54 | H-041 Estado da verificação | Product Owner | Trata da visão interna do status pelo profissional. | `[VERIFICADO]` H-043 cuida da visão externa pública. Sem conflito de rotas. |
| #55 | H-042 Guarda de elegibilidade | Product Owner | Trata da elegibilidade para descobrir e aceitar pedidos. | `[VERIFICADO]` H-043 não interfere em descoberta nem em aceite. |
| #46 | H-033 Opt-in de telefone | QA | Define que telefone nunca é público e só revela após aceite. | `[VERIFICADO]` H-043 não inclui campo de telefone em nenhum schema. |
| #58 | H-045 Acesso comercial | Concluído | Define o acesso comercial derivado. | `[VERIFICADO]` Perfil público não expõe nem depende do pagamento para existir institucionalmente (ver pergunta 585). |
| #96 a #98 | H-086 a H-088 Avaliações | Backlog | Fornecerão as notas reais na E10 (Onda 5). | `[VERIFICADO]` H-043 entrega estado padrão `"Ainda sem avaliações"`. |

### 9.2 Consumidores de H-043
- Visitantes do marketplace navegando perfis a partir de categorias (RF-001).
- Clientes que receberam proposta/aceite em um pedido e desejam verificar a identidade e reputação do profissional antes de selecioná-lo (RF-005).

---

## 10. Riscos e mitigações

- **R1. Risco de responsabilidade civil sobre o selo verificado (BLQ-JUR L7).** O consumidor pode presumir que "verificado" significa que o FastPro afiança ou assegura o trabalho realizado.
  - *Mitigação:* redação obrigatória, visível e inequívoca do disclaimer jurídico L7 junto ao selo (RF-006), desvinculando explicitamente conferência documental de garantia de execução (pergunta 586).
- **R2. Raspagem de dados e enumeração de prestadores.** Varredura automatizada de perfis por terceiros para capturar base de profissionais.
  - *Mitigação:* limitação de taxa (rate limiting) na rota pública por IP (pergunta 596), ausência total de dados de contato direto (sem e-mail e sem telefone) e exclusão de identificadores internos.
- **R3. Vazamento de status de reprovação ou retenção de documentos.** Descobrir se um concorrente foi rejeitado ou retido por duplicidade.
  - *Mitigação:* política de resposta 404 estritamente uniforme para perfis inexistentes, pendentes, retidos, suspensos ou recusados (pergunta 584).
- **R4. Vazamento de endereço residencial do profissional.** O profissional que atende presencialmente cadastra a própria casa como ponto de partida da base.
  - *Mitigação:* CA-11 da história H-036 é estritamente mantido. A rota pública jamais consulta nem expõe `professional_area.geocode_point_id`, `base_label` ou `radius_m`. Apenas a Cidade-UF pode ser exibida se configurada.
- **R5. Acoplamento prematuro com tabelas de avaliação não existentes (E10).** Tentar criar a tabela `review` antes do Épico E10.
  - *Mitigação:* o perfil consome dados de avaliação via contrato abstrato de leitura. Na ausência da tabela, responde o estado canônico fixo `"Ainda sem avaliações"`, sem migrações prematuras de review.
- **R6. Quebra de identidade visual e acessibilidade.** Telas desalinhadas do Design System EDS.
  - *Mitigação:* uso mandatório dos tokens CSS compartilhados de `packages/tokens` e varredura estática de conformidade (`check:all`).
- **R7. Exposição indevida de dados do cliente em avaliações futuras.**
  - *Mitigação:* imposição da regra de autor fixo `"Cliente do FastPro"` (RF-129) no modelo de contrato do item de avaliação pública.
- **R8. Sobrecarga de chamadas em perfis populares.**
  - *Mitigação:* rota pública rápida, sem joins desnecessários, com suporte a cabeçalho de cache HTTP `Cache-Control` (pergunta 593).

---

## 11. Ambiguidades

- **A1. Formato da rota pública e URL canônica.** No PRD (RF-001) fala-se em "perfis públicos de profissionais". O caminho deve ser `/v1/public/professionals/:slug`, `/v1/professionals/:slug` ou `/v1/pro/public/:slug`? (Ver pergunta 583).
- **A2. Comportamento para profissional aprovado cujo acesso comercial está expirado.** O perfil público institucional permanece acessível para visitantes ou é ocultado até que ele renove o acesso comercial? (Ver pergunta 585).
- **A3. Exibição da Cidade-UF no perfil.** A tabela `professional_profile` tem o documento e o slug, enquanto `professional_area` tem a base (privada). De onde a cidade/UF pública é derivada se o profissional tiver apenas serviço online? (Ver pergunta 588).
- **A4. Exibição de distinção Pessoa Física vs Pessoa Jurídica.** O perfil público deve indicar se o profissional atua como autônomo (CPF) ou empresa (CNPJ), sem expor o número? (Ver pergunta 589).
- **A5. Atividade regulamentada sem certificação (#51 pendente).** Se um profissional declarou serviço de atividade regulamentada (RF-051), mas a Issue #51 ainda está em refino, o serviço aparece no perfil público? (Ver pergunta 592).
- **A6. Botão de ação (Call to Action) no perfil.** O perfil público deve ter um botão "Solicitar orçamento / Pedir serviço" que encaminha o cliente para o fluxo de pedido de serviço do catálogo? (Ver pergunta 595).

---

## 12. Perguntas ao líder

Lista única, numerada de **583 a 602**. Sem envio ao usuário. Cada item traz a recomendação do PO e a decisão que destrava.

**583. Rota pública da API para o perfil do profissional.** Qual padrão de caminho adotar para a rota pública de leitura de perfil?
- (a) `GET /v1/public/professionals/:slug` (recomendado: explicita que é recurso público aberto para qualquer visitante e isola das rotas privadas autenticadas de `/v1/professional/*`).
- (b) `GET /v1/professionals/:slug` (caminho direto no padrão REST).
- **Recomendação:** (a). O prefixo `/public/` evita conflitos de roteamento e facilita regras de bypass de autenticação no gateway/NestJS. Destrava o contrato da rota e a Arquitetura.

**584. Código de resposta HTTP para perfil não aprovado ou inexistente.** Quando o slug não existe ou pertence a perfil não aprovado (`pendente`, `recusada`, `retida_duplicidade`, `suspensa`):
- (a) HTTP 404 `professional_not_found` uniforme para todos esses casos (recomendado: impede qualquer enumeração ou inferência sobre o estado cadastral de terceiros).
- (b) Códigos distintos: 404 para inexistente, 403 para não aprovado e 423 para suspenso.
- **Recomendação:** (a). Regra de ouro de segurança e privacidade: nunca revelar a terceiros que um documento foi recusado ou retido. Destrava CA-H043-06, CA-H043-07 e R3.

**585. Visibilidade do perfil público quando o acesso comercial está expirado.** Um profissional com identidade aprovada, mas com plano/trial expirado (`expirada` ou `trial_expirado`), tem seu perfil público visível na web?
- (a) Sim, permanece visível para visitantes e clientes com o selo verificado, pois identidade e histórico são válidos (RF-062 e FA-025); apenas a descoberta e aceite de *novos pedidos* ficam bloqueados na H-042 (recomendado).
- (b) Não, o perfil público é desativado (retorna 404) enquanto não houver acesso comercial ativo.
- **Recomendação:** (a). O perfil institucional e o selo atestam a identidade documental da pessoa; o acesso comercial governa o marketplace ativo de pedidos. Destrava RN-H043-05 e A2.

**586. Texto jurídico oficial do selo verificado (BLQ-JUR L7 / RF-006).** Adotar a proposta de texto do disclaimer de responsabilidade:
*"Identidade verificada: este profissional apresentou documento oficial (CPF ou CNPJ) validado pela equipe do FastPro. O selo atesta apenas a conferência de identificação cadastral e não constitui garantia de qualidade, certificação técnica, recomendação ou cobertura securitária sobre os serviços prestados."*?
- (a) Sim, adotar o texto acima como padrão oficial do MVP (recomendado).
- (b) Utilizar redação reduzida: *"Identidade verificada via documento oficial. Não constitui garantia de serviço."*
- **Recomendação:** (a). Atende perfeitamente ao RF-006 e neutraliza o risco jurídico de responsabilidade solidária por suposta afiança de qualidade. Destrava CA-H043-05 e o risco L7.

**587. Elemento de apresentação do selo verificado.** Como o selo e seu disclaimer devem ser apresentados na interface web?
- (a) Distintivo/badge com ícone de escudo/verificação, texto visual `"Identidade Verificada"`, e botão/link informativo que abre modal ou tooltip acessível com o disclaimer L7 completo (recomendado).
- (b) Apenas o texto estático do disclaimer impresso abaixo do nome do profissional.
- **Recomendação:** (a). Layout moderno, limpo, alinhado ao Design System EDS e 100% acessível via leitor de tela e teclado. Destrava a especificação de UI e acessibilidade.

**588. Exibição de localidade pública no perfil.** O perfil público deve exibir a localidade de atendimento do profissional?
- (a) Sim, apenas a `"Cidade - UF"` generalizada derivada da base aprovada na decisão 420 (ex: `"Campinas - SP"`), sem logradouro, sem bairro e sem raio (recomendado).
- (b) Não exibir nenhuma indicação geográfica no perfil público (apenas os serviços e suas modalidades).
- **Recomendação:** (a). Para serviços presenciais, o cliente precisa saber em qual cidade/região o profissional atua, mantendo sigilo total sobre o endereço de residência/base. Destrava CA-H043-12 e A3.

**589. Exibição de tipo de documento (Pessoa Física vs Pessoa Jurídica).** O perfil público deve exibir a natureza do cadastro documental?
- (a) Exibir apenas um rótulo genérico discreto: `"Profissional Autônomo"` para CPF ou `"Pessoa Jurídica / Empresa"` para CNPJ, sem jamais exibir o número do documento (recomendado).
- (b) Ocultar completamente qualquer indicação de CPF ou CNPJ.
- **Recomendação:** (a). Ajuda na clareza para o cliente (saber se contrata autônomo ou PJ) sem violar a privacidade nem expor dígitos do documento. Destrava o schema de apresentação.

**590. Contrato de dados de avaliação antes da implementação da E10.** Confirmar que o perfil público responde a estrutura de reputação contendo `count: 0`, `average: null` e `label: "Ainda sem avaliações"`?
- (a) Sim, contrato estruturado pronto para a futura ligação com a E10, sem criar tabelas de avaliações nesta história (recomendado).
- (b) Retornar o campo de avaliações como omitido/indefinido até a E10 ser criada.
- **Recomendação:** (a). Cumpre o RF-005 e o RF-130 literalmente sem gerar acoplamento de banco prematuro. Destrava CA-H043-09 e CA-H043-10.

**591. Apresentação da lista de serviços prestados.** Como os serviços do profissional devem ser agrupados na página do perfil?
- (a) Agrupados por Categoria/Grupo de Serviço (ex.: "Eletricista", "Pintor"), listando os serviços de cada grupo com badges de modalidade (`Presencial`, `Online`) (recomendado).
- (b) Lista plana alfabética única de serviços.
- **Recomendação:** (a). Facilita a leitura e compreensão pelo visitante, aproveitando a estrutura de `service_group` já existente no catálogo. Destrava CA-H043-11.

**592. Tratamento de serviço com atividade regulamentada sem certificação (#51 pendente).** Se um profissional declarou um serviço marcado como `regulated = true` no catálogo, mas a história de certificações (#51) ainda está em refino:
- (a) Exibir o serviço normalmente no perfil com a indicação de sua modalidade, sem selo de certificação técnica adicional (recomendado).
- (b) Ocultar temporariamente serviços regulamentados do perfil público até que a #51 seja concluída.
- **Recomendação:** (a). A aprovação de identidade foi concedida em H-039; o perfil apenas reflete os serviços declarados em H-036. Quando a #51 for implementada, os badges de certificação serão agregados. Destrava RN-H043-02 e A5.

**593. Política de cache HTTP na rota pública (`Cache-Control`).** Qual política de cache adotar para `GET /v1/public/professionals/:slug`?
- (a) `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600` (recomendado: reduz carga no banco para tráfego anônimo repetido e atualiza em até 1 minuto).
- (b) `Cache-Control: no-store` (sempre consulta ao vivo).
- **Recomendação:** (a). Perfis públicos têm taxa de alteração muito baixa; cache curto protege o banco gratuito do Supabase contra picos de tráfego de visitantes. Destrava CA-H043-16.

**594. Proteção contra exposição de telefone e contato pessoal.** Confirmar que telefone, WhatsApp e e-mail jamais entram no schema do perfil público, sob qualquer hipótese?
- (a) Confirmado. O telefone só é revelado entre cliente e profissional após o aceite formal de um pedido específico com consentimento explícito (H-033 / RF-137 / FA-030). No perfil público, contato direto é proibido (recomendado).
- (b) Permitir exibir telefone se o profissional optar.
- **Recomendação:** (a). Invariante de privacidade e do modelo de negócios do FastPro (evitar desintermediação descontrolada antes da conexão e proteger dados pessoais). Destrava CA-H043-04 e RN-H043-07.

**595. Ação do cliente no perfil público (Call to Action — CTA).** Qual ação o visitante/cliente pode realizar ao visualizar o perfil público?
- (a) Botão `"Solicitar este serviço"` ao lado de cada serviço (ou botão principal `"Contratar serviço"`), que redireciona para o fluxo de abertura de pedido com o serviço pré-selecionado (recomendado).
- (b) Página puramente informativa e estática, sem botão de ação.
- **Recomendação:** (a). Fecha o ciclo de valor para o visitante: ao gostar do profissional, ele publica um pedido na categoria/serviço correspondente, alimentando a descoberta e aceite do marketplace. Destrava a especificação de UI e fluxo de conversão.

**596. Limitação de requisições na rota pública (Rate Limiting).** Aplicar limite de taxa para prevenir raspagem (scraping)?
- (a) Sim, rate limit por IP de 60 requisições por minuto na rota pública de perfil (recomendado).
- (b) Sem rate limit nesta história.
- **Recomendação:** (a). Medida de segurança necessária para cumprir o princípio de proteção contra scraping em rotas C0. Destrava R2 e requisitos não funcionais.

**597. Formato da entrega de frontend.** Confirmar a estratégia de entrega de interface:
- (a) Arquivo web estático `apps/web/public/profissional-perfil.html` acompanhado de script em JavaScript vanilla semântico e CSS consumindo `tokens.css`, no mesmo padrão aprovado nas histórias #47, #57 e #54 (recomendado).
- (b) Módulo isolado de componente em `packages/ui` sem página HTML no servidor web.
- **Recomendação:** (a). Permite visualização imediata no navegador e execução de testes de ponta a ponta e de acessibilidade na suíte web. Destrava CA-H043-13 e §5.5.

**598. Permissões de banco para a leitura do perfil público.** Como a função SQL de leitura deve ser configurada?
- (a) Função `private.professional_public_profile(p_slug text)` com concessão de `EXECUTE` exclusiva para `app_system` e `app_api`. Nenhum `SELECT` direto em tabelas para papéis públicos (recomendado).
- (b) View pública no schema `public` com grants para papel `anon`.
- **Recomendação:** (a). Mantém a rigorosa postura de segurança do repositório FastPro (tabelas blindadas com RLS fechada; toda leitura pública passa pelo gateway autenticado da API NestJS). Destrava a Arquitetura de banco.

**599. Indexação por mecanismos de busca (SEO) no ambiente de desenvolvimento.** Qual diretiva de robôs de busca configurar no HTML da página do perfil?
- (a) `<meta name="robots" content="noindex, nofollow">` no ambiente de desenvolvimento/teste, com documentação para comutação para `index, follow` no lançamento de produção (M4) (recomendado).
- (b) `index, follow` imediato.
- **Recomendação:** (a). Impede que dados sintéticos ou ambientes de teste sejam indexados publicamente pelo Google antes do lançamento oficial. Destrava boas práticas operacionais.

**600. Tratamento para profissional aprovado com zero serviços cadastrados.** Se um profissional foi aprovado pela verificação humana (H-039), mas ainda não salvou nenhum serviço em H-036:
- (a) Exibir o perfil público com o nome, selo verificado e uma mensagem informativa amigável: `"Este profissional ainda não cadastrou serviços para exibição"` (recomendado).
- (b) Retornar 404 até que ao menos 1 serviço esteja ativo.
- **Recomendação:** (a). Evita erro falso de 404 para um profissional legítimo aprovado e incentiva a conclusão da configuração. Destrava estado vazio de serviços.

**601. Resolução do perfil por UUID vs Slug.** A rota pública aceita apenas o `slug` ou também deve aceitar o `user_id` (UUID) na URL?
- (a) Aceitar exclusivamente o `slug` (`/public/professionals/:slug`). UUIDs internos nunca devem ser expostos em URLs públicas ou compartilháveis (recomendado).
- (b) Aceitar tanto slug quanto UUID.
- **Recomendação:** (a). URLs com slug são amigáveis, legíveis, facilitam SEO e não expõem identificadores internos do banco. Destrava RN-H043-14 e schema de validação.

**602. Posição do cartão e movimentação após aprovação do refino.** Confirmar a movimentação da Issue #56 para **Arquitetura** assim que este refino for acolhido pelo líder?
- (a) Sim, mover #56 para a coluna Arquitetura, pois as dependências declaradas (#49 e #52) estão concluídas (recomendado).
- (b) Manter em Product Owner aguardando outras histórias da Onda 2.
- **Recomendação:** (a). Desbloqueia o fluxo de valor de visualização de perfil no MVP web, permitindo que a Arquitetura desenhe os contratos e DTOs. Destrava o fluxo WF-03.

---

## 13. Próximos passos

1. O líder confere o texto original da Issue #56 no GitHub e consolida as respostas às perguntas **583 a 602** (lista única numerada, sem envio direto ao usuário).
2. Registrar as decisões tomadas em `docs/factory/11-DECISOES.md` preservando a mesma numeração (583 a 602).
3. Atualizar este documento de refino (`docs/factory/138-REFINO-H043.md`) caso alguma recomendação do Product Owner seja alterada pelo líder.
4. Mover a Issue #56 para a coluna **Arquitetura** no quadro da fábrica (`docs/factory/quadro-status.md`), respeitando a regra de sincronização. Não mover por inferência antes da confirmação da coluna.
5. O Arquiteto desenha o contrato público na camada `@fastpro/contracts`, a rota da API NestJS, a função de consulta segura no Postgres e o módulo de apresentação web. O Desenvolvimento só inicia após o Desenho ser aprovado.
