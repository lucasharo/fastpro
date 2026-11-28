# H-026 — Refino: upload de fotos em quarentena

- **Issue:** #39 "[E3] Upload de fotos em quarentena" · **Backlog:** H-026
- **Etapa:** specification · **Data:** 2026-11-12 · **Papel:** Product Owner · **Status:** refino para validação do líder
- **Etiquetas:** `[DECIDIDO]` aprovado nos documentos (PRD, decisões, critérios) · `[VERIFICADO]` conferido em documento de arquitetura, QA ou backlog, sem decisão de produto · `[PROPOSTA]` sugestão do PO, a validar · `[NÃO VERIFICADO]` sem fonte ou depende de decisão em aberto
- **Fontes lidas:** 14-BACKLOG (E3, H-026 e dependentes H-027, H-029, H-037; H-005, H-025); 16-MANIFESTO-ISSUES e 21-ISSUES-CRIADAS (H-026 = #39); 04-PRD (bloco de fotos RF-025 a RF-030; o PRD não usa o rótulo "E3", que vem do backlog); 05-CRITERIOS-ACEITE (FA-001, FA-007, FA-008, FA-027); 11-DECISOES (decisões 30 a 33); 11-ARQ-RISCOS-E-TESTES (I-29, §2.2, P-01 a P-02, F-09, T-02, T-10, T-11, RC-09, H-110); 08-ARQUITETURA §10.1 a §10.4; 09-MODELO-DADOS (`media_asset`, RC-09); 74-DESENHO-H025 (`media_asset(draft_id)` fica para H-026; nonce do rascunho); 71-REFINO-H025 (padrão deste documento).

## 1. Objetivo

Permitir que o visitante, dentro do próprio rascunho de pedido (H-025), envie até 5 fotos que ficam guardadas em área de quarentena, sem leitura por ninguém, com URL de upload de uso único. Reenviar a mesma foto não duplica. `[DECIDIDO]` RF-025, FA-001 (decisão 30); `[VERIFICADO]` 08 §10.2 passos 1 e 2.

Esta história entrega só o recebimento e a quarentena. Não reduz tamanho, não remove EXIF, não detecta tipo pelo conteúdo, não exibe, não publica. Esses itens ficam em H-027 a H-029 (ver §5).

## 2. O que o visitante faz

| Passo | O que acontece | Origem |
|---|---|---|
| 1. Pedir envio | A API cria um registro de foto `pending` ligado ao rascunho e devolve URL de upload de uso único para a quarentena | `[VERIFICADO]` 08 §10.2 (1); 11-ARQ §2.2 (`POST /media/uploads`) |
| 2. Enviar o arquivo | O navegador envia o arquivo direto à quarentena pela URL recebida | `[VERIFICADO]` 08 §10.2 (2); 11-ARQ §2.2 (`PUT URL`) |
| 3. Confirmar | O cliente chama a confirmação (`finalize`) do registro; a confirmação é idempotente | `[VERIFICADO]` 11-ARQ §2.2 (`POST /media/{id}/finalize`) |
| 4. Limite | A 6ª foto do rascunho é recusada com 422 `photo_limit` | `[DECIDIDO]` RF-025; `[VERIFICADO]` I-29, P-01 |

- Entrada: JPG, PNG e WebP, até 10 MB cada. `[DECIDIDO]` FA-001. HEIC fica em aberto (D-H026-3).
- Nenhuma tela pede senha nem dado pessoal para enviar foto. `[DECIDIDO]` FA-001, RF-012.
- Fotos extras não têm canal na plataforma; só WhatsApp, com autorização do cliente. `[DECIDIDO]` RF-025a; decisão 30.

## 3. Estados do arquivo

Estados previstos em `media_asset`: `pending`, `ready`, `rejected`. `[VERIFICADO]` 08 §10.2 (1) e (4).

| De | Para | Gatilho | Marcação |
|---|---|---|---|
| (criação) | `pending` | API emite a URL de upload | `[VERIFICADO]` 08 §10.2 (1) |
| `pending` | `pending` com confirmação registrada | Cliente confirma o envio (`finalize`) | `[PROPOSTA]` (D-H026-2) |
| `pending` | removido | Prazo do pendente vence sem confirmação | `[VERIFICADO]` F-09; prazo `[NÃO VERIFICADO]` (D-H026-4) |
| `pending` ou confirmado | removido | Rascunho descartado (expurgo) | `[VERIFICADO]` RC-09, H-110 |
| `pending` | `ready` ou `rejected` | Processamento | `[VERIFICADO]` 08 §10.2 (4); fora de H-026 (H-027, H-028) |

- Um arquivo em quarentena nunca tem estado de leitura para usuário. `[VERIFICADO]` 08 §10.1.

## 4. Critérios de aceite (Given/When/Then)

- **CA-01 Envio ao rascunho.** Dado um visitante com rascunho válido (nonce do navegador) e menos de 5 fotos, quando pede o envio de uma foto JPG, PNG ou WebP de até 10 MB, então recebe URL de upload de uso único para a quarentena e um registro `pending` ligado ao rascunho; nenhuma tela pede senha. `[DECIDIDO]` RF-025, FA-001; `[VERIFICADO]` 08 §10.2 (1), 11-ARQ §2.2.

- **CA-02 Sexta foto recusada.** Dado um rascunho com 5 fotos, quando o visitante pede a 6ª, então a API responde 422 `photo_limit` antes de emitir URL, nada é gravado e as 5 fotos anteriores permanecem intactas. `[DECIDIDO]` RF-025; `[VERIFICADO]` I-29, P-01, 14-BACKLOG (H-026).

- **CA-03 Limite sem contorno por concorrência.** Dado um rascunho com 4 fotos, quando dois envios são confirmados ao mesmo tempo, então no máximo 5 ficam gravadas e o excedente recebe 422 `photo_limit`. `[VERIFICADO]` I-29 (trigger + CHECK); o cenário de concorrência é `[PROPOSTA]` para o QA criar.

- **CA-04 Confirmação idempotente.** Dado um registro já confirmado, quando a mesma confirmação é enviada de novo, então não cria segunda foto, não aumenta a contagem e devolve o mesmo resultado. `[VERIFICADO]` 08 §10.2 (2); 14-BACKLOG (H-026: "reenvio não duplica").

- **CA-05 Tamanho e tipo na entrada.** Dado um arquivo com mais de 10 MB, quando é confirmado, então recebe 413 e nada fica no rascunho. Dado um tipo declarado fora de JPG, PNG e WebP (e fora do que D-H026-3 decidir), quando é enviado, então recebe 415. `[DECIDIDO]` FA-001 (10 MB); `[VERIFICADO]` códigos 413 e 415 em 11-ARQ §2.2. A detecção do tipo pelo conteúdo fica em H-028.

- **CA-06 Posse pelo nonce.** Dado um rascunho criado no navegador A, quando uma chamada de envio, confirmação ou consulta de foto chega sem o nonce de A ou com outro nonce, então responde como "não encontrado" (404), sem revelar se o rascunho ou a foto existe; com o nonce de A, é aceita. `[PROPOSTA]` (D-H026-1), com a mesma regra de H-025 CA-05 e D-H025-7; base `[VERIFICADO]` T-02.

- **CA-07 Envio interrompido.** Dado um registro `pending` sem confirmação, quando o prazo do pendente vence, então o registro e o arquivo são removidos, o rascunho não mostra foto sem arquivo, e um reenvio não cria duplicata. `[VERIFICADO]` F-09, 08 §10.2 (5); prazo `[NÃO VERIFICADO]` (D-H026-4).

- **CA-08 Quarentena sem leitura.** Dado um arquivo na quarentena, quando qualquer pessoa ou perfil (inclusive o próprio visitante e profissionais) tenta obter link de leitura ou acessar o objeto diretamente, então não consegue; o armazenamento é privado e esta história não cria rota de leitura. `[VERIFICADO]` 08 §10.1 (quarentena: nenhum acesso de leitura por usuário). A visualização é de H-029.

- **CA-09 Fica em quarentena nesta história.** Dado um arquivo confirmado nesta história, quando é inspecionado no armazenamento, então está somente na quarentena: não é copiado para a área de fotos do pedido, não tem versão reduzida gerada aqui e não recebe estado `ready`. `[PROPOSTA]` (D-H026-2); base `[VERIFICADO]` 08 §10.2 (3) e (4); 14-BACKLOG (H-027 depende de H-026).

- **CA-10 Sem canal extra de foto.** Dado o cliente que quer mais de 5 fotos ou quer enviar foto pelo chat, quando procura um caminho na plataforma, então não existe rota de envio de foto fora do rascunho ou do pedido; fotos extras só pelo WhatsApp, se o cliente autorizar. `[DECIDIDO]` RF-025a, decisão 33; `[VERIFICADO]` P-02. Anexos no chat seguem recusados pelo teste M-01, de outra história.

- **CA-11 Expurgo junto com o rascunho.** Dado um rascunho descartado por prazo, quando o expurgo roda, então as fotos dele (pendentes e confirmadas) são removidas junto, sem depender de o cliente voltar. `[VERIFICADO]` RC-09, H-110 (rascunhos por TTL); vínculo `media_asset(draft_id)` `[VERIFICADO]` 74-DESENHO-H025. O job é de H-110; H-026 entrega o vínculo.

- **CA-12 Cota de envios.** Dado um visitante (nonce ou IP) que passa do limite de envios por dia, quando tenta mais um, então recebe 429 sem detalhe do limite. `[PROPOSTA]` 08 §10.2 (5) e §16; valores `[NÃO VERIFICADO]` (D-H026-4). Base `[DECIDIDO]` RF-021 (sem expor detalhe).

- **CA-13 Nada pessoal na resposta ou no log.** Dado qualquer envio, quando a API responde ou grava log, então o nome original do arquivo, os metadados (EXIF) e o IP em texto claro não aparecem; o nome no armazenamento é aleatório. `[VERIFICADO]` 08 §10.2 (4) e §10.3, T-10 (nome malicioso), T-11 (varredura de logs).

## 5. Fora de escopo

- Redução para ≈ 0,5 MB e ≤ 1.280 px, remoção de EXIF, rotação e detecção do tipo pelo conteúdo: H-027 e H-028 (`[DECIDIDO]` decisões 30 e 31).
- Movimento para a área final de fotos e estado `ready`: H-027 (D-H026-2).
- Pré-visualização, exclusão e reordenação de fotos antes de publicar: H-029 (D-H026-5).
- Conversão de HEIC: H-027/H-028 (D-H026-3).
- Acesso do profissional às fotos, marca d'água e registro de acesso: histórias de acesso (H-056, H-057, conforme 15-RASTREABILIDADE, FA-008).
- Aviso ao cliente sobre fachada ou interior nas fotos (R-03): texto de tela, com H-029 (D-H026-6).
- Vínculo das fotos ao pedido publicado (`media_asset` passa de rascunho a pedido): H-030 e H-031.
- Telefone e opt-in de WhatsApp: H-033.
- Documentos de identidade: H-037 (usa o mesmo mecanismo de quarentena, mas outro bucket e regras).

## 6. Dependências

- **Antes de H-026:** H-025 (rascunho, nonce e `media_asset(draft_id)`, `[VERIFICADO]` 74-DESENHO-H025) e H-005 (job com *lease*, chave de idempotência, contador de taxa, `[VERIFICADO]` 14-BACKLOG). O status de H-005 no quadro não foi conferido nesta leitura; o Orquestrador confirma antes de desenvolver.
- **H-026 libera:** H-027, H-029 e H-037. `[VERIFICADO]` 14-BACKLOG.
- **Modelo:** `media_asset` ganha a ligação ao rascunho (`draft_id`) e a marca de confirmação. Sem coluna de original, de caminho interno ou de nome original. `[VERIFICADO]` 09 (`media_asset`), 74-DESENHO-H025.

## 7. Evidência exigida

Registrada na Issue #39, com comando, contagem e código de saída de cada execução local. Não declarar CI verde.

- `corepack pnpm check:all` e `corepack pnpm db:test`: código de saída e contagem de testes.
- **P-01:** 6ª foto recusada com 422 `photo_limit`; 5 anteriores intactas; API e SQL.
- **P-02:** varredura de rotas e de esquema: nenhum caminho de foto fora de rascunho ou pedido.
- **F-09:** upload interrompido; registro pendente expurgado; reenvio sem duplicar.
- **T-02:** nonce ausente ou errado retorna 404 indistinguível; leitura da quarentena negada.
- **T-11:** varredura de log sem nome original, EXIF e IP em claro.
- **CA-03 (a criar pelo QA):** dois envios simultâneos com 4 fotos; no máximo 5 gravadas.
- **CA-09:** inspeção do armazenamento local após confirmação: objeto só na quarentena; nada em área de fotos do pedido.

## 8. Dúvidas para o líder

Sem perguntas ao usuário. Cada dúvida tem recomendação e não bloqueia o Architect, salvo onde indicado.

- **D-H026-1 (dono do envio antes da identificação).** A tabela de rotas diz "dono" para o envio (11-ARQ §2.2), mas antes da identificação não há conta. **Recomendação:** o dono é o rascunho pelo nonce do navegador, como em H-025. H-013 vincula depois. **Alternativa:** exigir conta, descartada pelo FA-001 (sem senha). Não bloqueia.
- **D-H026-2 (sequência e estado da foto). Bloqueia a liberação.** H-026 guarda o arquivo original (até 10 MB, com EXIF) na quarentena antes da redução de H-027 e da remoção de EXIF de H-028. I-29 diz "sem original no Storage". **Recomendação:** H-026 pode ser desenvolvido, mas o arquivo fica `pending` (confirmado, sem estado `ready`) e não é liberado em produção até H-027 e H-028 estarem prontos. **Alternativa:** juntar H-026 a H-027 (tamanho G). **Decisão:** do líder, por sequência.
- **D-H026-3 (HEIC).** RF-025 aceita HEIC só por conversão segura suportada, e essa conversão é de H-027/H-028. **Recomendação:** recusar HEIC com 415 nesta etapa e aceitar só quando H-027 ligar a conversão. **Alternativa:** aceitar e converter em H-026 (escopo maior, descartado). Não bloqueia.
- **D-H026-4 (prazos e cotas).** Sem valor em documento para o prazo do envio pendente (F-09), a cota por nonce, IP ou dia (08 §10.2 (5), §16) e a validade da URL de upload (não citada nas fontes). **Recomendação:** o Architect propõe valores marcados como `[PROPOSTA]`. O PO sugere prazo de 1 h para pendente e cota por rascunho limitada pelo teto de 5 fotos. Não bloqueia.
- **D-H026-5 (excluir foto antes de H-029).** Sem exclusão até H-029, uma foto errada fica no rascunho até o expurgo; com 5 fotos, a 6ª é recusada. **Recomendação:** não criar exclusão em H-026; H-029 entrega. **Alternativa:** rota mínima de exclusão em H-026 (aumenta escopo). Não bloqueia.
- **D-H026-6 (aviso sobre fachada e interior).** O aviso de tela (08 §10.3, R-03) é texto de interface. **Recomendação:** fica com H-029 e com o desenho de UX; H-026 não cria tela. Não bloqueia.
- **D-H026-7 (referência cruzada).** 08 §10.2 (2) cita FA-028 para a idempotência do envio, mas FA-028 em 05-CRITERIOS-ACEITE trata do chat (RF-105 a RF-107). **Recomendação:** o Architect troca a referência por FA-001 e P-01/F-09. Só correção de texto.

## 9. Próximo passo

O líder valida D-H026-2 e D-H026-3, que decidem o que entra e o que é liberado. As demais dúvidas seguem para o Architect com as recomendações acima. O cartão #39 permanece na coluna Product Owner até essa validação; a movimentação é do Orquestrador, não deste refino.
