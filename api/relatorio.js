// API/relatorio.js
// Grava relatórios na aba RELATORIO do Google Sheets.
//
// Fluxo:
// - Recebe dados do produto + loja + usuário + observação + quantidade + valor + documento.
// - Garante que a aba RELATORIO existe e possui cabeçalho em A1:P1.
// - Gera DATA/HORA em Brasília.
// - Gera um ID único (coluna P) para o registro.
// - Insere a linha na próxima linha disponível.
//
// Variáveis de ambiente (Vercel):
// - GOOGLE_SERVICE_ACCOUNT_EMAIL
// - GOOGLE_PRIVATE_KEY
// - SPREADSHEET_ID

import { google } from "googleapis";

// Lê as variáveis de ambiente da Vercel
const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
const spreadsheetId = process.env.SPREADSHEET_ID;

// Conserta quebras de linha da chave privada (vem com "\n" e precisa ser newline de verdade)
const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

// Autenticação com Service Account (escopo de escrita)
const auth = new google.auth.JWT(
  serviceAccountEmail,
  null,
  privateKey,
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });

// Controle simples para não recriar cabeçalho a cada requisição
let headerGarantido = false;

/**
 * Garante que a aba RELATORIO exista e tenha o cabeçalho correto em A1:P1.
 * Caso não exista, cria a aba.
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

  // Cabeçalho (A:P) com ID na coluna P
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
      "ID",                    // P  (identificador único do registro)
    ],
  ];

  // Escreve o cabeçalho em A1:P1 (RAW = exatamente o texto)
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

/**
 * Handler principal da rota /api/relatorio.
 * Somente POST é permitido.
 */
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
    // Garante aba + cabeçalho (A1:P1)
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
          "Dados de produto inválidos. Esperado array com pelo menos 8 colunas (EAN, COD, PRODUTO, DEP, SEÇÃO, GRUPO, SUBGRUPO, CATEGORIA).",
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

    // Quebra o array de produto nas colunas D:K (EAN até CATEGORIA)
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
    // Formato: "dd/MM/aaaa HH:mm" (ex.: "03/12/2025 12:17")
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

    // Gera um ID único simples:
    // - Parte baseada em timestamp
    // - Parte aleatória em base 36
    // Isso garante baixa chance de colisão e é legível.
    const idRegistro =
      Date.now().toString(36).toUpperCase() +
      "-" +
      Math.random().toString(36).substring(2, 8).toUpperCase();

    // Monta a linha exatamente na ordem A:P
    const linha = [
      dataHora,        // A  DATA/HORA
      loja,            // B  LOJAS
      usuario,         // C  USÚARIOS
      ean,             // D  EAN
      codConsinco,     // E  COD CONSINCO
      nomeProduto,     // F  PRODUTO
      departamento,    // G  DEPARTAMENTO
      secao,           // H  SECAO
      grupo,           // I  GRUPO
      subgrupo,        // J  SUBGRUPO
      categoria,       // K  CATEGORIA
      observacao,      // L  RELATORIO/OBSERVAÇÃO
      quantidade,      // M  QUANTIDADE
      valorUnitario,   // N  VALOR UNITARIO
      numeroDocumento, // O  DOCUMENTO
      idRegistro,      // P  ID (identificador único)
    ];

    // Append na próxima linha disponível (aba RELATORIO)
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "RELATORIO!A:A",           // aponta pela coluna A; o append preenche A:P
      valueInputOption: "USER_ENTERED", // deixa o Sheets interpretar número, data etc.
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [linha],
      },
    });

    return res.status(200).json({
      sucesso: true,
      message: "Relatório registrado com sucesso na base de dados.",
      id: idRegistro, // opcional: retorna o ID para o front, se quiser usar depois
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
