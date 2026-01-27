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

function pad2(n){ return String(n).padStart(2, "0"); }
function pad3(n){ return String(n).padStart(3, "0"); }

/* ==========================
   ✅ São Paulo SEM perder ms
========================== */
function getSaoPauloStamp() {
  const now = new Date();
  const ms = now.getMilliseconds(); // ✅ mantém ms real

  const dtf = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(now);
  const map = {};
  for (const p of parts) map[p.type] = p.value;

  const dd = map.day;
  const mm = map.month;
  const yyyy = map.year;
  const HH = map.hour;
  const MI = map.minute;
  const SS = map.second;

  const dataHoraRede = `${dd}/${mm}/${yyyy} ${HH}:${MI}:${SS}`; // A
  const data8 = `${dd}${mm}${yyyy}`;                            // p/ documento
  const hora6 = `${HH}${MI}${SS}`;                              // p/ documento

  return { dataHoraRede, data8, hora6, ms };
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

/* =========================================
   ✅ NOVO: parser de número pt-BR
========================================= */
function parseNumeroPtBR(valor) {
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) return null;
    const s = String(valor);
    const decPart = (s.split(".")[1] || "");
    return { num: valor, decDigits: decPart.length };
  }

  const s0 = String(valor ?? "").trim();
  if (!s0) return null;

  const s = s0.replace(/\s+/g, "");
  if (!/^[0-9.,]+$/.test(s)) return null;

  const commas = (s.match(/,/g) || []).length;
  if (commas > 1) return null;

  let decDigits = 0;
  let inteiroParte = s;
  let decimalParte = "";

  if (s.includes(",")) {
    const [a, b] = s.split(",");
    inteiroParte = a;
    decimalParte = b || "";
    decDigits = decimalParte.length;
  }

  const inteiroSemPontos = inteiroParte.replace(/\./g, "");
  if (!/^\d+$/.test(inteiroSemPontos)) return null;
  if (decimalParte && !/^\d+$/.test(decimalParte)) return null;

  const numStr = decimalParte ? `${inteiroSemPontos}.${decimalParte}` : inteiroSemPontos;
  const num = Number(numStr);
  if (!Number.isFinite(num)) return null;

  return { num, decDigits };
}

function validarItem(it) {
  if (!it || typeof it !== "object") return null;

  const produto = normalizarTexto(it.produto, 200);
  const embalagem = normalizarTexto(it.embalagem, 3);

  const parsed = parseNumeroPtBR(it.quantidade);
  if (!parsed) return null;

  const quantidade = parsed.num;
  const decDigits = parsed.decDigits;

  const tipoLancamento = normalizarTexto(it.tipoLancamento, 20).toUpperCase();
  const lojaDestino = normalizarTexto(it.lojaDestino, 60);

  if (!produto) return null;
  if (!Number.isFinite(quantidade) || quantidade <= 0) return null;
  if (embalagem !== "KG" && embalagem !== "UND") return null;

  if (embalagem === "UND") {
    if (decDigits > 0) return null;
    if (!Number.isInteger(quantidade)) return null;
  } else if (embalagem === "KG") {
    if (decDigits > 3) return null;
  }

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

/* ===== Documento único (coluna L) ===== */
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
    const prefix = m[1];
    const letra  = prefix[0];
    const num    = pad2(parseInt(m[2], 10));
    return { letra, num };
  }
  return { letra: (s[0] || "X"), num: "00" };
}

function montarDocumentoUnico({ loja, usuario, spStamp }) {
  const { letra, num } = extrairLetraENumLoja(loja);

  const u = normalizarUsuarioParaId(usuario);
  const first2 = (u.slice(0,2) || "xx").padEnd(2, "x");
  const last2  = (u.slice(-2)  || "xx").padStart(2, "x");
  const user4  = `${first2}${last2}`;

  const ms3 = pad3(spStamp.ms);

  return `${letra}${num}${user4}${spStamp.data8}${spStamp.hora6}${ms3}`;
}

function tipoLabel(tipoLancamento) {
  return (tipoLancamento === "MOV_INTERNA")
    ? "Movimentação interna"
    : "Recebimento de mercadorias";
}

function statusPorTipo(tipoLancamento) {
  return (tipoLancamento === "MOV_INTERNA")
    ? "PENDENTE"
    : "Validado";
}

/* ==========================
   ✅ NOTIF WhatsApp (Cloud API)
   - dispara sem bloquear o sucesso do bono
========================== */
async function dispararNotificacaoWhatsApp({ req, lojaOrigem, usuario, dataHoraEscolhida, documento, totalItens, lojaDestino }) {
  try {
    const base = process.env.APP_BASE_URL ? String(process.env.APP_BASE_URL).replace(/\/+$/, "") : "";
    const url = base ? `${base}/api/bono-notificar` : null;
    if (!url) return { sucesso: false, mensagem: "APP_BASE_URL não configurada (sem URL para /api/bono-notificar)." };

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);

    // ✅ importante: reenviar cookie da sessão (para requireSession do endpoint)
    const cookie = req.headers?.cookie || "";

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie
      },
      body: JSON.stringify({
        lojaOrigem,
        usuario,
        dataHora: dataHoraEscolhida,
        documento,
        totalItens,
        lojaDestino
      }),
      signal: ctrl.signal
    });

    clearTimeout(t);

    const data = await resp.json().catch(() => null);
    return data || { sucesso: false, mensagem: "Sem resposta JSON do /api/bono-notificar." };
  } catch (e) {
    console.error("[BONO][NOTIF] falha:", e);
    return { sucesso: false, mensagem: String(e?.message || e) };
  }
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
    if (!v) return bad(res, 400, "Existe item inválido na lista.");
    itensValidos.push(v);
  }

  const loja = String(session.loja || "").trim();
  const usuario = String(session.usuario || "").trim();
  if (!loja || !usuario) {
    return bad(res, 401, "Sessão inválida (loja/usuário ausentes).");
  }

  const spStamp = getSaoPauloStamp();
  const documentoUnico = montarDocumentoUnico({ loja, usuario, spStamp });

  const values = itensValidos.map((it) => {
    const tipoTxt = tipoLabel(it.tipoLancamento);
    const status = statusPorTipo(it.tipoLancamento);
    const destino = it.lojaDestino || "";

    return [
      spStamp.dataHoraRede,
      dataHoraEscolhida,
      loja,
      usuario,
      encarregado,
      it.produto,
      it.quantidade,
      it.embalagem,
      destino,
      tipoTxt,
      status,
      documentoUnico
    ];
  });

  try {
    const sheets = await getSheetsClient();

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "BONO!A:L",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values }
    });

    // ✅ NOTIFICA automaticamente se for MOV_INTERNA
    const primeiroMov = itensValidos.find(x => x.tipoLancamento === "MOV_INTERNA" && x.lojaDestino);
    let notif = null;

    if (primeiroMov && primeiroMov.lojaDestino) {
      notif = await dispararNotificacaoWhatsApp({
        req,
        lojaOrigem: loja,
        usuario,
        dataHoraEscolhida,
        documento: documentoUnico,
        totalItens: values.length,
        lojaDestino: primeiroMov.lojaDestino
      });
    }

    return ok(res, {
      sucesso: true,
      message: "Bono salvo com sucesso.",
      totalItens: values.length,
      documento: documentoUnico,
      whatsapp: notif ? notif : undefined
    });
  } catch (e) {
    console.error("[BONO] Falha ao append:", e);
    return bad(res, 500, "Falha ao salvar (BONO).");
  }
}

/*
Fontes confiáveis:
- Sheets API append: https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values/append
- valueInputOption USER_ENTERED: https://developers.google.com/sheets/api/reference/rest/v4/ValueInputOption
- Intl.DateTimeFormat + formatToParts (MDN): https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/formatToParts
- Fetch API (MDN): https://developer.mozilla.org/docs/Web/API/fetch
*/
