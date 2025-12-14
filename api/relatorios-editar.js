// api/relatorios-editar.js
import { google } from "googleapis";

/**
 * IMPORTANTE:
 * - Este endpoint atualiza SOMENTE: Relatório (L), Quantidade (M), Valor Unitário (N)
 * - Ele localiza a linha pelo idRegistro (coluna P) para garantir edição "na linha do id".
 *
 * AJUSTE ESTES 3 PONTOS PARA O SEU PROJETO:
 * 1) SPREADSHEET_ID (env)
 * 2) ABA (nome da guia, ex: "RELATORIO")
 * 3) MAPEAMENTO DE COLUNAS (L/M/N/P) se a sua planilha for diferente.
 */

// Nome da aba onde ficam os relatórios
const ABA_RELATORIOS = process.env.ABA_RELATORIOS || "RELATORIO";

// Coluna P = ID (16ª coluna), L/M/N = campos editáveis
const COL_ID = "P";
const COL_RELATORIO = "L";
const COL_QTD = "M";
const COL_VUNIT = "N";

// Em qual linha começam seus dados (geralmente 2 se a linha 1 é cabeçalho)
const LINHA_INICIO = 2;

function getAuth() {
  // Mesma lógica que você provavelmente já usa em /api/relatorios e /api/relatorios-excluir
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error("Credenciais do Google ausentes (GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY).");
  }

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function normalizarValorUnitario(valor) {
  // Mantém compatível com seu padrão "pt-BR": aceita "53,9", "53,90", "53.90"
  if (valor === null || valor === undefined) return "";
  let s = String(valor).trim();
  if (!s) return "";
  s = s.replace(/\s+/g, "");
  // Se vier com ponto milhar, remove; e troca vírgula por ponto (se necessário) — mas como você grava na planilha,
  // pode preferir manter vírgula. Aqui mantemos como texto "pt-BR" (vírgula), para não mexer no seu padrão.
  // Se você grava como número no Sheets, então converta para Number aqui.
  // -> Vou manter texto para ser "mínima alteração".
  return s;
}

export default async function handler(req, res) {
  // Vercel/Node: garanta CORS conforme seu app (se já tem padrão, replique).
  if (req.method !== "POST") {
    return res.status(405).json({ sucesso: false, message: "Método não permitido." });
  }

  try {
    const body = req.body || {};
    const registroOriginal = body.registroOriginal || null;
    const edicoes = body.edicoes || null;

    if (!registroOriginal || !edicoes) {
      return res.status(400).json({ sucesso: false, message: "Payload inválido." });
    }

    const idRegistro =
      registroOriginal.idRegistro ||
      registroOriginal.ID_REGISTRO ||
      registroOriginal.id ||
      "";

    if (!idRegistro) {
      // Sem ID não dá para garantir “linha exata”.
      return res.status(400).json({
        sucesso: false,
        message: "idRegistro não encontrado no registro. A edição por ID não pode ser concluída.",
      });
    }

    const novaQtd = (edicoes.quantidade ?? "").toString().trim();
    const novoVunit = normalizarValorUnitario(edicoes.valorUnitario);
    const novoRelatorio = (edicoes.relatorio ?? "").toString();

    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const spreadsheetId = process.env.SPREADSHEET_ID;
    if (!spreadsheetId) {
      return res.status(500).json({ sucesso: false, message: "SPREADSHEET_ID não configurado." });
    }

    // 1) Ler a coluna de ID (P) para achar a linha do registro
    const rangeIds = `${ABA_RELATORIOS}!${COL_ID}${LINHA_INICIO}:${COL_ID}`;
    const respIds = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: rangeIds,
    });

    const valoresIds = respIds.data.values || [];
    // valoresIds é algo como: [[id1],[id2],...]
    let linhaEncontrada = null;

    for (let i = 0; i < valoresIds.length; i++) {
      const idNaLinha = (valoresIds[i]?.[0] ?? "").toString().trim();
      if (idNaLinha === idRegistro.toString().trim()) {
        // Linha real na planilha = LINHA_INICIO + i
        linhaEncontrada = LINHA_INICIO + i;
        break;
      }
    }

    if (!linhaEncontrada) {
      return res.status(404).json({
        sucesso: false,
        message: `ID não encontrado na planilha: ${idRegistro}`,
      });
    }

    // 2) Atualizar L/M/N exatamente na linha encontrada
    // Atualiza como 1 linha com 3 colunas (L..N)
    const rangeUpdate = `${ABA_RELATORIOS}!${COL_RELATORIO}${linhaEncontrada}:${COL_VUNIT}${linhaEncontrada}`;

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: rangeUpdate,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[novoRelatorio, novaQtd, novoVunit]],
      },
    });

    return res.status(200).json({
      sucesso: true,
      message: "Registro editado com sucesso.",
      linha: linhaEncontrada,
      idRegistro,
    });
  } catch (err) {
    console.error("Erro em /api/relatorios-editar:", err);
    return res.status(500).json({
      sucesso: false,
      message: "Erro interno ao editar registro.",
    });
  }
}
