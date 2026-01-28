// /api/bono-listar.js
import { google } from "googleapis";
import { requireSession } from "./_authUsuarios.js";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const spreadsheetId = process.env.SPREADSHEET_ID;

// ✅ Agora inclui a coluna M (Fornecedor)
const RANGE_LISTAR = "BONO!A:M";

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

function normStr(v) {
  return String(v ?? "").trim();
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
    K: row[10] ?? "", // Status (ex.: "Validado" / "PENDENTE")
    L: row[11] ?? "", // Documento
    M: row[12] ?? "", // ✅ Fornecedor
  };
}

function linhaEhVazia(row = []) {
  return row.every((c) => normStr(c) === "");
}

function primeiraLinhaPareceCabecalho(row = []) {
  const r = row.map((c) => normStr(c).toLowerCase());
  const joined = r.join(" ");
  const pistas = [
    "data", "hora", "loja", "origem", "destino", "usuário", "usuario",
    "respons", "produto", "quant", "embal", "tipo", "status", "documento", "doc",
    "fornecedor"
  ];
  const hits = pistas.reduce((acc, p) => acc + (joined.includes(p) ? 1 : 0), 0);
  return hits >= 3;
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
      range: RANGE_LISTAR,
      majorDimension: "ROWS",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const values = Array.isArray(resp.data.values) ? resp.data.values : [];

    let rows = values.filter((r) => Array.isArray(r) && !linhaEhVazia(r));

    if (rows.length && primeiraLinhaPareceCabecalho(rows[0])) {
      rows = rows.slice(1);
    }

    const linhas = rows
      .map(normalizarLinha)
      .filter((r) => normStr(r.L) !== "" || normStr(r.F) !== "");

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
