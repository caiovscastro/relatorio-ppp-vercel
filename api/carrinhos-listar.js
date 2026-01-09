// /api/carrinhos-listar.js
//
// Lê registros da aba CARRINHOS (A:O) e retorna para o dashboard.
//
// Colunas (A..O):
// A: Data/Hora da rede (servidor - São Paulo)  -> string (ex: "06/01/2026 10:22:33")
// B: Loja (da sessão no lançamento)            -> string
// C: Usuário (da sessão no lançamento)         -> string
// D: Data Contagem (DD/MM/AAAA)                -> string
// E: Duplocar 120L                             -> int
// F: Grande 160L                               -> int
// G: Bebê conforto 160L                        -> int   (key: bebeConforto160)
// H: Maxcar 200L                               -> int
// I: Macrocar 300L                             -> int
// J: Prancha Jacaré                            -> int
// K: Compra Kids                               -> int
// L: Bebê Jipinho                              -> int
// M: Cestinha                                  -> int
// N: Cadeira Rodas                             -> int
// O: Carrinhos Quebrados                       -> int
//
// Segurança:
// - Exige sessão válida via cookie HttpOnly (requireSession)
// - Restringe perfis: ADMINISTRADOR, GERENTE_PPP, BASE_PPP
// - Não expõe credenciais, não aceita parâmetros sensíveis do front

import { google } from "googleapis";
import { requireSession } from "./_authUsuarios.js";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const spreadsheetId = process.env.SPREADSHEET_ID;

const PERFIS_PERMITIDOS = ["ADMINISTRADOR", "GERENTE_PPP", "BASE_PPP"];

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

// Converte valor em inteiro >= 0, truncando decimais e tratando inválidos como 0
function asIntSafe(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ sucesso: false, message: "Método não permitido. Use GET." });
  }

  // Sessão + perfis permitidos
  const session = requireSession(req, res, { allowedProfiles: PERFIS_PERMITIDOS });
  if (!session) return; // requireSession já responde 401/403

  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return res.status(500).json({
      sucesso: false,
      message: "Configuração do servidor incompleta (credenciais/planilha).",
    });
  }

  try {
    const sheets = await getSheetsClient();

    // ✅ Ajuste: agora busca A:O (15 colunas)
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "CARRINHOS!A:O",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const values = resp?.data?.values || [];
    if (!values.length) {
      return res.status(200).json({ sucesso: true, registros: [] });
    }

    // Se existir cabeçalho, removemos.
    // Heurística: se A1 contém "DATA" (ex: "DATA/HORA"), pula a primeira linha.
    const firstCell = String(values?.[0]?.[0] || "").toUpperCase();
    const startIndex = firstCell.includes("DATA") ? 1 : 0;

    const registros = [];

    for (let i = startIndex; i < values.length; i++) {
      const row = values[i] || [];

      // ✅ Garante 15 colunas (A..O) para evitar "undefined" em linhas incompletas
      while (row.length < 15) row.push("");

      const dataHoraRede = String(row[0] ?? "").trim(); // A
      const loja         = String(row[1] ?? "").trim(); // B
      const usuario      = String(row[2] ?? "").trim(); // C
      const dataContagem = String(row[3] ?? "").trim(); // D (DD/MM/AAAA)

      // Monta o registro no formato esperado pelo dashboard:
      // - contagens.* como inteiros >= 0
      // - ✅ remove "mini" (não existe mais na tela/dash)
      const rec = {
        dataHoraRede,
        loja,
        usuario,
        dataContagem,
        contagens: {
          duplocar120:        asIntSafe(row[4]),   // E
          grande160:          asIntSafe(row[5]),   // F
          bebeConforto160:    asIntSafe(row[6]),   // G
          maxcar200:          asIntSafe(row[7]),   // H
          macrocar300:        asIntSafe(row[8]),   // I
          pranchaJacare:      asIntSafe(row[9]),   // J
          compraKids:         asIntSafe(row[10]),  // K
          bebeJipinho:        asIntSafe(row[11]),  // L
          cestinha:           asIntSafe(row[12]),  // M
          cadeiraRodas:       asIntSafe(row[13]),  // N
          carrinhosQuebrados: asIntSafe(row[14]),  // O
        }
      };

      // Descarta linhas totalmente vazias
      if (!rec.dataHoraRede && !rec.loja && !rec.usuario && !rec.dataContagem) continue;

      registros.push(rec);
    }

    return res.status(200).json({
      sucesso: true,
      registros,
    });
  } catch (erro) {
    console.error("Erro em /api/carrinhos-listar:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro interno ao ler a planilha de carrinhos.",
      detalhe: erro?.message || String(erro),
    });
  }
}

/*
  Fontes confiáveis:
  - Google Sheets API (values.get): https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values/get
  - Google API Node.js Client (JWT): https://github.com/googleapis/google-api-nodejs-client
*/
