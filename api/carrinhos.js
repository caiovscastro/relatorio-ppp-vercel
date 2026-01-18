// /api/carrinhos.js
// Grava contagem de carrinhos na aba CARRINHOS do Google Sheets.
//
// ✅ MODELO NOVO (A..U):
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
// L: Carrinho gaiola pet
// M: Bebê Jipinho
// N: Cestinha
// O: Cadeira de rodas
// P: Carrinhos Quebrados
// Q: Carrinhos reserva
// R: Cestinhas reserva
//
// S: Qtd movimentação (entrada positivo / saída negativo)
// T: Motivo abreviado (M.L / M.M / E.N) (ou com underscore: M_L / M_M / E_N)
//
// ✅ NOVO:
// U: ID único da linha (gerado no backend)
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
  "ENTRADA_NOVOS",
]);

const MOV_ABREV_PERMITIDAS = new Set([
  "M.L", "M.M", "E.N",
  "M_L", "M_M", "E_N",
]);

function nowSaoPaulo() {
  const agora = new Date();
  return new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}

function formatarDataHoraBR(d) {
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function pad2(n){ return String(n).padStart(2, "0"); }

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

function abreviarCodigoMov(codigo) {
  const v = String(codigo || "").trim().toUpperCase();
  if (v === "MOVI_ENTRE_LOJAS") return "M.L";
  if (v === "MOVI_MANUTENCAO") return "M.M";
  if (v === "ENTRADA_NOVOS") return "E.N";
  return "";
}

function validarAbreviacao(raw) {
  const v = String(raw ?? "").trim().toUpperCase();
  if (!v) return { ok: false, value: "" };
  if (!MOV_ABREV_PERMITIDAS.has(v)) return { ok: false, value: "" };
  return { ok: true, value: v };
}

/* =====================================================================================
   ✅ NOVO: Gerador de ID (coluna U)
   Formato base (seu padrão): [LetraBandeira][NumLoja2][u2+uLast2][DDMMYYYY][HHMMSS]
   + ✅ Anti-colisão leve: acrescenta [CC] (centésimos de segundo) no final.
   Ex: U01vara10012026145128 + 07 => U01vara1001202614512807
===================================================================================== */
function normalizarUsuarioParaId(usuario){
  const s0 = String(usuario || "").trim();
  const semAcento = s0.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const soLetras = semAcento.replace(/[^a-zA-Z]/g, "").toLowerCase();
  return soLetras;
}

function extrairLetraEBairroNumeroLoja(loja){
  const s = String(loja || "").trim().toUpperCase();

  // Espera "ULT 01 - ..." ou "BIG 02 - ..."
  const m = s.match(/^(ULT|BIG)\s*(\d{1,2})\b/);
  if(m){
    const prefix = m[1]; // ULT | BIG
    const letra = prefix.slice(0,1); // U | B
    const num = pad2(parseInt(m[2], 10));
    return { letra, num };
  }

  // Fallback seguro
  const letra = s ? s[0] : "X";
  const num = "00";
  return { letra, num };
}

function ddmmyyyySemBarra(dataBR){
  // dataBR: DD/MM/AAAA
  const m = String(dataBR || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(!m) return "00000000";
  return `${m[1]}${m[2]}${m[3]}`;
}

function hhmmss(dt){
  return `${pad2(dt.getHours())}${pad2(dt.getMinutes())}${pad2(dt.getSeconds())}`;
}

function centesimos(dt){
  // 0..99 (centésimos) a partir de ms
  const cs = Math.floor(dt.getMilliseconds() / 10);
  return pad2(cs);
}

function montarIdLinha({ loja, usuario, dataLancamentoBR, dtRede }){
  const { letra, num } = extrairLetraEBairroNumeroLoja(loja);

  const u = normalizarUsuarioParaId(usuario);
  const first2 = (u.slice(0,2) || "xx").padEnd(2, "x");
  const last2  = (u.slice(-2)  || "xx").padStart(2, "x");
  const user4  = `${first2}${last2}`;

  const data8  = ddmmyyyySemBarra(dataLancamentoBR);
  const t6     = hhmmss(dtRede);

  // Base solicitado + sufixo anti-colisão
  return `${letra}${num}${user4}${data8}${t6}${centesimos(dtRede)}`;
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

    const movCategoriaValid = validarMovCategoria(body.movCategoria);
    if (!movCategoriaValid.ok) {
      return res.status(400).json({
        sucesso: false,
        message: "Tipo de movimentação inválido. Use: MOVI_ENTRE_LOJAS, MOVI_MANUTENCAO ou ENTRADA_NOVOS.",
      });
    }
    const movCategoriaCodigo = movCategoriaValid.value;

    const ab = validarAbreviacao(body.movCategoriaAbrev);
    const movCategoriaColT = ab.ok ? ab.value : abreviarCodigoMov(movCategoriaCodigo);

    if (!movCategoriaColT) {
      return res.status(400).json({
        sucesso: false,
        message: "Motivo abreviado inválido. Use M.L/M.M/E.N ou M_L/M_M/E_N.",
      });
    }

    if (!isBRDateDDMMAAAA(dataLancamento)) {
      return res.status(400).json({ sucesso: false, message: "Data Contagem inválida. Use DD/MM/AAAA." });
    }

    const duplocar120         = asIntObrigatorioNaoNegativo(contagens.duplocar120);
    const grande160           = asIntObrigatorioNaoNegativo(contagens.grande160);
    const bebeConforto160     = asIntObrigatorioNaoNegativo(contagens.bebeConforto160);
    const maxcar200           = asIntObrigatorioNaoNegativo(contagens.maxcar200);
    const macrocar300         = asIntObrigatorioNaoNegativo(contagens.macrocar300);
    const pranchaJacare       = asIntObrigatorioNaoNegativo(contagens.pranchaJacare);
    const compraKids          = asIntObrigatorioNaoNegativo(contagens.compraKids);
    const carrinhoGaiolaPet   = asIntObrigatorioNaoNegativo(contagens.carrinhoGaiolaPet);
    const bebeJipinho         = asIntObrigatorioNaoNegativo(contagens.bebeJipinho);
    const cestinha            = asIntObrigatorioNaoNegativo(contagens.cestinha);
    const cadeiraRodas        = asIntObrigatorioNaoNegativo(contagens.cadeiraRodas);
    const carrinhosQuebrados  = asIntObrigatorioNaoNegativo(contagens.carrinhosQuebrados);
    const carrinhosReserva    = asIntObrigatorioNaoNegativo(contagens.carrinhosReserva);
    const cestinhasReserva    = asIntObrigatorioNaoNegativo(contagens.cestinhasReserva);

    const movCarrinhosRaw =
      (contagens.movCarrinhos === "" || contagens.movCarrinhos === undefined || contagens.movCarrinhos === null)
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
      carrinhoGaiolaPet,
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

    // ✅ NOVO: ID coluna U
    const idLinha = montarIdLinha({
      loja,
      usuario,
      dataLancamentoBR: dataLancamento,
      dtRede
    });

    // ✅ MODELO NOVO A..U (21 colunas)
    const values = [[
      dataHoraRede,        // A
      loja,                // B
      usuario,             // C
      dataLancamento,      // D

      duplocar120,         // E
      grande160,           // F
      bebeConforto160,     // G
      maxcar200,           // H
      macrocar300,         // I
      pranchaJacare,       // J
      compraKids,          // K
      carrinhoGaiolaPet,   // L
      bebeJipinho,         // M
      cestinha,            // N
      cadeiraRodas,        // O
      carrinhosQuebrados,  // P
      carrinhosReserva,    // Q
      cestinhasReserva,    // R

      movCarrinhos,        // S
      movCategoriaColT,    // T
      idLinha,             // U ✅ NOVO
    ]];

    const sheets = await getSheetsClient();

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "CARRINHOS!A:U", // ✅ Ajuste: agora escreve até U
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values },
    });

    return res.status(200).json({
      sucesso: true,
      message: "Contagem de carrinhos enviada com sucesso.",
      id: idLinha, // opcional: útil para log/UX futuro
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
