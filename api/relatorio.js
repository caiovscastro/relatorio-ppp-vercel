// api/relatorio.js
// Grava relatórios na aba RELATORIO do Google Sheets
// Agora incluindo um ID único em cada linha (coluna P).

import { google } from "googleapis";

// Lê as variáveis de ambiente da Vercel
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
const spreadsheetId = process.env.SPREADSHEET_ID;

// Conserta quebras de linha da chave privada (vem com "\n" e precisa ser newline de verdade)
const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

// Autenticação com Service Account (escopo de escrita no Sheets)
const auth = new google.auth.JWT(
  serviceAccountEmail,
  null,
  privateKey,
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });

// Flag simples pra não ficar recriando cabeçalho em toda requisição
let headerGarantido = false;

/**
 * Gera um identificador único para cada registro.
 * Combina timestamp + random em base36 para evitar colisões.
 */
function gerarIdRegistro() {
  const parteTempo = Date.now().toString(36);
  const parteRandom = Math.random().toString(36).substring(2, 8);
  return `${parteTempo}-${parteRandom}`;
}

/**
 * Garante que a aba RELATORIO exista e tenha o cabeçalho correto.
 * Agora com colunas A:P, sendo P = ID_REGISTRO.
 */
async function garantirAbaRelatorio() {
  if (headerGarantido) return;

  // Consulta metadados da planilha
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
  });

  const sheetsList = spreadsheet.data.sheets || [];
  const existeRelatorio = sheetsList.some(
    (s) => s.properties && s.properties.title === "RELATORIO"
  );

  if (!existeRelatorio) {
    // Cria a aba RELATORIO, caso não exista
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: "RELATORIO" },
            },
          },
        ],
      },
    });
  }

  // Cabeçalho (A:P)
  const cabecalho = [
    [
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
      "ID_REGISTRO",           // P (NOVO)
    ],
  ];

  // Escreve o cabeçalho em A1:P1
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "RELATORIO!A1:P1",
    valueInputOption: "RAW",
    requestBody: {
      values: cabecalho,
    },
  });

  headerGarantido = true;
}

export default async function handler(req, res) {
  // Só aceitamos POST
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  // Confere se as variáveis da Vercel estão presentes
  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return res.status(500).json({
      sucesso: false,
      message:
        "Configuração da API incompleta. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY e SPREADSHEET_ID.",
    });
  }

  try {
    // Garante aba + cabeçalho
    await garantirAbaRelatorio();

    const {
      produto,         // array [EAN, COD, PRODUTO, DEP, SEÇÃO, GRUPO, SUBGRUPO, CATEGORIA]
      loja,
      usuario,
      observacao,
      quantidade,
      valorUnitario,
      numeroDocumento,
    } = req.body || {};

    // Validações básicas
    if (!Array.isArray(produto) || produto.length < 8) {
      return res.status(400).json({
        sucesso: false,
        message:
          "Dados de produto inválidos. Esperado array com pelo menos 8 colunas (A:H).",
      });
    }

    if (!loja || !usuario) {
      return res.status(400).json({
        sucesso: false,
        message: "Loja e usuário são obrigatórios.",
      });
    }

    if (!observacao || !quantidade || !valorUnitario || !numeroDocumento) {
      return res.status(400).json({
        sucesso: false,
        message:
          "Observação, quantidade, valor unitário e número de documento são obrigatórios.",
      });
    }

    // Quebra o array de produto nas colunas A:H
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

    // DATA/HORA em horário de Brasília, sem vírgula e sem segundos
    const agora = new Date();
    const options = { timeZone: "America/Sao_Paulo" };
    const dataBrasilia = new Date(
      agora.toLocaleString("en-US", options)
    );

    const dia = String(dataBrasilia.getDate()).padStart(2, "0");
    const mes = String(dataBrasilia.getMonth() + 1).padStart(2, "0");
    const ano = dataBrasilia.getFullYear();
    const hora = String(dataBrasilia.getHours()).padStart(2, "0");
    const minuto = String(dataBrasilia.getMinutes()).padStart(2, "0");

    const dataHora = `${dia}/${mes}/${ano} ${hora}:${minuto}`;

    // Gera ID único do registro (coluna P)
    const idRegistro = gerarIdRegistro();

    // Monta a linha na ordem A:P
    const linha = [
      dataHora,          // A DATA/HORA
      loja,              // B LOJAS
      usuario,           // C USÚARIOS
      ean,               // D
      codConsinco,       // E
      nomeProduto,       // F
      departamento,      // G
      secao,             // H
      grupo,             // I
      subgrupo,          // J
      categoria,         // K
      observacao,        // L
      quantidade,        // M
      valorUnitario,     // N
      numeroDocumento,   // O
      idRegistro,        // P ID_REGISTRO (NOVO)
    ];

    // Append na próxima linha disponível
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "RELATORIO!A:A", // continua baseando no início da planilha
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [linha],
      },
    });

    return res.status(200).json({
      sucesso: true,
      message: "Relatório registrado com sucesso na base de dados.",
      idRegistro, // devolve o ID, caso queira usar no front futuramente
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
