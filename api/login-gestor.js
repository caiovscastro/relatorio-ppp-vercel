// api/login-gestor.js
//
// Endpoint de login específico para o MÓDULO DE CONSULTAS / RELATÓRIO.
//
// - Método permitido: POST
// - Corpo esperado (JSON):
//     { "usuario": "Caio", "senha": "PPP2025" }
//
// - Respostas:
//   200 OK  -> credenciais válidas
//   401     -> credenciais inválidas
//   405     -> método não permitido

export default function handler(req, res) {
  // Aceita apenas POST
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ sucesso: false, message: "Método não permitido" });
  }

  const { usuario, senha } = req.body || {};

  // Normaliza entradas (evita erro se vier undefined/null)
  const usuarioEntrada = String(usuario || "").trim();
  const senhaEntrada   = String(senha   || "").trim();

  if (!usuarioEntrada || !senhaEntrada) {
    return res.status(400).json({
      sucesso: false,
      message: "Informe usuário e senha."
    });
  }

  // ======================================================
  // LISTA DE GESTORES AUTORIZADOS PARA CONSULTAS
  // ======================================================
  //
  // Aqui você define quem pode acessar o módulo de consultas.
  // NO MÍNIMO, já deixei criado o usuário:
  //
  //   Usuário: Caio
  //   Senha:   PPP2025
  //
  // Recomendo depois alterar a senha para algo mais forte.
  //
  const gestores = [
    {
      usuario: "CAIO",      // login
      senha:   "PPP2025",   // senha (TROQUE ISSO DEPOIS)
      nome:    "Caio",      // nome para exibir
      role:    "gestor"     // papel/perfil
    }
    // Você pode adicionar outros assim:
    // { usuario: "ADMIN", senha: "SENHA_FORTE", nome: "Administrador", role: "admin" }
  ];

  // Compara ignorando maiúsculas/minúsculas no usuário,
  // mas exigindo a senha exata.
  const gestorEncontrado = gestores.find((g) =>
    g.usuario.toLowerCase() === usuarioEntrada.toLowerCase() &&
    g.senha === senhaEntrada
  );

  if (!gestorEncontrado) {
    return res.status(401).json({
      sucesso: false,
      message: "Usuário ou senha inválidos para consultas."
    });
  }

  // Login OK: devolve dados mínimos para o front salvar na sessão
  return res.status(200).json({
    sucesso: true,
    usuario: gestorEncontrado.nome || gestorEncontrado.usuario,
    role: gestorEncontrado.role || "gestor",
    message: "Login de consultas autorizado."
  });
}
