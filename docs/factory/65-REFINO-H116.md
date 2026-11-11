# Refino de Product Owner — #125 (H-116) Testes de injeção e abuso

Data: 2026-11-11 · Workflow: WF-03 (Product Owner) · Fonte: `docs/factory/14-BACKLOG.md` (H-116), `docs/factory/11-ARQ-RISCOS-E-TESTES.md` (T-10), `docs/factory/18-PLANO-QA.md` (camada 9, Segurança).

## Objetivo

Provar, com testes automatizados e executados localmente, que a API e as páginas do FastPro não aceitam entradas maliciosas nas superfícies de escrita e de leitura de conteúdo do usuário: injeção de SQL, XSS armazenado, nome de arquivo malicioso, SSRF em URL fornecida, redirecionamento aberto e CSRF em rotas que mudam estado.

## Escopo (o que a Issue cobre)

Cada item vira um ou mais testes com evidência de saída:

1. **SQL**: parâmetros de texto livre (busca de serviço, descrição, mensagem, filtros de auditoria) com cargas clássicas (`' OR 1=1 --`, `"; DROP`, aspas e barras invertidas). Esperado: resposta 4xx ou dado tratado como texto; nenhuma linha extra, nenhum erro de banco exposto.
2. **XSS armazenado**: descrição de pedido, mensagem de chat e comentário (quando existir) com `<script>`, `<img onerror>` e `javascript:`. Esperado: o conteúdo volta escapado na resposta e na renderização; nenhuma tag executável.
3. **Upload malicioso**: nome de arquivo com `../`, nulo, caminhos absolutos, dupla extensão (`foto.jpg.html`) e arquivo com extensão de imagem mas conteúdo de outro tipo. Esperado: recusa ou nome neutro; nunca o nome original em caminho de armazenamento.
4. **SSRF**: qualquer campo que aceite URL (quando houver) com `http://127.0.0.1`, `http://169.254.169.254`, `http://localhost`, endereços privados e esquemas `file:`/`gopher:`. Esperado: recusa antes de qualquer requisição de saída. Se nenhuma rota aceitar URL na data do teste, o teste registra "não aplicável" com o motivo, sem passar em silêncio.
5. **Redirecionamento aberto**: parâmetros de retorno (`next`, `redirect`, `return_to`) com domínio externo. Esperado: recusa ou destino interno.
6. **CSRF**: rotas que mudam estado (POST, PUT, PATCH, DELETE) chamadas sem cookie de origem válida ou com `Origin` de outro domínio. Esperado: recusa (403 ou 404 conforme a guarda já existente, sem efeito).

## Critérios de aceite

- CA-1: cada categoria acima tem ao menos um teste automatizado que roda com `corepack pnpm test` ou com a suíte da API, sem rede externa.
- CA-2: nenhum teste depende de conta real, chave de produção ou envio de e-mail.
- CA-3: se um teste encontrar vulnerabilidade real, a Issue **não** é fechada como concluída: o achado é registrado na Issue com a categoria, o arquivo e a carga usada, e a correção segue como Issue própria ou como ciclo de correção (máximo 2 ciclos, regra da fábrica).
- CA-4: a entrega registra a saída do comando (nome da suíte, número de testes, código de saída) como evidência local.

## Fora de escopo

- Teste de penetração manual ou ferramenta de varredura externa (ZAP entra na camada 9 do plano de QA, não nesta Issue).
- Correção de vulnerabilidades encontradas (vira Issue própria).
- Testes de carga e de concorrência (H-117, outra Issue).

## Decisões de produto tomadas por recomendação (registradas para o líder)

- P-1: testes ficam no pacote da API (`packages/api/tests`), que já roda na suíte local. Recomendação: sem novo pacote.
- P-2: categorias sem superfície hoje (SSRF, redirecionamento, upload se a rota ainda não existir) são registradas como "não aplicável" com motivo, e não omitidas.
- P-3: nenhuma pergunta ao usuário é necessária para esta Issue; ela não gera custo nem usa serviço pago.

## Riscos

- Falso positivo por varredura textual (já ocorreu com `#número` em comentário no `check:hex`): os testes checam resposta e efeito, não o texto da carga.
- Testes lentos no Windows: usar timeout explícito de 30 s quando envolver processo filho ou git.
