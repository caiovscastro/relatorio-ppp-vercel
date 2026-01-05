// api/logout.js
//
// Logout PPP
// - Encerra a sessão removendo o cookie HttpOnly (ppp_session).
// - Importante: por ser cookie HttpOnly, o front NÃO consegue apagar sozinho.
// - Não deve ser cacheado (no-store).

import { destroySessionCookie } from "./_authUsuarios.js";

export default function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      sucesso: false,
      message: "Método não permitido. Use POST."
    });
  }

  // ✅ Evita cache
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");

  // Apaga o cookie ppp_session
  destroySessionCookie(res);

  return res.status(200).json({
    sucesso: true,
    message: "Logout realizado."
  });
}
