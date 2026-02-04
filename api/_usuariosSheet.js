// /api/_usuariosSheet.js
import { google } from "googleapis";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const spreadsheetId = process.env.SPREADSHEET_ID;

// Aba USUARIOS (ajuste se o nome for diferente)
const SHEET_NAME = "USUARIOS";

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
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

/**
 * Garante que os headers recomendados existam, sem quebrar seu layout atual.
 * - Mantém A-E como você já tem.
 * - Se F+ não existirem, cria/atualiza a linha 1.
 */
async function ensureHeaders(sheets) {
  const range = `${SHEET_NAME}!1:1`;
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    majorDimension: "ROWS",
  });

  const row = (resp.data.values && resp.data.values[0]) ? resp.data.values[0] : [];

  // Mapeia nomes existentes (case-insensitive)
  const norm = (s) => String(s || "").trim().toUpperCase();
  const existing = row.map(norm);

  // Seus headers base (A-E) conforme print
  const base = ["LOJAS", "USUARIO", "SENHA", "PERFIL", "ID"];

  // Novos (F+)
  const extra = ["ATIVO", "PRIMEIRO_LOGIN", "CRIADO_EM", "CRIADO_POR", "ULT_RESET_EM", "ULT_RESET_POR"];

  // Se a linha estiver vazia, cria tudo
  if (row.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [base.concat(extra)] },
    });
    return;
  }

  // Garante pelo menos os base (não força rename, só preenche vazios)
  const finalRow = row.slice();
  for (let i = 0; i < base.length; i++) {
    if (!finalRow[i] || !String(finalRow[i]).trim()) finalRow[i] = base[i];
  }

  // Garante extras em sequência (F+)
  const startIdx = base.length;
  for (let i = 0; i < extra.length; i++) {
    const idx = startIdx + i;
    if (!finalRow[idx] || !String(finalRow[idx]).trim()) finalRow[idx] = extra[i];
  }

  // Atualiza só se mudou algo
  const changed = finalRow.length !== row.length || finalRow.some((v, i) => v !== row[i]);
  if (changed) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [finalRow] },
    });
  }
}

/**
 * Busca todos usuários a partir da linha 2.
 * Retorna objetos com campos padronizados.
 */
async function listarUsuarios(sheets) {
  await ensureHeaders(sheets);

  const range = `${SHEET_NAME}!A2:K`; // Até K para pegar colunas extras
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values = resp.data.values || [];

  return values
    .map((r) => {
      const loja = r[0] || "";
      const usuario = r[1] || "";
      const senhaHashOuTexto = r[2] || "";
      const perfil = r[3] || "";
      const id = r[4] || "";
      const ativo = r[5] || "SIM";
      const primeiroLogin = r[6] || "NAO";

      // Não retornamos senha/hash pro front
      return { loja, usuario, perfil, id, ativo, primeiroLogin };
    })
    .filter((u) => u.usuario && u.id);
}

/**
 * Encontra a linha (1-based) pelo ID, buscando em E.
 * Retorna { rowIndex, rowValues } ou null.
 */
async function findRowById(sheets, id) {
  const range = `${SHEET_NAME}!A2:K`;
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values = resp.data.values || [];

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const rowId = row[4] || "";
    if (String(rowId).trim() === String(id).trim()) {
      // Linha real na planilha = i + 2 (porque começamos em A2)
      return { rowIndex: i + 2, rowValues: row };
    }
  }
  return null;
}

/**
 * Atualiza uma linha específica (por índice 1-based) com um array A-K.
 */
async function updateRow(sheets, rowIndex, valuesAtoK) {
  const range = `${SHEET_NAME}!A${rowIndex}:K${rowIndex}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values: [valuesAtoK] },
  });
}

export {
  bad, ok,
  spreadsheetId, SHEET_NAME,
  getSheetsClient,
  listarUsuarios,
  findRowById,
  updateRow,
  ensureHeaders
};
