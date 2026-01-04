// /api/session.js
//
// Retorna 200 se houver sessão válida, senão 401.
// Usado pelas telas para bloquear acesso direto por URL.

import { requireSession } from "./_authUsuarios.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ sucesso: false, message: "Método não permitido." });
  }

  const session = requireSession(req, res);
  if (!session) return;

  return res.status(200).json({
    sucesso: true,
    usuario: session.usuario,
    loja: session.loja,
    perfil: session.perfil,
    exp: session.exp, // útil para o front saber quando expira
  });
}
