// api/logout.js
//
// Logout PPP
// - Apaga a sessão no backend removendo o cookie HttpOnly ppp_session.
// - Não depende de qual "painel" está aberto: ao apagar o cookie,
//   qualquer endpoint protegido por requireSession passa a negar acesso.
//
// Observação importante:
// - Para o cookie ser realmente removido no navegador, os atributos usados
//   no clear (Path, Secure, SameSite) devem bater com os do cookie criado.
// - Por isso, o comportamento real depende do destroySessionCookie() no _authUsuarios.js.

import { destroySessionCookie } from "./_authUsuarios.js";

export default function handler(req, res) {
  // Aceita somente POST para evitar logout acidental via link/GET
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  // Remove o cookie de sessão
  destroySessionCookie(res);

  // Resposta simples para o front
  return res.status(200).json({ sucesso: true, message: "Logout realizado." });
}
