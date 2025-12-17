// api/relatorio.js
// Grava relatórios na aba RELATORIO do Google Sheets.
//
// NOVO:
// - Agora aceita envio em LOTE: { lote: [ { ...registro }, ... ] }
// - Mantém compatibilidade com envio unitário antigo.
//
// Fluxo:
// - Garante que a aba RELATORIO existe e possui cabeçalho em A1:P1.
// - Gera DATA/HORA em São Paulo.
// - Gera um ID único (coluna P) para CADA registro.
// - Insere as linhas na próxima linha disponível (append).
//
// Variáveis de ambiente (Vercel):
// - GOOGLE_SERVICE_ACCOUNT_EMAIL
// - GOOGLE_PRIVATE_KEY
// - SPREADSHEET_ID

import { google } from "googleapis";

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

async function garantirAbaRelatorio() {
  if (headerGarantido) return;

  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetsList = spreadsheet.data.sheets || [];
  const existeRelatorio = sheetsList.some(
    (s) => s.properties && s.properties.title === "RELATORIO"
  );

  if (!existeRelatorio) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          { addSheet: { properties: { title: "RELATORIO" } } },
        ],
      },
    });
  }

  const cabecalho = [[
    "DATA/HORA",             // A
    "LOJAS",                 // B
    "USÚARIOS",              // C
    "EAN",                   // D
    "COD CONSINCO",          // E
    "PRODUTO",               // F
    "DEPARTAMENTO",          // G
    "SECAO",                 // H
    "GRUPO",                 // I
    "SUBGRUPO",              // J
    "CATEGORIA",             // K
    "RELATORIO/OBSERVAÇÃO",  // L
    "QUANTIDADE",            // M
    "VALOR UNITARIO",        // N
    "DOCUMENTO",             // O
    "ID",                    // P
  ]];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "RELATORIO!A1:P1",
    valueInputOption: "RAW",
    requestBody: { values: cabecalho },
  });

  headerGarantido = true;
}

function dataHoraSaoPauloSemSegundos() {
  const agora = new Date();
  const options = { timeZone: "America/Sao_Paulo" };
  const dataSP = new Date(agora.toLocaleString("en-US", options));

  const dia = String(dataSP.getDate()).padStart(2, "0");
  const mes = String(dataSP.getMonth() + 1).padStart(2, "0");
  const ano = dataSP.getFullYear();
  const hora = String(dataSP.getHours()).padStart(2, "0");
  const minuto = String(dataSP.getMinutes()).padStart(2, "0");

  return `${dia}/${mes}/${ano} ${hora}:${minuto}`;
}

// Mesmo padrão que você já usa (forte o suficiente para seu volume)
function gerarIdRegistro() {
  return (
    Date.now().toString(36).toUpperCase() +
    "-" +
    Math.random().toString(36).substring(2, 8).toUpperCase()
  );
}

function validarRegistroBasico(reg) {
  const {
    produto,
    loja,
    usuario,
    observacao,
    quantidade,
    valorUnitario,
    numeroDocumento,
  } = reg || {};

  if (!Array.isArray(produto) || produto.length < 8) {
    return "Dados de produto inválidos. Esperado array com pelo menos 8 colunas (EAN, COD, PRODUTO, DEP, SEÇÃO, GRUPO, SUBGRUPO, CATEGORIA).";
  }
  if (!loja || !usuario) return "Loja e usuário são obrigatórios.";
  if (!quantidade || !valorUnitario || !numeroDocumento) {
    return "Quantidade, valor unitário e número de documento são obrigatórios.";
  }
  return null;
}

function montarLinhaPlanilha(reg, dataHora, idRegistro) {
  const {
    produto,
    loja,
    usuario,
    observacao,
    quantidade,
    valorUnitario,
    numeroDocumento,
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
    dataHora,        // A
    loja,            // B
    usuario,         // C
    ean,             // D
    codConsinco,     // E
    nomeProduto,     // F
    departamento,    // G
    secao,           // H
    grupo,           // I
    subgrupo,        // J
    categoria,       // K
    observacao,      // L
    quantidade,      // M
    valorUnitario,   // N
    numeroDocumento, // O
    idRegistro,      // P
  ];
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return res.status(500).json({
      sucesso: false,
      message:
        "Configuração da API incompleta. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY e SPREADSHEET_ID.",
    });
  }

  try {
    await garantirAbaRelatorio();

    // NOVO: detecta se é lote ou envio unitário
    const body = req.body || {};
    const lote = Array.isArray(body.lote) ? body.lote : null;

    // Normaliza tudo para array para simplificar a lógica
    const registros = lote ? lote : [body];

    if (!registros.length) {
      return res.status(400).json({
        sucesso: false,
        message: "Nenhum registro enviado.",
      });
    }

    // Validação de todos antes de tentar escrever
    for (const reg of registros) {
      const erro = validarRegistroBasico(reg);
      if (erro) {
        return res.status(400).json({ sucesso: false, message: erro });
      }
    }

    // DATA/HORA: pode ser igual para o lote (consistência da ocorrência)
    const dataHora = dataHoraSaoPauloSemSegundos();

    // Monta linhas + ids
    const ids = [];
    const linhas = registros.map((reg) => {
      const idRegistro = gerarIdRegistro();
      ids.push(idRegistro);
      return montarLinhaPlanilha(reg, dataHora, idRegistro);
    });

    // Append em lote (1 chamada, várias linhas)
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "RELATORIO!A:A",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: linhas,
      },
    });

    return res.status(200).json({
      sucesso: true,
      message: lote
        ? `Ocorrência finalizada. ${linhas.length} registro(s) gravado(s) com sucesso.`
        : "Relatório registrado com sucesso na base de dados.",
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
