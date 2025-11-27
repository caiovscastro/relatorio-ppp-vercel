// API/login-gestor.js
//
// Rota: /api/login-gestor
//
// Objetivo: validar login de gestores e devolver dados básicos
// (sem expor senha) para o front salvar em sessionStorage.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({
      sucesso: false,
      message: "Método não permitido. Use POST.",
    });
  }

  try {
    const { usuario, senha } = req.body || {};

    // Normaliza
    const u = String(usuario || "").trim().toLowerCase();
    const s = String(senha || "").trim();

    if (!u || !s) {
      return res.status(400).json({
        sucesso: false,
        message: "Informe usuário e senha.",
      });
    }

    // "Banco" de usuários gestores
    const GESTORES = [
      {
        usuario: "caio.castro",
        senha: "842142",
        nome: "Caio Castro",
      },
      {
        usuario: "gaspar.silva",
        senha: "842142",
        nome: "Gaspar Silva",
      },
    ];

    const gestor = GESTORES.find(
      (g) => g.usuario.toLowerCase() === u && g.senha === s
    );

    if (!gestor) {
      return res.status(401).json({
        sucesso: false,
        message: "Usuário ou senha inválidos.",
      });
    }

    // Aqui poderíamos gerar um token JWT no futuro.
    // Por enquanto devolvemos apenas dados básicos.
    return res.status(200).json({
      sucesso: true,
      message: "Login de gestor realizado com sucesso.",
      gestor: {
        usuario: gestor.usuario,
        nome: gestor.nome,
      },
    });
  } catch (erro) {
    console.error("Erro em /api/login-gestor:", erro);
    return res.status(500).json({
      sucesso: false,
      message: "Erro interno ao validar login de gestor.",
    });
  }
}
