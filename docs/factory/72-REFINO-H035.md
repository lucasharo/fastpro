# H-035 — Cadastro profissional com CPF/CNPJ cifrado (refino do Product Owner)

- **Issue:** #48 · **Épico:** E4 (Verificação e perfil profissional) · **Onda:** 2 · **Tamanho:** M
- **Etapa:** Product Owner (WF-03) · **Data:** 2026-11-11 · **Saída:** refino para a Arquitetura
- **Fontes:** `14-BACKLOG.md` (H-035, H-036, H-037, H-040, H-043); `04-PRD.md` (RF-046 a RF-050, RF-053, RF-147, RF-162); `05-CRITERIOS-ACEITE.md` (FA-004); `09-MODELO-DADOS.md` (§3.3, §6, §7, §8); `11-ARQ-RISCOS-E-TESTES.md` (RC-01, R-26, T-11); `11-DECISOES.md` (decisões 13, 34, 35).
- **Etiquetas:** [DECIDIDO] já aprovado na fonte citada · [VERIFICADO] conferido no documento citado · [PROPOSTA] texto deste refino, para validação do líder · [NÃO VERIFICADO] não conferido.

## 1. Objetivo

O profissional informa seu CPF (pessoa física) ou CNPJ (empresa ou MEI) ao criar o perfil. O número fica cifrado e recebe um identificador único, para: (a) impedir que o mesmo documento sirva a dois perfis sem revisão humana; (b) permitir a verificação posterior (H-039). **H-035 não aprova ninguém:** todo perfil nasce `pendente`. [DECIDIDO] (RF-050, FA-004)

## 2. Atores e pré-condições

- **Ator:** profissional autenticado (conta da H-016). [VERIFICADO] (backlog, H-035 depende de H-016)
- **Pré-condição:** sessão ativa. Publicar e aceitar exigem e-mail verificado; isso não é escopo desta história. [DECIDIDO] (RF-045)
- **Dependências:** H-016 (em andamento; status no Project [NÃO VERIFICADO] neste refino) e H-003 (migração e RLS de `professional_profile`).
- **Leitores de estado:** a Verificação (fila de H-039) só lê o estado. Nada desta história decide aprovação.

## 3. O que o profissional informa

| Campo | Obrigatório | Regra | Guarda |
|---|---|---|---|
| Tipo de documento | sim | CPF ou CNPJ. [VERIFICADO] (09 §3.3) | `document_type`, em claro |
| Número | sim | Aceita com ou sem máscara. Após normalizar: CPF com 11 dígitos e CNPJ com 14. Dígitos verificadores válidos. [PROPOSTA] | `document_enc` e `document_hmac` |
| Nome público | sim | Texto curto. Limite de caracteres [NÃO VERIFICADO] | `public_name` |
| Identificador de URL (slug) | automático | Gerado do nome público, único. [PROPOSTA] | `slug` |

### Como o número fica guardado

- **Nunca em claro** em tabela, log, resposta de API, mensagem de erro ou e-mail. [DECIDIDO] (09 §7: "nunca em log"; T-11)
- **`document_enc`:** criptografia de aplicação com chave versionada. [VERIFICADO] (09 §7, "Enc")
- **Chave:** em desenvolvimento, no `.env.local` (nome da variável, nunca o valor). [DECIDIDO] (decisão 13). A origem da chave em produção é a SD-11, para a Arquitetura. [NÃO VERIFICADO]
- **`document_hmac`:** identificador para unicidade, calculado sobre o número só com dígitos, usando segredo do servidor (pepper). [PROPOSTA] Motivo: CPF tem pouquíssimas combinações, então um hash sem segredo pode ser revertido. O uso de HMAC está em 09 §3.3. [VERIFICADO]
- **Unicidade:** `document_hmac` é único entre perfis **não recusados**. [VERIFICADO] (09 §3.3)
- **Leitura pela API:** a resposta ao próprio profissional nunca traz o número completo; exibição mascarada. [PROPOSTA] (ver dúvida 2)

## 4. Estados

- **Estado inicial de todo perfil criado por H-035:** `pendente`. [VERIFICADO] (09 §3.3; 05 FA-004)
- **Estados do ciclo** (feitos por H-039 e H-040, fora desta história): `em_revisao`, `retida_duplicidade`, `aprovada`, `recusada`, `suspensa`. [VERIFICADO] (09 §3.3)
- **Única transição feita por H-035 além da criação:** ir para `retida_duplicidade` quando o documento já existe em outro perfil não recusado (regra R2).
- **Não existe estado "revogado" na lista de 09 §3.3,** embora RF-050 cite "revogado". [NÃO VERIFICADO] (dúvida 4)

## 5. Regras de negócio

- **R1.** Cadastro válido cria o perfil em `pendente`. Nenhum aceite, conversa ou publicação é liberado. [DECIDIDO] (RF-050; FA-004)
- **R2.** Se o documento já está em outro perfil não recusado, o novo perfil vai para `retida_duplicidade`, com motivo. Não há bloqueio definitivo automático. [DECIDIDO] (RF-049). O estado gravado já no cadastro é [PROPOSTA].
- **R3.** A resposta ao profissional não revela dados do outro perfil (nome, e-mail, data). [PROPOSTA] (dúvida 1)
- **R4.** O selo "verificado" nunca aparece por causa de H-035. Só a aprovação (H-039) habilita o selo, na história H-043. [VERIFICADO] (backlog, H-043)
- **R5.** Documentos de identidade (imagem ou PDF) não entram aqui. Vão para H-037. [DECIDIDO] (decisões 34 e 35)

## 6. Critérios de aceite (Given/When/Then)

- **CA-01 (CPF válido).** Dado um profissional autenticado sem perfil, quando envia tipo CPF com número válido, então o perfil é criado em `pendente` com `document_enc` e `document_hmac` preenchidos.
- **CA-02 (CNPJ válido).** Dado um profissional autenticado sem perfil, quando envia tipo CNPJ com número válido, então o perfil é criado em `pendente` com `document_type` = CNPJ.
- **CA-03 (número inválido).** Dado um CPF com 10 dígitos ou com dígito verificador errado, quando envia, então recebe erro no campo e nada é gravado.
- **CA-04 (máscara não muda o identificador).** Dado o CPF "123.456.789-09" e o CPF "12345678909", quando calculo o `document_hmac` de cada um, então os valores são iguais.
- **CA-05 (duplicidade).** Dado um perfil A com CPF X em `pendente` ou `aprovada`, quando o profissional B cadastra o mesmo CPF X, então o perfil de B fica `retida_duplicidade` e a resposta não contém dados de A.
- **CA-06 (perfil recusado não conta).** Dado um perfil A `recusada` com CPF X, quando B cadastra X, então B é criado em `pendente`, sem retenção.
- **CA-07 (sem dado em claro).** Dado um cadastro concluído, quando leio logs, respostas da API, mensagens de erro e as tabelas, então o número completo não aparece em nenhum deles (varredura de T-11).
- **CA-08 (cifra).** Dado um perfil gravado, quando leio `document_enc` direto no banco, então o valor não contém o número e informa a versão da chave.
- **CA-09 (segredo do HMAC).** Dado o mesmo número e outro segredo de servidor, quando calculo o `document_hmac`, então o valor é diferente.
- **CA-10 (isolamento).** Dado o profissional A, quando consulta o próprio perfil, então a resposta não contém `document_enc` nem `document_hmac`. Consultar o perfil de B retorna negado.
- **CA-11 (envio duplo).** Dado o botão "Salvar" clicado duas vezes, quando o envio conclui, então existe um único perfil.
- **CA-12 (acessibilidade).** Dado o formulário, quando uso só o teclado, então consigo preencher e enviar; cada erro está ligado ao seu campo (RF-162). [VERIFICADO] (RF-162)
- **CA-13 (estado vazio e erro).** Dado um profissional sem perfil, quando abre o cadastro, então vê o formulário vazio. Dado erro de rede, quando envia, então vê mensagem acionável e os campos continuam preenchidos.

## 7. Fora de escopo

- Upload e verificação de documentos de identidade ou certificação: **H-037** (Issue própria).
- Certificação para atividades regulamentadas: H-038 (bloqueada pela L4).
- Fila, decisão, recurso e prazo de 2 dias úteis: H-039, H-040 e H-041.
- Bloqueio de aceite e de descoberta para não aprovado: H-042.
- Selo "verificado" e perfil público completo: H-043 (bloqueada pela L7).
- Serviços, raio e base geográfica: H-036.
- Prazos de retenção, eliminação e direitos do titular: L1 (H-109 e H-111). H-035 não apaga nada.
- Chave de produção e cofre de chaves: SD-11 (Arquitetura).

## 8. Dependências, dados e riscos

- **Dados (C3, 09 §7):** o número é o dado de maior risco do cadastro. Leitura por Verificação passa pelo registro de acesso sensível. [VERIFICADO] (09 §6–§7)
- **Tabelas:** `professional_profile` (09 §3.3) e registro inicial de `verification_case` em `pendente` [PROPOSTA]. A fila é H-039.
- **Riscos** (11-ARQ): vazamento por log (R-01 e T-11); reversão do HMAC se não houver segredo (CA-09); falso positivo de duplicidade (R-26 e H-040).
- **Testes previstos:** CA-07 e CA-08 (T-11); CA-10 (T-04 e T-06, na visão do profissional); execução local do `corepack pnpm check:all`, como pede a regra da fábrica. [VERIFICADO] (AGENTS.md)

## 9. Dúvidas não bloqueantes (com recomendação do PO)

Nenhuma dúvida trava o início da Arquitetura. Todas têm recomendação e podem seguir como [PROPOSTA] até validação do líder.

1. **Mensagem de duplicidade ao profissional.** (a) "Não foi possível concluir seu cadastro. Vamos revisar seu caso." (b) Informar que o documento já existe em outro perfil. **Recomendo (a):** a alternativa (b) revelaria a existência de outra conta com o mesmo documento. O motivo detalhado segue no recurso de H-040.
2. **Exibição do número após salvar.** (a) Só mascarado, por exemplo com os últimos dígitos. (b) Completo para o próprio dono. **Recomendo (a).** A tabela de 09 §6 permite leitura pelo profissional; a Arquitetura decide o mascaramento.
3. **Perfil antes da aprovação.** (a) Não aparece na busca pública até `aprovada`. (b) Aparece com "em verificação". **Recomendo (a).** 09 não define; afeta H-043.
4. **Estado "revogado" (RF-050).** (a) Tratar como `suspensa`. (b) Criar estado próprio. **Recomendo (a)**, sem novo estado, até o líder confirmar para H-039.
5. **CPF e CNPJ do mesmo titular (MEI).** (a) Identidades distintas: a unicidade é por documento. (b) Vincular os dois. **Recomendo (a)** e registrar como limitação aceita, junto ao risco de duas contas do mesmo titular (já aceito em 11-ARQ).
6. **Troca do número após o cadastro.** (a) Não permitida; a Verificação faz nova análise. (b) Permitida, com nova verificação automática. **Recomendo (a).**
7. **Validação de dígitos verificadores.** (a) Sim, como regra de formato. (b) Só o tamanho. **Recomendo (a).** Isso não substitui a verificação de identidade (H-037).

**Pergunta única para o líder (se precisar consolidar):** nenhuma pergunta bloqueante. Se o líder quiser fechar as dúvidas 1 a 7 antes do desenvolvimento, a decisão é aceitar ou trocar as recomendações.
