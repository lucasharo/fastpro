// H-016 | Lista local de senhas comuns (docs/factory/33-DESENHO-H016.md §3.1; D-H016-4; decisao do usuario de
// 2026-11-11: senha minima de 8 e lista local). Itens em minusculas, sem acento; a comparacao ignora caixa.
// Lista inicial curada: pode crescer por commit, sem mudar a regra. Sem rede e sem dependencia externa.
const LISTA: readonly string[] = [
  '12345678', '123456789', '1234567890', '12345678910', '123123123', '11111111', '00000000', '87654321',
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssword', 'p@ssw0rd', 'pass1234',
  'qwertyui', 'qwerty123', 'qwertyuiop', 'asdfghjk', 'asdfgh123', 'zxcvbnm1', 'abc12345', 'abcd1234',
  'iloveyou', 'letmein1', 'welcome1', 'welcome123', 'monkey123', 'dragon123', 'football', 'baseball',
  'superman', 'batman123', 'trustno1', 'sunshine', 'princess', 'starwars', 'master123', 'hello123',
  'admin123', 'administrator', 'root1234', 'changeme', 'changeme1', 'default1', 'test1234', 'testing123',
  'senha123', 'senha1234', 'senha12345', 'senha@123', 'senha1234567', 'mudar123', 'mudar1234', 'trocar123',
  'brasil123', 'brasil2020', 'brasil2024', 'brasil2025', 'brasil2026', 'bemvindo1', 'bemvindo123',
  'bemvindo2026', 'sucesso123', 'futebol1', 'flamengo1', 'corinthians', 'palmeiras1', 'saopaulo1',
  'mudar@123', 'senhaforte', 'segredo123', 'internet1', 'nosso123', 'amorzinho', 'chocolate1',
  'fastpro123', 'fastpro2026', 'qazwsxedc', '1q2w3e4r', '1q2w3e4r5t', 'q1w2e3r4', 'zaq12wsx', '1qaz2wsx',
  '159753456', '147258369', '741852963', '112233445', '123321123', '654321789', '999999999', '888888888',
  'a1b2c3d4', 'aa123456', 'abc123456', 'abcdef123', 'hunter22', 'jordan23', 'michael1', 'shadow123',
  'computer1', 'freedom1', 'whatever1', 'qwerty1234', 'asdf1234', 'lovely123', 'secret123', 'login123',
];

/** Conjunto de senhas comuns em minusculas, para consulta O(1). */
export const PROFESSIONAL_COMMON_PASSWORDS: ReadonlySet<string> = new Set(LISTA);
