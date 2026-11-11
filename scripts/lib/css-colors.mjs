// Nomes de cor CSS (CSS Color Module Level 4, palavras-chave nomeadas). Usado por check-hex.
// "transparent" e "currentColor" ficam de fora de proposito: nao sao cor hardcoded.
export const CSS_COLOR_NAMES = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet
brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue
darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange
darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise
darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia
gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo
ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue
lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon
mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red
rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue
slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white
whitesmoke yellow yellowgreen`
    .split(/\s+/)
    .filter(Boolean),
);

// Propriedades CSS/JSX/SVG cujo valor e (ou contem) uma cor. Aceita kebab-case e camelCase.
const COLOR_PROPS = [
  'color',
  'background',
  'background-color',
  'backgroundColor',
  'border',
  'border-color',
  'borderColor',
  'border-(?:top|right|bottom|left)(?:-color)?',
  'border(?:Top|Right|Bottom|Left)(?:Color)?',
  'outline',
  'outline-color',
  'outlineColor',
  'fill',
  'stroke',
  'stop-color',
  'stopColor',
  'flood-color',
  'caret-color',
  'caretColor',
  'accent-color',
  'accentColor',
  'text-decoration',
  'text-decoration-color',
  'textDecorationColor',
  'column-rule-color',
  'box-shadow',
  'boxShadow',
  'text-shadow',
  'textShadow',
  'bgcolor',
].join('|');

// chave (sem ser parte de outro identificador, nem variavel --x) seguida de : ou = e do valor.
export const COLOR_PROP_RE = new RegExp(
  `(?<![\\w-])(?:${COLOR_PROPS})['"]?\\s*[:=]\\s*([^;{}\\n]*)`,
  'g',
);

// Utilitarios no estilo Tailwind com nome de cor: bg-red-500, text-white, border-black...
const TW_PREFIX =
  '(?:bg|text|border|fill|stroke|ring|outline|from|to|via|shadow|accent|caret|decoration|divide|placeholder)';
export const TAILWIND_COLOR_RE = new RegExp(
  `(?<![\\w-])${TW_PREFIX}-(${[...CSS_COLOR_NAMES].join('|')})(?:-\\d{2,3})?(?![\\w-])`,
  'g',
);

/** Devolve nomes de cor CSS encontrados na linha (propriedade de cor ou utilitario de cor). */
export function namedColorsIn(line) {
  const found = [];
  for (const m of line.matchAll(COLOR_PROP_RE)) {
    const value = m[1]
      .split(/,\s*['"]?[\w-]+['"]?\s*:/)[0] // corta na proxima chave de objeto JS
      .replace(/url\([^)]*\)/gi, '')
      .replace(/var\([^)]*\)/gi, '');
    for (const word of value.toLowerCase().match(/[a-z]+/g) ?? []) {
      if (CSS_COLOR_NAMES.has(word)) found.push(word);
    }
  }
  for (const m of line.matchAll(TAILWIND_COLOR_RE)) found.push(m[1]);
  return found;
}
