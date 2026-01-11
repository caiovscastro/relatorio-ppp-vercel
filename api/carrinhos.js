// /api/carrinhos.js
//
// Grava contagem de carrinhos na aba CARRINHOS do Google Sheets.
//
// ✅ MODELO ATUAL (A..S):
// A: Data/Hora da rede (servidor - São Paulo)
// B: Loja (da sessão)
// C: Usuário (da sessão)
// D: Data Contagem (formato "DD/MM/AAAA")
//
// Tipos / contagens (E em diante):
// E: Duplocar 120L
// F: Grande 160L
// G: Bebê conforto 160L
// H: Maxcar 200L
// I: Macrocar 300L
// J: Prancha Jacaré
// K: Compra Kids
// L: Bebê Jipinho
// M: Cestinha
// N: Cadeira de rodas
// O: Carrinhos Quebrados
//
// ✅ Reservas:
// P: Carrinhos de reserva
// Q: Cestinhas de reserva
//
// ✅ Movimentação:
// R: Movimentação de carrinhos (entrada positivo / saída negativo)
//
// ✅ Coluna S (abreviado):
// S: Motivo abreviado (M.L / M.M) (ou M_L / M_M)
//
// Segurança:
// - Exige sessão válida via cookie HttpOnly (requireSession)
// - Restringe perfis: ADMINISTRADOR, GERENTE_PPP, BASE_PPP
// - Não confia em loja/usuario vindos do front

import { google } from "googleapis";
import { requireSession } from "./_authUsuarios.js";

const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const spreadsheetId = process.env.SPREADSHEET_ID;

const PERFIS_PERMITIDOS = ["ADMINISTRADOR", "GERENTE_PPP", "BASE_PPP"];

const MOV_CATEGORIAS_PERMITIDAS = new Set([
  "MOVI_ENTRE_LOJAS",
  "MOVI_MANUTENCAO",
]);

// ✅ abreviações aceitas para gravar na coluna S
const MOV_ABREV_PERMITIDAS = new Set(["M.L", "M.M", "M_L", "M_M"]);

function nowSaoPaulo() {
  const agora = new Date();
  return new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}

function formatarDataHoraBR(d) {
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function isBRDateDDMMAAAA(s) {
  const str = String(s || "").trim();
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return false;

  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const yyyy = parseInt(m[3], 10);

  if (yyyy < 2000 || yyyy > 2100) return false;
  if (mm < 1 || mm > 12) return false;

  const maxDia = new Date(yyyy, mm, 0).getDate();
  if (dd < 1 || dd > maxDia) return false;

  return true;
}

function asIntObrigatorioNaoNegativo(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

function asIntObrigatorioComSinal(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: serviceAccountEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function validarMovCategoria(raw) {
  const v = String(raw ?? "").trim().toUpperCase();
  if (!v) return { ok: true, value: "MOVI_ENTRE_LOJAS" };
  if (!MOV_CATEGORIAS_PERMITIDAS.has(v)) return { ok: false, value: "" };
  return { ok: true, value: v };
}

// ✅ converte o código para abreviação padrão
function abreviarCodigoMov(codigo) {
  const v = String(codigo || "").trim().toUpperCase();
  if (v === "MOVI_ENTRE_LOJAS") return "M.L";
  if (v === "MOVI_MANUTENCAO") return "M.M";
  return "";
}

// ✅ normaliza/valida abreviação (M.L/M.M ou M_L/M_M)
function validarAbreviacao(raw) {
  const v = String(raw ?? "").trim().toUpperCase();
  if (!v) return { ok: false, value: "" };
  if (!MOV_ABREV_PERMITIDAS.has(v)) return { ok: false, value: "" };
  return { ok: true, value: v };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ sucesso: false, message: "Método não permitido. Use POST." });
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
    const body = req.body || {};
    const dataLancamento = String(body.dataLancamento || "").trim();
    const contagens = body.contagens || {};

    // ✅ valida o código (para manter robustez)
    const movCategoriaValid = validarMovCategoria(body.movCategoria);
    if (!movCategoriaValid.ok) {
      return res.status(400).json({
        sucesso: false,
        message: "Tipo de movimentação inválido. Use: MOVI_ENTRE_LOJAS ou MOVI_MANUTENCAO.",
      });
    }
    const movCategoriaCodigo = movCategoriaValid.value;

    // ✅ pega abreviação do front (se vier), senão deriva do código
    const ab = validarAbreviacao(body.movCategoriaAbrev);
    const movCategoriaColS = ab.ok ? ab.value : abreviarCodigoMov(movCategoriaCodigo);

    if (!movCategoriaColS) {
      return res.status(400).json({
        sucesso: false,
        message: "Motivo abreviado inválido para coluna S. Use M.L/M.M ou M_L/M_M.",
      });
    }

    if (!isBRDateDDMMAAAA(dataLancamento)) {
      return res.status(400).json({ sucesso: false, message: "Data Contagem inválida. Use DD/MM/AAAA." });
    }

    const duplocar120        = asIntObrigatorioNaoNegativo(contagens.duplocar120);
    const grande160          = asIntObrigatorioNaoNegativo(contagens.grande160);
    const bebeConforto160    = asIntObrigatorioNaoNegativo(contagens.bebeConforto160);
    const maxcar200          = asIntObrigatorioNaoNegativo(contagens.maxcar200);
    const macrocar300        = asIntObrigatorioNaoNegativo(contagens.macrocar300);
    const pranchaJacare      = asIntObrigatorioNaoNegativo(contagens.pranchaJacare);
    const compraKids         = asIntObrigatorioNaoNegativo(contagens.compraKids);
    const bebeJipinho        = asIntObrigatorioNaoNegativo(contagens.bebeJipinho);
    const cestinha           = asIntObrigatorioNaoNegativo(contagens.cestinha);
    const cadeiraRodas       = asIntObrigatorioNaoNegativo(contagens.cadeiraRodas);
    const carrinhosQuebrados = asIntObrigatorioNaoNegativo(contagens.carrinhosQuebrados);
    const carrinhosReserva   = asIntObrigatorioNaoNegativo(contagens.carrinhosReserva);
    const cestinhasReserva   = asIntObrigatorioNaoNegativo(contagens.cestinhasReserva);

    const movCarrinhosRaw = (contagens.movCarrinhos === "" || contagens.movCarrinhos === undefined || contagens.movCarrinhos === null)
      ? 0
      : contagens.movCarrinhos;

    const movCarrinhos = asIntObrigatorioComSinal(movCarrinhosRaw);

    const obrigatorios = [
      duplocar120,
      grande160,
      bebeConforto160,
      maxcar200,
      macrocar300,
      pranchaJacare,
      compraKids,
      bebeJipinho,
      cestinha,
      cadeiraRodas,
      carrinhosQuebrados,
      carrinhosReserva,
      cestinhasReserva,
      movCarrinhos,
    ];

    if (obrigatorios.some((v) => v === null)) {
      return res.status(400).json({
        sucesso: false,
        message: "Preencha as contagens com números inteiros (sem ponto e sem vírgula). Movimentação pode ser negativa.",
      });
    }

    const loja = String(session.loja || "").trim();
    const usuario = String(session.usuario || "").trim();
    const perfil = String(session.perfil || "").trim().toUpperCase();

    if (!loja || !usuario) {
      return res.status(401).json({ sucesso: false, message: "Sessão inválida (loja/usuário ausentes)." });
    }

    if (!PERFIS_PERMITIDOS.includes(perfil)) {
      return res.status(403).json({ sucesso: false, message: "Perfil sem permissão para esta operação." });
    }

    const dtRede = nowSaoPaulo();
    const dataHoraRede = formatarDataHoraBR(dtRede);

    const values = [[
      dataHoraRede,       // A
      loja,               // B
      usuario,            // C
      dataLancamento,     // D

      duplocar120,        // E
      grande160,          // F
      bebeConforto160,    // G
      maxcar200,          // H
      macrocar300,        // I
      pranchaJacare,      // J
      compraKids,         // K
      bebeJipinho,        // L
      cestinha,           // M
      cadeiraRodas,       // N
      carrinhosQuebrados, // O

      carrinhosReserva,   // P
      cestinhasReserva,   // Q

      movCarrinhos,       // R
      movCategoriaColS,   // S  ✅ abreviado (M.L/M.M ou M_L/M_M)
    ]];

    const sheets = await getSheetsClient();

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "CARRINHOS!A:S",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });

    return res.status(200).json({
      sucesso: true,
      message: "Contagem de carrinhos enviada com sucesso.",
    });
  } catch (erro) {
    console.error("Erro em /api/carrinhos:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro interno ao gravar contagem de carrinhos.",
      detalhe: erro?.message || String(erro),
    });
  }
}

/*
  Fontes (links confiáveis):
  - https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values/append
  - https://github.com/googleapis/google-api-nodejs-client
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toLocaleString
*/
