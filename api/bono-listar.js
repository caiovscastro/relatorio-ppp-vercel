// /api/bono-listar.js
import { google } from "googleapis";
import { requireSession } from "./_authUsuarios.js";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const spreadsheetId = process.env.SPREADSHEET_ID;

function bad(res, status, message) {
  return res.status(status).json({ sucesso: false, message });
}

function ok(res, obj) {
  return res.status(200).json(obj);
}

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({ version: "v4", auth });
}

function normalizarLinha(row = []) {
  return {
    A: row[0] ?? "",  // Data/Hora rede
    B: row[1] ?? "",  // Data/Hora escolhida
    C: row[2] ?? "",  // Loja origem
    D: row[3] ?? "",  // Usuário
    E: row[4] ?? "",  // Responsável
    F: row[5] ?? "",  // Produto
    G: row[6] ?? "",  // Quantidade
    H: row[7] ?? "",  // Embalagem
    I: row[8] ?? "",  // Loja destino
    J: row[9] ?? "",  // Tipo
    K: row[10] ?? "", // Status
    L: row[11] ?? "", // Documento
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return bad(res, 405, "Método não permitido. Use GET.");
  }

  const session = requireSession(req, res);
  if (!session) return;

  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return bad(res, 500, "Configuração do servidor incompleta.");
  }

  try {
    const sheets = await getSheetsClient();

    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "BONO!A:L",
      majorDimension: "ROWS",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const values = resp.data.values || [];

    // remove cabeçalho se existir
    const linhas = values.slice(1).map(normalizarLinha);

    return ok(res, {
      sucesso: true,
      dados: linhas,
      total: linhas.length,
    });

  } catch (e) {
    console.error("[BONO-LISTAR] Erro:", e);
    return bad(res, 500, "Falha ao listar registros do BONO.");
  }
}
