// /api/usuarios-listar.js
import { requireSession } from "./authUsuarios.js";
import { bad, ok, getSheetsClient, listarUsuarios } from "./_usuariosSheet.js";

export default async function handler(req, res) {
  try {
    const session = await requireSession(req, res);
    if (!session) return; // requireSession já respondeu

    if (session.perfil !== "ADMINISTRADOR") {
      return bad(res, 403, "Acesso negado.");
    }

    const sheets = await getSheetsClient();
    const usuarios = await listarUsuarios(sheets);
    return ok(res, { sucesso: true, usuarios });

  } catch (e) {
    return bad(res, 500, "Erro ao listar usuários.");
  }
}
