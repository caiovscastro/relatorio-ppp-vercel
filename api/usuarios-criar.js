// /api/usuarios-criar.js
import bcrypt from "bcryptjs";
import { requireSession } from "./authUsuarios.js";
import { bad, ok, getSheetsClient, ensureHeaders, SHEET_NAME, spreadsheetId } from "./_usuariosSheet.js";

function nowBR() {
  // Ajuste se quiser outro formato
  const d = new Date();
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function gerarId() {
  // Node 18+ (Vercel): crypto.randomUUID disponível
  return crypto.randomUUID();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return bad(res, 405, "Método não permitido.");

    const session = await requireSession(req, res);
    if (!session) return;

    if (session.perfil !== "ADMINISTRADOR") {
      return bad(res, 403, "Acesso negado.");
    }

    const { loja, perfil, usuario, senha, primeiroLogin } = req.body || {};
    if (!loja || !perfil || !usuario || !senha) {
      return bad(res, 400, "Campos obrigatórios ausentes.");
    }

    const sheets = await getSheetsClient();
    await ensureHeaders(sheets);

    // Checa duplicidade de usuário (B)
    const chk = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!B2:B`,
    });
    const colB = (chk.data.values || []).map(r => String(r[0] || "").trim().toLowerCase());
    if (colB.includes(String(usuario).trim().toLowerCase())) {
      return bad(res, 409, "Usuário já existe.");
    }

    const id = gerarId();
    const hash = await bcrypt.hash(String(senha), 10);

    // Monta linha A-K
    const row = [
      String(loja).trim(),                 // A LOJAS
      String(usuario).trim(),              // B USUARIO
      hash,                                // C SENHA (vira hash)
      String(perfil).trim(),               // D PERFIL
      id,                                  // E ID
      "SIM",                               // F ATIVO
      (primeiroLogin === "SIM" ? "SIM" : "NAO"), // G PRIMEIRO_LOGIN
      nowBR(),                             // H CRIADO_EM
      String(session.usuario || "").trim(),// I CRIADO_POR
      "",                                  // J ULT_RESET_EM
      ""                                   // K ULT_RESET_POR
    ];

    // Append (evita sobrescrever linha em concorrência)
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_NAME}!A:K`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });

    // Se você gerou senha automaticamente no front, pode retornar ela aqui também.
    // (Atenção: só retorne se você realmente precisa.)
    return ok(res, {
      sucesso: true,
      id,
      senhaTemporaria: String(senha) // útil quando for "gerar" no front
    });

  } catch (e) {
    return bad(res, 500, "Erro ao criar usuário.");
  }
}
