// api/efetividade-lancar.js
import { google } from "googleapis";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKeyRaw = process.env.GOOGLE_PRIVATE_KEY;
const spreadsheetId = process.env.SPREADSHEET_ID_EFETIVIDADE;

const privateKey = privateKeyRaw ? privateKeyRaw.replace(/\\n/g, "\n") : null;

const auth = new google.auth.JWT(
  serviceAccountEmail,
  null,
  privateKey,
  ["https://www.googleapis.com/auth/spreadsheets"]
);

const sheets = google.sheets({ version: "v4", auth });

const ABA_LANCADOS = "LANCADOS";

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
        "Configuração incompleta. Verifique GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY e SPREADSHEET_ID_EFETIVIDADE.",
    });
  }

  try {
    const {
      registroBase,     // array vindo da BASE_DADOS (linha completa)
      loja,
      usuario,
      observacao,
      quantidade,
      valorUnitario,
      numeroDocumento,
    } = req.body || {};

    if (!Array.isArray(registroBase) || !registroBase.length) {
      return res.status(400).json({
        sucesso: false,
        message: "Registro da base (registroBase) inválido.",
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

    // Data/hora em Brasília
    const agora = new Date();
    const dataHora = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      dateStyle: "short",
      timeStyle: "medium",
    }).format(agora);

    /*
      Montagem da linha:
      A: DATA/HORA
      B: LOJA
      C: USUÁRIO
      D...: colunas originais da BASE_DADOS
      (últimas): OBS, QTD, VALOR, DOC
    */
    const linha = [
      dataHora,
      loja,
      usuario,
      ...registroBase,
      observacao,
      quantidade,
      valorUnitario,
      numeroDocumento,
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${ABA_LANCADOS}!A:A`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [linha],
      },
    });

    return res.status(200).json({
      sucesso: true,
      message: "Lançamento registrado com sucesso na aba LANCADOS.",
    });
  } catch (erro) {
    console.error("Erro em /api/efetividade-lancar:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro ao registrar lançamento na aba LANCADOS.",
      detalhe: erro.message,
    });
  }
}
