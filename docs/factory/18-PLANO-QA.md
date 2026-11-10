# FastPro — Plano de QA (estratégia, matriz de casos e critérios de saída)

- **Etapa:** QA (planejamento, sem execução) · **Data:** 2026-11-10 · **Papel:** QA (`roles/factory-qa.md`) · **Status:** rascunho [PROPOSTA] para validação do Orquestrador
- **Natureza:** SOMENTE documento. **Nenhum teste foi executado**, nenhuma ferramenta foi instalada, nenhuma conta, chave, repositório, Issue, PR, branch ou código foi criado ou alterado. Nada aqui é evidência de funcionamento. **EXEC-ID:** não atribuído (não há execução nesta fase).
- **Fontes (revisões mais recentes):** `05-CRITERIOS-ACEITE` (Rev. 6), `11-ARQ-RISCOS-E-TESTES` (Rev. 6), `14-BACKLOG` (ondas, marcos, H-xxx), `15-RASTREABILIDADE`, `17-CHECKLIST-REVISAO` (§2 B-xx, §5 evidências, §7 verificações), `11-DECISOES` (decisões 1 a 40), `12-TODO`, `13-VERIFICACAO-SERVICOS`.
- **Etiquetas:** `[APROVADO]` decisão do usuário · `[DELEGADO]` · `[PROPOSTA]` sugestão deste plano (revogável) · `[PENDENTE JURÍDICO]` · `[NÃO VERIFICADO]`.
- **Escopo:** web (ondas 0 a 5 e gate M4). Mobile (Onda 6, M5) fica fora deste plano (lacuna N8).
- **Dados:** exclusivamente sintéticos (RF-163; B-43). Nenhum dado real em fixture, seed, log, captura ou relatório.

---

## 0. Resumo

- A matriz da §5 cobre os 35 FA com sete categorias de caso: Positivo (P), Negativo (N), Limite (L), Rede/falha (R), Concorrência (C), Autorização (A) e Acessibilidade (Y). IDs no formato `QA-FAnn-X`.
- Pirâmide: a maior parte é unitária e de domínio; concorrência e RLS rodam em Postgres real (nunca mock); E2E só nas jornadas de M1 a M3; provedores externos (Mapbox, Mercado Pago, Resend) são sempre simulados em dev e CI.
- Ambientes sem custo e sem conta: Supabase CLI com Docker local, Mailpit e simuladores. Sandbox do Mercado Pago, projetos na Vercel e no Supabase e Mapbox real exigem autorização de execução (BLQ-EXEC, BK-6).
- Marcos: M1 exige C-01 a C-03, C-16, M-01 e M-02 verdes com N≥100 nos cenários de concorrência. M3 exige a suíte completa. M4 é decisão humana; o QA não emite CONCLUIR nem BLOQUEAR.
- Lacunas e inconsistências documentais: §11. Três pontos bloqueiam apenas a execução de casos específicos; o restante são recomendações.

## 1. Princípios

1. Autorização testada por chamada direta de API e acesso direto ao banco com papéis, não só pela UI (11 §8; 17 §3).
2. Toda suíte de concorrência roda com N≥100 iterações, requisições realmente simultâneas e, ao fim de cada cenário, os monitores I-xx (11 §7; 17 §5).
3. Nenhum teste chama rede externa em dev e CI: bloqueio de egress na suíte (17 §7.7; B-49, B-50, B-51).
4. Prazos (15 min, 24 h, 7 dias, 72 h) usam relógio do banco controlado, nunca relógio do processo (B-30; R-23).
5. Caso sem evidência registrada é pendência, não aprovação (17 §1.2 e §5; AGENTS, item 8).
6. O QA não reinterpreta regra de negócio. Divergência entre documento e comportamento vira achado para o DEV ou dúvida para o Orquestrador (17 §6).

## 2. Estratégia por camada

| # | Camada | Escopo (IDs) | Ferramenta gratuita [PROPOSTA] | Onde roda | Entra na onda |
|---|---|---|---|---|---|
| 1 | Unitário | Estados, prazos com relógio injetado, validação de corpo, redação de PII, contadores de cota, breaker de geocodificação | Vitest ou Jest | Local e CI | 0 em diante |
| 2 | Propriedades e modelo | Sequências aleatórias de operações verificando I-01 a I-30 | fast-check | Local e CI | 3 (I-01 a I-03); 4 em diante (demais) |
| 3 | Integração API e Postgres | Endpoints contra Postgres real: idempotência (C-14), 404 indistinguível, 409, 422 | Cliente HTTP de teste e Supabase CLI local | Local e CI | 1 em diante |
| 4 | Contrato de API | Respostas contra OpenAPI de `packages/contracts`; campos extras; `application/problem+json`; allowlist de resposta ao profissional (CT-01 a CT-08) | Schemathesis (OSS) | CI | 1 em diante |
| 5 | RLS, privilégios e catálogo (pgTAP) | RLS habilitada e forçada (B-02); `SECURITY DEFINER` com `search_path` fixo (B-03); papéis `anon`, `authenticated` e `app_api` (T-05); paridade `access-matrix` (T-06); catálogo de ausência (T-17, M-02, N-07, P-04) | pgTAP e Supabase CLI | CI: migração do zero e incremental | 0 em diante |
| 6 | Concorrência e falha | C-01 a C-18, F-01 a F-12, N≥100; barreiras determinísticas (`pg_sleep` ou ponto de pausa injetado); relógio do banco | Node com driver Postgres; Postgres efêmero | CI (job dedicado) | C-01 a C-03 na onda 3; demais nas ondas 4 e 5 |
| 7 | E2E web | Jornadas EE-01 a EE-09 (§6.3) em navegador real | Playwright | Local e CI; preview só smoke, sem e-mail | 3 em diante |
| 8 | Acessibilidade | AX-01 a AX-09 (§6.4): triagem automatizada, teclado, leitor de tela manual, contraste dos tokens, zoom e reflow | @axe-core/playwright (triagem); script de contraste; roteiro manual | CI (triagem) e manual (evidência) | 3 nas telas tocadas; completo na 5 |
| 9 | Segurança | T-01 a T-17 (negativos por chamada direta), B-05, B-06, B-14 a B-19, SC-01 a SC-06 (§6.6) | Scripts HTTP; OWASP ZAP baseline (local); gitleaks; OSV-Scanner ou `pnpm audit` | CI e local | 0 em diante; completa na 5 |
| 10 | E-mail | N-01 a N-10, Q-01, Q-10, Q-11, F-04, F-12, C-13; captura pela API do Mailpit | Mailpit | Local e CI | 1 (N-05, N-09, N-10); 3 (N-01, N-03); 4 e 5 (demais) |
| 11 | Billing (simulado e sandbox) | B-01 a B-10, C-11, T-09, F-07; assinatura inválida; consulta ao recurso; replay | Fixtures de webhook versionadas (RT-04); sandbox do MP após BLQ-EXEC | Local (simulado) e sandbox | 4 em diante |
| 12 | Geocodificação (simulada) | G-01 a G-07, F-05, I-28; respostas "temporária" e "permanente" distintas | Simulador próprio do Mapbox | Local e CI, sem egress | 2 em diante |
| 13 | Mídia | P-01 a P-06, T-07, F-09, F-11, Q-08, Q-12; EXIF; imagem-bomba; arquivo falso por extensão | Fixtures sintéticas geradas por script; ExifTool para verificar metadados [PROPOSTA] | Local e CI | 2 em diante |
| 14 | Carga leve | LT-01 a LT-05, Q-06, Q-07, C-15 (§6.5) | k6 (OSS) contra o ambiente local | Local; nunca contra Supabase Free ou Hobby sem autorização | 3 (smoke); 5 (completa) |
| 15 | Recuperação | D-01, D-02, H-119; restauração de dump sintético e reconciliação de Storage | `pg_dump` e restore locais; script de reconciliação | Local | 5 e antes do M4 |
| 16 | Observabilidade e PII | T-11, B-41; varredura de logs, eventos e capturas de teste por padrões de e-mail, telefone, CPF/CNPJ e token | Script com regex e allowlist | CI | 1 em diante |

## 3. Ambientes e dados

### 3.1 Ambientes

| ID | Ambiente | Componentes | Uso permitido | Restrições | Estado |
|---|---|---|---|---|---|
| A1 | Dev local | Supabase CLI e Docker (Postgres, Auth, Storage e Realtime locais), app local, Mailpit, simuladores de Mapbox, Mercado Pago e Resend, relógio controlado | Todas as camadas | Extensões locais podem diferir do plano Free (PostGIS, pg_cron, pg_net; RT-02). Egress externo bloqueado na suíte | Montável sem conta. Licença do Docker: [NÃO VERIFICADO] (RT-13) |
| A2 | CI | Mesmo conjunto do A1, em containers, sem segredos reais | Camadas 1 a 10, 12, 13 e 16; smoke da 14 | Minutos e limites de CI: [NÃO VERIFICADO] (RT-11). Nenhum segredo real | Depende de H-004 |
| A3 | Preview na Vercel (Hobby) | Web e API em função única | Smoke e E2E de navegação, sem e-mail e sem cobrança | Hobby é só uso não comercial (R-28); e-mail real impossível sem domínio (R-33); Mailpit não é acessível a partir do preview (RT-06) | BLQ-EXEC (criar projeto) |
| A4 | Supabase Free remoto (projeto de teste) | Spikes S-02 e S-10; pooler; conexão | Spikes e smoke de conexão | Pausa após 1 semana sem uso (R-08); sem backup; 60 conexões diretas e 200 no pooler; sem dados reais | BLQ-EXEC |
| A5 | Sandbox do Mercado Pago | Checkout hospedado e assinatura de teste | Casos B-xx em sandbox; decisão 37 (sandbox permitido) | Sem cobrança real. Sandbox em conta Hobby pendente de confirmação (BK-3). Proibido em produção (B-48) | BLQ-EXEC; BK-3 |
| A6 | Mapbox real | Uma chamada de smoke com permanent=true, manual | Confirmar formato de resposta (S-04) | Cartão e limite de gasto (decisões 29 e 36); nunca em CI; resultado temporário nunca em cache | BLQ-EXEC (H-021) |
| A7 | Resend real | Nenhum | Nenhum teste nesta fase | 100 por dia UTC e 3.000 por mês por destinatário; resend.dev também consome cota (13); domínio inexistente (H2) | Fora de teste até TL-1 |

Regras de ambiente:
- Dev e CI usam somente A1 e A2. Qualquer chamada a host externo falha o teste (B-49, B-50, B-51).
- Mailpit é o único destino de e-mail em dev e CI (I-27; N-09). Não usar resend.dev nem e-mail real de titular como destino de teste (13; RT-05).
- O relógio controlado vale para o banco (função now). O mecanismo (função de teste em schema isolado ou libfaketime no container) não está definido (N14).

### 3.2 Dados sintéticos

| ID | Dado | Regra de geração |
|---|---|---|
| DS-01 | Cliente A e Cliente B | Nomes fictícios; e-mail no domínio reservado .test (ex.: cliente.a@sintetico.test) |
| DS-02 | Profissionais P1 a P8 aprovados | Mesmo padrão; CPF ou CNPJ conforme DS-05 |
| DS-03 | Profissionais nos estados pendente, em_revisao, retida_duplicidade, recusada e suspensa | Um por estado, para os casos T-04 |
| DS-04 | Staff: Auditor, Financeiro, Verificação, Moderador, Suporte e Superadmin | Um por papel; Superadmin com MFA de teste (aal2) |
| DS-05 | CPF e CNPJ | Gerados por script de teste, marcados como fictícios; nunca copiados de fonte real; HMAC com chave de teste |
| DS-06 | Telefones | Faixa claramente fictícia [PROPOSTA]; confirmar que não coincide com número real |
| DS-07 | Endereços e coordenadas | Logradouro "Rua Sintética 000"; coordenadas fictícias em área sem população (ex.: oceano) para o simulador de geocodificação |
| DS-08 | Fotos | Geradas por script: JPG, PNG, WebP e HEIC sintéticos; cores sólidas; EXIF com GPS fictício injetado para testar a remoção; imagem-bomba e arquivo falso por extensão |
| DS-09 | Documentos de identidade | PDF e imagens sintéticos; limites conforme decisão 35 (ver N2) |
| DS-10 | Mensagens | Texto sintético com marcadores de teste (ex.: XSS-PROBE-01) para T-10 |
| DS-11 | Pagamentos | Valores em centavos: 2990, 8070, 14940 e 23880 (D5; H-046); estornos de 20000 e 20001 centavos (I-18) |
| DS-12 | Payloads de webhook | Fixtures versionadas com data de verificação; segredo só por nome de variável (ex.: MP_WEBHOOK_SECRET_TEST); valor nunca no repositório (decisão 13; B-39) |

Regra geral: a varredura de T-11 roda sobre logs e capturas de teste. Um padrão de PII real reprova o lote, inclusive fixtures que pareçam reais (RT-07).

## 4. Critérios de entrada e saída

### 4.1 Por onda

| Onda | Entrada | Testes obrigatórios | Saída (QA) |
|---|---|---|---|
| 0 Spikes e fundação | Spikes S-01 a S-04 e S-09 a S-11 com saída registrada; autorização por spike (BK-6) | Catálogo pgTAP (B-02, B-03); gitleaks e .gitignore (B-39, B-40); varredura de hex (B-32) em projeto vazio; T-13; T-14 (baseline) | Zero segredo; migração do zero sobe; catálogo verde; nenhum recurso de produção criado; saídas dos spikes anexadas |
| 1 Identidade | Onda 0 concluída | T-01 (todos os subitens); T-12; B-10; B-11; H-015 (tempos e respostas uniformes); N-05; N-09; N-10 | T-01 verde; respostas e tempos uniformes medidos (método em LT-02); GET do link não consome token |
| 2 Geo, pedido e verificação | S-02, S-04 e S-06 com saída; Onda 1 concluída | G-01 a G-07; F-05; P-01 a P-06; T-07; I-16; T-03; B-13; B-15; B-16; B-58; Q-08; Q-12; Q-13 | Nenhum permanent=true fora do ponto de H-021; 6ª foto recusada na API e no banco; nenhum original no Storage |
| 3 Aceite e chat (M1) | Onda 2 concluída | C-01 a C-04, C-04b, C-12, C-14, C-16, C-18, F-01, F-10, M-01, M-02, T-02, T-03, T-04, T-06 (parcial), T-16, T-17, I-01 a I-03, I-12, I-13, I-22, N-01, N-03, EE-01 a EE-03, AX-01 a AX-04 nas telas tocadas | Itens de M1 verdes com N≥100 nos cenários de concorrência; E2E verde; triagem de acessibilidade sem violação crítica; roteiro de teclado executado e registrado |
| 4 Ciclo de vida e assinatura (M2) | Onda 3 concluída; S-03 com saída; cota de e-mail (H-094) | B-01 a B-10; T-09; C-05 a C-11; C-13; C-15; F-02; F-03; F-04; F-07; F-08; F-12; I-04 a I-11; I-14; I-20; I-25; N-02; N-04; N-06; N-08; Q-01; Q-10; Q-11; Q-14; EE-04 a EE-06; reconciliação (H-053) | Carência de 72 h verde com relógio controlado; webhook idempotente e sem regressão; cotas de e-mail verdes |
| 5 MVP em ensaio fechado (M3) | Onda 4 concluída. L1 só para ativar prazos reais | Suíte completa: T-01 a T-17, C-01 a C-18, F-01 a F-12, I-01 a I-30; T-08; I-15; I-18; B-07 a B-09; N-07; N-09; N-10; C-07; C-08; C-17; D-01; D-02; Q-02 a Q-07; LT-01 a LT-05; SC-01 a SC-06; AX-01 a AX-09 completo com evidência humana; EE-07 a EE-09 | Zero BLOQUEADOR aberto; monitores zerados; carga leve dentro do §6.5; restauração testada com dados sintéticos |
| Gate M4 (bloqueado) | M3 concluído; TL-1 a TL-8 e L1 a L7 decididos | Reexecução da suíte no SHA candidato; testes de bloqueio de cobrança (B-46, B-48, B-53); checklist de H-121 | Pacote de evidências (§7) entregue ao Orquestrador. O QA não decide CONCLUIR |
| 6 Mobile (M5) | Fora deste plano | Não definido (N8) | Não aplicável |

### 4.2 Por marco

| Marco | Critério de QA |
|---|---|
| M0 Spikes e fundação | Catálogo pgTAP verde; gitleaks e .gitignore verdes; spikes S-01 a S-04 e S-09 a S-11 com saída registrada; nenhum teste contra produção |
| M1 Núcleo web | C-01, C-02, C-03 e C-16 verdes com N≥100; M-01 e M-02 verdes; EE-01 a EE-03 verdes; P-01, P-02, T-16 e T-17 verdes; triagem de acessibilidade sem violação crítica nas telas do fluxo; nenhuma declaração de conformidade WCAG (B-36) |
| M2 Ciclo completo | C-05 a C-11 verdes com N≥100 onde aplicável; B-01 a B-10 verdes em sandbox ou simulado; F-02 verde (tudo ou nada); N-02, N-04 e N-08 verdes; Q-10 e Q-11 verdes |
| M3 MVP em ensaio fechado | Suíte completa verde no SHA candidato; monitores I-01 a I-30 zerados; T-08 verde; D-01 e D-02 executados com dados sintéticos; LT-01 a LT-05 dentro do §6.5; SC-01 a SC-06 sem achado alto aberto; pacote L5 (§7) pronto |
| M4 Lançamento restrito (bloqueado) | Itens de H-054 e H-121 verificados com evidência; L1 a L4 e L7 decididos pelo jurídico; TL-1 a TL-8 resolvidos; decisão humana registrada. Não alcançado por inferência (14 §3) |
| M5 Mobile | Fora deste plano (N8) |

## 5. Matriz de casos por FA

Convenção: cada célula é um caso com ID QA-FAnn-X (X = P, N, L, R, C, A ou Y). "n/a" indica categoria sem sentido para o FA, com justificativa breve. A última coluna traz os IDs de testes já existentes no 11-ARQ, para rastreio. Os dados são os DS-xx da §3.2.

### 5.1 FA-001 a FA-009

| FA | P (positivo) | N (negativo) | L (limite) | R (rede/falha) | C (concorrência) | A (autorização) | Y (a11y) | Base existente |
|---|---|---|---|---|---|---|---|---|
| FA-001 Visitante navega e inicia pedido sem senha | Catálogo sem login; autocomplete sugere serviço; pedido completo sem senha em nenhum passo | Termo sem resultado no autocomplete; urgência fora dos 4 valores exatos vira 422 | Acentos e caixa variados no termo; descrição no limite (valor NÃO DEFINIDO, N4) | Mapbox indisponível: texto preservado (F-05); rascunho expirado por TTL | n/a: rascunho tem um único dono; envio duplicado gera um rascunho (C-14) | Rascunho de outro nonce retorna 404 indistinguível | Autocomplete operável por setas, Enter e Esc; resultados anunciados | P-01, P-03, G-01, F-05, T-12 |
| FA-002 Publicação após identificação, link, revisão e confirmação | Link, revisão e confirmação expressa publicam com novo ID e prazo de 7 dias | Publicar sem nome ou e-mail: bloqueio por campo; e-mail não verificado por API direta: recusa | Prazo exato de 7 dias pelo relógio do banco, com ±1 ms; limite de nome (NÃO DEFINIDO) | Queda após confirmar, antes da resposta: retry com mesma chave cria um pedido (F-01) | Duplo clique em Confirmar: um pedido (C-14; FA-035) | Publicar pedido de outro: 404 | Erros por campo ligados ao campo; revisão operável por teclado | I-05, I-07, T-01, C-14, F-01 |
| FA-003 Link ou código inválido ou expirado não dá acesso | Link válido em até 15 min cria sessão após POST de confirmação | Link após 15 min, usado ou adulterado: negado; 5 códigos errados invalidam o desafio | 15 min exatos e +1 s; código com zeros à esquerda; 5ª e 6ª tentativa | Falha do provedor de e-mail: 202 uniforme e item pendente (F-12); GET de scanner não consome (D8) | Dois POST simultâneos com o mesmo token: um consome, o outro falha | Link consumido em outro navegador não anexa rascunho de outro e-mail; e-mail B não vê pedido de A | Página de confirmação com foco e erro acionável; código colável (AX-09) | B-10, T-01, T-12, N-05, F-12 |
| FA-004 Profissional não aprovado não aceita, nem por API | Profissional aprovado aceita; aprovação gera auditoria com ator e data | Estados pendente, em_revisao, retida, recusada ou suspensa: aceite negado na UI e na API, nada criado | Certificação REG ausente: aprovação não conclui (caso condicionado a L4); documento no limite da decisão 35 (N2) | Upload interrompido de documento: arquivo pendente expurgado (F-09) | Aprovação e suspensão simultâneas: estado final único e auditado | Profissional não lê documentos; Financeiro nega; leitura da Verificação registrada | Estados de verificação anunciados em texto, não só por cor | T-04, T-08, B-13, F-09 |
| FA-005 Trial de 14 dias | Aprovado ativa trial sem meio de pagamento; acesso dura 14 dias | Não aprovado tenta ativar: negado; segundo trial da mesma identidade: negado (AMB-09 pendente, ver N11) | Dia 14 até o instante final e +1 s pelo relógio do banco; sem carência depois do trial | Falha ao gravar o trial no meio da operação: nenhuma meia-ativação | Dois cliques em Ativar: um trial | Identidade repetida em duas contas (HMAC): negado | n/a: sem tela própria além do botão (coberto em FA-006) | B-07, I-14, N-04 |
| FA-006 Mercado Pago (Pix e cartão), carência de 72 h, idempotência | Pix ou cartão aprovado no sandbox ativa acesso pelo período; preços 2990, 8070, 14940, 23880 | Boleto: 422 method_not_supported; webhook com assinatura inválida: 401 sem efeito; Pix pendente não estende acesso | Fim do período +72 h exatos e +72 h +1 s; Pix pago em +60 h e em +72 h | Webhook respondendo 5xx: reentrega sem efeito duplicado; MP fora do ar na criação: 502 sem concessão (F-07) | Webhook duplicado, concorrente e fora de ordem: uma concessão (C-11) | Webhook sem assinatura válida: 401; checkout por visitante anônimo: negado; cartão nunca passa pelo NestJS (B-46) | Planos e escolha Pix ou cartão operáveis por teclado; sem opção de boleto | B-01 a B-10, C-11, I-14, I-20, I-25, F-07, T-09 |
| FA-007 Elegível vê fotos antes de aceitar, sem dados pessoais | Aprovado com acesso vigente vê foto reduzida com marca de água e localização generalizada | Resposta da API sem nome, e-mail, telefone ou endereço (inspeção por padrão de PII) | Foto de 1.280 px e de 1.281 px (reduzida, não recusada); fronteira da célula de 500 m; EXIF GPS removido | URL assinada expirada (60 s +1 s): 403 ou 404; Storage fora: placeholder sem URL vazada | 20 profissionais pedem a mesma foto: limite por profissional (429) sem afetar os demais [PROPOSTA] | Não elegível (fora do raio, sem acesso, não aprovado): 404 indistinguível; URL de outro profissional: negada | Foto com texto alternativo; informação não só visual | P-05, T-03, T-07, Q-13, B-18 |
| FA-008 Sem acesso, sem imagem | Participante mantém foto autorizada depois da expiração | Visitante pede URL, ID ou miniatura: 401, 403 ou 404 indistinguíveis em corpo e tempo | Pedido expirado no instante exato do dia 7: não participante negado; participante mantém | Cache ou CDN não guarda foto de visitante [PROPOSTA] | Expiração ou revogação durante o carregamento: próxima requisição negada | URL assinada vazada e usada por terceiro: negada; miniatura com a mesma política do original | n/a: sem tela nova; estado sem foto anunciado em FA-007 | T-02, T-07, B-18 |
| FA-009 Só o participante vê nome e a própria conversa | Aceite ativo vê primeiro nome e a conversa própria | P1 pede conversa de P2 por ID previsível: 404 indistinguível | Pedido com 1 aceite e com 8 aceites; profissional com aceite retirado vê histórico somente leitura | Falha na checagem de participação: negado por padrão (default-deny) [PROPOSTA] | Retirada no mesmo instante da leitura do nome: resposta coerente | Elegível não participante não vê primeiro nome (T-03); admin sem caso não abre a conversa (FA-031) | Nome da conversa com rótulo acessível | T-02, T-03, I-12 |

### 5.2 FA-010 a FA-018

| FA | P (positivo) | N (negativo) | L (limite) | R (rede/falha) | C (concorrência) | A (autorização) | Y (a11y) | Base existente |
|---|---|---|---|---|---|---|---|---|
| FA-010 Teto de 8, 4+4, botão da segunda onda | Quatro aceites: botão Chamar mais profissionais visível; clique libera até +4 | Com 3 aceites, botão ausente; 9º aceite: negado sem contadores | 4 e 3 aceites; slot 4 e slot 5; botão no último instante dos 7 dias | Retry da 2ª onda após resposta perdida: uma abertura (idempotência) | C-01 (50 simultâneos: 4 aceites); C-02 (N≥100, com abertura da onda durante a disputa); C-04 e C-04b | Profissional não abre 2ª onda; não dono: 404 em second-wave | Rótulo sem números lido por leitor de tela; motivo de indisponibilidade em texto (N4, texto da decisão 39) | C-01, C-02, C-04, C-04b, I-01, I-06 |
| FA-011 Aceite único, idempotente, sem conteúdo | Aceite cria 1 aceite, 1 vaga, 1 conversa e 1 mensagem "Estou disponível para trabalhar" (remetente nulo) | Corpo com texto, valor ou prazo: 422 e nada persistido; editar aceite: negado; reaceite após retirada: negado | Campo extra vazio ou ausente; aceite no último segundo do prazo | Queda antes do COMMIT: nada persistido; retry cria um (F-01, F-10) | Duplo clique e duas abas: um aceite (C-03); repetição 5 vezes (C-16) | Aceite por não aprovado: negado (FA-004); aceite no próprio pedido: negado (I-19) | Botão Aceitar trabalho sem campo de texto; mensagem automática anunciada no chat (FA-034) | C-03, C-16, C-17, C-18, F-01, F-10, T-16, T-17 |
| FA-012 Expiração aos 7 dias | Prazo chega: admissão encerrada; pedido não é cancelado nem concluído | Aceite depois do prazo: negado, inclusive com requisições concorrentes | Dia 7 exato: aceite com -1 ms é aceito e com +1 ms é negado; lembrete de 24 h no instante exato | Job de expiração atrasado (tick falhou): aceite continua negado pela regra de instante, sem depender do job (Q-14) | Aceite concorrente no instante da expiração (±1 s) (C-06) | Cliente de outro pedido não recebe lembrete | Aviso de expiração em texto, não só por cor [PROPOSTA] | C-06, I-05, I-17, N-04 |
| FA-013 Seleção após expiração | Cliente seleciona P1 que aceitou, depois de 7 dias: efetivada; prazo não muda | Profissional sem aceite: seleção negada | Seleção no mesmo segundo da expiração | Queda no meio da seleção: rollback total (F-02) | Duas seleções simultâneas (C-05) | P1 bloqueado ou suspenso: seleção negada | n/a: fluxo de seleção coberto em FA-014 | C-05, I-04 |
| FA-014 Seleção encerra aceites e mantém conversas | Seleção de P1: admissão encerrada; conversas com P2 e P3 ativas | P4 tenta aceitar depois da seleção: negado | Seleção no último aceite possível | Notificação falha: conversas intactas; e-mail na fila (FA-029) | Aceite de P4 e seleção de P1 simultâneos: um vence; estado consistente (C-05, C-06) | Evento de P2 não contém identidade de P1 (T-16) | n/a: sem tela nova | C-05, I-04 |
| FA-015 Troca de selecionado | P1 para P2 (participante prévio), com auditoria; nada transferido | Troca para quem nunca aceitou: negada; troca em pedido concluído ou cancelado: negada | Troca repetida para o mesmo P2: idempotente | Queda entre desmarcar P1 e marcar P2: rollback | Troca simultânea para P2 e P3: uma seleção ativa (I-04) | Troca por cliente de outro pedido: 404 | Confirmação de troca com foco e texto acessíveis | I-04, T-08 |
| FA-016 Cancelamento | Sem selecionado: cancelado e conversas somente leitura; com selecionado, só a dele fica ativa | Clique sem confirmação: nada muda; envio em conversa somente leitura: negado | Cancelar no mesmo instante de um aceite: ordem definida e registrada | E-mail de cancelamento com cota degradada: estado do pedido não depende do e-mail | Cancelar e concluir simultâneos: estado consistente (C-07) | Profissional não cancela: negado | Diálogo de confirmação com foco inicial e saída por Esc [PROPOSTA] | C-07; FA-016 (sem caso próprio em 11, ver N12) |
| FA-017 Conclusão | Selecionado P1; cliente confirma: concluído e avaliação habilitada | Sem selecionado: negado; profissional ou sistema tentando concluir: negado | Concluir sem seleção ativa; expiração não conclui | Retry da confirmação com Idempotency-Key: uma conclusão | Duas conclusões simultâneas: uma (C-07) | Só o cliente dono; outro cliente: 404 | n/a: sem tela nova | C-07, I-08 |
| FA-018 Correção de conclusão | Correção em 24 h menos 1 ms, sem avaliação: volta a selecionado; aceites não reabrem | Correção em 24 h mais 1 ms: negada com oferta de revisão administrativa; com avaliação publicada: negada | Exatamente 24 h (limite inclusivo, AMB-11 A) | Relógio do banco; falha no meio: rollback | Correção simultânea com avaliação (C-08) | Não dono: 404; revisão administrativa com auditoria | n/a: sem tela nova além de mensagens | C-07, I-17, I-08 |

### 5.3 FA-019 a FA-027

| FA | P (positivo) | N (negativo) | L (limite) | R (rede/falha) | C (concorrência) | A (autorização) | Y (a11y) | Base existente |
|---|---|---|---|---|---|---|---|---|
| FA-019 Avaliação | Conclusão válida; nota de 1 a 5 com comentário publicada automaticamente após filtro | Nota 0 ou 6; avaliação de não selecionado; segunda avaliação; conteúdo ofensivo: rejeitado com correção (AMB-12) | Notas 1 e 5; comentário no limite (NÃO DEFINIDO, N4); edição no 7º dia exato | Filtro antifraude indisponível: não publica sem decisão (comportamento não definido, N6) | Dupla avaliação (C-08) | Profissional avalia cliente: negado; autor exibido como "Cliente do FastPro", sem nome ou e-mail | Formulário de nota em grupo de opções rotulado | C-08, I-09, T-10 |
| FA-020 Primeira avaliação sem prazo comercial (condicionado a L1) | Com dados disponíveis, avaliação aceita (somente se L1 decidida) | Dados eliminados por retenção: negado com mensagem | Retenção nula significa mecanismo desligado; teste de catálogo sem prazo ativo | n/a: depende de L1 | n/a: sem concorrência própria | Novo link autenticado avalia só como selecionado | n/a: sem tela nova | C-08 (condicionado a L1) |
| FA-021 Republicação | Republica pedido expirado ou cancelado (decisão 38): novo ID e 7 dias; original inalterado | Republicar pedido ativo, selecionado ou desistido: negado (decisão 38) | Telefone desmarcado na republicação; limite de uma ativa por cadeia | Falha na criação: original intacto | Duas republicações simultâneas: uma (C-09) | Republicar pedido de terceiro: 404 | n/a: sem tela nova | C-09 (sem caso próprio em 11, ver N12) |
| FA-022 Uma republicação ativa por cadeia | Segundo pedido de serviço distinto não é bloqueado (AMB-01) | Segunda republicação na mesma cadeia: 409 com referência à existente | Distância de 100 m e de 101 m (duplicidade); janela de 24 h exata | n/a: sem integração externa | Duas tentativas quase simultâneas: uma (C-09) | Cadeia de outro cliente: 404 | Mensagem de 409 acessível | C-09, I-10 (condicionado a AMB-01 e AMB-02) |
| FA-023 Seleção no original com republicação ativa | Confirma impacto: republicação cancelada e P1 selecionado no original | Sem confirmação: nada muda | Republicação com selecionado conta como ativa | Falha entre cancelar e selecionar: rollback total (F-02) | Requisição repetida e chave diferente: efeito único (C-10) | Não dono: 404 | Diálogo de impacto acessível | C-10, F-02, I-11 |
| FA-024 Desistência sem substituto | P1 desiste: cliente notificado; sem troca automática; duas confirmações oferecidas | Desistência sem seleção ativa: 409 | Prazo original não reabre | Falha no e-mail de desistência: estado registrado | Desistência e seleção simultâneas: um estado | P2 não registra desistência de P1 | Duas confirmações independentes com texto claro | I-04 (sem caso próprio em 11, ver N12) |
| FA-025 Assinatura expirada preserva participação | Selecionado com acesso expirado: seleção efetivada; conversa mantida | Acesso expirado não descobre novos pedidos (lista e API) | Expiração no instante exato | n/a: sem integração síncrona | Expiração durante um aceite em curso: resultado documentado pela ordem de lock [PROPOSTA] | Suspenso por segurança: seleção negada | n/a | T-04, B-13 |
| FA-026 Mensagens sem edição ou exclusão; arquivar | Arquivar só para quem arquivou; nova mensagem devolve à caixa de quem arquivou | Editar ou excluir mensagem, na UI ou na API: negado; mensagem de sistema não editável | Conversa arquivada e somente leitura: nova mensagem não aparece | Falha de rede ao arquivar: estado consistente | Arquivar e receber mensagem ao mesmo tempo: estado coerente | Arquivo de outro usuário não altera a minha caixa | Controle de arquivar com rótulo; estado arquivada anunciado | I-13 (sem caso próprio em 11, ver N12) |
| FA-027 Chat somente texto, sem anexos | Texto entregue | Qualquer anexo (imagem, PDF, arquivo renomeado, multipart, campo attachments): 422 attachments_not_allowed | Mensagem no limite de tamanho (NÃO DEFINIDO, N4); rajada acima do limite anti-abuso | Envio sem rede: sinal de falha ao usuário | Rajada de envios: rate limit sem limite comercial | Anexo em conversa de terceiro: 404 | Sem seletor, arrastar, colar ou preview; falha anunciada | M-01, M-02, I-30 |

### 5.4 FA-028 a FA-035

| FA | P (positivo) | N (negativo) | L (limite) | R (rede/falha) | C (concorrência) | A (autorização) | Y (a11y) | Base existente |
|---|---|---|---|---|---|---|---|---|
| FA-028 Reenvio sem duplicar; somente leitura | Texto reenviado após falha: uma mensagem e falha sinalizada | Envio em conversa somente leitura: negado; conversa restrita por segurança: aviso | client_message_id reutilizado com corpo diferente: 422 (B-27) | Queda após COMMIT antes da resposta: retry gera uma mensagem (C-12) | Reenvio cinco vezes (C-12) | Não participante: 404 | Estados enviando e falha anunciados por região viva [PROPOSTA] | C-12, C-18, I-13 |
| FA-029 Notificações: chat imediato e e-mails habilitados; cota | Aceite enfileira e envia ao Mailpit: primeiro imediato, demais em resumo de 15 min | Sem domínio ou segredo: Resend recusa e item fica pendente (N-10); nenhum e-mail retroativo (N-07) | Cota de 89, 90 e 100 destinatários no dia UTC (Q-10); 2.699, 2.700 e 3.000 no mês (Q-11); virada UTC | Provedor fora por horas: pendente com recuo e sem duplicação (F-04); cota esgotada: login passa (F-12) | Dois ticks concorrentes: no máximo um e-mail por janela (C-13) | E-mail não expõe e-mail ou telefone de terceiros (N-01) | Não lida exibida no site sem depender de e-mail (H-101) | N-01 a N-10, Q-01, Q-10, Q-11, C-13, F-04, F-12 |
| FA-030 E-mail nunca; telefone só com consentimento | Opt-in marcado e aceite: profissional vê o telefone só dentro daquela participação | Checkbox desmarcado: telefone não aparece; e-mail do cliente nunca aparece em resposta | Opt-in marcado sem telefone: opt-in inativo; revogação corta acesso futuro | n/a: sem integração externa | Revogação e revelação simultâneas: revelação negada depois da revogação | Elegível que não aceitou não vê telefone; republicação não herda consentimento | Checkbox com rótulo; estado padrão desmarcado | T-03, I-16, B-14, B-15 |
| FA-031 Admin sem navegação livre | Auditor consulta trilha; caso autorizado com justificativa tem acesso e log | Sem MFA: negado; papel inadequado na API: 403; sem access_case: negado | Estorno de 20000 centavos (1 aprovação) e de 20001 (2 aprovações) (T-08) | Perda do dispositivo MFA: reenrolamento com dupla aprovação (R-21, D-07) | Duas aprovações do mesmo aprovador ao mesmo tempo: uma válida | Autoaprovação: negada; Auditor não altera | Console admin operável por teclado; telas mínimas por papel | T-08, I-15, I-18 |
| FA-032 Estornos (bloqueado por L3) | Com estorno liberado (após L3): aprovado por Financeiro com uma aprovação | Solicitante aprova o próprio: negado; mesmo aprovador duas vezes: negado | 20000 centavos (uma aprovação) e 20001 (duas) | Falha no provedor durante o estorno: estado pendente sem duplicar [PROPOSTA; NÃO VERIFICADO no MP] | Duas aprovações simultâneas de aprovadores distintos: efeito único | Papel sem permissão: 403 | n/a | I-18, T-08 (teste de bloqueio enquanto L3 estiver pendente) |
| FA-033 Temas e EDS | Tokens claros e escuros aplicados | Cor literal em componente: falha no lint (B-32) | Contraste no limiar de 4,5:1 (texto) e 3:1 (texto grande e componentes) | Fonte Roboto indisponível: layout não quebra | n/a: sem concorrência | n/a: sem permissão | Troca de tema preserva foco; pares de cores medidos (AX-03) | T-15, B-32 a B-34 |
| FA-034 Acessibilidade | Fluxos principais alcançáveis só por teclado, com foco visível | Controle sem nome acessível e erro só por cor: falham (B-35) | Zoom de 200% e reflow em 320 px; alvo de 24 por 24 px (AX-05, AX-06) | Estado de carregamento anunciado; erro de rede acionável | Chegada da mensagem automática sem perda de foco | n/a | Roteiro de teclado, leitor de tela e triagem automatizada (AX-01 a AX-04) | T-15; L5 |
| FA-035 Idempotência e falha parcial | Duplo clique em aceite, seleção, cancelamento, conclusão, pagamento e republicação: efeito único | Mesma Idempotency-Key com corpo diferente: 422; em andamento: 409 (C-14) | 8 aceitos e 9 tentativas (C-02, N≥100) | Injeção de falha F-01 a F-12 | C-01 a C-18 completos | Retry de outro usuário com chave alheia não reaproveita resposta [PROPOSTA] | n/a | C-01 a C-18, F-01 a F-12, I-01 a I-22 |

## 6. Casos transversais

### 6.1 Concorrência e falha (execução)

- Cada cenário C-xx e F-xx roda em no mínimo 100 iterações, com requisições realmente simultâneas (processos ou workers) e barreira determinística que força a intercalação descrita em 11 §7.
- Oráculo: o resultado esperado da coluna de 11 §7, mais os monitores MON-01 a MON-30 (§6.7) ao fim de cada iteração.
- Relatório por cenário: número de iterações, número de violações, distribuição do resultado (por exemplo, quantos aceites por iteração) e instantes do relógio do banco usados.
- Falha de uma única iteração reprova o cenário inteiro. Não há média aceitável.
- Teste repetido é diagnóstico, não evidência. Reexecução sem causa identificada não substitui a falha original.

### 6.2 Contrato de API (CT)

| ID | Caso | Esperado |
|---|---|---|
| CT-01 | OpenAPI gerado de packages/contracts é válido e corresponde às rotas | Sem divergência entre contrato e rotas |
| CT-02 | Todo erro é application/problem+json com code estável | Lista de códigos da 11 §2.1 |
| CT-03 | Corpo com campo extra em aceite (texto, valor, prazo) | 422; nada persistido (11 §2.2; B-25) |
| CT-04 | Respostas a profissional validadas contra allowlist | Sem e-mail, telefone, endereço exato, primeiro nome sem aceite nem contadores (B-14 a B-17, B-21) |
| CT-05 | Idempotency-Key | Mesma chave e corpo: repetição idêntica; mesma chave e corpo diferente: 422; em andamento: 409 (C-14) |
| CT-06 | Cabeçalhos RateLimit e Retry-After | Presentes em 409 e 429 |
| CT-07 | Recurso alheio | 404 idêntico em corpo e em tempo (B-05; CT-04) |
| CT-08 | Rotas de máquina (tick e webhooks) | 401 sem segredo ou assinatura; não expostas ao navegador (17 §4.1) |

### 6.3 Jornadas E2E (EE)

| ID | Jornada | Ondas |
|---|---|---|
| EE-01 | Visitante: catálogo, autocomplete, pedido com 5 fotos, e-mail, link (POST), revisão, publicação | 3 |
| EE-02 | Profissional aprovado: login, descoberta, foto com marca, aceite, conversa com mensagem automática | 3 |
| EE-03 | Cliente: vê aceites, botão da segunda onda após 4 aceites, seleção, chat com o selecionado | 3 |
| EE-04 | Ciclo: seleção, conclusão, avaliação; correção dentro de 24 h | 4 |
| EE-05 | Assinatura em sandbox: planos, Pix ou cartão (sem boleto), webhook simulado, acesso ativo, carência | 4 |
| EE-06 | Republicação de pedido expirado e cancelamento | 4 |
| EE-07 | Admin: MFA, caso autorizado com justificativa, log de leitura | 5 |
| EE-08 | E-mail: aceite gera captura no Mailpit sem PII de terceiros | 3 e 4 |
| EE-09 | Falhas na UI: sem rede, tempo esgotado, 409 de version_mismatch, mensagens acionáveis | 5 |

### 6.4 Acessibilidade (AX), WCAG 2.2 AA

| ID | Verificação | Critério WCAG | Método | Evidência |
|---|---|---|---|---|
| AX-01 | Teclado em EE-01 a EE-05: todos os controles alcançáveis, ordem lógica | 2.1.1; 2.4.3 | Roteiro manual | Registro por tela |
| AX-02 | Leitor de tela nos fluxos principais (pedido, link, aceite, chat, assinatura) | 4.1.2; 4.1.3 | NVDA com navegador no Windows, manual (N7) | Nota do testador |
| AX-03 | Contraste dos pares de tokens claro e escuro | 1.4.3; 1.4.11 | Script sobre os tokens | Tabela de razões |
| AX-04 | Triagem automatizada em cada tela tocada | Conjunto de regras do axe | @axe-core/playwright; triagem, não conformidade | Relatório JSON |
| AX-05 | Zoom de 200% e reflow em 320 CSS px | 1.4.4; 1.4.10 | Playwright e manual | Capturas |
| AX-06 | Alvo de toque de pelo menos 24 por 24 CSS px | 2.5.8 | Medição automatizada e manual | Relatório |
| AX-07 | Foco não obscurecido por cabeçalho, rodapé ou sheet | 2.4.11; 2.4.7 | Manual e automatizado | Capturas |
| AX-08 | Estados vazio, carregando e erro anunciados | 4.1.3 | NVDA, manual | Nota do testador |
| AX-09 | Autenticação acessível: link ou código colável, sem teste cognitivo | 3.3.8 | Roteiro manual | Registro |

Regra: conformidade WCAG 2.2 AA só pode ser declarada com as evidências AX-01 a AX-09 do SHA declarado (B-36; FA-034). Triagem automatizada não é evidência suficiente sozinha.

### 6.5 Carga leve compatível com o plano gratuito (LT) [PROPOSTA]

Nenhum SLO numérico está definido em 08 ou 11 (N4). Os limiares abaixo são propostas do QA, para o Architect confirmar. Todas as cargas rodam em A1. Não se testa carga contra Supabase Free nem contra Hobby sem autorização. Limite de conexões: 60 diretas e 200 pelo pooler (13).

| ID | Cenário | Parâmetros [PROPOSTA] | Limiar proposto |
|---|---|---|---|
| LT-01 | Leitura de descoberta e de pedido | 20 usuários virtuais por 5 min | p95 de até 500 ms; zero 5xx |
| LT-02 | Rajada de publicação e de login | Acima do limite por conta e por IP | 429 com Retry-After acima do limite; zero 5xx; tempos de resposta de login comparados (anti-enumeração, H-015) |
| LT-03 | Webhook do Mercado Pago em rajada | 100 eventos, 30% duplicados, fora de ordem | Resposta 200 em até 1 s; uma concessão por pagamento |
| LT-04 | E-mail em cota | 110 destinatários simulados no dia UTC | Alertas em 90; comportamento de N-08 |
| LT-05 | Volume sintético | 5 mil pedidos, 20 mil aceites, 100 mil mensagens; contabilidade de Storage de 5 fotos de 0,5 MB por pedido | Consultas quentes com EXPLAIN; tamanho do banco medido contra 500 MB (Free) |

### 6.6 Segurança (SC)

| ID | Verificação | Ferramenta [PROPOSTA] | Limiar |
|---|---|---|---|
| SC-01 | Varredura dinâmica baseline, somente contra A1 | OWASP ZAP baseline | Zero achado alto aberto no M3 |
| SC-02 | Segredos no repositório e no histórico | gitleaks | Zero achado |
| SC-03 | Dependências vulneráveis | OSV-Scanner ou pnpm audit | Zero alto ou crítico aberto (T-14) |
| SC-04 | Cabeçalhos de rotas sensíveis: foto e link com no-store; Referrer-Policy no link | Teste HTTP | Presença confirmada |
| SC-05 | SSRF e redirecionamento em URL fornecida | Scripts (T-10) | Negado |
| SC-06 | Bundle web e admin sem service_role ou segredo | Varredura de bundle (B-06) | Zero ocorrência |

### 6.7 Monitores de invariante (MON)

MON-01 a MON-30 correspondem a I-01 a I-30 (11 §1). Cada monitor é uma consulta SQL que deve retornar zero linhas. Roda ao fim de C-xx e F-xx e diariamente no ambiente de teste (17 §7.5). A lista de consultas ainda não existe; cabe ao DEV ou ao Architect escrevê-las (lacuna N9).

### 6.8 Regras de teste para pagamento e e-mail

- Billing: relógio do banco controlado; fixtures de webhook com assinatura gerada pelo segredo de teste; cenários de replay, fora de ordem e assinatura inválida (T-09; B-05).
- E-mail: Mailpit como único destino; verificar que o destinatário é sintético e que o corpo não contém dado de terceiro (N-01; T-11).

## 7. Evidências exigidas

Base: 17 §5. Nada é dado como executado sem registro. Evidência é artefato verificável no SHA testado.

| Tipo de entrega | Evidência mínima |
|---|---|
| Todo lote | EXEC-ID; SHA testado; data; ambiente (A1 a A7); versões das ferramentas; link do job de CI, quando existir (não inventar); saída da varredura de segredos |
| Matriz preenchida | Para cada caso (QA-FAnn-X e demais IDs): status em um dos valores EXECUTADO-PASSOU, EXECUTADO-FALHOU, NAO EXECUTADO, BLOQUEADO (com motivo e L/TL/BK/B) ou CONDICIONADO (com AMB ou L) |
| Concorrência | Relatório por cenário com número de iterações, violações e distribuição; saída dos monitores MON com zero linhas (17 §5) |
| API | Chamadas diretas com 2xx, 401, 403, 404 (IDOR), 422, retry; prova de que a resposta não contém campos sensíveis (CT-04) |
| Banco | Log de migração do zero e incremental; pgTAP verde; teste de catálogo de RLS; monitores zerados; plano de rollback |
| UI | Saída da varredura de hex vazia; capturas claro e escuro; roteiro de teclado; contraste dos tokens; nota de leitor de tela; estados vazio, erro e carregando |
| Billing | B-01 a B-10 relevantes com relógio controlado; webhook duplicado, fora de ordem e com assinatura inválida; evidência de sandbox, sem chamada de produção |
| E-mail | N-01 a N-10 relevantes com capturas do Mailpit sem PII real; simulação de cota (Q-10, Q-11); prova de ausência de interruptor e de backfill (N-07) |
| Mídia | P-01 a P-06: 6ª foto recusada; Storage sem original; EXIF ausente; dimensões e bytes dentro do teto; URL expira |
| Admin | T-08: sem MFA nega; papel inadequado nega; autoaprovação nega; leitura sem access_case nega; log gerado |
| Segurança | Saídas de SC-01 a SC-06 e varredura de PII em logs de teste (T-11) |
| Carga | Parâmetros, duração, ambiente, limiares e medições de LT-01 a LT-05, com a marca de que os limiares são propostas |
| Recuperação | D-01 e D-02: dump sintético restaurado, migrações aplicadas, monitores zerados, tempo medido contra o RTO proposto (8 h, 09 §9) |
| Pacote L5 (M3) | Reunião de todos os itens acima, com o que falta explicitado; o pacote não declara conformidade por si |
| Spike | Resposta à pergunta do spike, sem recurso de produção criado |

## 8. O que bloqueia o lançamento

### 8.1 Bloqueios jurídicos e de evidência (L1 a L7)

Fonte: 14 §6 e 12-TODO. Estado conforme os documentos; o QA não decide nenhum deles.

| Item | Efeito no QA | Casos afetados | Estado | Quem destrava |
|---|---|---|---|---|
| L1 Retenção e base legal | Testa-se só o mecanismo desligado; nenhum prazo ativo | FA-020; H-091; H-109; H-111; D-08 | [PENDENTE JURÍDICO] | Jurídico |
| L2 Termos, privacidade e encarregado (DPO) | Textos aprovados verificados (B-38) | H-063; H-099; H-111; H-113 | Pendente | Jurídico |
| L3 Reembolso e política de estorno | Teste apenas de bloqueio enquanto L3 estiver pendente | FA-032; H-105 parcial; H-106 | Pendente | Jurídico |
| L4 Certificações de atividades regulamentadas | Caso condicionado | FA-004 (último item); H-038 | Pendente | Jurídico |
| L5 Evidências (WCAG, testes, backup, observabilidade) | Responsabilidade do QA: pacote da §7 e evidências AX-01 a AX-09, D-01, LT | FA-034; H-118; H-121; B-36 | Pendente de execução | Execução |
| L6 Lojas (mobile) | Fora deste plano | H-122; H-124 | Pendente | Usuário (SD-13) |
| L7 Responsabilidade: selo "verificado" e conteúdo | Texto verificado como aprovado ou pendente, sem fixar redação | H-043; H-063; H-113 | Pendente | Jurídico |

### 8.2 Bloqueios técnicos e de decisão (TL-1 a TL-8) [PROPOSTA]

| ID | Condição | Base | Efeito no QA | Estado documental |
|---|---|---|---|---|
| TL-1 | Domínio verificado no Resend antes de qualquer e-mail real | I-27; N-10; H2; decisão 15; BK-10 | Sem envio real; testes só com Mailpit | Inexistente |
| TL-2 | Vercel Pro antes de cobrar | Decisão 28; R-28; B-53 | Teste de bloqueio de cobrança no Hobby | Hobby |
| TL-3 | Backup manual com periodicidade definida e restauração testada | BK-7; 12-TODO #1; R-08; D-01 | D-01 e D-02 obrigatórios antes do M4 | Periodicidade pendente |
| TL-4 | Tarifas do Mercado Pago obtidas | S-03; 12-TODO #12 | Nenhum valor de taxa codificado ou testado como fato | Não obtidas (403) |
| TL-5 | Mapbox: cartão e limite de gasto na conta; termos de produto lidos; BK-2 registrado conforme decisão 36 | Decisões 29 e 36; S-04; H-021; N13 | Teste manual de smoke (A6) só após autorização | BLQ-EXEC |
| TL-6 | Suíte verde no SHA candidato, com CI real e concorrência em N≥100 | H-117; H-121; 17 §5 | Pacote de evidência do M4 | Não iniciada |
| TL-7 | Decisão de geo (PostGIS ou fallback) e de tick (A, B ou C) registrada | S-02; S-10; R-38 | Casos de geo e de tick só valem após a decisão | Não verificado no Free |
| TL-8 | Canal privado do Realtime verificado | S-05; H-070 | T-02 no chat em tempo real depende disso; polling como contingência (F-06) | Não verificado |

## 9. Ferramentas gratuitas sugeridas [PROPOSTA]

Licenças e limites declarados de memória, não verificados nesta fase. Confirmar antes de uso: [NÃO VERIFICADO].

| Ferramenta | Função | Observação |
|---|---|---|
| Vitest ou Jest | Unitário | Verificar licença |
| fast-check | Propriedades e modelo (I-xx) | OSS |
| Playwright e @axe-core/playwright | E2E e triagem de a11y | axe é triagem, não conformidade |
| pgTAP e Supabase CLI | RLS, catálogo e migração | Extensões locais podem diferir do Free (RT-02) |
| Docker | Ambiente A1 e A2 | Licença de uso [NÃO VERIFICADO] (RT-13) |
| Mailpit | Captura de e-mail | Único destino em dev e CI |
| Schemathesis | Contrato de API | OSS |
| k6 | Carga leve | Local apenas |
| OWASP ZAP | Baseline dinâmico | Somente A1 |
| gitleaks; OSV-Scanner ou pnpm audit | Segredos e dependências | Sem achado alto ou crítico (T-14) |
| ExifTool; ripgrep | Metadados de foto; varredura de hex (B-32) | Verificar licença |
| NVDA e navegador | Leitor de tela manual | Exige testador humano (N7) |

## 10. Riscos de teste

| ID | Risco | Mitigação proposta |
|---|---|---|
| RT-01 | Concorrência instável ou falso negativo por timing | Barreiras determinísticas, N≥100, relatório de distribuição |
| RT-02 | Local difere do Free (PostGIS, pg_cron, pg_net, pooler) | Tratar geo e tick como TL-7; marcar casos como condicionados |
| RT-03 | Simuladores de Mapbox, Mercado Pago e Resend divergem da API real | Fixtures versionadas com data de verificação; smoke manual após autorização |
| RT-04 | Formato de x-signature não verificado; fixture pode validar implementação errada | Só gerar fixture após S-03 |
| RT-05 | Resend em modo de teste não confirmado; resend.dev consome cota | Não usar resend.dev em teste |
| RT-06 | Preview na Vercel não alcança Mailpit | E-mail só em A1 e A2 |
| RT-07 | Fixture com aparência de PII real | Dados sintéticos com domínio .test; revisão do lote |
| RT-08 | Triagem de a11y não substitui leitor de tela | FA-034 fica pendente sem AX-02 humano; sem declaração de conformidade |
| RT-09 | Relógio do banco: flakiness em 7 dias, 24 h, 72 h e virada UTC | Mecanismo de relógio definido (N14) |
| RT-10 | Limites de documento inconsistentes (decisões 34 e 35) | Usar 35 e marcar N2 |
| RT-11 | Minutos de CI e limites do Free não verificados; pausa do Supabase após 1 semana | Reduzir N se necessário; keep-alive (H-010) |
| RT-12 | Sem SLO numérico; limiares de LT são propostas | Confirmar com o Architect (N4) |
| RT-13 | Licença de Docker e de ferramentas não verificada | Verificar antes da adoção |
| RT-14 | QA não decide CONCLUIR nem BLOQUEAR | Entregar pacote de evidência; decisão só humana |

## 11. Lacunas e dúvidas

Dúvidas bloqueantes para execução (únicas que devem subir ao Orquestrador):
- B1. Autorização de execução das contas (BK-6, SD-14): sem ela, A3 a A7 não existem; só as camadas A1 e A2 podem rodar. Recomendação: autorizar por spike, na ordem de BK-6.
- B2. Limites de documentos de identidade: decisão 34 (5 arquivos de 5 MB) e decisão 35 (imagem reduzida, PDF até 2 MB) conflitam; H-037 cita a 34 e B-58 cita a 35. Recomendação: usar a 35 e confirmar BK-1. Bloqueia só os casos de documento.
- B3. Sandbox do Mercado Pago em conta Hobby (BK-3). Recomendação: aceitar a opção (a), confirmando que sandbox não é uso comercial. Bloqueia só A5.

Não bloqueantes (registrar e seguir):
- N1. Textos de "sem vaga" e "sem cobertura": decisão 39 aprovou; BK-5 e A-10 ainda pendentes. Usar a decisão 39.
- N2. Limites de documento: ver B2.
- N3. Republicação: decisão 38 (só expirado ou cancelado) versus BK-4 (a mais c). Usar a 38.
- N4. Metas numéricas (LT, limite de descrição, de nome e de mensagem) não definidas. Architect confirma os valores propostos.
- N5. E-mails do próprio Supabase Auth (verificação de e-mail, recuperação) não estão nos casos N-xx; rota de envio ainda não decidida (S-11).
- N6. Comportamento de filtro antifraude indisponível não definido (FA-019). QA assume não publicar sem decisão.
- N7. Teste de leitor de tela e de teclado exige testador humano. Sem ele, FA-034 e L5 ficam pendentes.
- N8. Mobile (M5) sem plano de QA.
- N9. Monitores MON-01 a MON-30 e fixtures de webhook dependem de S-02, S-03 e S-05; não existem consultas escritas.
- N10. Matriz de telas do admin (RF-146) ausente; T-08 depende de AMB-08 A (BK-11).
- N11. Reativação de trial (AMB-09) não definida; caso tratado como condicionado.
- N12. Alguns FA (FA-016, FA-021, FA-024, FA-026) são citados em 15 como teste de si mesmos; este plano cria casos próprios em QA-FAnn-X.
- N13. BK-2 ainda pergunta, mas a decisão 36 aprovou a opção A. Registrar a decisão 36.
- N14. Mecanismo de relógio controlado do banco não especificado (RT-09).

## 12. Próximos passos

1. Orquestrador responde B1 a B3 e registra N1 a N14.
2. Após autorização, executar spikes e camadas A1 e A2 conforme §4.1.
3. Nada executado nesta fase: nenhum EXEC-ID, teste ou SHA é afirmado.

