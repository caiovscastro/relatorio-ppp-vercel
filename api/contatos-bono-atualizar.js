// /api/contatos-bono-atualizar.js
import { requireSession } from "./_authUsuarios.js";
import { bad, ok, getSheetsClientRW, SHEET_NAME, getSpreadsheetId } from "./_contatosBonoSheet.js";

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

    const { loja, celular } = req.body || {};
    const lojaKey = String(loja || "").trim();
    const celNew = String(celular || "").trim();

    if (!lojaKey || !celNew) {
      return bad(res, 400, "Loja e celular são obrigatórios.");
    }

    const sheets = await getSheetsClientRW();
    const spreadsheetId = getSpreadsheetId();

    // Busca linha da loja em A2:A
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A2:A`,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const colA = resp.data.values || [];
    let foundIndex = -1; // 0-based dentro do A2:A

    for (let i = 0; i < colA.length; i++) {
      const v = String(colA[i]?.[0] || "").trim();
      if (v === lojaKey) { foundIndex = i; break; }
    }

    if (foundIndex < 0) {
      return bad(res, 404, "Loja não encontrada na aba CONTATOS_BONO.");
    }

    // Linha real na planilha: A2 é linha 2 => index 0 => linha 2
    const rowNumber = foundIndex + 2;

    // Atualiza coluna B dessa linha
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_NAME}!B${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [[celNew]] },
    });

    return ok(res, { sucesso: true });

  } catch (e) {
    console.error("contatos-bono-atualizar error:", e);
    return bad(res, 500, "Erro interno ao atualizar contato.");
  }
}
