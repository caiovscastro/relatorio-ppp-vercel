// /api/usuarios-criar.js
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { requireSession } from "./_authUsuarios.js";
import { bad, ok, getSheetsClient, ensureHeaders, SHEET_NAME, spreadsheetId } from "./_usuariosSheet.js";

// Data/hora BR (apenas para registrar na planilha)
function nowBR() {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

// ✅ ID robusto (compatível com qualquer runtime Node na Vercel)
function gerarId() {
  // 32 chars hex (equivalente a 16 bytes)
  return crypto.randomBytes(16).toString("hex");
}

// Normalização simples (evita diferenças por espaços/maiúsculas)
function normLower(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export default async function handler(req, res) {
  try {
    // Só aceita POST
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return bad(res, 405, "Método não permitido. Use POST.");
    }

    // ✅ evita cache
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");

    // Sessão obrigatória
    const s = requireSession(req, res);
    if (!s) return;

    // Somente ADMIN
    if (String(s.perfil || "").toUpperCase() !== "ADMINISTRADOR") {
      return bad(res, 403, "Sessão sem permissão para este acesso.");
    }

    // Body
    const { loja, perfil, usuario, senha, primeiroLogin } = req.body || {};
    if (!loja || !perfil || !usuario || !senha) {
      return bad(res, 400, "Campos obrigatórios ausentes.");
    }

    const lojaNorm = normLower(loja);
    const userNorm = normLower(usuario);

    // Sheets client
    const sheets = await getSheetsClient();

    // ✅ Best effort: se o header estiver protegido, não derruba a criação
    try {
      await ensureHeaders(sheets);
    } catch (e) {
      console.warn("ensureHeaders falhou (seguindo mesmo assim):", e?.message || e);
    }

    // ==========================================================
    // ✅ NOVA REGRA DE DUPLICIDADE:
    // Permite o mesmo "usuario" em lojas diferentes.
    // Bloqueia APENAS se já existir a combinação (LOJA + USUARIO).
    //
    // Planilha: A=LOJAS, B=USUARIO
    // ==========================================================
    const chk = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A2:B`, // ✅ pega LOJA e USUARIO
    });

    const rows = chk.data.values || [];

    const jaExisteNaMesmaLoja = rows.some((r) => {
      const lojaRow = normLower(r?.[0] || "");
      const userRow = normLower(r?.[1] || "");
      return lojaRow === lojaNorm && userRow === userNorm;
    });

    if (jaExisteNaMesmaLoja) {
      return bad(res, 409, "Usuário já existe nesta loja.");
    }

    // Gera id e hash da senha
    const id = gerarId();
    const hash = await bcrypt.hash(String(senha), 10);

    // Linha A-K
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

    // Append na planilha
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_NAME}!A:K`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });

    // Retorna a senha recebida (para exibir 1x no front, se foi gerada)
    return ok(res, { sucesso: true, id, senhaTemporaria: String(senha) });

  } catch (e) {
    console.error("usuarios-criar error:", e);
    return bad(res, 500, "Erro interno ao criar usuário.");
  }
}
