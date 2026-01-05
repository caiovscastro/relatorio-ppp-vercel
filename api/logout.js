// api/logout.js
import { destroySessionCookie } from "./_authUsuarios.js";

export default function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ sucesso: false, message: "Método não permitido." });
    return;
  }

  // Apaga o cookie ppp_session
  destroySessionCookie(res);

  res.status(200).json({ sucesso: true, message: "Logout realizado." });
}
