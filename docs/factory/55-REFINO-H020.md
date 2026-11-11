# FastPro — Refino H-020 (Issue #33): autocomplete de endereço Mapbox temporário

- **Issue:** #33 (H-020, "[E2] Autocomplete de endereço Mapbox temporário") · **Workflow:** WF-03 (refinamento) · **Coluna:** Product Owner · **Data:** 2026-11-11 · **Papel:** Product Owner
- **Natureza:** somente documento. Nenhum código, teste, commit ou push foi feito neste refinamento. Nenhum arquivo de outra Issue foi alterado.
- **Fontes:** `14-BACKLOG` (H-020, H-021, H-025, §6), `04-PRD` (RF-010, RF-012, RF-013, RF-019), `05-CRITERIOS-ACEITE` (FA-001, FA-007), `10-ADRS` (ADR-008, ADR-013, ADR-014), `11-DECISOES` (decisões 29 e 36), `13-VERIFICACAO-SERVICOS` (Mapbox), `spikes/S-04-RESULTADO` (§2, §3, §4, §7). `07-AMBIGUIDADES`: não há AMB aberta sobre Mapbox.
- **Etiquetas:** `[APROVADO]` decisão do usuário ou requisito aprovado · `[DELEGADO]` adotado por delegação · `[PROPOSTA]` número, texto ou premissa deste refinamento.

## 1. Contexto

H-020 entrega a sugestão de endereço no campo "local" do pedido (RF-010). A sugestão é temporária: o texto escolhido pelo cliente é gravado; a sugestão e a coordenada dela não são (ADR-008; S-04 §2.7.2 e §4). A coordenada permanente é H-021 (#34).

Fatos de base (S-04, concluído em 2026-11-10): resultado temporário não pode ser exportado, armazenado nem cacheado. Assim, a condição S-04 de H-020 no backlog (§6, BLQ-SPK) fica resolvida para este escopo.

Premissa de custo: a cota temporária é de 100.000 consultas por mês sem cobrança. Acima disso a Mapbox cobra (US$ 0,75 por 1.000, S-04 §3), e cada tecla digitada conta como consulta (`13-VERIFICACAO-SERVICOS`). Como não há orçamento, o teto interno precisa ser respeitado antes de a cobrança ocorrer.

## 2. Critérios de aceite (Given/When/Then)

**Uso somente no rascunho**
- **CA-01 [APROVADO]** (RF-010, RF-012) Dado um pedido em rascunho, inclusive antes da identificação por link e na revisão antes da publicação, quando o cliente digita no campo local, então recebe sugestões de endereço.
- **CA-02 [APROVADO]** (ADR-008) Dado um pedido que não está em rascunho (publicado, selecionado, cancelado, concluído ou expirado), quando alguém abre o pedido, então não há campo de busca de endereço e nenhuma consulta ao serviço externo é feita.

**Sem armazenar coordenada**
- **CA-03 [APROVADO]** (ADR-008; S-04 §4, itens 1 e 5) Dado que o cliente escolheu uma sugestão, quando o rascunho é salvo, então ele guarda somente o texto escolhido. Não guarda latitude, longitude, identificador da sugestão nem a resposta do serviço. O identificador do resultado (Feature ID) também não é gravado nesta história `[PROPOSTA]`.
- **CA-04 [APROVADO]** (S-04 §2.7.2) Dado uma sugestão exibida, quando a tela é inspecionada, então não aparecem latitude nem longitude; só o texto do endereço.
- **CA-05 [PROPOSTA]** (leitura conservadora de S-04 §2.7.2) Dado o menu de sugestões aberto, quando o cliente escolhe uma opção, fecha o menu ou limpa o campo, então as sugestões são descartadas. Não há cache de resposta no servidor nem armazenamento persistente no navegador.
- **CA-06 [APROVADO]** (RF-010; S-04 §4) Dado que o cliente digitou o endereço sem escolher sugestão, quando salva o rascunho, então o texto é gravado sem coordenada. A coordenada é obtida somente em H-021, na revisão do pedido.

**Limites de chamadas**
- **CA-07 [PROPOSTA]** Dado o campo local, quando o cliente digita, então a consulta só ocorre com pelo menos 3 caracteres e após 300 ms sem nova tecla (debounce). Teclas intermediárias não geram consulta.
- **CA-08 [PROPOSTA]** Dado o contador mensal de consultas temporárias, quando chega a 70.000, então a equipe recebe alerta; quando chega a 95.000, então o autocomplete é desligado até o mês seguinte e o campo passa a aceitar só texto, sem erro para o cliente. O teto fica abaixo de 100.000 para que nunca haja cobrança.
- **CA-09 [PROPOSTA]** Dado um visitante ou rascunho, quando envia mais de 30 consultas em 1 minuto, então as excedentes não chegam ao serviço externo e o campo fica em texto livre por 1 minuto, sem erro exibido.

**Tratamento de erro**
- **CA-10 [APROVADO]** (RF-010) Dado uma falha do serviço (tempo esgotado, erro de servidor, chave ou origem recusada, cota atingida), quando o cliente digita, então o campo continua aceitando texto, aparece mensagem neutra ("Não foi possível sugerir endereços agora. Digite o endereço normalmente.") e o envio do pedido não é bloqueado.
- **CA-11 [PROPOSTA]** Dado uma falha, quando ocorre, então não há nova tentativa automática em sequência. A próxima consulta depende de nova digitação e respeita CA-07 a CA-09.

**Privacidade e logs**
- **CA-12 [APROVADO]** (ADR-013; H-007; RF-013) Dado qualquer log, métrica, registro de erro ou rastreamento gerado pelo fluxo de endereço, quando inspecionado, então não contém texto digitado, sugestão, endereço, latitude, longitude nem resposta do serviço. Permitidos: contagem, código de estado, duração e identificador pseudônimo do rascunho.
- **CA-13 [PROPOSTA]** Dado um teste automatizado de logs (T-11), quando um endereço sintético é digitado em um fluxo de erro, então o teste reprova se o endereço aparecer em qualquer log.

**Configuração do token**
- **CA-14 [PROPOSTA]** (ADR-008, risco 3) Dado o token público de desenvolvimento, quando verificado no painel do Mapbox, então tem restrição às origens de desenvolvimento e de produção, e a nenhuma outra. A redação final depende da dúvida 2 abaixo.

## 3. Fora de escopo

- Coordenada permanente (`permanent=true`), uma chamada por revisão, teto de 3 por rascunho, disjuntor de gasto e marcação do modo de geocodificação: **H-021 (#34)**. A decisão 36 (A) [APROVADO] já confirma a chamada paga na revisão do pedido.
- Casamento por célula e ponto de casamento: **H-022 (#35)**.
- Mapa visível, pino ou mapa interativo: fora de H-020. A UI pública não mostra pino (ADR-008).
- Campo de endereço no cadastro do profissional (base de raio): **H-036 (#49)**, ver dúvida 4.
- Cache de respostas, base própria de endereços e gravação do Feature ID: proibidos ou fora de escopo (S-04 §2.7.1 e §4).

## 4. Dúvidas ao Orquestrador (líder)

Sem numeração própria. O líder consolida na lista única da sessão e renumera de forma contínua.

1. **Conta Mapbox e token de desenvolvimento (fato NÃO VERIFICADO).** Não foi possível verificar: esta sessão não tem ferramenta de shell nem de GitHub; as ferramentas do servidor Mapbox citadas nas instruções não estão carregadas; o arquivo de ambiente local não foi lido, por instrução. Os documentos não registram a conta como criada: `12-TODO` #9 (cartão e limite de gasto) está pendente e a criação de conta é BLQ-EXEC. Recomendação: confirmar a existência pela planilha de chaves do Drive (somente nomes e ambiente) ou pela listagem de tokens do Mapbox, sem valores, e registrar como fato. Para H-020, S-04 §3 indica que a consulta temporária não exige cartão; o cartão é exigido só para o permanente (H-021). Não bloqueia a escrita dos critérios.

2. **Chamada direta do navegador ou proxy no servidor.** Decide se CA-08, CA-09 e CA-14 são aplicáveis como escritos.
   - (a) Proxy no servidor: o servidor conta e limita antes de chamar o Mapbox e o token fica fora do navegador. Custo: cada tecla passa pelo servidor (função serverless, ADR-018).
   - (b) Chamada direta do navegador com token restrito por origem: o servidor não vê as consultas e não consegue contar a cota. O controle ficaria só no alerta manual, pois o limite de gasto da conta não se aplica ao temporário.
   - Recomendação: (a), a confirmar pelo Architect, por ser o único jeito de cumprir o teto sem orçamento. Destrava: CA-08, CA-09 e CA-14.

3. **Valores numéricos** (3 caracteres, 300 ms de debounce, 30 consultas por minuto, alertas em 70.000 e 95.000). São [PROPOSTA] do PO; o Architect ajusta. Não bloqueante.

4. **Escopo do campo de endereço no perfil do profissional.** Alternativas: (a) H-020 cobre o pedido e a base do profissional usa o mesmo componente em H-036; (b) H-020 cobre só o pedido. Recomendação: (a), para não criar dois campos. Não bloqueante para H-020.

5. **Decisão 36 e BK-2.** A decisão 36 (A) confirmou a chamada permanente na revisão do pedido, o que parece fechar BK-2 e o achado A-3 de `14-BACKLOG`. Confirmar o registro. Não bloqueante para H-020; relevante para H-021.

6. **Feature ID.** Adotado: não gravar (CA-03). Alternativa: gravar para uso interno (S-04 §2.7.6). Recomendação: não gravar. Não bloqueante.

7. **Pendência de S-04 (§7, dúvida 1).** A confirmação escrita da Mapbox sobre o casamento por raio segue sem resposta registrada. Não bloqueia H-020 (só temporário); deve ser resolvida antes de H-021 e da produção.

## 5. Estado da entrega

- Verificação: leitura dos documentos listados acima. Nenhum teste ou build (documento).
- Coluna do GitHub Project: não consultada (sem ferramenta de GitHub nesta sessão). Coluna Product Owner informada pelo Orquestrador.
- Commit e push: **não executados**. Esta sessão não tem ferramenta de shell. Mensagem proposta: `docs(H-020): refino do autocomplete de endereço temporário`, com corpo `Refs: #33` e os trailers `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_01A8KvVP1ECgDzoXA3WLyBux`.
