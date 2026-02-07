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
  const ms = now.getMilliseconds();

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
   ✅ Placa: A-Z0-9, maiúsculo, máx 7
========================================= */
function normalizarPlaca(x) {
  const up = String(x || "").toUpperCase().trim();
  const alnum = up.replace(/[^A-Z0-9]/g, "");
  return alnum.slice(0, 7);
}

/* =========================================
   ✅ parser de número pt-BR
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

/* =========================================================
   ✅ CONFIRMAÇÃO REAL: RELER NA PLANILHA O QUE FOI GRAVADO
   - usa updates.updatedRange do append
   - valida qtd de linhas e Documento na coluna L
========================================================= */
async function confirmarLeituraNaPlanilha({ sheets, documentoUnico, qtdEsperada, updatedRange }) {
  if (!updatedRange || typeof updatedRange !== "string") {
    return { ok: false, motivo: "append sem updatedRange; não foi possível verificar a base de dados." };
  }

  const r = updatedRange.trim(); // ex: "BONO!A123:N127"

  const getResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: r,
    majorDimension: "ROWS",
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING"
  });

  const rows = Array.isArray(getResp?.data?.values) ? getResp.data.values : [];
  if (!rows.length) return { ok: false, motivo: "releitura retornou 0 linhas." };

  // ✅ pode existir linhas “curtas”; garantimos índice 11 (coluna L)
  const docs = rows.map(row => (row && row[11] != null) ? String(row[11]).trim() : "");

  const qtdLida = rows.length;
  if (qtdLida !== Number(qtdEsperada)) {
    return { ok: false, motivo: `qtd lida (${qtdLida}) diferente da enviada (${qtdEsperada}).` };
  }

  const todasBatem = docs.every(d => d === String(documentoUnico));
  if (!todasBatem) {
    return { ok: false, motivo: "Documento relido não confere com o Documento gerado." };
  }

  return { ok: true, documento: String(documentoUnico), qtdItens: qtdLida, rangeConfirmado: r };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return bad(res, 405, "Método não permitido. Use POST.");
  }

  const session = requireSession(req, res);
  if (!session) return;

  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return bad(res, 500, "Configuração do servidor incompleta (credenciais).");
  }

  const body = req.body || {};
  const dataHoraEscolhida = normalizarTexto(body.dataHoraEscolhida, 20);
  const encarregado = normalizarTexto(body.encarregado, 80);

  // ✅ fornecedor (coluna M)
  const fornecedor = normalizarTexto(body.fornecedor, 80);

  // ✅ placa (coluna N)
  const placaVeiculo = normalizarPlaca(body.placaVeiculo);

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
  let temRecebimento = false;

  for (const it of itens) {
    const v = validarItem(it);
    if (!v) return bad(res, 400, "Existe item inválido na lista.");
    itensValidos.push(v);
    if (v.tipoLancamento === "RECEBIMENTO") temRecebimento = true;
  }

  if (temRecebimento && !fornecedor) {
    return bad(res, 400, 'Fornecedor é obrigatório para "Recebimento de mercadorias".');
  }

  const loja = String(session.loja || "").trim();
  const usuario = String(session.usuario || "").trim();
  if (!loja || !usuario) {
    return bad(res, 401, "Sessão inválida (loja/usuário ausentes).");
  }

  const spStamp = getSaoPauloStamp();

  // ⚠️ continua sendo gerado aqui, mas AGORA serve como “chave de correlação”
  // A certeza vem da RELEITURA (values.get), não do ato de gerar.
  const documentoUnico = montarDocumentoUnico({ loja, usuario, spStamp });

  const values = itensValidos.map((it) => {
    const tipoTxt = tipoLabel(it.tipoLancamento);
    const status = statusPorTipo(it.tipoLancamento);
    const destino = it.lojaDestino || "";

    const fornecedorLinha = (it.tipoLancamento === "RECEBIMENTO") ? fornecedor : "";

    return [
      spStamp.dataHoraRede,     // A
      dataHoraEscolhida,        // B
      loja,                     // C
      usuario,                  // D
      encarregado,              // E
      it.produto,               // F
      it.quantidade,            // G
      it.embalagem,             // H
      destino,                  // I
      tipoTxt,                  // J
      status,                   // K
      documentoUnico,           // L
      fornecedorLinha,          // M
      placaVeiculo              // N
    ];
  });

  try {
    const sheets = await getSheetsClient();

    const appendResp = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "BONO!A:N",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values }
    });

    // ✅ updatedRange é a “pista” exata do que foi inserido
    const updatedRange = appendResp?.data?.updates?.updatedRange || "";

    // ✅ AGORA SIM: reler na planilha e validar
    const conf = await confirmarLeituraNaPlanilha({
      sheets,
      documentoUnico,
      qtdEsperada: values.length,
      updatedRange
    });

    if (!conf.ok) {
      console.error("[BONO] Gravou, mas não confirmou na releitura:", conf.motivo, { updatedRange });
      return bad(res, 500, `Bono salvo, mas NÃO foi possível confirmar a leitura na base de dados. Motivo: ${conf.motivo}`);
    }

    // ✅ resposta baseada em LEITURA confirmada
    return ok(res, {
      sucesso: true,
      message: "Bono salvo e confirmado na base de dados.",
      documento: conf.documento,
      qtdItens: conf.qtdItens,
      totalItens: conf.qtdItens,
      rangeConfirmado: conf.rangeConfirmado // opcional (se não quiser expor, remova)
    });

  } catch (e) {
    console.error("[BONO] Falha ao append/confirmar:", e);
    return bad(res, 500, "Falha ao salvar (BONO).");
  }
}

/*
Fontes confiáveis:
- Sheets API append (retorna updates.updatedRange): https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values/append
- Sheets API get (reler valores): https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values/get
- google-api-nodejs-client (Sheets): https://github.com/googleapis/google-api-nodejs-client
*/
