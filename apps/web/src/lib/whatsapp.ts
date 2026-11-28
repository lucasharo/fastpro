// WhatsApp: numero do cliente na publicacao e link de conversa para o profissional que aceitou.

/** Celular brasileiro com DDD (11 digitos, 9 na frente), com ou sem o 55. Devolve so os digitos nacionais ou null. */
export function celularValido(valor: string): string | null {
  const digitos = valor.replace(/\D/g, '').replace(/^55(?=\d{11}$)/, '');
  return /^[1-9]{2}9\d{8}$/.test(digitos) ? digitos : null;
}

/** Mascara (11) 91234-5678 enquanto a pessoa digita. */
export function mascaraCelular(valor: string): string {
  const d = valor.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function linkWhatsApp(telefone: string, servico: string): string {
  const texto = `Olá! Aceitei seu pedido de ${servico} no FastPro. Podemos conversar?`;
  return `https://wa.me/${telefone.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`;
}
