// /api/carrinhos-listar.js
//
// Lê registros da aba CARRINHOS (A:L) e retorna para o dashboard.
//
// Colunas:
// A: Data/Hora da rede (servidor - São Paulo)  -> string (ex: "06/01/2026 10:22:33")
// B: Loja (da sessão no lançamento)            -> string
// C: Usuário (da sessão no lançamento)         -> string
// D: Data Contagem (DD/MM/AAAA)                -> string
// E: Duplocar 120L                             -> int
// F: Grande 160L                               -> int
// G: Bebê conforto 160L                        -> int
// H: Maxcar 200L                               -> int
// I: Macrocar 300L                             -> int
// J: Mini                                      -> int
// K: Compra Kids                               -> int
// L: Bebê Jipinho                              -> int
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

    // Busca tudo de A:L. Se crescer muito, depois a gente pagina/otimiza.
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "CARRINHOS!A:L",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const values = resp?.data?.values || [];
    if (!values.length) {
      return res.status(200).json({ sucesso: true, registros: [] });
    }

    // Se existir cabeçalho, removemos. (heurística: se A1 contém "Data" ou "DATA")
    const firstCell = String(values?.[0]?.[0] || "").toUpperCase();
    const startIndex = firstCell.includes("DATA") ? 1 : 0;

    const registros = [];

    for (let i = startIndex; i < values.length; i++) {
      const row = values[i] || [];
      // Garante 12 colunas
      while (row.length < 12) row.push("");

      const dataHoraRede = String(row[0] ?? "").trim();
      const loja = String(row[1] ?? "").trim();
      const usuario = String(row[2] ?? "").trim();
      const dataContagem = String(row[3] ?? "").trim(); // "DD/MM/AAAA" (como você pediu)

      const rec = {
        dataHoraRede,
        loja,
        usuario,
        dataContagem,
        contagens: {
          duplocar120:     asIntSafe(row[4]),
          grande160:       asIntSafe(row[5]),
          bebeConforto160: asIntSafe(row[6]),
          maxcar200:       asIntSafe(row[7]),
          macrocar300:     asIntSafe(row[8]),
          mini:            asIntSafe(row[9]),
          compraKids:      asIntSafe(row[10]),
          bebeJipinho:     asIntSafe(row[11]),
        }
      };

      // Descarta linhas vazias “soltas”
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
