// API/relatorio.js
// Grava relatórios na aba RELATORIO do Google Sheets

import { google } from "googleapis";

// Marca de cabeçalho já garantido por planilha
const headerGarantido = new Set();

function getEnvVars() {
  const serviceAccountEmail =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env["E-MAIL DA CONTA DE SERVIÇO DO GOOGLE"];

  const privateKeyRaw =
    process.env.GOOGLE_PRIVATE_KEY || process.env.CHAVE_PRIVADA_DO_GOOGLE;

  const spreadsheetId =
    process.env.SPREADSHEET_ID || process.env.ID_DA_PLANILHA;

  if (!serviceAccountEmail || !privateKeyRaw || !spreadsheetId) {
    throw new Error(
      "Variáveis de ambiente ausentes. " +
        "Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL / E-MAIL DA CONTA DE SERVIÇO DO GOOGLE, " +
        "GOOGLE_PRIVATE_KEY / CHAVE_PRIVADA_DO_GOOGLE e " +
        "SPREADSHEET_ID / ID_DA_PLANILHA."
    );
  }

  return {
    serviceAccountEmail,
    privateKey: privateKeyRaw.replace(/\\n/g, "\n"),
    spreadsheetId,
  };
}

function getSheetsClient({ serviceAccountEmail, privateKey }) {
  const auth = new google.auth.JWT(
    serviceAccountEmail,
    null,
    privateKey,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  return { auth, sheets: google.sheets({ version: "v4", auth }) };
}

// Garante que a aba RELATORIO existe e tem o cabeçalho correto
async function garantirAbaRelatorio({ sheets, spreadsheetId }) {
  if (headerGarantido.has(spreadsheetId)) return;

  // Consulta metadados da planilha
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });

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
      "DATA/HORA", // A
      "LOJAS", // B
      "USÚARIOS", // C
      "EAN", // D
      "COD CONSINCO", // E
      "PRODUTO", // F
      "DEPARTAMENTO", // G
      "SECAO", // H
      "GRUPO", // I
      "SUBGRUPO", // J
      "CATEGORIA", // K
      "RELATORIO/OBSERVAÇÃO", // L
      "QUANTIDADE", // M
      "VALOR UNITARIO", // N
      "DOCUMENTO", // O
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

  headerGarantido.add(spreadsheetId);
}

export default async function handler(req, res) {
  // Só aceitamos POST
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido. Use POST." });
  }

  try {
    let envVars;

    try {
      envVars = getEnvVars();
    } catch (err) {
      return res.status(500).json({
        sucesso: false,
        message:
          "Configuração da API incompleta. Verifique as variáveis de ambiente.",
        detalhe: err.message,
      });
    }

    const { serviceAccountEmail, privateKey, spreadsheetId } = envVars;
    const { auth, sheets } = getSheetsClient({
      serviceAccountEmail,
      privateKey,
    });
    await auth.authorize();

    // Garante aba + cabeçalho
    await garantirAbaRelatorio({ sheets, spreadsheetId });

    const {
      produto, // array [EAN, COD, PRODUTO, DEP, SEÇÃO, GRUPO, SUBGRUPO, CATEGORIA]
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

    // DATA/HORA em horário de Brasília, como texto
    const agora = new Date();
    const dataHora = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
      timeStyle: "medium",
    }).format(agora);

    // Monta a linha exatamente na ordem que você pediu
    const linha = [
      dataHora, // DATA/HORA
      loja, // LOJAS
      usuario, // USÚARIOS
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
      message: "Relatório registrado com sucesso na aba RELATORIO.",
    });
  } catch (erro) {
    console.error("Erro na API /api/relatorio:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro ao registrar relatório na planilha.",
      detalhe: erro.message,
    });
  }
}
