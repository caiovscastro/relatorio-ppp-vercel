// /api/bono-listar.js
// Lê dados do Google Sheets e retorna JSON no formato esperado pelo front:
// { sucesso: true, dados: [...] }
//
// Requisitos:
// - npm i googleapis
// - Variáveis de ambiente (Vercel / .env):
//   SHEETS_SPREADSHEET_ID=...
//   SHEETS_TAB_NAME=...              (ex: "BONO" ou "BASE_DADOS")
//   SHEETS_RANGE=A:L                 (opcional; default A:L)
//   GOOGLE_SERVICE_ACCOUNT_EMAIL=...
//   GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

import { google } from "googleapis";

function json(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function getEnv(name, required = true) {
  const v = process.env[name];
  if (required && (!v || !String(v).trim())) throw new Error(`ENV ausente: ${name}`);
  return v;
}

function getPrivateKey() {
  // No Vercel, normalmente você cola a chave com \n.
  // Aqui a gente normaliza.
  const raw = getEnv("GOOGLE_PRIVATE_KEY");
  return raw.replace(/\\n/g, "\n");
}

async function readSheetValues({ spreadsheetId, tabName, rangeA1 }) {
  const auth = new google.auth.JWT({
    email: getEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    key: getPrivateKey(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!${rangeA1}`,
    majorDimension: "ROWS",
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  return resp.data?.values || [];
}

function normalizeRowsToAL(values) {
  // Mantém exatamente o padrão do seu front: A..L (12 colunas)
  // Primeira linha pode ser cabeçalho; você decide se remove ou não.
  // Aqui eu removo se detectar “cara” de cabeçalho (string na 1ª linha).
  const rows = Array.isArray(values) ? values : [];
  if (!rows.length) return [];

  const looksHeader = rows[0].some((c) => typeof c === "string" && /data|loja|usuario|tipo|status|documento/i.test(c));
  const dataRows = looksHeader ? rows.slice(1) : rows;

  return dataRows.map((r) => {
    const row = Array.isArray(r) ? r : [];
    const pick = (i) => (row[i] ?? "");
    return {
      A: pick(0),  B: pick(1),  C: pick(2),  D: pick(3),
      E: pick(4),  F: pick(5),  G: pick(6),  H: pick(7),
      I: pick(8),  J: pick(9),  K: pick(10), L: pick(11),
    };
  });
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return json(res, 405, { sucesso: false, erro: "Método não permitido" });
    }

    // (Opcional) Se quiser bloquear cache:
    res.setHeader("Cache-Control", "no-store");

    const spreadsheetId = getEnv("SHEETS_SPREADSHEET_ID");
    const tabName = getEnv("SHEETS_TAB_NAME");
    const rangeA1 = (process.env.SHEETS_RANGE || "A:L").trim();

    const values = await readSheetValues({ spreadsheetId, tabName, rangeA1 });
    const dados = normalizeRowsToAL(values);

    return json(res, 200, {
      sucesso: true,
      dados,
      total: dados.length,
    });
  } catch (err) {
    const msg = err?.message || String(err);
    return json(res, 500, { sucesso: false, erro: msg });
  }
}
