# S-04 — Resultado: Mapbox, termos de produto e armazenamento de geocodificação permanente

- **Issue:** #7 (spike S-04). **Data:** 2026-11-10. **Branch:** `feature/init`. **Papel:** Arquiteto de Software (WF-03 adaptado a spike).
- **Escopo executado:** somente leitura de páginas oficiais da Mapbox. Nenhuma conta, chave ou chamada à API foi criada ou feita.
- **Método:** a ferramenta WebFetch não estava disponível neste agente; as páginas e o PDF foram baixados com `curl` (somente `GET` de URLs oficiais da Mapbox) e convertidos para texto (`pdftotext` para o PDF). Os trechos citados abaixo foram extraídos desse texto.

## Resumo em linguagem simples
Os termos oficiais permitem guardar no banco as coordenadas obtidas com `permanent=true` (US$ 5 por 1.000 consultas, cartão na conta), mas só para uso interno do negócio e com condições se o app as usar para os usuários.
O casamento por raio do FastPro está numa zona cinzenta dessas condições; recomenda-se manter `permanent=true` (decisão 36) e pedir confirmação escrita à Mapbox antes de produção.

## 1. Fontes e data de acesso (todas acessadas em 2026-11-10)

| Fonte | URL | Estado |
|---|---|---|
| Página de termos de produto | https://www.mapbox.com/legal/product-terms | Lida (HTTP 200) |
| PDF "Mapbox Product Terms", **Last Updated: October 20, 2026** | https://cdn.prod.website-files.com/609ed46055e27a02ffc0749b/6ad79764a359d21b46049ea4_Mapbox%20Product%20Terms%20(October%2020%2C%202026).pdf (linkado pela página de termos) | **Lido integralmente (683 linhas de texto)** |
| Documentação de geocodificação (seção "Storing Geocoding Results") | https://docs.mapbox.com/api/search/geocoding/ | Lida |
| Preços | https://www.mapbox.com/pricing | Lida (seções "Temporary Geocoding API" e "Permanent Geocoding API") |

O PDF foi lido; portanto o item "termos de produto (PDF) não lidos" do doc 13, do ADR-008 e do §9.5 do doc 08 deixa de ser NÃO VERIFICADO. Não foram lidos o MSA nem os Terms of Service gerais (https://www.mapbox.com/legal/tos, /legal/msa), referenciados pelos termos de produto: **NÃO VERIFICADO** para o que eles acrescentem.

## 2. O que os termos dizem (Product Terms, §2.7 "Search APIs" e §3 "Definições")

Trechos em inglês, parafraseados em português abaixo.

- **§3.53 Permanent Geocode:** geocódigo obtido com Search API em modo `mapbox.places-permanent` (v5) ou com o parâmetro `permanent` igual a `true` (Geocoding v6). **§3.70 Temporary Geocode:** qualquer geocódigo que não seja Permanent.
- **§2.7.2 Temporários:** "Customer shall not export, store, or cache Temporary Geocodes." Pode exibir (exceto latitude e longitude) e posicionar em mapa.
- **§2.7.3 Permanentes:** "Customer may permanently store Permanent Geocodes and may query the Geocoding API programmatically for Permanent Geocodes." Porém "shall only use Permanent Geocodes for Customer's own internal business use". Exceção: pode usá-los **na aplicação licenciada** se **todas** as condições forem atendidas:
  1. o acesso a geocódigos permanentes **não pode ser recurso principal ou significativo** da aplicação, apenas apoiar recurso acessório ou incidental;
  2. deve haver uma **requisição separada de geocódigo permanente para cada conta de usuário final** que acesse, use ou dependa desse geocódigo "in any way";
  3. a aplicação **não pode permitir** que um usuário final sublicencie, venda, alugue, ceda, **divulgue ou distribua** um geocódigo permanente a outro usuário final ou terceiro;
  4. se os geocódigos permanentes forem exibidos na aplicação, **latitude e longitude não podem ser disponibilizadas** aos usuários finais.
- **§2.7.1 Geral:** proíbe usar resultados de geocodificação para (i) criar base geral de endereços/locais/áreas, (iii) desenvolver ou testar outro geocodificador, e proíbe (a) revender/ressindicar/disponibilizar resultados a outros publicadores ou terceiros e (b) **exibir latitudes ou longitudes diretamente** a usuários finais ou terceiros.
- **§2.7.6:** pode armazenar os Mapbox Feature IDs para uso interno (a Mapbox pode alterá-los sem aviso).
- **§3.31 Licensed Application:** deve "add substantial and independent functionality and value such that the Licensed Application is not a substitute for any Service Offering". O FastPro (marketplace de serviços) cumpre isso com folga.
- **Documentação (geocoding):** "Temporary results are not allowed to be cached, while Permanent results are allowed to be cached and stored indefinitely." Permanente exige **cartão de crédito válido cadastrado ou contrato enterprise ativo**. Padrão é temporário; permanente com `permanent=true`.
- **Página de preços:** "Results from the Permanent Geocoding API are only available for your own personal or business use, and cannot be used for distribution or sublicense." A mesma página, na tabela permanente, diz "If you're interested in using this API, please contact Mapbox sales" (ver risco R4).

**Resposta à pergunta do doc 13 ("guardar no banco conta como armazenar?"):** sim. O texto fala em "permanently store" geocódigos permanentes e proíbe "store/cache" de temporários; gravar a coordenada numa tabela é armazenar. Portanto o desenho do ADR-008 (sugestões temporárias nunca gravadas, coordenada só via `permanent=true`) está correto quanto a armazenar.

## 3. Custos (preço de lista, páginas oficiais, 2026-11-10)

| Produto | Faixa mensal | USD por 1.000 requisições |
|---|---|---|
| Geocodificação **temporária** | até 100.000 | grátis |
| | 100.001 a 500.000 | 0,75 |
| | 500.001 a 1.000.000 | 0,60 |
| | acima de 1.000.000 | 0,45 |
| Geocodificação **permanente** | 1 a 500.000 | **5,00** (sem faixa gratuita) |
| | 500.001 ou mais | 4,00 |
| | acima de 1.000.000 | sob consulta (desconto) |

Consequências: (a) US$ 0,005 por chamada permanente, confirmando a estimativa do §9.5 do doc 08 (≈ US$ 6,50 por 1.000 pedidos, com 1,3 chamadas por pedido); (b) novo fato: o temporário **além de 100.000/mês não é bloqueado, é cobrado** (US$ 0,75/1.000), o que agrava o risco de token público raspado (R3 do ADR-008) se houver cartão na conta, reforçando a necessidade de limite de gasto na conta e restrição de origem. Valores em dólar, sem câmbio, sujeitos a mudança.

## 4. Decisão

**Manter `permanent=true` na revisão do pedido (decisão 36), sem alternativa adotada.** Justificativa: os termos permitem expressamente armazenar permanentes indefinidamente; o plano B do ADR-008 (permanente só na publicação, temporário em memória) não reduz o risco contratual principal (R1 abaixo) e acrescenta fragilidade, por isso continua não adotado. Ajustes de desenho exigidos pelos termos, a refletir no ADR-008 e no §9.5:

1. **Latitude e longitude nunca chegam ao navegador nem a profissionais**, em nenhuma resposta de API, log voltado ao usuário ou exportação (§2.7.1b e §2.7.3 iv). A UI mostra só rótulo textual, como já previsto.
2. **Nenhuma coordenada é compartilhada entre usuários.** O profissional recebe resultado de casamento (sim/não, rótulo), nunca o `exact_point`; o `match_point` (célula de 500 m) é interno (§2.7.3 iii).
3. **Uma requisição permanente por conta que depende do geocódigo:** o cliente tem a sua (revisão do pedido); o profissional tem a sua (`base_point`, uma por cadastro/alteração), já previstas. Não reutilizar a coordenada de um usuário para outro.
4. **Não montar base geral de endereços** (§2.7.1 i): a tabela de pedidos guarda a coordenada de cada pedido apenas; sem catálogo, sem revenda, sem exportação a terceiros.
5. Não guardar nada vindo de chamada temporária (inclui o `mapbox_id`/coordenadas das sugestões do autocomplete), exceto, se necessário, o Feature ID (§2.7.6).

## 5. Impacto em H-021 (#34) e demais histórias

- **H-021 (#34):** o critério "exatamente uma chamada `permanent=true` por revisão; nenhuma coordenada em resposta ao cliente" ganha respaldo; acrescentar teste de contrato "nenhuma resposta de API contém latitude/longitude do pedido ou da base" (se ainda não coberto por G-02 a G-06). O bloqueio S-04 de H-021 pode ser considerado **resolvido para desenvolvimento**; permanece **BLQ-EXEC** (cartão e limite de gasto na conta) para o smoke real A6, e recomenda-se a confirmação escrita do R1 antes de produção.
- **H-020 (#33):** confirmado que o autocomplete temporário não pode gravar nada (cache, rascunho, log); mantém-se como especificado.
- **H-022 (#35) e H-036 (#49):** `match_point` e `base_point` são derivados de geocódigo permanente; devem permanecer internos (item 2 da seção 4).
- **Doc 11 (linha S-04), doc 14 (S-04, H-020, H-021), doc 13 e ADR-008:** atualizar "PDF não lido" para "lido em 2026-11-10, ver S-04-RESULTADO" (a cargo do Orquestrador).

## 6. Riscos

| ID | Risco | Gravidade | Mitigação |
|---|---|---|---|
| R1 | **Zona cinzenta do uso no casamento.** §2.7.3 limita o uso na aplicação a recurso "acessório ou incidental", exige requisição separada "por conta que depende do geocódigo" e proíbe divulgação a outros usuários. O casamento por raio é central ao FastPro e a coordenada do cliente influencia o que o profissional vê. Pode-se argumentar que é "internal business use" (processamento interno, sem divulgar coordenada), mas é interpretação nossa **[NÃO VERIFICADO com a Mapbox]** | Média a alta (contratual, pode levar a suspensão) | Manter coordenadas internas (seção 4); **perguntar por escrito à Mapbox** (suporte ou vendas) se o casamento interno de pedidos e profissionais por raio com geocódigos permanentes é uso permitido; arquivar a resposta. Plano C se negado: outro geocodificador (muda a stack, decisão 29) |
| R2 | Termos podem mudar (versão atual de 20/10/2026); o §2.7.6 diz que Feature IDs mudam sem aviso | Baixa | Reler os termos antes do GO de produção; não depender de Feature ID |
| R3 | Temporário acima de 100.000/mês é cobrado (US$ 0,75/1.000) e o token público pode ser raspado | Média | Restrição de token por origem, limites de uso, limite de gasto na conta (já previsto no §9.5) |
| R4 | Página de preços diz "contact Mapbox sales" para a API permanente, enquanto a documentação diz que cartão cadastrado basta; pode haver aprovação comercial adicional | Baixa a média | Confirmar na criação da conta (execução, BLQ-EXEC); sem conta criada neste spike |
| R5 | MSA e Terms of Service gerais não lidos | Baixa | Ler antes de produção |
| R6 | Custo variável desde o primeiro pedido (sem faixa gratuita) | Baixa (≈ US$ 0,005 por chamada) | Circuit breaker e teto de 3 chamadas por rascunho, já no desenho |

## 7. Dúvidas para o Orquestrador

1. **O usuário aceita pedir à Mapbox confirmação escrita sobre o uso no casamento por raio (R1) antes da produção?** Alternativas: (a) sim, antes do GO de produção, sem bloquear o desenvolvimento; (b) sim, antes de iniciar H-021; (c) não perguntar e assumir "uso interno". **Recomendação: (a).**
2. **Atualizar ADR-008 e §9.5 do doc 08 agora com a seção 4 deste resultado?** Alternativas: (a) sim, agora; (b) só no fechamento da Onda 0. **Recomendação: (a)**, por ser mudança de baixo impacto que registra restrições obrigatórias.

## 8. Não verificado

- Interpretação da Mapbox sobre R1 (nenhum contato feito).
- MSA e Terms of Service gerais.
- Comportamento real da API (formato de resposta com `permanent=true`, rate limit): exige conta e chave, fora do escopo (smoke A6, BLQ-EXEC).
