# FastPro — Jornadas

- **Etapa:** conception · **Data:** 2026-11-09 · **Status:** rascunho para validação humana
- **Etiquetas:** `[APROVADO]` · `[DELEGADO]` · `[PROPOSTA]` · `[PENDENTE JURÍDICO]`
- Baseado nos resumos 03, 05 e 06 do pacote e em `11-DECISOES.md`. Nenhuma RN nova foi criada; critérios FA-001..035 serão tratados pelo PO. Telas não são especificadas. Foco em web.

## J1. Cliente — do pedido à avaliação

| # | Passo | Origem |
|---|---|---|
| 1 | Navega sem login (categorias, perfis públicos) | [APROVADO] |
| 2 | Informa o serviço (autocomplete) e o local (Mapbox) | [APROVADO] |
| 3 | Escolhe urgência (Imediato / Nas próximas semanas / Próximo mês / Ainda não defini), descreve, anexa até 5 fotos (opcional) | [APROVADO] |
| 4 | Informa primeiro nome e e-mail (telefone opcional); confirma o e-mail por link mágico (15 min, uso único, confirmação por ação na página; código de 6 dígitos como alternativa) | [APROVADO] / [DELEGADO] D8 |
| 5 | Revisa e confirma expressamente a publicação; abre janela de 7 dias | [APROVADO] |
| 6 | Recebe ofertas; e-mail imediato na primeira, agrupado a cada 15 min nas seguintes | [APROVADO] / [DELEGADO] |
| 7 | Com 4 ofertas e pedido aberto, vê "Receber mais ofertas" e libera a 2ª onda (uma vez) | [DELEGADO] D3 |
| 8 | Conversa com cada participante (um chat por par e pedido) | [APROVADO] |
| 9 | Seleciona um participante; novas ofertas encerram; pode trocar antes de concluir | [APROVADO] |
| 10 | Declara a conclusão (só o cliente); pode corrigir em até 24 h se não houver avaliação publicada | [APROVADO] |
| 11 | Avalia o profissional (1–5, comentário opcional); publicada automaticamente; edita em 7 dias | [APROVADO] / [DELEGADO] D4 |
| 12 | Volta depois por link mágico e sessão (até 7 dias) para ver pedidos, conversas e avaliações | [APROVADO] / [DELEGADO] |

Variações:
- **Expiração (7 dias):** fecha entrada de ofertas, sem cancelar nem concluir; lembrete 24 h antes e aviso no vencimento; ainda é possível selecionar entre participantes anteriores. [APROVADO]
- **Cancelamento:** ação expressa e confirmada; sem selecionado, chats somente leitura; com selecionado, só o chat dele permanece ativo. [APROVADO]
- **Republicação:** novo pedido (novo ID, 7 dias), dados revistos, ofertas/conversas não transferidas; uma ativa por cadeia. Para selecionar alguém do pedido original com republicação ativa, o cliente confirma o cancelamento da nova. [APROVADO]
- **Desistência do profissional:** registra e notifica; não troca sozinho; sem substituto o cliente confirma cancelar e depois republicar (duas confirmações). [APROVADO]
- **Contato externo:** telefone/WhatsApp só com consentimento explícito (checkbox desmarcado por padrão); e-mail nunca revelado. [APROVADO]
- **Sem profissional elegível no raio:** comportamento e texto não definidos. Ver pendências.

O cliente não vê contadores, vagas ou ondas. [APROVADO]

## J2. Profissional — do cadastro à contratação

| # | Passo | Origem |
|---|---|---|
| 1 | Cria conta (e-mail/senha; Google/Apple quando suportados) | [APROVADO]; D9 pendente |
| 2 | Informa CPF/CNPJ e documentos; certificações se a atividade for regulamentada | [APROVADO]; verificação de certificação [PENDENTE JURÍDICO] |
| 3 | Aguarda aprovação humana (meta 2 dias úteis, não promessa); duplicidade suspeita retém a aprovação com explicação e recurso | [APROVADO] |
| 4 | Monta perfil: serviços, base e raio (5–100 km) | [APROVADO] / [DELEGADO] |
| 5 | Ativa por conta própria o teste gratuito de 14 dias (sem meio de pagamento) | [APROVADO] |
| 6 | Vê pedidos compatíveis (serviço e raio), com localização generalizada e fotos | [APROVADO]; mitigações D10 [DELEGADO] |
| 7 | Participa se houver vaga interna (até 8 por pedido, 4+4) e envia uma oferta, editável | [APROVADO] |
| 8 | Conversa com o cliente; primeiro nome do cliente só após participação legítima | [APROVADO] |
| 9 | Se selecionado, atende o cliente e pode ser avaliado; responde publicamente ou contesta | [APROVADO] |
| 10 | Antes do fim do teste, escolhe um dos 4 planos (cartão com renovação por adesão; Pix/boleto manual) | [APROVADO] |

Variações:
- **Falha de renovação paga:** 72 h de carência; teste expirado sem carência. [APROVADO]
- **Assinatura expirada:** não descobre nem participa de novos pedidos; mantém participações e pode ser selecionado onde já participou. [APROVADO]
- **Sem vaga:** vê que não pode participar (mensagem não definida e sem expor contadores). [PROPOSTA]
- **Desistência:** comunica ao cliente ou à plataforma; o sistema registra e notifica sem trocar sozinho. [APROVADO]
- **Pontos de retenção:** valor percebido depende do fluxo de pedidos elegíveis; ver riscos R2 e R3 em `01-VISAO.md`. [PROPOSTA]

## J3. Admin

| Jornada | Passos | Origem |
|---|---|---|
| Verificar profissional (Verificação) | Revisa documentos e certificações, aprova/recusa/retém por duplicidade, explica e aceita recurso; registra auditoria | [APROVADO] |
| Moderar (Moderador) | Trata denúncias de mensagem, avaliação ou perfil; decide com fundamento; recurso; revisão da avaliação se a conclusão for corrigida | [APROVADO] / [DELEGADO] D4 |
| Corrigir conclusão (Suporte/Admin) | Após 24 h ou com avaliação publicada, revisão administrativa com auditoria; não reabre ofertas | [APROVADO] |
| Financeiro | Analisa cobranças e estornos: ≤ R$200 por um Financeiro; > R$200 por dois aprovadores independentes | [APROVADO]; política de reembolso [PENDENTE JURÍDICO] |
| Catálogo e promoções | Gerencia serviços, sinônimos e promoções futuras | [APROVADO]; 10 grupos desconhecidos |
| Acesso excepcional a conversa | Só com caso autorizado, justificativa e log | [APROVADO] |
| Auditoria (Auditor) | Consulta trilha de ações | [APROVADO] |
| Suspensão permanente | Dupla aprovação quando definido | [APROVADO] |

Todos os acessos exigem MFA e menor privilégio. [APROVADO] A matriz de telas e permissões por papel e as metas de triagem de risco elevado não foram recebidas. [APROVADO como existência; conteúdo ausente]

## Rastreabilidade (nível conception)
Requisito → jornada: pedido/publicação (J1.2–5), distribuição 4+4 e ofertas (J1.6–7, J2.7), seleção/conclusão/avaliação (J1.9–11), assinatura e teste (J2.5, J2.10), verificação (J2.2–3, J3). A ligação com RN e FA-001..035 será feita pelo PO.

## Decisões pendentes
1. Comportamento e texto quando não há profissional elegível no raio (cliente) e quando não há vaga (profissional).
2. Quais telas/permissões cada papel admin possui; metas de triagem.
3. Como o profissional é lembrado do fim do teste e do ciclo (conteúdo e canal; só e-mail está aprovado).
4. Critério de "mesmo serviço × distinto" (D6) e casos extremos de cadeia (D7).
5. Login Google/Apple (D9).
6. Contato cliente↔profissional: direto ou intermediado (entrevista) — confirmar se chat na plataforma mais consentimento de telefone responde a isto.
7. Política de reembolso e itens jurídicos.
