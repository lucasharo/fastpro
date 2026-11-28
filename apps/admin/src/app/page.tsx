// H-103 (Issue 112) | Raiz do admin: envia para o console. A permissao continua na API.
import { redirect } from 'next/navigation';

export default function Raiz() {
  redirect('/console');
}
