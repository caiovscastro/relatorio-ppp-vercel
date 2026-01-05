// api/session.js
//
// Session PPP
// - Endpoint para o front verificar se existe sessão válida.
// - Retorna dados mínimos: usuario/loja/perfil/exp.
// - Se sessão for inválida/ausente, requireSession responde 401.
// - Não deve ser cacheado (no-store).
//
// Importante:
// - Protege páginas do front (painel.html, dashboard.html, etc.)
// - A autenticação real acontece no backend (cookie HttpOnly assinado).

import { requireSession } from "./_authUsuarios.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      sucesso: false,
      message: "Método não permitido. Use GET."
    });
  }

  // ✅ Evita cache (browser/proxy/CDN)
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");

  // Se quiser restringir perfis:
  // const s = requireSession(req, res, { allowedProfiles: ["ADMINISTRADOR","GERENTE_PPP","BASE_PPP"] });

  const s = requireSession(req, res);
  if (!s) return; // requireSession já respondeu 401/403

  return res.status(200).json({
    sucesso: true,
    usuario: s.usuario,
    loja: s.loja || "",
    perfil: s.perfil || "",
    exp: s.exp || null // epoch seconds (JWT exp) se estiver no token
  });
}
