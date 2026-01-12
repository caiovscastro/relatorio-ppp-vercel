// api/relatorio.js
// Grava relatórios na aba RELATORIO do Google Sheets.
//
// SUPORTA:
// - Envio em LOTE: { lote: [ { ...registro }, ... ] }
// - Envio unitário (compatibilidade)
// - Imagem opcional (URL na coluna Q)
//
// NOVO (SOLICITADO):
// - DATA_OCORRIDO -> coluna R  (formato BR: dd/MM/yyyy) ✅ AJUSTADO
// - HORA_OCORRIDO -> coluna S
// - TIPO_ABORDAGEM -> coluna T ✅ NOVO (Reativa/Preventiva obrigatório)
//
// Fluxo:
// - Garante que a aba RELATORIO exista e tenha cabeçalho A1:T1
// - Gera DATA/HORA do REGISTRO em São Paulo (coluna A)
// - Gera um ID único por linha (coluna P)
// - Insere linhas via append
//
// Variáveis de ambiente (Vercel):
// - GOOGLE_SERVICE_ACCOUNT_EMAIL
// - GOOGLE_PRIVATE_KEY
// - SPREADSHEET_ID

import { google } from "googleapis";
import { requireSession } from "./_authUsuarios.js"; // ✅ NOVO: valida sessão

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
const spreadsheetId = process.env.SPREADSHEET_ID;

const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

const auth = new google.auth.JWT(
  serviceAccountEmail,
  null,
  privateKey,
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });

let headerGarantido = false;

/**
 * Garante que a aba RELATORIO exista e tenha cabeçalho correto A:T
 */
async function garantirAbaRelatorio() {
  if (headerGarantido) return;

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetsList = spreadsheet.data.sheets || [];

  const existeRelatorio = sheetsList.some(
    (s) => s.properties?.title === "RELATORIO"
  );

  if (!existeRelatorio) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: "RELATORIO" } } }],
      },
    });
  }

  const cabecalho = [[
    "DATA/HORA REGISTRO",     // A
    "LOJA",                  // B
    "USUARIO",               // C
    "EAN",                   // D
    "COD CONSINCO",          // E
    "PRODUTO",               // F
    "DEPARTAMENTO",          // G
    "SECAO",                 // H
    "GRUPO",                 // I
    "SUBGRUPO",              // J
    "CATEGORIA",             // K
    "RELATORIO/OBSERVACAO",  // L
    "QUANTIDADE",            // M
    "VALOR UNITARIO",        // N
    "DOCUMENTO",             // O
    "ID",                    // P
    "IMAGEM_URL",            // Q
    "DATA_OCORRIDO",         // R  ✅ NOVO
    "HORA_OCORRIDO",         // S  ✅ NOVO
    "TIPO_ABORDAGEM",        // T  ✅ NOVO
  ]];

  // ✅ Atualiza cabeçalho agora para A1:T1
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "RELATORIO!A1:T1",
    valueInputOption: "RAW",
    requestBody: { values: cabecalho },
  });

  headerGarantido = true;
}

/**
 * Data/Hora do REGISTRO (não confundir com data ocorrido)
 * Formato: dd/MM/yyyy HH:mm
 */
function dataHoraSaoPauloSemSegundos() {
  const agora = new Date();
  const sp = new Date(
    agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );

  const dd = String(sp.getDate()).padStart(2, "0");
  const mm = String(sp.getMonth() + 1).padStart(2, "0");
  const yyyy = sp.getFullYear();
  const hh = String(sp.getHours()).padStart(2, "0");
  const mi = String(sp.getMinutes()).padStart(2, "0");

  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function gerarIdRegistro() {
  return (
    Date.now().toString(36).toUpperCase() +
    "-" +
    Math.random().toString(36).substring(2, 8).toUpperCase()
  );
}

/* =====================================================================================
   ✅ AJUSTE SOLICITADO:
   O input type="date" do HTML sempre envia "YYYY-MM-DD".
   Para gravar na planilha como "DD/MM/YYYY", convertemos aqui na API.

   - Se vier vazio, retorna ""
   - Se NÃO vier no formato ISO, retorna como está (não quebra compatibilidade)
   ===================================================================================== */
function isoParaBR(iso) {
  const s = String(iso || "").trim();
  if (!s) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const [yyyy, mm, dd] = s.split("-");
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Validação mínima (mantida exatamente como você tinha)
 * + ✅ NOVO: valida Tipo de abordagem (Reativa/Preventiva obrigatório)
 */
function validarRegistroBasico(reg) {
  const {
    produto,
    loja,
    usuario,
    quantidade,
    valorUnitario,
    numeroDocumento,
    tipoAbordagem, // ✅ NOVO
  } = reg || {};

  if (!Array.isArray(produto) || produto.length < 8) {
    return "Dados de produto inválidos.";
  }

  if (!loja || !usuario) {
    return "Loja e usuário são obrigatórios.";
  }

  if (!quantidade || !valorUnitario || !numeroDocumento) {
    return "Quantidade, valor unitário e número de documento são obrigatórios.";
  }

  // ✅ NOVO (solicitado): obrigatório ser "Reativa" ou "Preventiva"
  const ta = String(tipoAbordagem || "").trim();
  if (ta !== "Reativa" && ta !== "Preventiva") {
    return "Tipo de abordagem é obrigatório (Reativa ou Preventiva).";
  }

  return null;
}

/**
 * Monta linha A:T
 */
function montarLinhaPlanilha(reg, dataHoraRegistro, idRegistro) {
  const {
    produto,
    loja,
    usuario,
    observacao,
    imagemUrl,
    quantidade,
    valorUnitario,
    numeroDocumento,
    dataOcorrido,    // ✅ vindo do front (ISO: YYYY-MM-DD)
    horaOcorrido,    // ✅ vindo do front
    tipoAbordagem,   // ✅ NOVO: vindo do front
  } = reg;

  const [
    ean = "",
    codConsinco = "",
    nomeProduto = "",
    departamento = "",
    secao = "",
    grupo = "",
    subgrupo = "",
    categoria = "",
  ] = produto;

  return [
    dataHoraRegistro,            // A
    loja,                        // B
    usuario,                     // C
    ean,                         // D
    codConsinco,                 // E
    nomeProduto,                 // F
    departamento,                // G
    secao,                       // H
    grupo,                       // I
    subgrupo,                    // J
    categoria,                   // K
    observacao || "",            // L
    quantidade,                  // M
    valorUnitario,               // N
    numeroDocumento,             // O
    idRegistro,                  // P
    imagemUrl || "",             // Q
    isoParaBR(dataOcorrido),     // R  ✅ AJUSTADO p/ dd/MM/yyyy
    horaOcorrido || "",          // S  ✅
    String(tipoAbordagem || ""), // T  ✅ NOVO
  ];
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      sucesso: false,
      message: "Método não permitido. Use POST.",
    });
  }

  // ✅ NOVO: exige sessão válida (8h via cookie)
  const session = requireSession(req, res);
  if (!session) return;

  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return res.status(500).json({
      sucesso: false,
      message: "Configuração da API incompleta.",
    });
  }

  try {
    await garantirAbaRelatorio();

    const body = req.body || {};
    const registros = Array.isArray(body.lote) ? body.lote : [body];

    if (!registros.length) {
      return res.status(400).json({
        sucesso: false,
        message: "Nenhum registro enviado.",
      });
    }

    for (const reg of registros) {
      const erro = validarRegistroBasico(reg);
      if (erro) {
        return res.status(400).json({ sucesso: false, message: erro });
      }
    }

    const dataHoraRegistro = dataHoraSaoPauloSemSegundos();

    const ids = [];
    const linhas = registros.map((reg) => {
      const id = gerarIdRegistro();
      ids.push(id);
      return montarLinhaPlanilha(reg, dataHoraRegistro, id);
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "RELATORIO!A:A",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: linhas },
    });

    return res.status(200).json({
      sucesso: true,
      message: `Ocorrência finalizada. ${linhas.length} registro(s) gravado(s) com sucesso.`,
      ids,
    });
  } catch (erro) {
    console.error("Erro na API /api/relatorio:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro ao registrar relatório na base de dados.",
      detalhe: erro.message,
    });
  }
}

/*
Fontes (documentação confiável):
- <input type="date"> retorna YYYY-MM-DD: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/date
- Sheets API values.append / valueInputOption: https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values/append
*/
