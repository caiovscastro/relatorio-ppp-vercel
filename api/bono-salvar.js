// /api/bono-salvar.js
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

function nowSaoPaulo() {
  const agora = new Date();
  return new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}

function pad2(n){ return String(n).padStart(2, "0"); }
function pad3(n){ return String(n).padStart(3, "0"); }

function dataHoraSP_ddmmyyyy_hhmmss(dt) {
  return `${pad2(dt.getDate())}/${pad2(dt.getMonth()+1)}/${dt.getFullYear()} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}:${pad2(dt.getSeconds())}`;
}

function validarDataHoraEscolhida(str) {
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

  const tipoLancamento = normalizarTexto(it.tipoLancamento, 20).toUpperCase(); // RECEBIMENTO | MOV_INTERNA
  const lojaDestino = normalizarTexto(it.lojaDestino, 60);

  if (!produto) return null;
  if (!Number.isFinite(quantidade) || quantidade <= 0) return null;
  if (embalagem !== "KG" && embalagem !== "UND") return null;

  if (tipoLancamento !== "RECEBIMENTO" && tipoLancamento !== "MOV_INTERNA") return null;
  if (tipoLancamento === "MOV_INTERNA" && !lojaDestino) return null;

  return { produto, embalagem, quantidade, tipoLancamento, lojaDestino };
}

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

/* ===== Documento único (coluna J) =====
   Formato: [LetraBandeira][NumLoja2][u2+uLast2][DDMMYYYY][HHMMSS][mmm]
   Ex: B16gava22012026124710256
*/
function normalizarUsuarioParaId(usuario){
  const s0 = String(usuario || "").trim();
  const semAcento = s0.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const soLetras = semAcento.replace(/[^a-zA-Z]/g, "").toLowerCase();
  return soLetras;
}

function extrairLetraENumLoja(loja){
  const s = String(loja || "").trim().toUpperCase();
  const m = s.match(/^(ULT|BIG)\s*(\d{1,2})\b/);
  if (m) {
    const prefix = m[1];          // ULT | BIG
    const letra  = prefix[0];     // U | B
    const num    = pad2(parseInt(m[2], 10));
    return { letra, num };
  }
  return { letra: (s[0] || "X"), num: "00" };
}

function ddmmyyyySemBarra(dt){
  return `${pad2(dt.getDate())}${pad2(dt.getMonth()+1)}${dt.getFullYear()}`;
}

function hhmmss(dt){
  return `${pad2(dt.getHours())}${pad2(dt.getMinutes())}${pad2(dt.getSeconds())}`;
}

function montarDocumentoUnico({ loja, usuario, dt }) {
  const { letra, num } = extrairLetraENumLoja(loja);

  const u = normalizarUsuarioParaId(usuario);
  const first2 = (u.slice(0,2) || "xx").padEnd(2, "x");
  const last2  = (u.slice(-2)  || "xx").padStart(2, "x");
  const user4  = `${first2}${last2}`;

  const data8 = ddmmyyyySemBarra(dt);
  const t6    = hhmmss(dt);
  const ms3   = pad3(dt.getMilliseconds());

  return `${letra}${num}${user4}${data8}${t6}${ms3}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return bad(res, 405, "Método não permitido. Use POST.");
  }

  const session = requireSession(req, res);
  if (!session) return;

  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
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
    if (!v) {
      return bad(res, 400, "Existe item inválido na lista.");
    }
    itensValidos.push(v);
  }

  const loja = String(session.loja || "").trim();
  const usuario = String(session.usuario || "").trim();
  if (!loja || !usuario) {
    return bad(res, 401, "Sessão inválida (loja/usuário ausentes).");
  }

  const dtRede = nowSaoPaulo();
  const dataHoraRede = dataHoraSP_ddmmyyyy_hhmmss(dtRede);

  // ✅ Documento único do envio (coluna J)
  const documentoUnico = montarDocumentoUnico({ loja, usuario, dt: dtRede });

  // ✅ Monta linhas (A..J)
  const values = itensValidos.map((it) => {
    const status = (it.tipoLancamento === "MOV_INTERNA") ? "PENDENTE" : "Validado";

    return [
      dataHoraRede,          // A
      dataHoraEscolhida,     // B
      loja,                  // C
      usuario,               // D
      encarregado,           // E
      it.produto,            // F
      it.quantidade,         // G
      it.embalagem,          // H
      status,                // I
      documentoUnico         // J
    ];
  });

  try {
    const sheets = await getSheetsClient();

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "BONO!A:J",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values }
    });

    return ok(res, {
      sucesso: true,
      message: "Bono salvo com sucesso.",
      totalItens: values.length,
      documento: documentoUnico
    });
  } catch (e) {
    console.error("[BONO] Falha ao append:", e);
    return bad(res, 500, "Falha ao salvar (BONO).");
  }
}

/*
Fontes confiáveis:
- Sheets API append: https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values/append
- googleapis (Node): https://github.com/googleapis/google-api-nodejs-client
- Intl / DateTimeFormat: https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl
- OWASP validação de entrada: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
*/
