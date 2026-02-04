// /api/usuarios-atualizar.js
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

    const { id, loja, perfil, ativo } = req.body || {};
    if (!id) return bad(res, 400, "ID é obrigatório.");

    const sheets = await getSheetsClient();
    const found = await findRowById(sheets, id);
    if (!found) return bad(res, 404, "Usuário não encontrado.");

    const row = found.rowValues;

    // Índices A-K:
    // 0 loja, 1 usuario, 2 hash, 3 perfil, 4 id, 5 ativo, 6 primeiro_login, 7 criado_em, 8 criado_por, 9 ult_reset_em, 10 ult_reset_por
    if (typeof loja === "string" && loja.trim()) row[0] = loja.trim();
    if (typeof perfil === "string" && perfil.trim()) row[3] = perfil.trim();
    if (ativo === "SIM" || ativo === "NAO") row[5] = ativo;

    // Se desativou, você pode (opcional) marcar um log em colunas futuras.
    // Mantive só o ATIVO por simplicidade.

    await updateRow(sheets, found.rowIndex, padToK(row));
    return ok(res, { sucesso: true, atualizadoEm: nowBR() });

  } catch (e) {
    return bad(res, 500, "Erro ao atualizar usuário.");
  }
}

function padToK(row) {
  const out = Array.from(row || []);
  while (out.length < 11) out.push("");
  return out.slice(0, 11);
}
