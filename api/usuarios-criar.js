// /api/usuarios-criar.js
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { requireSession } from "./_authUsuarios.js";
import { bad, ok, getSheetsClient, ensureHeaders, SHEET_NAME, spreadsheetId } from "./_usuariosSheet.js";

function nowBR() {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function gerarId() {
  // ✅ agora funciona (crypto importado)
  return crypto.randomUUID();
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

    const { loja, perfil, usuario, senha, primeiroLogin } = req.body || {};
    if (!loja || !perfil || !usuario || !senha) {
      return bad(res, 400, "Campos obrigatórios ausentes.");
    }

    const sheets = await getSheetsClient();
    await ensureHeaders(sheets);

    // Checa duplicidade de usuário (coluna B)
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

    // A-K
    const row = [
      String(loja).trim(),                           // A LOJAS
      String(usuario).trim(),                        // B USUARIO
      hash,                                          // C SENHA (hash)
      String(perfil).trim().toUpperCase(),           // D PERFIL
      id,                                            // E ID
      "SIM",                                         // F ATIVO
      (primeiroLogin === "SIM" ? "SIM" : "NAO"),     // G PRIMEIRO_LOGIN
      nowBR(),                                       // H CRIADO_EM
      String(s.usuario || "").trim(),                // I CRIADO_POR
      "",                                            // J ULT_RESET_EM
      ""                                             // K ULT_RESET_POR
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_NAME}!A:K`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });

    // Retorna a senha que chegou (pra você exibir 1x no front se estiver gerando)
    return ok(res, { sucesso: true, id, senhaTemporaria: String(senha) });

  } catch (e) {
    console.error("usuarios-criar error:", e);
    return bad(res, 500, "Erro interno ao criar usuário.");
  }
}
