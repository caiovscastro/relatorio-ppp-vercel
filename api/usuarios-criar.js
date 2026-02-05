// /api/usuarios-criar.js
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { requireSession } from "./_authUsuarios.js";
import { bad, ok, getSheetsClient, ensureHeaders, SHEET_NAME, spreadsheetId } from "./_usuariosSheet.js";

function nowBR() {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function gerarId() {
  return crypto.randomBytes(16).toString("hex");
}

function normLower(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
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

    const lojaNorm = normLower(loja);
    const userNorm = normLower(usuario);

    const sheets = await getSheetsClient();

    try { await ensureHeaders(sheets); } catch (e) {
      console.warn("ensureHeaders falhou (seguindo mesmo assim):", e?.message || e);
    }

    // ==========================================================
    // Lê A..K para:
    // - bloquear duplicidade (LOJA+USUARIO)
    // - detectar se o usuario já existe em outra loja (para herdar hash)
    // Colunas:
    // A LOJAS | B USUARIO | C SENHA_HASH | D PERFIL | E ID | F ATIVO | G PRIMEIRO_LOGIN | ...
    // ==========================================================
    const get = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A2:K`,
    });

    const rows = get.data.values || [];

    // 1) Bloqueia duplicidade só para (LOJA+USUARIO)
    const existeNaMesmaLoja = rows.some(r => {
      const lojaRow = normLower(r?.[0] || "");
      const userRow = normLower(r?.[1] || "");
      return lojaRow === lojaNorm && userRow === userNorm;
    });
    if (existeNaMesmaLoja) {
      return bad(res, 409, "Usuário já existe nesta loja.");
    }

    // 2) Se usuário já existir em qualquer loja, herda o hash (senha global)
    let hashGlobal = null;
    const rowExistente = rows.find(r => normLower(r?.[1] || "") === userNorm);
    if (rowExistente) {
      hashGlobal = String(rowExistente?.[2] || "").trim(); // C: hash existente
      if (!hashGlobal) {
        return bad(res, 500, "Usuário existe, mas o hash da senha está inválido na base.");
      }
    } else {
      // usuário novo -> gera hash a partir da senha enviada
      hashGlobal = await bcrypt.hash(String(senha), 10);
    }

    const id = gerarId();

    const row = [
      String(loja).trim(),                          // A
      String(usuario).trim(),                       // B
      hashGlobal,                                   // C (sempre global por usuário)
      String(perfil).trim().toUpperCase(),          // D
      id,                                           // E
      "SIM",                                        // F
      (primeiroLogin === "SIM" ? "SIM" : "NAO"),    // G
      nowBR(),                                      // H
      String(s.usuario || "").trim(),               // I
      "",                                           // J
      ""                                            // K
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_NAME}!A:K`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });

    // ⚠️ Nota: se o usuário já existia, a senha NÃO foi alterada (continuou a mesma global).
    // O front pode continuar exibindo senhaTemporaria apenas quando for usuário novo.
    const usuarioEraNovo = !rowExistente;

    return ok(res, {
      sucesso: true,
      id,
      usuarioNovo: usuarioEraNovo,
      senhaTemporaria: usuarioEraNovo ? String(senha) : null
    });

  } catch (e) {
    console.error("usuarios-criar error:", e);
    return bad(res, 500, "Erro interno ao criar usuário.");
  }
}
