// api/session.js
//
// Session PPP
// - Endpoint para o front verificar se existe sessão válida.
// - Retorna dados mínimos: usuario/loja/perfil/exp.
// - IMPORTANTE: permite sessão mesmo quando há troca obrigatória de senha.

import { requireSession } from "./_authUsuarios.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      sucesso: false,
      message: "Método não permitido. Use GET."
    });
  }

  // ✅ Evita cache
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");

  // ✅ AQUI ESTÁ A CORREÇÃO
  // Permite sessão mesmo com forcePwdChange=true
  const s = requireSession(req, res, { allowForcePwdChange: true });
  if (!s) return;

  return res.status(200).json({
    sucesso: true,
    usuario: s.usuario,
    loja: s.loja || "",
    perfil: s.perfil || "",
    forcePwdChange: !!s.forcePwdChange,
    exp: s.exp || null
  });
}
