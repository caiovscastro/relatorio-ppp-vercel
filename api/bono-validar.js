// /api/bono-validar.js
// Atualiza o status para "Validado" em todas as linhas do documento informado.
//
// ⚠️ Configurar ENV VARS na Vercel:
// - GOOGLE_SERVICE_ACCOUNT_EMAIL
// - GOOGLE_PRIVATE_KEY
// - SHEET_ID
// - SHEET_TAB_BONO   (ex: "BONO" ou o nome da aba)
//
// ⚠️ A planilha precisa estar compartilhada com GOOGLE_SERVICE_ACCOUNT_EMAIL (permissão Editor).
//
// Estrutura esperada (colunas A..L):
// K: Status
// L: Documento

import { google } from "googleapis";

function normStr(v) {
  return String(v ?? "").trim();
}
function normKey(v) {
  return normStr(v).toUpperCase().replace(/\s+/g, " ");
}

function statusToWrite(status) {
  // Normaliza entradas diversas para o valor gravado na planilha
  const s = normKey(status);
  if (s.includes("VALID")) return "Validado";
  if (s.includes("PEND")) return "PENDENTE";
  // fallback: se vier vazio, força Validado (porque esta rota é de validação)
  return "Validado";
}

function getAuth() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!clientEmail || !privateKey) {
    throw new Error("ENV ausente: GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY");
  }

  // Corrige quebras de linha do private key quando salvo em ENV
  privateKey = privateKey.replace(/\\n/g, "\n");

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ sucesso: false, erro: "Método não permitido" });
    }

    const sheetId = process.env.SHEET_ID;
    const tabName = process.env.SHEET_TAB_BONO;

    if (!sheetId || !tabName) {
      return res.status(500).json({
        sucesso: false,
        erro: "ENV ausente: SHEET_ID e/ou SHEET_TAB_BONO",
      });
    }

    // Body pode vir como string (dependendo do runtime)
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const documento = normStr(body.documento);
    const status = statusToWrite(body.status);

    if (!documento) {
      return res.status(400).json({ sucesso: false, erro: "Campo 'documento' é obrigatório" });
    }

    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // Lê a aba (A:L) para localizar linhas do documento
    // (interno) Ajuste o range se sua aba tiver mais colunas; aqui precisamos até L.
    const rangeLeitura = `${tabName}!A:L`;
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: rangeLeitura,
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const values = Array.isArray(r.data.values) ? r.data.values : [];

    if (values.length <= 1) {
      // Sem dados (ou só cabeçalho)
      return res.status(200).json({ sucesso: true, atualizadas: 0 });
    }

    // Procura linhas cujo Documento (coluna L = índice 11) bate com o documento
    // OBS: assumindo cabeçalho na linha 1
    const updates = [];
    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      const docCell = normStr(row[11]); // L

      if (docCell && normKey(docCell) === normKey(documento)) {
        const sheetRow = i + 1; // porque i=1 é linha 2
        // Status é coluna K
        updates.push({
          range: `${tabName}!K${sheetRow}`,
          values: [[status]],
        });
      }
    }

    if (!updates.length) {
      return res.status(404).json({
        sucesso: false,
        erro: "Documento não encontrado na aba",
      });
    }

    // Aplica updates em lote
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: updates,
      },
    });

    return res.status(200).json({
      sucesso: true,
      atualizadas: updates.length,
      status_gravado: status,
    });
  } catch (err) {
    console.error("bono-validar erro:", err);

    // Tenta devolver uma mensagem útil
    const msg = (err && err.message) ? err.message : "Erro interno";
    return res.status(500).json({ sucesso: false, erro: msg });
  }
}
