// api/session.js
//
// Session PPP
// - Endpoint para o front verificar se existe sessão válida.
// - Retorna dados mínimos (usuario/loja/perfil/exp).
// - Se sessão for inválida/ausente, requireSession responde 401.
// - (Opcional) pode restringir perfis permitidos aqui.
//
// Importante:
// - Protege a UI sem depender de localStorage/sessionStorage.
// - A proteção REAL deve estar também em endpoints sensíveis (ex.: /api/relatorio, /api/upload-imagem etc.)

import { requireSession } from "./_authUsuarios.js";

export default function handler(req, res) {
  // ✅ Segurança: nunca cachear endpoint de sessão
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use GET." });
  }

  // ✅ Se você quiser que este endpoint também restrinja perfis:
  // (isso é útil para “barreira de UI”; mas NÃO substitui a validação nos endpoints sensíveis)
  // const s = requireSession(req, res, { allowedProfiles: ["ADMINISTRADOR","GERENTE_PPP","BASE_PPP"] });

  const s = requireSession(req, res);

  // requireSession já respondeu 401/403 se falhar
  if (!s) return;

  // ✅ exp no seu token é SEMPRE epoch seconds (JWT-style), porque é criado assim no _authUsuarios.js
  return res.status(200).json({
    sucesso: true,
    usuario: s.usuario,
    loja: s.loja || "",
    perfil: s.perfil || "",
    exp: typeof s.exp === "number" ? s.exp : null, // epoch seconds
  });
}
