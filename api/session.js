// api/session.js
//
// Session PPP
// - Endpoint para o front verificar se existe sessão válida.
// - Retorna dados mínimos da sessão (usuario/loja/perfil/exp).
// - Se sessão for inválida/ausente, requireSession responde 401.
// - Se quiser restringir perfis, passe allowedProfiles.
//
// Importante:
// - Esse endpoint é útil para proteger páginas do front (painel.html, dashboard.html, etc.)
//   sem depender de localStorage/sessionStorage.
// - A autenticação de verdade acontece no backend (cookie HttpOnly assinado).

import { requireSession } from "./_authUsuarios.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ sucesso: false, message: "Método não permitido. Use GET." });
  }

  // Se quiser restringir perfis:
  // const s = requireSession(req, res, { allowedProfiles: ["ADMINISTRADOR","GERENTE_PPP","BASE_PPP"] });

  const s = requireSession(req, res);

  // requireSession já respondeu 401/403 se falhar
  if (!s) return;

  // Retorna apenas o necessário para UI/roteamento
  return res.status(200).json({
    sucesso: true,
    usuario: s.usuario,
    loja: s.loja || "",
    perfil: s.perfil || "",
    exp: s.exp || null, // epoch seconds (se estiver no token)
  });
}
