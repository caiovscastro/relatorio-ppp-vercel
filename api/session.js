// api/session.js
import { requireSession } from "./_authUsuarios.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ sucesso: false, message: "Método não permitido." });
    return;
  }

  // Se quiser restringir perfil, passe allowedProfiles:
  // const s = requireSession(req, res, { allowedProfiles: ["ADMINISTRADOR","GERENTE_PPP","BASE_PPP"] });
  const s = requireSession(req, res);

  // requireSession já respondeu 401/403 se falhar
  if (!s) return;

  res.status(200).json({
    sucesso: true,
    usuario: s.usuario,
    loja: s.loja || "",
    perfil: s.perfil || "",
    exp: s.exp || null
  });
}
