# FastPro — Refino H-018 (Issue #31): catálogo com seed de 25 grupos

- **Issue:** #31 (H-018, "[E2] Catálogo com seed de 25 grupos [PROPOSTA]") · **Workflow:** WF-03 (refinamento) · **Coluna:** Product Owner · **Data:** 2026-11-11 · **Papel:** Product Owner
- **Natureza:** somente documento. Nenhum código, teste, commit, push ou alteração no GitHub. Nenhum arquivo de outra Issue foi alterado.
- **Fontes:** `14-BACKLOG` (H-018, E2), `04-PRD` (RF-001, RF-002, RF-003, RF-004, RF-047, RF-153, RF-154), `05-CRITERIOS-ACEITE` (FA-001, FA-004), `07-AMBIGUIDADES` (AMB-08), `11-DECISOES` (D2), `08-ARQUITETURA` (módulo `catalog`), `09-MODELO-DADOS` (service_group, service, service_synonym), `10-ADRS` (ADR-002, ADR-017), `06-CATALOGO-PROPOSTO` (conteúdo).
- **Etiquetas:** `[APROVADO]` decisão do usuário · `[DELEGADO]` adotado por delegação · `[PROPOSTA]` premissa ou texto deste refinamento.

## 1. Contexto

H-018 entrega a semente do catálogo: 25 grupos de serviço e os serviços e sinônimos de cada um. O conteúdo é [PROPOSTA] (D2: os 10 grupos originais não foram recebidos). Se os originais chegarem, a semente é reagrupada sob eles (`06`, nota 1), sem renomear em silêncio.

Modelo de referência (`09`): `service_group(id, name, position, active)`; `service(id, group_id, name, modality, regulated, active)`; `service_synonym(service_id, term)`.

Mapeamento das marcas de `06`: PR = presencial; ON = online; HI = ambos; REG = regulamentado. REG? e SENS: ver dúvidas.

Grupos da semente (ordem de exibição G01 a G25, [PROPOSTA]):
G01 Reformas e construção · G02 Elétrica, hidráulica e gás · G03 Casa, manutenção e serviços domésticos · G04 Climatização, eletrodomésticos e eletrônicos · G05 Segurança, portaria e cuidados com o imóvel · G06 Beleza e estética · G07 Saúde e bem-estar · G08 Aulas, educação e idiomas · G09 Tecnologia e informática · G10 Design, marketing e comunicação · G11 Eventos e festas · G12 Pets · G13 Jurídico · G14 Contábil, financeiro e administrativo · G15 Automotivo · G16 Transporte, entregas e logística · G17 Alimentação e gastronomia · G18 Moda, costura e artesanato · G19 Agro, rural e meio ambiente · G20 Indústria, comércio e manutenção industrial · G21 Imóveis e hospedagem · G22 Arte, entretenimento e cultura · G23 Cuidados pessoais e família · G24 Empresas e serviços corporativos · G25 Outros serviços

## 2. Critérios de aceite (Given/When/Then)

**Semente e estrutura**
- **CA-01 [PROPOSTA]** Dado o banco local com migrações e semente aplicadas, quando os grupos são lidos, então existem exatamente 25 grupos, cada um com nome não vazio e único, na ordem G01 a G25.
- **CA-02 [PROPOSTA]** Dado um grupo da semente, quando consultado, então tem nome, status ativo (`active = true`) e vínculo com seus serviços. Todo grupo ativo tem ao menos um serviço ativo.
- **CA-03 [PROPOSTA]** Dado um serviço da semente, quando consultado, então pertence a exatamente um grupo, tem modalidade (presencial, online ou ambos) e marca de regulamentado. Os sinônimos ficam ligados ao serviço.
- **CA-04 [PROPOSTA]** Dado que a semente já foi aplicada e um administrador alterou um nome ou desativou um grupo, quando a semente roda de novo, então não há duplicata e a alteração do administrador é preservada.

**Leitura pública**
- **CA-05 [APROVADO]** Dado um visitante sem conta e sem sessão, quando lista as categorias, então recebe os grupos ativos com nome e os serviços ativos com modalidade e marca de regulamentado, sem pedir login (RF-001, FA-001).
- **CA-06 [PROPOSTA]** Dado um grupo desativado, quando o visitante lista, então o grupo não aparece, nem seus serviços.
- **CA-07 [PROPOSTA]** Dado a resposta da leitura pública, quando inspecionada, então não traz campos internos (auditoria, identificador de administrador, colunas de outras tabelas).

**Alteração**
- **CA-08 [APROVADO]** Dado uma pessoa sem papel de administrador (visitante, cliente ou profissional), quando tenta criar, alterar ou desativar grupo, serviço ou sinônimo pela interface ou pela API direta, então a operação é negada e nada muda (RF-003, RF-153). Sem sessão: 401; com sessão sem papel: 403 [PROPOSTA, mesma regra de H-102].
- **CA-09 [PROPOSTA]** Dado o papel de catálogo do administrador com verificação em dois fatores (aal2), quando cria, altera ou desativa um item, então a mudança gera registro de auditoria com ator, objeto, valor anterior e posterior, data e hora (RF-154, RF-153, H-107).
- **CA-10 [PROPOSTA]** Dado as tabelas do catálogo, quando verificadas no banco, então têm RLS habilitada e forçada, e papéis sem permissão de escrita não alteram nenhuma linha (H-003, ADR-002).

**Flags**
- **CA-11 [APROVADO]** Dado um serviço ON, PR ou HI da semente, quando consultado, então a modalidade persistida é online, presencial ou ambos, respectivamente (RF-003; online sem raio, RF-004 [DELEGADO]).
- **CA-12 [APROVADO]** Dado um serviço marcado como regulamentado, quando consultado, então a marca fica persistida, e o cadastro de profissional exige certificação para esse serviço (RF-047). A verificação do conteúdo da certificação segue [PENDENTE JURÍDICO] L4 (H-038).

## 3. Fora de escopo

- Autocomplete de serviço e sinônimos, sem acento e sem diferença de caixa: H-019 (RF-002). Aqui os sinônimos são apenas carregados.
- Cobertura geográfica e raio de atendimento: E2 posterior (H-023, H-024; RF-004, RF-051).
- Tela de gestão do catálogo no administrativo: H-107. Este refinamento cobre só as regras de permissão e auditoria.
- Parecer jurídico sobre as marcas regulamentadas (L4) e lista de serviços proibidos (`06`, nota 6).
- Layout da navegação pública: não consta no H-018. CA-05 é verificado no contrato de leitura (ver dúvida 9).

## 4. Dúvidas ao Orquestrador (líder)

Sem numeração própria. O líder consolida na lista única da sessão.

1. **BLOQUEADOR (aceite do conteúdo de H-018).** A lista de 25 grupos e os cerca de 550 serviços é [PROPOSTA] (`06`; D2 em `11-DECISOES`: "sujeito a validação posterior do usuário"). Decisão do usuário: (a) aprovar os 25 grupos como estão; (b) aprovar com ajuste de nomes ou agrupamento, indicando quais; (c) enviar os 10 grupos originais, que prevalecem e reorganizam a semente. Recomendação do PO: (a) ou (b). Destrava: marcar H-018 como [APROVADO] e fixar o conteúdo final. Não impede a modelagem nem a implementação com a semente marcada como provisória.
2. **Marcas REG? e itens de conselho profissional.** `06` usa REG? (pode ser regulamentado) e marca REG em saúde, jurídico, contábil, estética avançada e outros, com possível restrição de publicidade (CFM, OAB, CFP; `06`, nota 2). Decisão do usuário, com parecer L4: (a) REG? vira regulamentado até o parecer (conservador; exige certificação e pode travar cadastros); ou (b) REG? fica não regulamentado até o parecer; e os serviços de conselho profissional entram inativos até o parecer L4. Recomendação do PO: (a) e inativos até L4. Destrava: publicação desses itens.
3. **Marca SENS sem campo no modelo.** `06` e H-018 citam SENS, mas `09` só tem modalidade e regulamentado. Decisão do Architect: incluir campo `sensitive` em `service` ou tratar SENS só como política de moderação. Não bloqueia H-018 se a marca ficar fora da semente.
4. **Definição de "vínculo" (H-018).** Adotado: `service.group_id` obrigatório e grupo ativo com ao menos um serviço ativo (CA-02, CA-03). Confirmar com o líder. Não bloqueante.
5. **Serviço em mais de um grupo.** `06`, nota 7, fala em um item com vários grupos. `09` define `group_id` único. Recomendação do PO: um grupo por serviço, e referências cruzadas viram sinônimos. Decisão do Architect. Não bloqueante.
6. **Papel de administrador do catálogo.** AMB-08 é [PROPOSTA]. Assumi o Superadmin para gestão de catálogo (CA-08, CA-09). Confirmar no lote de decisões sobre AMB-08. Não bloqueante.
7. **Volume de serviços.** "Cerca de 550" é estimativa não contada (`06`, resumo). O DEV conta a semente final e registra a contagem real; o aceite fixa a contagem medida, não o número estimado. Não bloqueante.
8. **Teste de semente.** A semente é conteúdo do produto, não dado de teste; RF-163 (dados sintéticos) não se aplica a ela. Confirmar. Não bloqueante.
9. **Layout da navegação pública.** Confirmar se a tela de navegação entra no #31 ou em outra Issue de interface. Não bloqueante.

## 5. Estado da entrega

- Verificação feita: os títulos G01 a G25 em `06` foram conferidos (25 grupos).
- Nenhum teste ou build foi executado (documento).
- Coluna do GitHub Project: não consultada, pois `gh` estava proibido por instrução e não há ferramenta de GitHub nesta sessão. Coluna Product Owner informada pelo Orquestrador.
- Commit e push: não executados. Esta sessão não tem ferramenta de shell. Mensagem proposta: `docs(H-018): refino do catálogo com seed de 25 grupos` com corpo `Refs: #31`, mais os trailers `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_01A8KvVP1ECgDzoXA3WLyBux`.
