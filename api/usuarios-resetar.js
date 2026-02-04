// /api/usuarios-resetar.js
import bcrypt from "bcryptjs";
import { requireSession } from "./authUsuarios.js";
import { bad, ok, getSheetsClient, findRowById, updateRow } from "./_usuariosSheet.js";

function nowBR() {
  const d = new Date();
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "Método não permitido.");

    const session = await requireSession(req, res);
    if (!session) return;

    if (session.perfil !== "ADMINISTRADOR") {
      return bad(res, 403, "Acesso negado.");
    }

    const { id, senha, primeiroLogin } = req.body || {};
    if (!id || !senha) return bad(res, 400, "ID e senha são obrigatórios.");

    const sheets = await getSheetsClient();
    const found = await findRowById(sheets, id);
    if (!found) return bad(res, 404, "Usuário não encontrado.");

    const row = found.rowValues;

    // Se usuário estiver desativado, você pode bloquear reset (opcional)
    const ativo = (row[5] || "SIM");
    if (ativo !== "SIM") return bad(res, 400, "Usuário desativado.");

    const hash = await bcrypt.hash(String(senha), 10);

    // C = hash
    row[2] = hash;

    // G = primeiro login
    row[6] = (primeiroLogin === "SIM") ? "SIM" : "NAO";

    // J/K = log reset
    row[9] = nowBR();
    row[10] = String(session.usuario || "").trim();

    await updateRow(sheets, found.rowIndex, padToK(row));
    return ok(res, { sucesso: true });

  } catch (e) {
    return bad(res, 500, "Erro ao resetar senha.");
  }
}

function padToK(row) {
  const out = Array.from(row || []);
  while (out.length < 11) out.push("");
  return out.slice(0, 11);
}
