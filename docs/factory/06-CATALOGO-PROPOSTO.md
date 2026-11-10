# FastPro — Catálogo proposto de grupos, serviços e sinônimos

- **Data:** 2026-11-09 · **Papel:** Product Owner · **Status:** [PROPOSTA] integral, para validação do usuário
- **Autorização:** `11-DECISOES.md` (Rodada 2): catálogo amplo, não restrito a 10 grupos. **Os 10 grupos originais, se recuperados, prevalecem**: este catálogo deve então ser reagrupado sob eles (cada grupo abaixo pode virar subgrupo).
- Nada aqui é decisão aprovada. O catálogo é administrável (RF-003/RF-153): o conteúdo é semente, não contrato.

## Legenda
| Marca | Significado |
|---|---|
| **PR** | Presencial: depende de base + raio (5–100 km) do profissional |
| **ON** | Online: alcance nacional, sem raio (RF-004, [DELEGADO]) |
| **HI** | Híbrido: o profissional declara se atende presencial (com raio), online (nacional) ou ambos |
| **REG** | Atividade regulamentada: exige certificação/registro no cadastro (RF-047). **[PENDENTE JURÍDICO]** L4: lista, órgãos e forma de verificação precisam de validação jurídica. A marca REG aqui é palpite do PO, não parecer |
| **REG?** | Pode ser regulamentada conforme escopo/estado/município; confirmar |
| **SENS** | Serviço sensível (menores, saúde, segurança, valores); sugerir política de moderação/termos. [PROPOSTA] |

Sinônimos: termos de busca coloquiais/regionais/erros comuns, para o autocomplete (RF-002). Sem acento é implícito (busca deve ignorar acentos e caixa).

## Aviso sobre REG
A coluna REG indica onde a lei brasileira costuma exigir habilitação profissional ou registro em conselho (ex.: CREA/CAU, OAB, CRC, CRM, CRO, CRP, CREFITO, COREN, CRN, CREF, CRMV, CFM, CRF), curso/registro específico (ex.: eletricista NR-10 para determinados serviços, NR-35 trabalho em altura, gás), ou licença. É preciso validar com jurídico: (a) se a plataforma deve exigir o documento, (b) como validar, (c) responsabilidade (L4, L7). O selo "verificado" não certifica competência (RF-006).

---

## G01. Reformas e construção
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Pedreiro | PR | — | alvenaria, construir muro, levantar parede, obra |
| Mestre de obras | PR | — | encarregado de obra, gerenciar obra |
| Servente de pedreiro | PR | — | ajudante de obra, auxiliar de pedreiro |
| Reforma geral de casa | PR | — | reformar casa, reforma de apartamento, obra residencial |
| Reforma de banheiro | PR | — | trocar box, azulejo banheiro, reformar banheiro |
| Reforma de cozinha | PR | — | reformar cozinha, trocar bancada, revestimento cozinha |
| Construção de casa | PR | REG? | construir casa, obra nova, empreiteiro |
| Ampliação / puxadinho | PR | REG? | aumentar casa, construir cômodo, laje |
| Projeto arquitetônico | HI | REG (CAU) | planta de casa, projeto de casa, arquiteto |
| Projeto estrutural / cálculo | HI | REG (CREA/CAU) | engenheiro civil, cálculo estrutural, laudo estrutural |
| Laudo técnico / vistoria de imóvel | PR | REG (CREA/CAU) | vistoria, laudo de engenharia, ART, perícia de imóvel |
| Regularização de imóvel (habite-se, averbação) | HI | REG? | regularizar casa, habite-se, averbar construção |
| Gesseiro / drywall | PR | — | forro de gesso, gesso 3D, sanca, parede de drywall |
| Pintor residencial | PR | — | pintar casa, pintar parede, pintura de apartamento, textura |
| Pintor predial / fachada | PR | REG? (NR-35) | pintura de prédio, fachada, trabalho em altura |
| Impermeabilização | PR | — | infiltração, vazamento laje, manta asfáltica |
| Azulejista / ladrilheiro | PR | — | assentar piso, colocar cerâmica, porcelanato, revestimento |
| Instalação de piso laminado / vinílico | PR | — | piso vinílico, piso de madeira, instalar laminado |
| Restauração de taco / sinteco | PR | — | raspar taco, sinteco, polimento de piso |
| Marmoraria / bancadas | PR | — | granito, mármore, pia de pedra, bancada |
| Serralheiro | PR | — | portão de ferro, grade, estrutura metálica, solda |
| Soldador | PR | — | solda, soldagem, serralheria |
| Vidraceiro | PR | — | box de vidro, espelho, janela de vidro, vidro temperado |
| Esquadrias de alumínio | PR | — | janela de alumínio, porta de alumínio, caixilho |
| Carpinteiro | PR | — | madeiramento, telhado de madeira, deck, pergolado |
| Instalação de telhado | PR | REG? (NR-35) | trocar telha, telhadista, calha |
| Calhas e rufos | PR | — | instalar calha, rufo, condutor |
| Demolição | PR | REG? | derrubar parede, quebrar piso, entulho |
| Terraplenagem / escavação | PR | REG? | aterro, nivelamento de terreno, retroescavadeira |
| Fundação / sapata | PR | REG | estaca, radier, baldrame |
| Poço artesiano / perfuração | PR | REG | cavar poço, poço semi-artesiano |
| Fossa e esgoto | PR | — | fossa séptica, sumidouro, caixa de gordura |
| Pavimentação / calçada | PR | — | calçamento, piso externo, intertravado, concreto |
| Muro e cerca | PR | — | levantar muro, cerca de arame, alambrado |
| Orçamento de obra / quantitativo | ON | — | planilha de obra, orçamento de reforma |
| Fiscalização de obra | HI | REG? (CREA/CAU) | acompanhar obra, engenheiro de obra |
| Topografia / georreferenciamento | PR | REG (CREA) | topógrafo, medição de terreno, levantamento planialtimétrico |
| Aluguel de equipamento de obra | PR | — | andaime, betoneira, escora |

## G02. Elétrica, hidráulica e gás
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Eletricista residencial | PR | REG? (NR-10) | fiação, trocar tomada, disjuntor, curto-circuito |
| Eletricista predial / comercial | PR | REG? (NR-10) | quadro de energia, instalação elétrica comercial |
| Instalação de chuveiro elétrico | PR | — | trocar resistência, chuveiro queimado |
| Instalação de iluminação / lustres | PR | — | colocar luminária, spot, fita de led |
| Instalação de ventilador de teto | PR | — | ventilador, pendurar ventilador |
| Aterramento / SPDA (para-raios) | PR | REG (CREA/técnico) | para-raios, aterramento |
| Padrão de entrada de energia | PR | REG? | medidor, ligação de luz, ligação nova |
| Energia solar: projeto e instalação | PR | REG (CREA/CFT) | painel solar, placa solar, fotovoltaico |
| Carregador de carro elétrico | PR | REG? (NR-10) | wallbox, carregador veicular |
| Encanador / bombeiro hidráulico | PR | — | vazamento, cano estourado, torneira, descarga |
| Desentupimento | PR | — | pia entupida, ralo entupido, vaso entupido, esgoto |
| Caça-vazamento | PR | — | detectar vazamento, vazamento oculto |
| Instalação de caixa d'água / limpeza | PR | — | limpar caixa d'água, instalar reservatório |
| Instalação de aquecedor a gás/solar | PR | REG? (gás) | aquecedor, boiler, aquecimento solar |
| Instalação e manutenção de gás (GLP/GN) | PR | REG | instalar fogão, ponto de gás, vazamento de gás, gasista |
| Instalação de bomba / pressurizador | PR | — | bomba d'água, pressurizador |
| Instalação de louças e metais | PR | — | trocar vaso, instalar pia, torneira, ducha higiênica |
| Piscina: construção | PR | REG? | fazer piscina, piscina de fibra, piscina de alvenaria |
| Piscina: manutenção e limpeza | PR | — | piscineiro, tratamento de piscina, cloro |
| Sistema de reuso / cisterna | PR | — | captação de água de chuva, cisterna |

## G03. Casa, manutenção e serviços domésticos
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Diarista / faxina | PR | — | faxineira, limpeza de casa, empregada por dia |
| Empregada doméstica mensalista | PR | — | doméstica, empregada, babá e doméstica |
| Limpeza pós-obra | PR | — | limpeza de obra, limpeza pesada |
| Limpeza pré-mudança / pós-mudança | PR | — | limpeza de apartamento vazio, limpeza final |
| Limpeza de sofá, colchão e estofados | PR | — | lavar sofá, higienização, lavagem a seco |
| Limpeza de carpetes e tapetes | PR | — | lavar tapete, lavagem de carpete |
| Limpeza de vidros e fachadas | PR | REG? (NR-35) | limpar janelas, limpeza de fachada |
| Limpeza de caixa d'água | PR | — | higienização de reservatório |
| Passadeira | PR | — | passar roupa, engomar |
| Lavanderia / lavagem de roupa | PR | — | lavar roupa, lavanderia a domicílio |
| Cozinheira / chef a domicílio | PR | — | cozinheira, marmita, chef em casa |
| Marmitas e refeições por encomenda | PR | — | quentinha, comida caseira |
| Montador de móveis | PR | — | montar guarda-roupa, montar armário, montar cama |
| Marceneiro | PR | — | móveis sob medida, armário planejado, marcenaria |
| Móveis planejados | PR | — | cozinha planejada, closet, dormitório planejado |
| Estofador / reforma de sofá | PR | — | reformar sofá, trocar espuma, tapeceiro |
| Reparo de móveis | PR | — | consertar armário, dobradiça, conserto de móvel |
| Cortinas e persianas | PR | — | instalar persiana, cortina sob medida, blackout |
| Papel de parede e adesivos | PR | — | colocar papel de parede, revestimento adesivo |
| Instalação de box e espelhos | PR | — | box de banheiro, espelho de parede |
| Chaveiro | PR | — | abrir porta, trocar fechadura, cópia de chave, chaveiro 24h |
| Mudança residencial | PR | — | carreto, frete, caminhão de mudança, mudança de apartamento |
| Montagem e desmontagem na mudança | PR | — | desmontar móveis, embalar mudança |
| Guarda-móveis / self storage | PR | — | box de armazenamento, guardar móveis |
| Marido de aluguel / pequenos reparos | PR | — | pequenos consertos, faz-tudo, manutenção de casa, bico |
| Instalação de suportes e prateleiras | PR | — | fixar TV, prateleira, nicho, cabide |
| Jardinagem | PR | — | cortar grama, poda, manutenção de jardim, jardineiro |
| Paisagismo | PR | REG? | projeto de jardim, jardim vertical |
| Poda e remoção de árvores | PR | REG? (NR-35) | cortar árvore, poda de altura |
| Irrigação automática | PR | — | sistema de irrigação, aspersor |
| Dedetização e controle de pragas | PR | REG (licença sanitária/CRQ/técnico) | desinsetização, baratas, cupins, ratos, formiga |
| Desratização | PR | REG | combate a ratos, ratos |
| Sanitização / desinfecção | PR | REG? | desinfetar ambiente, sanitizar |
| Controle de pombos / morcegos | PR | REG? | afastar pombos, tela anti-pombos |
| Faxina rural / sítio | PR | — | cuidar de sítio, caseiro |
| Caseiro / zelador | PR | — | cuidar de casa, vigia de casa, porteiro |
| Organização de ambientes (personal organizer) | HI | — | organizar armário, closet, organização residencial |
| Decoração e interiores | HI | — | decorador, decorar casa, home staging |
| Design de interiores | HI | REG? | projeto de interiores, designer de ambientes |
| Lavagem de caixa de gordura | PR | — | limpeza de gordura, caixa de gordura |

## G04. Climatização, eletrodomésticos e eletrônicos
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Instalação de ar-condicionado | PR | REG? (NR-10/NR-35, certificação F-Gas) | instalar split, instalar ar, ar-condicionado |
| Manutenção e limpeza de ar-condicionado | PR | — | higienização de ar, carga de gás do ar |
| Conserto de geladeira | PR | — | geladeira não gela, freezer, refrigerador |
| Conserto de máquina de lavar | PR | — | lavadora, lava e seca, máquina não centrifuga |
| Conserto de fogão e cooktop | PR | REG? (gás) | fogão, forno elétrico, forno a gás |
| Conserto de micro-ondas | PR | — | microondas |
| Conserto de lava-louças | PR | — | máquina de lavar louça |
| Conserto de televisão | PR | — | TV, smart TV, tela quebrada |
| Conserto de aparelho de som e áudio | PR | — | caixa de som, home theater |
| Conserto de pequenos eletrodomésticos | PR | — | liquidificador, ferro de passar, batedeira, aspirador |
| Conserto de ventilador / climatizador | PR | — | ventilador, climatizador |
| Manutenção de bebedouro / purificador | PR | — | troca de filtro, purificador |
| Manutenção de cozinha industrial | PR | — | equipamentos de restaurante, forno industrial, chapa |
| Refrigeração comercial | PR | — | câmara fria, balcão refrigerado |
| Instalação de TV e suporte | PR | — | fixar TV na parede, rack |
| Instalação de antena / TV por satélite | PR | — | antena digital, parabólica |
| Automação residencial | HI | — | casa inteligente, smart home, alexa |

## G05. Segurança, portaria e cuidados com o imóvel
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Instalação de câmeras de segurança (CFTV) | PR | — | câmera, monitoramento, DVR |
| Alarme e cerca elétrica | PR | — | instalar alarme, cerca elétrica |
| Interfone e portaria eletrônica | PR | — | interfone, vídeo porteiro, controle de acesso |
| Portão eletrônico: instalação e manutenção | PR | — | automatizar portão, motor de portão |
| Fechadura digital | PR | — | fechadura biométrica, tranca eletrônica |
| Vigilante / segurança patrimonial | PR | REG (Polícia Federal/curso de vigilante) | segurança, vigia, escolta |
| Brigadista / prevenção de incêndio | PR | REG? | extintor, brigada, PPCI, AVCB |
| Recarga e inspeção de extintores | PR | REG | extintores |
| Detector de fumaça e sprinklers | PR | REG? | sprinkler, hidrante |
| Serviço de portaria / zeladoria | PR | — | porteiro, zelador, controle de acesso |

## G06. Beleza e estética
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Cabeleireiro(a) | PR | — | corte de cabelo, escova, hair stylist |
| Barbeiro | PR | — | barba, corte masculino, barbearia |
| Coloração e mechas | PR | — | tintura, luzes, descoloração, loira |
| Alisamento e tratamentos capilares | PR | REG? (produtos controlados) | progressiva, botox capilar, cauterização |
| Penteados para festa / noivas | PR | — | penteado, coque, noiva |
| Manicure e pedicure | PR | — | unha, esmaltação, cutícula |
| Alongamento de unhas | PR | — | gel, fibra, acrigel |
| Design de sobrancelhas | PR | — | sobrancelha, henna, micropigmentação |
| Micropigmentação | PR | REG? (vigilância sanitária) | micro, sobrancelha fio a fio |
| Extensão de cílios | PR | REG? | cílios, volume russo |
| Maquiagem | PR | — | make, maquiadora, automaquiagem |
| Maquiagem para noivas / eventos | PR | — | make noiva |
| Depilação | PR | — | cera, depilação a laser, linha |
| Depilação a laser | PR | REG? (profissional de saúde) | laser, luz pulsada |
| Limpeza de pele | PR | REG? | esteticista, peeling, skin care |
| Massagem relaxante | PR | REG? | massagista, spa, shiatsu |
| Massagem modeladora / drenagem linfática | PR | REG? | drenagem, anticelulite |
| Estética corporal | PR | REG? | tratamento corporal, redução de medidas |
| Estética facial avançada (toxina, preenchimento) | PR | REG (CRM/CRO; SENS) | botox, harmonização, preenchedor |
| Podologia | PR | REG? | pé, unha encravada, podólogo |
| Tatuagem | PR | REG? (vigilância sanitária) | tattoo, tatuador |
| Piercing | PR | REG? | piercer, furar |
| Visagismo e consultoria de imagem | HI | — | personal stylist, consultoria de estilo |
| Cabelo afro / tranças | PR | — | box braids, trança nagô, cabelo crespo |
| Perucas e laces | PR | — | lace front, megahair, aplicação de mega hair |
| Esteticista a domicílio | PR | — | beleza em casa, home care beleza |
| Bronzeamento | PR | REG? | bronze, spray tan |

## G07. Saúde e bem-estar
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Médico (consulta) | HI | REG (CRM; SENS) | clínico geral, consulta, atestado |
| Pediatra | PR | REG (CRM; SENS) | médico de criança |
| Cardiologista, dermatologista, etc. | HI | REG (CRM; SENS) | especialista, consulta especializada |
| Dentista | PR | REG (CRO; SENS) | odontologia, canal, clareamento, aparelho |
| Ortodontia | PR | REG (CRO) | aparelho dentário |
| Psicólogo(a) / psicoterapia | HI | REG (CRP; SENS) | terapia, terapia online, psicoterapia, ansiedade |
| Psicanalista | HI | REG? (SENS) | análise, terapia |
| Psicopedagogo | HI | REG? | dificuldade de aprendizagem, TDAH, dislexia |
| Terapeuta ocupacional | HI | REG (CREFITO) | TO, reabilitação |
| Fonoaudiólogo | HI | REG (CRFa) | fono, fala, gagueira |
| Fisioterapeuta | PR | REG (CREFITO) | fisio, reabilitação, RPG |
| Fisioterapia pélvica / pilates clínico | PR | REG (CREFITO) | pilates, fisio pélvica |
| Quiropraxia / osteopatia | PR | REG? | quiropraxista |
| Acupuntura | PR | REG? | agulha, medicina chinesa |
| Nutricionista | HI | REG (CRN) | dieta, reeducação alimentar, emagrecimento |
| Personal trainer | HI | REG (CREF) | treino, musculação, personal |
| Educador físico | HI | REG (CREF) | treino funcional, treino em casa |
| Pilates | HI | REG? | pilates solo, aparelho |
| Yoga | HI | — | professor de yoga, meditação |
| Treino funcional / crossfit | HI | REG (CREF) | funcional |
| Natação / hidroginástica (aulas) | PR | REG? (CREF) | professor de natação |
| Artes marciais (aulas) | PR | — | jiu-jitsu, muay thai, karatê, boxe |
| Enfermeiro(a) | PR | REG (COREN; SENS) | curativo, aplicação de injeção, home care |
| Técnico de enfermagem | PR | REG (COREN; SENS) | cuidador de saúde, aplicação |
| Cuidador de idosos | PR | REG? (SENS) | acompanhante de idoso, cuidar de idoso |
| Acompanhante hospitalar | PR | — (SENS) | acompanhante noturno, plantão |
| Home care / atendimento domiciliar | PR | REG (SENS) | atendimento em casa |
| Coleta de exames a domicílio | PR | REG | exame de sangue em casa |
| Vacinação domiciliar | PR | REG (COREN; SENS) | vacina em casa |
| Doula / consultoria de amamentação | HI | REG? | gestante, parto, amamentação |
| Terapias integrativas | HI | REG? | reiki, florais, aromaterapia, ayurveda |
| Coaching de saúde / bem-estar | ON | — | coach de vida, mentor de saúde |
| Veterinário | ver G12 | | |
| Óptica / optometrista | PR | REG | óculos, receita, ajuste |
| Aparelho auditivo | PR | REG (fonoaudiólogo) | surdez, audiometria |
| Perícia médica | HI | REG (CRM) | laudo médico, assistência técnica |

## G08. Aulas, educação e idiomas
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Reforço escolar | HI | — | aula particular, dever de casa, aulas de apoio |
| Aulas de matemática | HI | — | professor de matemática, álgebra, cálculo |
| Aulas de português / redação | HI | — | redação ENEM, gramática, literatura |
| Aulas de física e química | HI | — | professor de física, professor de química |
| Aulas de biologia / ciências | HI | — | biologia, ciências |
| Aulas de história e geografia | HI | — | história, geografia, sociologia, filosofia |
| Preparação ENEM / vestibular | ON | — | pré-vestibular, cursinho, simulado |
| Preparação para concursos | ON | — | concurso público, aulas para concurso |
| Preparação para OAB / residência | ON | — | exame da ordem, prova de residência |
| Orientação de TCC / mestrado | ON | — | monografia, dissertação, orientação acadêmica |
| Revisão e normalização de trabalhos (ABNT) | ON | — | formatar TCC, normas ABNT, revisão de texto |
| Inglês (aulas) | HI | — | professor de inglês, English, conversação |
| Espanhol (aulas) | HI | — | professor de espanhol |
| Francês, alemão, italiano (aulas) | HI | — | francês, alemão, italiano |
| Japonês, mandarim, coreano (aulas) | HI | — | japonês, chinês, coreano |
| Libras (aulas) | HI | — | língua de sinais |
| Português para estrangeiros | ON | — | PFOL |
| Alfabetização infantil | HI | — | ensinar a ler, alfabetizar |
| Alfabetização de adultos | HI | — | EJA, aprender a ler |
| Música: violão | HI | — | professor de violão, aula de violão |
| Música: guitarra, baixo, bateria | HI | — | guitarra, bateria, contrabaixo |
| Música: piano e teclado | HI | — | piano, teclado |
| Música: canto | HI | — | aula de canto, técnica vocal |
| Música: outros instrumentos | HI | — | violino, flauta, saxofone, ukulele |
| Teoria musical e produção | ON | — | home studio, DAW, composição |
| Dança (aulas) | PR | — | forró, ballet, zumba, hip hop, dança de salão |
| Teatro e oratória | HI | — | falar em público, expressão corporal |
| Desenho e pintura (aulas) | HI | — | aula de arte, aquarela, ilustração |
| Fotografia (aulas) | HI | — | curso de fotografia |
| Culinária (aulas) | PR | — | aula de culinária, confeitaria, panificação |
| Xadrez | HI | — | aula de xadrez |
| Artesanato (aulas) | HI | — | crochê, tricô, macramê, bordado |
| Costura (aulas) | HI | — | curso de corte e costura |
| Informática básica (aulas) | HI | — | computação para iniciantes, internet |
| Excel e planilhas | ON | — | excel avançado, power bi, google sheets |
| Programação (aulas) | ON | — | python, java, javascript, lógica |
| Robótica / STEAM infantil | HI | — | robótica |
| Educação financeira | ON | — | investimentos, finanças pessoais |
| Direção (aula de direção) | PR | REG (instrutor credenciado Detran; SENS) | autoescola, instrutor, primeira habilitação |
| Aula de condução de moto | PR | REG | instrutor de moto |
| Barcos / náutica (aulas, arrais) | PR | REG? | habilitação náutica |
| Primeiros socorros (curso) | HI | REG? | CIPA, brigada |
| Supervisão de estágio / mentoria | ON | — | mentoria de carreira |
| Educação especial / acompanhante terapêutico | PR | REG? (SENS) | AT, inclusão, mediador escolar |
| Homeschooling / tutoria | HI | — | ensino domiciliar |

## G09. Tecnologia e informática
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Formatação e manutenção de computador | HI | — | consertar PC, formatar notebook, limpeza de PC |
| Conserto de notebook | PR | — | trocar tela, teclado, placa, notebook lento |
| Montagem de PC gamer | PR | — | montar computador, upgrade |
| Assistência para celular | PR | — | trocar tela, bateria, celular molhado |
| Conserto de tablets | PR | — | iPad, tablet |
| Recuperação de dados | HI | — | recuperar HD, perda de arquivos |
| Instalação de redes e Wi-Fi | PR | — | roteador, cabeamento, internet fraca, mesh |
| Cabeamento estruturado | PR | — | cabo de rede, rack, patch panel |
| Suporte técnico remoto | ON | — | acesso remoto, suporte TI |
| Suporte de TI para empresas | HI | — | help desk, infraestrutura, servidor |
| Segurança da informação | ON | — | cibersegurança, pentest, antivírus |
| Remoção de vírus | HI | — | limpar vírus, malware |
| Desenvolvimento de sites | ON | — | criar site, site institucional, WordPress |
| Lojas virtuais (e-commerce) | ON | — | criar loja online, Shopify, Woocommerce |
| Desenvolvimento de aplicativos | ON | — | app mobile, Android, iOS, Flutter |
| Desenvolvimento de software sob medida | ON | — | sistema web, ERP, CRM, API |
| Automação de processos / bots | ON | — | RPA, chatbot, integrações |
| Banco de dados / BI | ON | — | dashboards, Power BI, SQL |
| Ciência de dados / IA | ON | — | machine learning, ciência de dados, IA |
| UX/UI design | ON | — | design de interface, prototipagem, Figma |
| Manutenção de sites | ON | — | atualizar site, suporte WordPress |
| Hospedagem e domínio | ON | — | registro.br, migrar site |
| Configuração de servidores / nuvem | ON | — | AWS, Azure, DevOps, VPS |
| Instalação de impressoras e redes | PR | — | impressora, wi-fi impressora |
| Conserto de impressoras | PR | — | impressora travada, recarga de toner |
| Consultoria em tecnologia | ON | — | CTO como serviço, arquitetura |
| Testes de software / QA | ON | — | testador, qualidade de software |
| Games e modding | ON | — | modelagem de jogos, Unity |
| Assistência para consoles | PR | — | PS5, Xbox, Nintendo |
| Drones: operação e manutenção | PR | REG? (ANAC/DECEA) | drone, piloto remoto |

## G10. Design, marketing e comunicação
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Design gráfico | ON | — | logo, identidade visual, banner, flyer |
| Criação de logotipo | ON | — | logomarca, marca |
| Social media | ON | — | gestão de redes sociais, Instagram, posts |
| Tráfego pago | ON | — | Google Ads, Meta Ads, anúncios |
| SEO | ON | — | otimização de site, Google |
| E-mail marketing | ON | — | newsletter, automação de marketing |
| Copywriting / redação publicitária | ON | — | texto, redator, roteiro de vendas |
| Produção de conteúdo / blog | ON | — | artigos, blog |
| Edição de vídeo | ON | — | editar vídeo, reels, YouTube, motion |
| Motion graphics / animação | ON | — | animação, vinheta |
| Ilustração | ON | — | desenho digital, arte, personagem |
| Design de embalagens | ON | — | rótulo, packaging |
| Fotografia de produtos | HI | — | foto para e-commerce, still |
| Fotografia: ensaios | PR | — | ensaio, gestante, newborn, família |
| Fotografia: eventos | PR | — | foto de festa, casamento, formatura |
| Fotografia imobiliária | PR | — | foto de imóvel |
| Videomaker / filmagem | HI | — | vídeo de casamento, vídeo institucional |
| Locução e dublagem | ON | — | locutor, narração, voice over |
| Podcast: produção | ON | — | edição de podcast, gravação |
| Tradução | ON | — | tradutor, tradução juramentada |
| Tradução juramentada | ON | REG (Junta Comercial) | tradutor público |
| Legendagem | ON | — | legenda, transcrição |
| Revisão de textos | ON | — | revisor, correção ortográfica |
| Ghostwriter / livros | ON | — | escrever livro, biografia |
| Assessoria de imprensa | ON | — | press release, jornalista |
| Relações públicas | ON | — | RP, comunicação corporativa |
| Branding e estratégia | ON | — | posicionamento de marca |
| Pesquisa de mercado | ON | — | pesquisa, survey |
| Gráfica / impressão | PR | — | cartão de visita, folder, banner |
| Serigrafia / camisetas | PR | — | silk, estampa, bordado |
| Brindes personalizados | PR | — | canecas, brindes corporativos |
| Comunicação visual / fachadas | PR | — | letreiro, adesivação, totem |
| Sinalização | PR | — | placas, sinalização |

## G11. Eventos e festas
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Organização de eventos | HI | — | cerimonialista, assessoria de eventos |
| Assessoria de casamento | HI | — | wedding planner, cerimonial |
| Buffet | PR | — | comida para festa, buffet infantil |
| Salgados e doces para festa | PR | — | coxinha, brigadeiro, doces finos |
| Bolos decorados | PR | — | bolo de aniversário, confeiteira |
| Churrasqueiro | PR | — | churrasco, assador |
| Bartender / drinks | PR | — | barman, drinks, open bar |
| Garçom / copeira | PR | — | garçom, copeira, serviço de mesa |
| Decoração de festas | PR | — | decoração infantil, painéis, balões |
| Aluguel de mesas, cadeiras e louças | PR | — | locação de mobiliário |
| Aluguel de brinquedos / pula-pula | PR | — | infláveis, brinquedos de festa |
| Recreação infantil | PR | — | animação de festa, recreador, brincadeiras |
| Personagens de festa | PR | — | palhaço, mágico, mascote |
| Mágico | PR | — | ilusionismo, show de mágica |
| DJ | PR | — | som e iluminação, festa, discotecagem |
| Banda e música ao vivo | PR | — | banda para casamento, músico, cantor |
| Cantor(a) / MC | PR | — | cantor de casamento |
| Som, luz e palco | PR | — | iluminação cênica, equipamento de som |
| Fotógrafo de eventos | PR | — | ver G10 |
| Filmagem de eventos | PR | — | ver G10 |
| Cabine de fotos / totem | PR | — | photo booth, 360 |
| Fogos e efeitos especiais | PR | REG (Exército/Corpo de Bombeiros) | pirotecnia, show de fogos |
| Segurança de eventos | PR | REG | segurança, brigadista |
| Cerimonial de formatura | PR | — | formatura, colação |
| Aluguel de espaço para festas | PR | — | salão de festas, chácara |
| Decoração de casamento | PR | — | flores, buquê |
| Floricultura / arranjos | PR | — | flores, coroas, cesta |
| Lembrancinhas | PR | — | lembrancinha personalizada |
| Convites personalizados | ON | — | convite digital, convite impresso |
| Transporte para eventos | PR | — | van, ônibus fretado, carro de noiva |
| Cerimonial religioso / celebrante | PR | REG? | celebrante, padre, pastor |
| Chá de bebê / revelação | PR | — | chá revelação |
| Eventos corporativos | PR | — | convenção, treinamento, coffee break |

## G12. Pets
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Banho e tosa | PR | — | tosa, tosador, pet shop |
| Banho e tosa a domicílio | PR | — | pet móvel, tosa em casa |
| Passeador de cães (dog walker) | PR | — | passear cachorro |
| Pet sitter | PR | — | cuidador de pets, hospedagem pet |
| Hospedagem / creche pet | PR | — | hotel para cachorro, day care |
| Adestramento | PR | — | treinador de cães, comportamento canino |
| Veterinário | PR | REG (CRMV; SENS) | vet, consulta veterinária |
| Veterinário a domicílio | PR | REG (CRMV) | atendimento pet em casa |
| Exames e vacinação pet | PR | REG (CRMV) | vacina cachorro, castração |
| Fisioterapia veterinária | PR | REG (CRMV) | fisio pet |
| Comportamentalista animal | HI | REG? | etólogo |
| Táxi pet | PR | — | transporte de animais |
| Fotografia pet | PR | — | ensaio pet |
| Cuidados com aquário | PR | — | limpeza de aquário, aquarismo |
| Terapia holística pet | PR | REG? | reiki pet |
| Cremação / sepultamento pet | PR | REG? | funeral pet |
| Cuidado com cavalos | PR | REG? | tratador, ferrador, cavalo |
| Criação responsável | HI | — | consultoria de criação |

## G13. Jurídico
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Advogado: cível | HI | REG (OAB) | processo, indenização, cobrança |
| Advogado: família e sucessões | HI | REG (OAB; SENS) | divórcio, pensão, inventário, guarda |
| Advogado: trabalhista | HI | REG (OAB) | rescisão, direitos trabalhistas |
| Advogado: previdenciário | HI | REG (OAB) | INSS, aposentadoria, auxílio |
| Advogado: criminal | HI | REG (OAB; SENS) | defesa criminal, habeas corpus |
| Advogado: consumidor | HI | REG (OAB) | cobrança indevida, negativação |
| Advogado: imobiliário | HI | REG (OAB) | usucapião, aluguel, compra de imóvel |
| Advogado: tributário | HI | REG (OAB) | impostos, execução fiscal |
| Advogado: empresarial / societário | HI | REG (OAB) | contrato social, sociedade |
| Advogado: digital / LGPD | ON | REG (OAB) | privacidade, adequação à LGPD |
| Advogado: trânsito | HI | REG (OAB) | multa, CNH suspensa |
| Advogado: propriedade intelectual | ON | REG (OAB) | marca, patente, INPI |
| Elaboração e revisão de contratos | ON | REG (OAB) | contrato de aluguel, minuta |
| Consultoria jurídica | ON | REG (OAB) | parecer, consulta jurídica |
| Mediação e arbitragem | HI | REG? | conciliação, câmara de arbitragem |
| Despachante documental | HI | REG? | documentação, certidões |
| Cartório e documentação | PR | — | autenticação, registro |
| Despachante veicular | PR | REG? | transferência de veículo, licenciamento |
| Habilitação / CNH (despachante) | PR | REG? | renovar CNH, primeira habilitação |
| Registro de marca (INPI) | ON | REG? | registrar marca |
| Imigração e vistos | ON | REG? (OAB) | visto, cidadania, passaporte |
| Perícia judicial | HI | REG | perito, assistente técnico |
| Detetive particular | PR | REG? (SENS) | investigação, localização de pessoas |

## G14. Contábil, financeiro e administrativo
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Contador | ON | REG (CRC) | contabilidade, escrituração |
| Abertura de empresa (MEI, ME, LTDA) | ON | REG? (CRC) | abrir CNPJ, abrir MEI |
| Contabilidade para MEI | ON | REG (CRC) | declaração anual MEI, DAS |
| Imposto de renda (IRPF) | ON | REG? (CRC) | declaração IR, malha fina |
| Declaração de pessoa jurídica | ON | REG (CRC) | DCTF, SPED, DEFIS |
| Planejamento tributário | ON | REG (CRC) | reduzir impostos |
| Departamento pessoal | ON | REG? | folha de pagamento, eSocial, admissão |
| Auditoria | ON | REG (CRC) | auditor, compliance |
| Consultoria financeira | ON | REG? | planejamento financeiro, fluxo de caixa |
| Planejador financeiro pessoal | ON | REG? (CFP) | organizar finanças |
| Assessoria de investimentos | ON | REG (CVM; SENS) | consultor, assessor de investimentos |
| Corretor de seguros | HI | REG (SUSEP) | seguro, apólice |
| Corretor de imóveis | PR | REG (CRECI) | vender imóvel, alugar imóvel, avaliação de imóvel |
| Avaliação de imóveis | PR | REG (CRECI/CREA) | laudo de avaliação, PTAM |
| Administração de condomínio | PR | — | síndico profissional, condomínio |
| Administração de imóveis (locação) | PR | REG? (CRECI) | gestão de aluguel |
| Cobrança e recuperação de crédito | ON | — | cobrança, negociação de dívidas |
| Renegociação de dívidas | ON | — | limpar nome, serasa |
| Secretária / assistente virtual | ON | — | secretária remota, agenda, atendimento |
| Digitação e transcrição | ON | — | digitar, transcrever |
| Atendimento ao cliente (SAC terceirizado) | ON | — | call center, atendimento |
| Gestão administrativa para pequenos negócios | ON | — | gestão, organização |
| Consultoria empresarial | ON | — | estratégia, plano de negócios |
| Consultoria de RH | ON | — | recrutamento, seleção, treinamento |
| Plano de negócios / pitch | ON | — | captação, investidores |
| Contabilidade rural | HI | REG (CRC) | produtor rural |

## G15. Automotivo
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Mecânico | PR | — | oficina, conserto de carro, revisão |
| Mecânico a domicílio | PR | — | mecânico em casa |
| Elétrica automotiva | PR | — | bateria, alternador, chicote |
| Funilaria e pintura | PR | — | batida, amassado, polimento |
| Martelinho de ouro | PR | — | amassado pequeno, granizo |
| Polimento e cristalização | PR | — | polimento de carro, vitrificação |
| Lavagem automotiva | PR | — | lavar carro, lava-jato, higienização interna |
| Estética automotiva | PR | — | detalhamento, detailing |
| Película / insulfilm | PR | — | insulfilm, película de vidro |
| Som automotivo | PR | — | instalar som no carro |
| Alarme e rastreador | PR | — | rastreamento, bloqueador |
| Guincho | PR | — | reboque, socorro mecânico |
| Auto socorro | PR | — | pane, pneu furado, bateria arriada |
| Borracheiro / pneus | PR | — | calibragem, alinhamento, balanceamento |
| Alinhamento e balanceamento | PR | — | geometria, suspensão |
| Troca de óleo | PR | — | revisão, filtros |
| Ar-condicionado automotivo | PR | — | gás do ar do carro |
| Vidraceiro automotivo | PR | — | para-brisa, vidro de carro |
| Mecânica de motos | PR | — | oficina de moto, conserto de moto |
| Mecânica de caminhões e ônibus | PR | — | diesel, manutenção de frota |
| Conversão GNV | PR | REG (INMETRO) | kit gás |
| Vistoria cautelar / inspeção veicular | PR | REG? | laudo cautelar |
| Despachante veicular | PR | REG? | ver G13 |
| Instrutor de direção | PR | REG | ver G08 |
| Tapeçaria automotiva | PR | — | banco de couro, forro |
| Carros elétricos: manutenção | PR | REG? | EV, híbrido |
| Customização / tuning | PR | — | rebaixamento, envelopamento |
| Envelopamento (wrap) | PR | — | adesivar carro |
| Compra e venda: avaliação | PR | — | avaliar veículo, consultor automotivo |

## G16. Transporte, entregas e logística
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Frete e carreto | PR | — | transportar móveis, caminhonete |
| Mudança | PR | — | ver G03 |
| Motoboy / entregas | PR | — | entrega rápida, motofrete |
| Motorista particular | PR | REG? | motorista executivo, chofer |
| Motorista para evento / diária | PR | — | motorista de van |
| Transporte escolar | PR | REG (autorização/CNH D, SENS) | van escolar, lotação |
| Transporte de passageiros (turismo) | PR | REG | fretamento, excursão |
| Aluguel de van / ônibus com motorista | PR | REG | fretar ônibus |
| Transporte de cargas pesadas | PR | REG | carreta, munck, guindaste |
| Transporte de animais | PR | — | táxi pet, translado |
| Transporte de veículos (cegonha) | PR | — | levar carro |
| Entrega de documentos | HI | — | malote, office boy |
| Logística e armazenagem | HI | — | estoque, fulfillment |
| Embalagem e remessa | PR | — | embalar, correios |
| Transporte aéreo / drones | PR | REG | cargas aéreas |
| Agente de viagens | ON | REG? (Cadastur) | passagem, roteiro, pacote |
| Guia de turismo | PR | REG (Cadastur) | guia turístico, city tour |
| Transfer aeroporto | PR | — | traslado, aeroporto |
| Barqueiro / transporte fluvial | PR | REG? | passeio de barco |

## G17. Alimentação e gastronomia
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Confeiteiro(a) | PR | — | doces, bolo, torta |
| Padeiro / panificação artesanal | PR | — | pães, fermentação natural |
| Cozinheiro(a) autônomo(a) | PR | — | cozinheira, chef |
| Marmitaria fitness | PR | — | refeição saudável, dieta |
| Salgadeira | PR | — | salgado, coxinha |
| Churrasco para eventos | PR | — | ver G11 |
| Food truck | PR | — | carrinho de lanche |
| Consultoria em gastronomia | HI | — | cardápio, ficha técnica |
| Boas práticas de manipulação (consultoria) | PR | REG? | vigilância sanitária |
| Nutricionista | HI | REG (CRN) | ver G07 |
| Barista / café | PR | — | barista |
| Cervejeiro artesanal | PR | — | cerveja caseira |
| Produção de alimentos congelados | PR | — | congelados caseiros |

## G18. Moda, costura e artesanato
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Costureira | PR | — | ajuste de roupa, barra, conserto de roupa |
| Alfaiate | PR | — | terno sob medida |
| Estilista / criação de moda | HI | — | design de moda, modelagem |
| Modelista | HI | — | moldes, modelagem |
| Bordado | HI | — | bordado à mão, bordado computadorizado |
| Crochê e tricô sob encomenda | HI | — | tricô, amigurumi |
| Estamparia | PR | — | silk, DTF, sublimação |
| Sapateiro | PR | — | conserto de sapato, bolsa |
| Reforma de bolsas | PR | — | restauração de bolsa |
| Ajuste de roupa de noiva | PR | — | barra de vestido, vestido de noiva |
| Consultoria de estilo | HI | — | personal stylist |
| Aluguel de roupas | PR | — | trajes para festa |
| Artesanato sob encomenda | HI | — | feito à mão, personalizados |
| Biju e joias artesanais | HI | — | bijuteria |
| Relojoeiro | PR | — | consertar relógio, trocar bateria |
| Joalheiro / conserto de joias | PR | REG? | ourives, ajuste de aliança |
| Cerâmica e porcelana | PR | — | cerâmica, pintura |
| Velas e aromas | HI | — | velas artesanais |

## G19. Agro, rural e meio ambiente
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Agrônomo | PR | REG (CREA) | consultoria agrícola, receituário agronômico |
| Técnico agrícola | PR | REG? (CFTA) | assistência técnica rural |
| Zootecnista | HI | REG (CRMV) | nutrição animal |
| Veterinário de grandes animais | PR | REG (CRMV) | veterinário rural, pecuária |
| Inseminação artificial | PR | REG? | inseminador |
| Topografia rural | PR | REG (CREA) | georreferenciamento, CAR |
| CAR / licenciamento ambiental | HI | REG? | CAR, licença ambiental, outorga |
| Consultoria ambiental | HI | REG (CREA/CRBio) | EIA/RIMA, estudo ambiental |
| Reflorestamento / manejo | PR | REG? | plantio de árvores |
| Cercas e currais | PR | — | cerca elétrica rural |
| Irrigação rural | PR | REG? | pivô, gotejamento |
| Operador de máquinas agrícolas | PR | — | trator, colheitadeira |
| Pulverização com drone | PR | REG (MAPA/ANAC) | drone agrícola |
| Apicultura | PR | — | abelhas, mel |
| Horta caseira e permacultura | HI | — | horta, composteira |
| Reciclagem e coleta | PR | — | coleta de entulho, caçamba |
| Aluguel de caçambas | PR | — | caçamba de entulho |
| Coleta de resíduos perigosos | PR | REG | resíduos |

## G20. Indústria, comércio e manutenção industrial
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Manutenção industrial | PR | REG? | manutenção mecânica, elétrica industrial |
| Automação industrial (CLP) | HI | REG? | CLP, supervisório |
| Usinagem e torno | PR | — | torneiro mecânico, fresador |
| Caldeiraria | PR | — | solda, caldeireiro |
| Instalação de máquinas | PR | REG? | montagem industrial |
| Manutenção de elevadores | PR | REG | elevador, plataforma |
| Manutenção de geradores | PR | REG? | gerador, nobreak |
| Inspeção de segurança do trabalho | HI | REG (técnico/engenheiro de seg.) | NR, PCMSO, PGR, SESMT |
| Técnico de segurança do trabalho | HI | REG (MTE) | CIPA, laudos |
| Laudos de insalubridade | HI | REG | LTCAT, PPP |
| Metrologia / calibração | PR | REG? (INMETRO/RBC) | calibrar instrumentos |
| Treinamentos NR | HI | REG? | NR-10, NR-35, NR-33 |
| Consultoria de qualidade (ISO) | HI | — | ISO 9001, auditoria |
| Logística industrial | HI | — | estoque, PCP |
| Projeto mecânico / elétrico | ON | REG (CREA/CFT) | CAD, SolidWorks, projeto elétrico |
| Desenho técnico (CAD) | ON | — | AutoCAD, Revit, BIM |
| Impressão 3D / prototipagem | HI | — | impressora 3D, protótipo |
| Corte a laser / CNC | PR | — | MDF, acrílico |
| Representante comercial | HI | REG? (CORE) | vendas, representação |

## G21. Imóveis e hospedagem
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Corretor de imóveis | PR | REG (CRECI) | ver G14 |
| Avaliador de imóveis | PR | REG | ver G14 |
| Gestão de Airbnb / temporada | PR | — | anfitrião profissional, check-in |
| Limpeza e enxoval para temporada | PR | — | roupa de cama, faxina de Airbnb |
| Fotografia imobiliária | PR | — | ver G10 |
| Home staging | PR | — | decorar para venda |
| Vistoria de entrada e saída | PR | REG? | vistoria de aluguel, laudo |
| Síndico profissional | PR | — | gestão condominial |
| Administradora de condomínio | PR | — | boleto, assembleia |
| Mudança e storage | PR | — | ver G03 |
| Regularização documental | HI | REG? | ver G01 |
| Topografia urbana | PR | REG | ver G01 |

## G22. Arte, entretenimento e cultura
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Artista plástico / pintura sob encomenda | HI | — | quadro personalizado, retrato |
| Escultor / escultura | HI | — | estátuas, esculturas |
| Muralista / grafiteiro | PR | — | pintura de mural, grafite |
| Tatuador | PR | REG? | ver G06 |
| Ator / atriz | PR | REG? (DRT) | elenco, publicidade |
| Modelo | PR | — | modelo fotográfico, book |
| Figurante | PR | — | figuração |
| Músico para eventos | PR | — | ver G11 |
| Compositor / produtor musical | ON | — | beats, composição |
| Estúdio de gravação | PR | — | gravar música |
| Escritor / roteirista | ON | — | roteiro, texto |
| Contador de histórias | PR | — | contação, animação infantil |
| Circo e teatro infantil | PR | — | peça infantil |
| Cursos de arte | HI | — | ver G08 |

## G23. Cuidados pessoais e família
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Babá | PR | — (SENS) | cuidar de criança, babá folguista |
| Nanny / babá noturna | PR | — (SENS) | babá noite |
| Cuidador de idosos | PR | REG? (SENS) | ver G07 |
| Acompanhante para consultas | PR | — (SENS) | levar idoso ao médico |
| Mãe de leite / amamentação | HI | REG? | consultoria de amamentação |
| Consultora de sono infantil | HI | REG? | sono do bebê |
| Orientação parental | HI | — | educação de filhos |
| Terapia familiar / de casal | HI | REG (CRP; SENS) | terapeuta de família |
| Passeador de idosos | PR | — | companhia |
| Doula | HI | REG? | ver G07 |
| Personal organizer | HI | — | ver G03 |
| Assistente pessoal / concierge | HI | — | resolver pendências, concierge |
| Luto e acolhimento | HI | REG? (CRP; SENS) | apoio ao luto |
| Funerais e traslado | PR | REG | funerária, velório |

## G24. Empresas e serviços corporativos
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Terceirização de limpeza | PR | — | conservação, serviços gerais |
| Terceirização de portaria | PR | — | portaria remota |
| Cozinha industrial / refeitório | PR | — | alimentação corporativa |
| Manutenção predial | PR | REG? | manutenção preventiva |
| Jardinagem corporativa | PR | — | paisagismo empresarial |
| Controle de pragas empresarial | PR | REG | PMOC, dedetização |
| PMOC (plano de manutenção de climatização) | PR | REG (CREA/CFT) | laudo PMOC |
| Brigada e treinamentos | PR | REG? | brigada de incêndio |
| Segurança do trabalho | HI | REG | ver G20 |
| Medicina do trabalho | HI | REG (CRM) | ASO, exames ocupacionais |
| Consultoria em vendas | ON | — | treinamento comercial |
| Treinamento corporativo | HI | — | palestrante, workshop |
| Palestrante | HI | — | palestra, keynote |
| Coaching executivo | ON | — | coach, mentoria |
| Pesquisa e BI | ON | — | ver G09 |
| Tradução corporativa | ON | — | ver G10 |
| Terceirização de TI | HI | — | ver G09 |
| Consultoria de importação/exportação | ON | REG? | comex, despachante aduaneiro |
| Despachante aduaneiro | ON | REG | importação |

## G25. Outros serviços
| Serviço | Mod | REG | Sinônimos de busca |
|---|---|---|---|
| Serviços gerais / bicos | PR | — | ajudante, diária, faz-tudo |
| Ajudante geral | PR | — | auxiliar, carregador |
| Entregador / retirada de objetos | PR | — | busca de encomenda |
| Fila e burocracia (assistente de tarefas) | PR | — | resolver pendências, ficar na fila |
| Aluguel de itens (ferramentas, eventos) | PR | — | locação |
| Compras e mandados | PR | — | comprar para mim, supermercado |
| Atendimento religioso / espiritual | HI | — | benzedeira, mãe de santo |
| Astrologia / tarô | ON | — | mapa astral |
| Coach de vida | ON | — | mentoria |
| Serviço não listado | HI | — | outro, não encontrei |

---

## Resumo quantitativo (estimativa grosseira, não contada item a item)
- 25 grupos, da ordem de 550 serviços (algumas referências cruzadas repetem itens).
- Itens REG/REG? concentrados em G07 (saúde), G13 (jurídico), G14 (contábil/financeiro), G02 (elétrica/gás), G19 (agro), G20 (indústria), G15/G16. Percentuais por modalidade não foram calculados.

## Notas de curadoria
1. **Agrupamento:** 25 grupos é proposta de cobertura. Para compatibilizar com os 10 grupos originais (D2), sugere-se mapear: Casa/obras (G01–G05, G21) · Beleza/saúde (G06–G07, G23) · Aulas (G08) · Tecnologia/design (G09–G10) · Eventos/arte (G11, G22) · Pets (G12) · Jurídico/contábil (G13–G14, G24) · Automotivo/transporte (G15–G16) · Alimentação/moda (G17–G18) · Agro/indústria/outros (G19–G20, G25). [PROPOSTA], não é recuperação dos nomes originais.
2. **REG:** validar item a item com jurídico (L4). Algumas atividades de saúde e jurídico podem ter restrição de publicidade (CFM, OAB, CFP) que afeta o perfil público; verificar. [PENDENTE JURÍDICO]
3. **SENS:** sugerir termos e moderação reforçada (menores, saúde, segurança, investigação). Não há texto aprovado.
4. **Online vs presencial:** HI deixa o profissional declarar. Para ON o raio não se aplica (RF-004). Serviços ON que exijam inscrição local (ex.: advogado inscrito em outro estado) podem ter limite territorial legal: validar.
5. **Sinônimos:** semente para o autocomplete; evoluir com termos de busca reais após o lançamento. Incluir regionalismos (ex.: "carreto" / "frete", "faxineira" / "diarista", "mecânico" / "oficineiro").
6. **Serviços que podem exigir restrição de produto:** itens que a plataforma talvez não deva listar (ex.: serviços ilícitos, sexuais, venda de produtos controlados). Lista de proibidos: não definida; [PENDENTE JURÍDICO] / decisão de produto.
7. **Duplicatas intencionais:** alguns serviços aparecem com "ver G.." para referência cruzada; no sistema são um único item com vários grupos.
