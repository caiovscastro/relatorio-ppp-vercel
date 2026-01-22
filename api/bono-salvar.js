// /api/bono-salvar.js
// Grava itens do Bono na aba BONO (A..H) em lote.
//
// Colunas:
// A: Data/Hora da rede (server SP)  -> "DD/MM/AAAA HH:MM:SS"
// B: Data/Hora escolhida            -> "DD/MM/AAAA HH:MM"
// C: Loja (sessão)
// D: Usuário (sessão)
// E: Encarregado
// F: Descrição do produto
// G: Quantidade
// H: Embalagem (KG/UND)
//
// Variáveis de ambiente (PADRÃO DO PROJETO):
// - GOOGLE_SERVICE_ACCOUNT_EMAIL
// - GOOGLE_PRIVATE_KEY
// - SPREADSHEET_ID

import { google } from "googleapis";
import { requireSession } from "./_authUsuarios.js";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const spreadsheetId = process.env.SPREADSHEET_ID;

function ok(res, obj) {
  return res.status(200).json(obj);
}
function bad(res, status, message) {
  return res.status(status).json({ sucesso: false, message });
}

function agoraSP_ddmmyyyy_hhmmss() {
  const dtf = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return dtf.format(new Date()).replace(",", "");
}

function validarDataHoraEscolhida(str) {
  // "DD/MM/AAAA HH:MM"
  if (!str || typeof str !== "string") return false;
  const s = str.trim();
  const re = /^(\d{2})\/(\d{2})\/(\d{4})\s(\d{2}):(\d{2})$/;
  const m = s.match(re);
  if (!m) return false;

  const dd = Number(m[1]), mm = Number(m[2]), yyyy = Number(m[3]);
  const hh = Number(m[4]), min = Number(m[5]);

  if (mm < 1 || mm > 12) return false;
  if (dd < 1 || dd > 31) return false;
  if (hh < 0 || hh > 23) return false;
  if (min < 0 || min > 59) return false;
  if (yyyy < 2020 || yyyy > 2100) return false;

  return true;
}

function normalizarTexto(x, max) {
  const s = String(x || "").trim();
  if (!s) return "";
  return s.length > max ? s.slice(0, max) : s;
}

function validarItem(it) {
  if (!it || typeof it !== "object") return null;

  const produto = normalizarTexto(it.produto, 200);
  const embalagem = normalizarTexto(it.embalagem, 3);
  const quantidade = Number(it.quantidade);

  if (!produto) return null;
  if (!Number.isFinite(quantidade) || quantidade <= 0) return null;
  if (embalagem !== "KG" && embalagem !== "UND") return null;

  return { produto, embalagem, quantidade };
}

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return bad(res, 405, "Método não permitido. Use POST.");
  }

  // ✅ Exige sessão válida (igual ao resto do projeto)
  const session = requireSession(req, res);
  if (!session) return;

  // ✅ Fail-fast env (igual ao seu padrão)
  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    console.error("[BONO] ENV ausente:", {
      hasEmail: !!serviceAccountEmail,
      hasKey: !!privateKey,
      hasSheet: !!spreadsheetId,
    });
    return bad(res, 500, "Configuração do servidor incompleta (credenciais/planilha).");
  }

  const body = req.body || {};
  const dataHoraEscolhida = normalizarTexto(body.dataHoraEscolhida, 20);
  const encarregado = normalizarTexto(body.encarregado, 80);
  const itens = Array.isArray(body.itens) ? body.itens : [];

  if (!validarDataHoraEscolhida(dataHoraEscolhida)) {
    return bad(res, 400, "Data/Hora escolhida inválida.");
  }
  if (!encarregado) {
    return bad(res, 400, "Nome do encarregado é obrigatório.");
  }
  if (!itens.length) {
    return bad(res, 400, "Adicione pelo menos 1 item.");
  }

  const itensValidos = [];
  for (const it of itens) {
    const v = validarItem(it);
    if (!v) return bad(res, 400, "Existe item inválido na lista.");
    itensValidos.push(v);
  }

  const loja = String(session.loja || "").trim();
  const usuario = String(session.usuario || "").trim();
  if (!loja || !usuario) {
    return bad(res, 401, "Sessão inválida (loja/usuário ausentes).");
  }

  const dataHoraRede = agoraSP_ddmmyyyy_hhmmss();

  const values = itensValidos.map((it) => ([
    dataHoraRede,        // A
    dataHoraEscolhida,   // B
    loja,                // C
    usuario,             // D
    encarregado,         // E
    it.produto,          // F
    it.quantidade,       // G
    it.embalagem,        // H
  ]));

  try {
    const sheets = await getSheetsClient();

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "BONO!A:H",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });

    return ok(res, {
      sucesso: true,
      message: "Bono salvo com sucesso.",
      totalItens: values.length,
    });
  } catch (e) {
    console.error("[BONO] Falha ao append:", e);
    return bad(res, 500, "Falha ao salvar (BONO).");
  }
}

/*
Fontes confiáveis:
- Sheets API (append): https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values/append
- googleapis (Node): https://github.com/googleapis/google-api-nodejs-client
- Vercel env vars: https://vercel.com/docs/projects/environment-variables
- OWASP validação de entrada: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
*/
