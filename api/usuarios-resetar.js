// /api/usuarios-resetar.js
import bcrypt from "bcryptjs";
import { requireSession } from "./_authUsuarios.js";
import { bad, ok, getSheetsClient, findRowById, updateRow } from "./_usuariosSheet.js";

function nowBR() {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

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

    const { id, senha, primeiroLogin } = req.body || {};
    if (!id || !senha) return bad(res, 400, "ID e senha são obrigatórios.");

    const sheets = await getSheetsClient();
    const found = await findRowById(sheets, id);
    if (!found) return bad(res, 404, "Usuário não encontrado.");

    const row = padToK(found.rowValues);

    const ativo = (row[5] || "SIM");
    if (ativo !== "SIM") return bad(res, 400, "Usuário desativado.");

    row[2] = await bcrypt.hash(String(senha), 10);              // C hash
    row[6] = (primeiroLogin === "SIM") ? "SIM" : "NAO";         // G
    row[9] = nowBR();                                           // J
    row[10] = String(s.usuario || "").trim();                   // K

    await updateRow(sheets, found.rowIndex, row);
    return ok(res, { sucesso: true });

  } catch (e) {
    console.error("usuarios-resetar error:", e);
    return bad(res, 500, "Erro interno ao resetar senha.");
  }
}

function padToK(row) {
  const out = Array.from(row || []);
  while (out.length < 11) out.push("");
  return out.slice(0, 11);
}
