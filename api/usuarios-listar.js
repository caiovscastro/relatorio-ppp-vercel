// /api/usuarios-listar.js
import { requireSession } from "./_authUsuarios.js";
import { bad, ok, getSheetsClient, listarUsuarios } from "./_usuariosSheet.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return bad(res, 405, "Método não permitido. Use GET.");
    }

    // ✅ no-store (igual seu /api/session)
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");

    const s = requireSession(req, res);
    if (!s) return;

    if (String(s.perfil || "").toUpperCase() !== "ADMINISTRADOR") {
      return bad(res, 403, "Sessão sem permissão para este acesso.");
    }

    const sheets = await getSheetsClient();
    const usuarios = await listarUsuarios(sheets);

    return ok(res, { sucesso: true, usuarios });
  } catch (e) {
    console.error("usuarios-listar error:", e);
    return bad(res, 500, "Erro interno ao listar usuários.");
  }
}
