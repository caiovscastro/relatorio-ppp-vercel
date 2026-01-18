// /api/carrinhos-listar.js
// Lê registros da aba CARRINHOS (A:U) e retorna para o dashboard.
//
// Colunas (A..U) — ORDEM:
// A: Data/Hora da rede (servidor - São Paulo)
// B: Loja
// C: Usuário
// D: Data Contagem (DD/MM/AAAA)
// E: Duplocar 120L
// F: Grande 160L
// G: Bebê conforto 160L
// H: Maxcar 200L
// I: Macrocar 300L
// J: Prancha Jacaré
// K: Compra Kids
// L: Carrinho gaiola pet                 -> key: carrinhoGaiolaPet
// M: Bebê Jipinho
// N: Cestinha
// O: Cadeira de rodas
// P: Carrinhos Quebrados
// Q: Carrinhos reserva
// R: Cestinhas reserva
// S: Qtd Mov. (com sinal)
// T: Motivo
// U: ID da linha (para edição)
//
// Segurança:
// - Exige sessão válida via cookie HttpOnly (requireSession)
// - Restringe perfis: ADMINISTRADOR, GERENTE_PPP, BASE_PPP

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

function asIntSignedSafe(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

function parseDataHoraRedeBR(dataHoraRede) {
  const s = String(dataHoraRede ?? "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return { dataBR: "", horaHMS: "" };

  const dd = m[1];
  const mm = m[2];
  const yyyy = m[3];
  const HH = m[4];
  const MM = m[5];
  const SS = (m[6] ?? "00").padStart(2, "0");

  return {
    dataBR: `${dd}/${mm}/${yyyy}`,
    horaHMS: `${HH}:${MM}:${SS}`,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ sucesso: false, message: "Método não permitido. Use GET." });
  }

  const session = requireSession(req, res, { allowedProfiles: PERFIS_PERMITIDOS });
  if (!session) return;

  if (!serviceAccountEmail || !privateKey || !spreadsheetId) {
    return res.status(500).json({
      sucesso: false,
      message: "Configuração do servidor incompleta (credenciais/planilha).",
    });
  }

  try {
    const sheets = await getSheetsClient();

    // ✅ Agora busca A:U (21 colunas)
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "CARRINHOS!A:U",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const values = resp?.data?.values || [];
    if (!values.length) {
      return res.status(200).json({ sucesso: true, registros: [] });
    }

    const firstCell = String(values?.[0]?.[0] || "").toUpperCase();
    const startIndex = firstCell.includes("DATA") ? 1 : 0;

    const registros = [];

    for (let i = startIndex; i < values.length; i++) {
      const row = values[i] || [];
      while (row.length < 21) row.push("");

      const dataHoraRede = String(row[0] ?? "").trim();
      const loja         = String(row[1] ?? "").trim();
      const usuario      = String(row[2] ?? "").trim();
      const dataContagem = String(row[3] ?? "").trim();

      const motivo = String(row[19] ?? "").trim();   // T
      const idLinha = String(row[20] ?? "").trim();  // U

      const { dataBR: dataRegistro, horaHMS: horaRegistro } =
        parseDataHoraRedeBR(dataHoraRede);

      const rec = {
        idLinha,
        dataHoraRede,
        loja,
        usuario,
        dataContagem,

        horaRegistro,
        dataRegistro,

        motivo,
        movCategoria: motivo,

        contagens: {
          duplocar120:        asIntSafe(row[4]),   // E
          grande160:          asIntSafe(row[5]),   // F
          bebeConforto160:    asIntSafe(row[6]),   // G
          maxcar200:          asIntSafe(row[7]),   // H
          macrocar300:        asIntSafe(row[8]),   // I
          pranchaJacare:      asIntSafe(row[9]),   // J
          compraKids:         asIntSafe(row[10]),  // K
          carrinhoGaiolaPet:  asIntSafe(row[11]),  // L ✅
          bebeJipinho:        asIntSafe(row[12]),  // M
          cestinha:           asIntSafe(row[13]),  // N
          cadeiraRodas:       asIntSafe(row[14]),  // O
          carrinhosQuebrados: asIntSafe(row[15]),  // P
          carrinhosReserva:   asIntSafe(row[16]),  // Q
          cestinhasReserva:   asIntSafe(row[17]),  // R
          movCarrinhos:       asIntSignedSafe(row[18]), // S
        },
      };

      if (!rec.dataHoraRede && !rec.loja && !rec.usuario && !rec.dataContagem && !rec.idLinha) continue;
      registros.push(rec);
    }

    return res.status(200).json({ sucesso: true, registros });
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
  - Regex (match): https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/match
*/
