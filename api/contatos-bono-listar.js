// /api/contatos-bono-listar.js
import { requireSession } from "./_authUsuarios.js";
import { bad, ok, getSheetsClientRW, SHEET_NAME, getSpreadsheetId } from "./_contatosBonoSheet.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return bad(res, 405, "Método não permitido. Use GET.");
    }

    // no-store
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");

    const s = requireSession(req, res);
    if (!s) return;

    if (String(s.perfil || "").toUpperCase() !== "ADMINISTRADOR") {
      return bad(res, 403, "Sessão sem permissão para este acesso.");
    }

    const sheets = await getSheetsClientRW();
    const spreadsheetId = getSpreadsheetId();

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A2:B`,
      valueRenderOption: "FORMATTED_VALUE",
    });

    const rows = resp.data.values || [];

    const contatos = rows
      .map(r => ({
        loja: String(r?.[0] || "").trim(),
        celular: String(r?.[1] || "").trim(),
      }))
      .filter(x => x.loja); // ignora linhas vazias

    return ok(res, { sucesso: true, contatos });

  } catch (e) {
    console.error("contatos-bono-listar error:", e);
    return bad(res, 500, "Erro interno ao listar contatos.");
  }
}
