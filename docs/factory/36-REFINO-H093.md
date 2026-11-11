# Refino H-093 — EmailProviderPort: Mailpit e Resend (Issue #103, WF-03, coluna Product Owner)

- **Issue:** #103 · **História:** H-093 (E11, "[E11] EmailProviderPort: Mailpit e Resend") · **Workflow:** WF-03 · **Coluna:** Product Owner · **Data:** 2026-11-11 · **Papel:** Product Owner
- **Natureza:** somente documento. Nenhum código, teste, conta, domínio, chave ou envio. O estado da coluna veio do Orquestrador; não foi conferido no Project nesta etapa.
- **Etiquetas:** `[APROVADO]` decisão já registrada (pedido do Orquestrador, decisão 15, I-27, S-11) · `[PROPOSTA]` texto deste refino, a validar.
- **Fontes:** 14-BACKLOG (H-093, E11); 08-ARQUITETURA §12.2, §12.5, §12.6; 10-ADRS (ADR-011, ADR-022, SD-03); 11-ARQ-RISCOS-E-TESTES (I-27, N-09, N-10); 11-DECISOES (decisão 15); `spikes/S-11-RESULTADO.md`; `packages/domain/src/notifications/ports.ts` (porta já existente, entregue com H-092).

## 1. Escopo

Dois adaptadores atrás de `EmailProviderPort`, que não faz I/O e já foi definida em H-092:
- **Mailpit** (desenvolvimento e CI): recebe todo envio local; zero chamada a serviço externo.
- **Resend** (produção): ativo somente com domínio verificado e segredo presente.
- Escolha do adaptador por ambiente (`EMAIL_PROVIDER`). Nos documentos, só nomes de variáveis; valores nunca.

## 2. Critérios de aceite (Given/When/Then)

### 2.1 Seleção do provedor por ambiente
- **CA-H093-01 [APROVADO, I-27; 08 §12.5].** Dado que o ambiente é desenvolvimento ou CI, quando o pipeline envia um e-mail, então o provedor usado é o Mailpit e nenhuma chamada a serviço externo ocorre.
- **CA-H093-02 [APROVADO, I-27].** Dado que o ambiente é produção, quando o pipeline envia um e-mail, então o provedor usado é o Resend. Dado `EMAIL_PROVIDER` ausente ou com valor desconhecido, então a aplicação não inicia (falha de configuração; nunca um provedor padrão silencioso) `[PROPOSTA]`.

### 2.2 Mailpit recebe o envio em desenvolvimento
- **CA-H093-03 [APROVADO, N-09].** Dado o ambiente de desenvolvimento, quando um e-mail é enviado, então ele é entregue ao Mailpit local com destinatário, modelo e chave de idempotência, e o registro do envio identifica o provedor `mailpit` `[PROPOSTA]` (nome).
- **CA-H093-04 [APROVADO, pedido do Orquestrador].** Nesta história, o adaptador Mailpit é verificado por contrato, com um dublê do transporte. O programa Mailpit não é instalado; a prova com o programa real fica para etapa própria (ver §4, D5).

### 2.3 Resend desligado sem domínio, com falha fechada
- **CA-H093-05 [APROVADO, decisão 15, I-27, N-10].** Dado o Resend selecionado e o domínio não verificado (hoje, sempre), quando um envio é tentado, então o adaptador não chama a API, responde `nao_configurado` com código `dominio_nao_verificado`, e o item permanece `pendente` sem perda.
- **CA-H093-06 [APROVADO, N-10].** Dado o Resend selecionado, domínio verificado e segredo ausente, quando um envio é tentado, então responde `nao_configurado` com código `segredo_ausente`, sem chamada externa.

### 2.4 Erro do provedor vira retentativa ou falha definitiva
Classes da resposta (`SendResult` em `ports.ts`). Números e recuos são `[PROPOSTA]`, em configuração.
- **CA-H093-07 [PROPOSTA].** Dado resposta `aceito`, então o item vira enviado e guarda o identificador devolvido pelo provedor.
- **CA-H093-08 [PROPOSTA].** Dado `limite_taxa`, então nova tentativa após o tempo informado pelo provedor; não é falha definitiva.
- **CA-H093-09 [PROPOSTA].** Dado `indisponivel`, então nova tentativa com recuo crescente até o teto; esgotado o teto, falha definitiva (fila de mortos).
- **CA-H093-10 [PROPOSTA].** Dado `recusa_permanente`, então falha definitiva imediata, sem nova tentativa, com o código registrado.
- **CA-H093-11 [PROPOSTA].** Dado `nao_configurado`, então o item fica `pendente`, não consome tentativa e é reavaliado quando a configuração estiver completa.
- **CA-H093-12 [APROVADO, ports.ts (R-2)].** Dado uma retentativa de envio cuja primeira tentativa chegou ao provedor mas a resposta se perdeu, então o destinatário não recebe segundo e-mail: todas as tentativas usam a mesma chave de idempotência.

### 2.5 Nenhum dado sensível no envio
- **CA-H093-13 [APROVADO, RF-120; 09 §7; ports.ts].** Dado qualquer envio por qualquer adaptador, quando o conteúdo e os registros são inspecionados, então não aparecem: endereço completo do pedido, telefone, e-mail de terceiro, corpo de mensagem, link de login, código, credencial ou valor de chave.
- **CA-H093-14 [APROVADO, ports.ts].** Dado qualquer erro ou log do adaptador, então o endereço de destino não é gravado em tabela nem em log, e o valor de `RESEND_API_KEY` nunca aparece.

## 3. Fora desta história
- Envio real a qualquer pessoa: depende de domínio verificado (decisão 15; BK-10; BLQ-EXEC).
- Domínio: não comprar, configurar nem verificar (SD-03; H2).
- Conta Resend nova, chave nova, SMTP do Supabase Auth (exige domínio).
- Instalação do Mailpit (programa real).
- Remetente de produção: não usa `onboarding@resend.dev` (teste da S-11, só para a própria conta).
- Contador de cota e alertas (H-094); textos finais dos e-mails (H-095 a H-098); webhook de bounce (NÃO VERIFICADO, S-11 §5).

## 4. Dúvidas ao Orquestrador (com recomendação)
- **D1. Como o adaptador Resend sabe que o domínio foi verificado?** (a) variável de configuração marcada pelo titular depois de conferir no painel do Resend; (b) consulta à API do Resend na inicialização. **Recomendação: (a).** Não exige chamada externa nem credencial extra. A opção (b) faz chamada externa mesmo sem domínio. Destrava CA-H093-05.
- **D2. Premissa do "modo de teste" do Resend (T8).** A decisão 15 (11-DECISOES) e o cabeçalho de 11-ARQ (N-09/N-10) citam "modo de teste do Resend" com redirecionamento. A S-11 (2026-11-10) mostrou que o Resend só aceita envio de teste para a própria conta, e 08 §12.5 diz que o redirecionamento não está confirmado. **Recomendação:** adotar S-11 e 08 §12.5. O adaptador não tem modo de teste; em dev/CI a regra é "zero chamada externa". O Orquestrador confirma e atualiza a decisão 15. Destrava CA-H093-03 e CA-H093-05.
- **D3. Quem aplica a retentativa?** (a) o adaptador só classifica e o pipeline da H-092 retenta; (b) o próprio adaptador retenta. **Recomendação: (a),** mantendo o adaptador sem estado. Número de tentativas e recuo em configuração (valores `[PROPOSTA]`). Destrava CA-H093-07 a CA-H093-11.
- **D4. Classificação das respostas do Resend.** **Recomendação:** limite de taxa (429) vira `limite_taxa`; erro de validação (4xx) vira `recusa_permanente`; erro do servidor (5xx) e tempo esgotado viram `indisponivel`. O formato da resposta de cota excedida não está verificado (S-11 §5); até verificar, tratar como `limite_taxa`. Validação só com dublê; nenhum teste contra a API real nesta história. Destrava CA-H093-08 a CA-H093-10.
- **D5. Onde registrar a instalação real do Mailpit?** **Recomendação:** item próprio de ambiente local (ou dentro de H-003), instalação sem conta. Confirmar. Destrava apenas a prova final de CA-H093-04.
