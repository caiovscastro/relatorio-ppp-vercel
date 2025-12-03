// api/login.js
// Função serverless da Vercel responsável por validar o login.
// Este endpoint deve ser acessado via POST em /api/login.

export default function handler(req, res) {
    // 1) Garante que apenas o método POST seja aceito
    if (req.method !== "POST") {
        // 405 = Method Not Allowed
        return res.status(405).json({
            sucesso: false,
            message: "Método não permitido. Use POST para acessar este endpoint."
        });
    }

    // 2) Extrai os campos enviados no corpo da requisição
    //    Esperamos um JSON: { usuario: "...", senha: "...", loja: "..." }
    const { usuario, senha, loja } = req.body || {};

    // 3) Validação básica dos campos obrigatórios
    if (!usuario || !senha || !loja) {
        // 400 = Bad Request (requisição malformada/incompleta)
        return res.status(400).json({
            sucesso: false,
            message: "Usuário, senha e loja são obrigatórios."
        });
    }

    // 4) Base de usuários AUTORIZADOS (por enquanto, fixo no código)
    //    Depois podemos mover isso para uma planilha Google.
    const usuarios = [
        { usuario: "Uloja1", senha: "842142", loja: "ULT 01 - PLANALTINA" },
        { usuario: "gaspar.silva", senha: "842142", loja: "ULT 01 - PLANALTINA" },
        { usuario: "Uloja2", senha: "842142", loja: "ULT 02 - GAMA" },
        { usuario: "Uloja3", senha: "842142", loja: "ULT 03 - COLORADO" },
        { usuario: "Uloja4", senha: "842142", loja: "ULT 04 - CEI SUL" },
        { usuario: "Uloja5", senha: "842142", loja: "ULT 05 - POLO JK" },
        { usuario: "Uloja6", senha: "842142", loja: "ULT 06 - SOBRADINHO" },
        { usuario: "Uloja7", senha: "842142", loja: "ULT 07 - ADE" },
        { usuario: "Uloja8", senha: "842142", loja: "ULT 08 - ARAPOANGA" },
        { usuario: "Uloja9", senha: "842142", loja: "ULT 09 - CEI NORTE" },
        { usuario: "Uloja10", senha: "842142", loja: "ULT 10 - ESTRUTURAL" }
        
    ];

    // 5) Procura um registro que combine usuário, senha e loja
    const autorizado = usuarios.find(
        (u) =>
            u.usuario === usuario &&
            u.senha === senha &&
            u.loja === loja
    );

    // 6) Caso não encontre, retorna NÃO AUTORIZADO
    if (!autorizado) {
        // 401 = Unauthorized
        return res.status(401).json({
            sucesso: false,
            message: "Credenciais inválidas. Verifique usuário, senha e loja."
        });
    }

    // 7) Se chegou aqui, o login está OK.
    //    Repare que agora usamos SEMPRE o campo 'sucesso',
    //    que vai bater com o que o front-end (login.html) espera.
    return res.status(200).json({
        sucesso: true,
        usuario: autorizado.usuario,
        loja: autorizado.loja
    });
}
