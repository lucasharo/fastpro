# Refino H-120 — Dados sintéticos de demonstração

- **Issue:** #129 · **História:** H-120 · **Épico:** E15 · **Papel:** Product Owner (WF-03) · **Data:** 2026-11-12
- **Entradas:** `14-BACKLOG.md` (linha H-120), `04-PRD.md` (RF-163), `05-CRITERIOS-ACEITE.md` (cabeçalho), `11-ARQ-RISCOS-E-TESTES.md` §1, `18-PLANO-QA.md` §3.2 (DS-01 a DS-10) e T-11, `11-DECISOES.md`.
- **Etiquetas:** `[DECIDIDO]` vem de fonte aprovada; `[VERIFICADO]` conferido no arquivo; `[PROPOSTA]` deste refino; `[NÃO VERIFICADO]` fora do alcance desta leitura.

## 1. Objetivo

Um conjunto de dados fictícios para demonstrar o produto (cadastro, pedido, aceite e chat de texto) sem nenhum dado real, identificável como sintético por domínio reservado e nomes marcados.

- `[DECIDIDO]` RF-163: dados de teste exclusivamente sintéticos (aprovado). Também `02-ESCOPO-MVP` §5.4.
- `[VERIFICADO]` `11-ARQ-RISCOS-E-TESTES` §1: ambiente de teste local ou efêmero, sem serviço externo real.
- `[NÃO VERIFICADO]` `11-DECISOES.md` não contém regra de dados sintéticos nem o domínio `@example.test` citado no pedido. A única decisão relacionada é a 37 (sandbox do Mercado Pago com dados sintéticos). A regra de domínio está em `18-PLANO-QA` (DS-01 e RT-07, domínio `.test`).

## 2. Fora de escopo

- Catálogo de serviços e grupos: não é recriado aqui. Reutiliza o seed de H-018 (ver dúvida D2).
- Dado real de qualquer origem (cópia de produção, planilha, cadastro real), inclusive para "dar realismo".
- Carga em staging ou produção. Staging só entra por autorização própria (ADR de ambientes, BLQ-EXEC).
- Envio de e-mail: `[DECIDIDO]` regra do projeto, nenhum e-mail é enviado durante o desenvolvimento.
- Mercado Pago, Mapbox e Storage reais para a demo.
- Interface de administração para carregar ou remover (somente script) `[PROPOSTA]`.
- Volume de carga (LT-05, Q-07) e perfis de staff de RBAC (H-102): têm testes próprios.

## 3. Conteúdo criado

Quantidades `[PROPOSTA]`, baseadas em DS-01 a DS-08:

| Item | Quantidade | Regra |
|---|---|---|
| Clientes | 2 (Cliente A e B) | Nomes fictícios; e-mail no domínio `.test` (DS-01) |
| Profissionais aprovados | 8 (P1 a P8) | Documento gerado por script e marcado como fictício (DS-02, DS-05) |
| Profissionais em estados de verificação | 5 (um por estado) | Pendente, em revisão, retida por duplicidade, recusada e suspensa (DS-03) |
| Pedidos | 6 | Um em cada estado de demonstração; lista exata de estados não lida `[NÃO VERIFICADO]` (09) |
| Aceites e chat | 2 aceites, com mensagens de texto e uma mensagem de sistema | Chat somente texto, sem anexo (`[DECIDIDO]` decisões 32 e 33) |
| Fotos | até 2 pedidos com 3 fotos cada | Imagens sólidas geradas por script, **sem** metadados de localização (diferente de DS-08, que injeta GPS para teste) |
| Endereço | "Rua Sintética 000" | Coordenada fictícia, em área comum a todos os perfis da demo (ver D3) |
| Telefone | faixa claramente fictícia | Confirmar que não coincide com número real (DS-06) |

Não entram: perfis de staff (ficam para testes de RBAC), senhas ou credenciais de demo (ver seção 5).

## 4. Onde pode ser carregado

- `[DECIDIDO]` RF-163 e `[VERIFICADO]` 11-ARQ §1: somente banco local ou efêmero.
- `[PROPOSTA]` A carga é um script separado e opt-in. Não entra no `seed.sql` do reset padrão (`19-PLANO-TECNICO-DEV`), para não alterar as contagens dos testes.
- `[PROPOSTA]` O script confere uma variável explícita de ambiente (nome a definir pelo Arquiteto) e recusa qualquer outro valor antes de escrever.
- `[DECIDIDO]` Segredos fora do repositório (decisão 13). A carga não usa chave nem senha versionada.

## 5. Como se remove

- `[PROPOSTA]` Script próprio que apaga apenas os registros marcados como demo e os objetos de Storage com o mesmo marcador. O marcador (identificador fixo reservado ou coluna) é escolha do Arquiteto (ver D5).
- `[PROPOSTA]` Mesma trava de ambiente da carga. Fora do ambiente permitido, nada é apagado.
- `[PROPOSTA]` Remoção total no banco local: `supabase db reset`, que apaga tudo (uso de desenvolvedor).
- `[PROPOSTA]` Idempotente: a segunda execução termina sem erro e sem apagar nada além do marcado.

## 6. Critérios de aceite

Todos `[PROPOSTA]`, derivados de RF-163, T-11, T-13 e DS-01 a DS-08.

- **CA-H120-01 (sem PII real):** Dado a demo carregada, quando a varredura de T-11 roda sobre o conjunto, então não há e-mail fora de `.test`, CPF/CNPJ, telefone ou token que não esteja na lista de exceções de demo (D4). Padrão real reprova o lote.
- **CA-H120-02 (identificável como sintético):** Dado a demo carregada, quando um cliente ou profissional é listado, então nome, e-mail e endereço trazem a marca de sintético (domínio `.test`, "Rua Sintética").
- **CA-H120-03 (ambiente bloqueado):** Dado um ambiente fora do permitido, quando a carga é executada, então ela termina com erro antes de qualquer escrita, e a contagem de linhas permanece igual.
- **CA-H120-04 (contagens):** Dado um banco local vazio, quando a carga roda, então cria exatamente as quantidades da seção 3 e termina com código de saída 0.
- **CA-H120-05 (idempotência):** Dado a carga já feita, quando roda de novo, então as contagens não mudam e não há duplicata.
- **CA-H120-06 (remoção seletiva):** Dado a demo carregada e um registro de teste sem marcador, quando a remoção roda, então apaga só os marcados e o registro sem marcador permanece.
- **CA-H120-07 (remoção sem órfãos):** Dado a remoção executada duas vezes, quando se confere o Storage, então não há objeto de demo restante e a segunda execução não falha.
- **CA-H120-08 (sem segredo):** Dado o repositório, quando a varredura de segredos (T-13) roda, então nenhuma senha ou chave de demo está versionada.
- **CA-H120-09 (sem e-mail):** Dado a carga e os pedidos e aceites criados, quando se confere o provedor de e-mail, então nenhum envio foi feito.
- **CA-H120-10 (origem sintética):** Dado o conjunto final, quando há revisão de lote (RT-07), então nenhum dado foi copiado de fonte real, e a revisão fica registrada na Issue como evidência manual.

## 7. Dependências e impacto

- H-018 (concluída, `[NÃO VERIFICADO]` pelo PO; status não consultado no Project): fornece o catálogo reutilizado.
- H-007 (concluída, `[NÃO VERIFICADO]` pelo PO): base da redação e da varredura de PII.
- T-11 (`18-PLANO-QA` §16): a varredura usa regex com allowlist. A demo depende da lista de exceções (D4).
- H-010 e H-119: exports e restauração com dados sintéticos usam o mesmo conjunto de demo, se o Arquiteto reaproveitar.

## 8. Dúvidas não bloqueantes (com recomendação do PO)

- **D1 (domínio):** o pedido cita `@example.test` em `11-DECISOES`, mas a regra não existe ali. Os docs usam `.test` (DS-01 `sintetico.test`, RT-07). **Recomendação:** `@sintetico.test`, dentro do TLD reservado `.test`.
- **D2 (catálogo):** o pedido lista "serviços e grupos" como conteúdo da demo, mas H-018 já carrega 25 grupos e cerca de 550 serviços `[PROPOSTA]`. **Recomendação:** reutilizar H-018, sem segunda cópia.
- **D3 (coordenada):** DS-07 sugere área sem população (oceano). Nessa coordenada nenhum profissional casaria com o pedido, e a demo não mostra o fluxo. **Recomendação:** uma coordenada fictícia, comum a todos os perfis da demo.
- **D4 (exceções do T-11):** CPF e telefone fictícios podem casar com o padrão da varredura. **Recomendação:** lista explícita de identificadores de demo, sem liberar o padrão em geral.
- **D5 (marcador de remoção):** coluna nova ou identificador fixo. **Recomendação:** identificador fixo reservado, sem alterar o esquema. Decisão do Arquiteto.
- **D6 (carga separada):** **Recomendação:** script opt-in, fora do reset padrão (seção 4).

## 9. Pergunta única para o líder

**P-H120 (número a ser atribuído pelo líder na lista contínua):** a demo fica restrita a banco local ou efêmero, e a carga em staging fica fora do H-120 até autorização própria?
**Recomendação do PO:** sim. Esta pergunta destrava a seção 4 e os critérios CA-H120-03.
