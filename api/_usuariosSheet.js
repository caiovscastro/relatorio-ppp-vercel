// /api/_usuariosSheet.js
//
// Helpers de USUÁRIOS (Sheets)
// - Centraliza: ENV, Sheets client, leitura/gravação, validações
// - IMPORTANTE: compatível com env vars padrão (GOOGLE_*/SPREADSHEET_ID)
//   e com suas env vars PT-BR (incluindo a que tem hífen)
//
// Referências:
// - Node process.env: https://nodejs.org/api/process.html#processenv
// - Vercel env vars: https://vercel.com/docs/projects/environment-variables
// - Google Sheets API: https://developers.google.com/sheets/api

import { google } from "googleapis";

// =============================
// ✅ ENV (compatível com PT-BR)
// =============================
// Obs: variável com hífen precisa ser acessada com colchetes
const serviceAccountEmail =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
  process.env["E-MAIL_DA_CONTA_DE_SERVICO_DO_GOOGLE"] ||
  process.env.EMAIL_DA_CONTA_DE_SERVICO_DO_GOOGLE || // se você criar sem hífen
  "";

const privateKeyRaw =
  process.env.GOOGLE_PRIVATE_KEY ||
  process.env.CHAVE_PRIVADA_DO_GOOGLE ||
  "";

const spreadsheetId =
  process.env.SPREADSHEET_ID ||
  process.env.ID_DA_PLANILHA ||
  "";

const privateKey = String(privateKeyRaw || "").replace(/\\n/g, "\n");

// =============================
// Config da aba
// =============================
export const SHEET_NAME = "USUARIOS";

// Cabeçalho padrão A:K (11 colunas) — mantém seu modelo atual
const HEADERS_AK = [
  "LOJAS",           // A
  "USUARIO",         // B
  "SENHA",           // C (hash)
  "PERFIL",          // D
  "ID",              // E
  "ATIVO",           // F
  "PRIMEIRO_LOGIN",  // G
  "CRIADO_EM",       // H
  "CRIADO_POR",      // I
  "ULT_RESET_EM",    // J
  "ULT_RESET_POR"    // K
];

// Exporta porque seu usuarios-criar.js importa "spreadsheetId"
export { spreadsheetId };

// =============================
// Helpers padrão de resposta
// =============================
export function bad(res, status, message) {
  return res.status(status).json({ sucesso: false, message });
}

export function ok(res, obj) {
  return res.status(200).json(obj);
}

// =============================
// Sheets client
// =============================
export async function getSheetsClient() {
  // ✅ Validação explícita (evita 500 “misterioso”)
  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    console.error("ENV ausente/inválida em _usuariosSheet.js:", {
      hasEmail: !!serviceAccountEmail,
      hasKey: !!privateKey,
      hasSheetId: !!spreadsheetId
    });
    throw new Error("ENV do Google Sheets ausente/inválida (email/key/spreadsheetId).");
  }

  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

// =============================
// Garantir cabeçalho A:K
// - Se não existir ou estiver diferente, escreve HEADERS_AK em A1:K1
// =============================
export async function ensureHeaders(sheets) {
  // Lê A1:K1
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A1:K1`,
  });

  const current = (resp.data.values && resp.data.values[0]) ? resp.data.values[0] : [];
  const curNorm = current.map(x => String(x || "").trim().toUpperCase());
  const expNorm = HEADERS_AK.map(x => String(x || "").trim().toUpperCase());

  const igual =
    curNorm.length >= expNorm.length &&
    expNorm.every((h, i) => (curNorm[i] || "") === h);

  if (igual) return true;

  // Escreve cabeçalho padrão
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A1:K1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADERS_AK] },
  });

  return true;
}

// =============================
// Listar usuários
// - Retorna objetos compatíveis com seu usuarios.html
// =============================
export async function listarUsuarios(sheets) {
  // Lê dados a partir da linha 2 para baixo
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A2:K`,
  });

  const values = resp.data.values || [];

  // Monta array de usuários
  const usuarios = values.map((r) => {
    const row = padToK(r);

    return {
      loja: row[0] || "",
      usuario: row[1] || "",
      // senha (hash) fica no backend, não precisamos mandar pro front
      perfil: row[3] || "",
      id: row[4] || "",
      ativo: (row[5] || "SIM") === "SIM" ? "SIM" : "NAO",
      primeiroLogin: (row[6] || "NAO") === "SIM" ? "SIM" : "NAO",
      criadoEm: row[7] || "",
      criadoPor: row[8] || "",
      ultResetEm: row[9] || "",
      ultResetPor: row[10] || ""
    };
  });

  // Opcional: remove linhas vazias (sem ID e sem usuário)
  return usuarios.filter(u => (u.id || "").trim() || (u.usuario || "").trim());
}

// =============================
// Achar linha por ID (coluna E)
// - Retorna { rowIndex, rowValues } onde rowIndex é número real no Sheets (2..)
// =============================
export async function findRowById(sheets, id) {
  const target = String(id || "").trim();
  if (!target) return null;

  // Pega coluna E (ID) a partir da linha 2
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!E2:E`,
  });

  const col = resp.data.values || [];
  const idx0 = col.findIndex(r => String((r && r[0]) || "").trim() === target);
  if (idx0 === -1) return null;

  const rowIndex = idx0 + 2; // porque começou no E2

  // Lê a linha inteira A:K dessa linha
  const rowResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A${rowIndex}:K${rowIndex}`,
  });

  const rowValues = (rowResp.data.values && rowResp.data.values[0]) ? rowResp.data.values[0] : [];
  return { rowIndex, rowValues };
}

// =============================
// Atualizar linha inteira A:K
// - rowIndex = número real da linha no Sheets
// - row = array A..K
// =============================
export async function updateRow(sheets, rowIndex, row) {
  const i = Number(rowIndex);
  if (!Number.isFinite(i) || i < 2) throw new Error("rowIndex inválido.");

  const values = [padToK(row)];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A${i}:K${i}`,
    valueInputOption: "RAW",
    requestBody: { values },
  });

  return true;
}

// =============================
// Util: garante 11 colunas (A..K)
// =============================
function padToK(row) {
  const out = Array.from(row || []);
  while (out.length < 11) out.push("");
  return out.slice(0, 11);
}
