// /api/usuarios-atualizar.js
import { requireSession } from "./_authUsuarios.js";
import { bad, ok, getSheetsClient, findRowById, updateRow } from "./_usuariosSheet.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return bad(res, 405, "Método não permitido. Use POST.");
    }

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");

    const s = requireSession(req, res);
    if (!s) return;

    if (String(s.perfil || "").toUpperCase() !== "ADMINISTRADOR") {
      return bad(res, 403, "Sessão sem permissão para este acesso.");
    }

    const { id, loja, perfil, ativo } = req.body || {};
    if (!id) return bad(res, 400, "ID é obrigatório.");

    const sheets = await getSheetsClient();
    const found = await findRowById(sheets, id);
    if (!found) return bad(res, 404, "Usuário não encontrado.");

    const row = padToK(found.rowValues);

    if (typeof loja === "string" && loja.trim()) row[0] = loja.trim();
    if (typeof perfil === "string" && perfil.trim()) row[3] = perfil.trim().toUpperCase();
    if (ativo === "SIM" || ativo === "NAO") row[5] = ativo;

    await updateRow(sheets, found.rowIndex, row);
    return ok(res, { sucesso: true });

  } catch (e) {
    console.error("usuarios-atualizar error:", e);
    return bad(res, 500, "Erro interno ao atualizar usuário.");
  }
}

function padToK(row) {
  const out = Array.from(row || []);
  while (out.length < 11) out.push("");
  return out.slice(0, 11);
}
