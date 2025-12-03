// API/relatorio.js
// Grava relatórios na aba RELATORIO do Google Sheets

import { google } from "googleapis";

// Lê as variáveis de ambiente da Vercel
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
const spreadsheetId = process.env.SPREADSHEET_ID;

// Conserta quebras de linha da chave privada (vem com "\n" e precisa ser newline de verdade)
const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

// Autenticação com Service Account
const auth = new google.auth.JWT(
  serviceAccountEmail,
  null,
  privateKey,
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });

// Garante que a aba RELATORIO existe e tem o cabeçalho correto
let headerGarantido = false;

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
    // Cria a aba RELATORIO
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

  // Cabeçalho (A:O) na ordem que você pediu
  const cabecalho = [
    [
      "DATA/HORA",        // A
      "LOJAS",            // B
      "USÚARIOS",         // C
      "EAN",              // D
      "COD CONSINCO",     // E
      "PRODUTO",          // F
      "DEPARTAMENTO",     // G
      "SECAO",            // H
      "GRUPO",            // I
      "SUBGRUPO",         // J
      "CATEGORIA",        // K
      "RELATORIO/OBSERVAÇÃO", // L
      "QUANTIDADE",       // M
      "VALOR UNITARIO",   // N
      "DOCUMENTO",        // O
    ],
  ];

  // Escreve o cabeçalho em A1:O1 (RAW = exatamente o texto)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "RELATORIO!A1:O1",
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
    // Formato final: "dd/MM/aaaa HH:mm" (ex.: "03/12/2025 12:17")
    // Usamos formatação manual para evitar quebras com vírgula ou segundos.
    const agora = new Date();
    const options = { timeZone: "America/Sao_Paulo" };
    const dataBrasilia = new Date(
      agora.toLocaleString("en-US", options) // converte para string na TZ desejada
    );

    const dia = String(dataBrasilia.getDate()).padStart(2, "0");
    const mes = String(dataBrasilia.getMonth() + 1).padStart(2, "0");
    const ano = dataBrasilia.getFullYear();
    const hora = String(dataBrasilia.getHours()).padStart(2, "0");
    const minuto = String(dataBrasilia.getMinutes()).padStart(2, "0");

    const dataHora = `${dia}/${mes}/${ano} ${hora}:${minuto}`;

    // Monta a linha exatamente na ordem que você pediu
    const linha = [
      dataHora,          // DATA/HORA
      loja,              // LOJAS
      usuario,           // USÚARIOS
      ean,
      codConsinco,
      nomeProduto,
      departamento,
      secao,
      grupo,
      subgrupo,
      categoria,
      observacao,
      quantidade,
      valorUnitario,
      numeroDocumento,
    ];

    // Append na próxima linha disponível
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "RELATORIO!A:A",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [linha],
      },
    });

    return res.status(200).json({
      sucesso: true,
      message: "Relatório registrado com sucesso na base de dados.",
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
