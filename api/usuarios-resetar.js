// /api/usuarios-resetar.js
import bcrypt from "bcryptjs";
import { requireSession } from "./_authUsuarios.js";
import { bad, ok, getSheetsClient, SHEET_NAME, spreadsheetId } from "./_usuariosSheet.js";

function nowBR() {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
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

    const { id, senha, primeiroLogin } = req.body || {};
    if (!id || !senha) {
      return bad(res, 400, "Campos obrigatórios ausentes.");
    }

    const sheets = await getSheetsClient();

    // Lê A..K para encontrar:
    // - qual usuário pertence ao ID
    // - todas as linhas desse usuário
    const get = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A2:K`,
    });

    const rows = get.data.values || [];

    const idxById = rows.findIndex(r => String(r?.[4] || "").trim() === String(id).trim()); // E = ID
    if (idxById === -1) {
      return bad(res, 404, "Usuário (ID) não encontrado.");
    }

    const usuarioAlvo = String(rows[idxById]?.[1] || "").trim(); // B = USUARIO
    const usuarioNorm = normLower(usuarioAlvo);
    if (!usuarioAlvo) {
      return bad(res, 500, "Registro inválido: usuário ausente.");
    }

    // Novo hash (será aplicado a todas as lojas desse usuário)
    const novoHash = await bcrypt.hash(String(senha), 10);

    // Linhas da planilha são 1-index no Sheets; nosso range começou em A2, então:
    // linha real = (index no array) + 2
    const linhasParaAtualizar = [];
    for (let i = 0; i < rows.length; i++) {
      const u = normLower(rows[i]?.[1] || "");
      if (u === usuarioNorm) {
        linhasParaAtualizar.push(i + 2);
      }
    }

    // Atualiza C (hash), G (primeiroLogin), J (ult_reset_em), K (ult_reset_por)
    // Fazemos em batchUpdate de values para evitar várias chamadas.
    const data = linhasParaAtualizar.map(linha => ({
      range: `${SHEET_NAME}!C${linha}:C${linha}`,
      values: [[novoHash]],
    }));

    // primeiroLogin (G)
    const pl = (primeiroLogin === "SIM" ? "SIM" : "NAO");
    linhasParaAtualizar.forEach(linha => {
      data.push({ range: `${SHEET_NAME}!G${linha}:G${linha}`, values: [[pl]] });
      data.push({ range: `${SHEET_NAME}!J${linha}:J${linha}`, values: [[nowBR()]] });
      data.push({ range: `${SHEET_NAME}!K${linha}:K${linha}`, values: [[String(s.usuario || "").trim()]] });
    });

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data,
      },
    });

    return ok(res, {
      sucesso: true,
      message: `Senha resetada para o usuário "${usuarioAlvo}" em ${linhasParaAtualizar.length} loja(s).`,
      usuario: usuarioAlvo,
      lojasAfetadas: linhasParaAtualizar.length
    });

  } catch (e) {
    console.error("usuarios-resetar error:", e);
    return bad(res, 500, "Erro interno ao resetar senha.");
  }
}
