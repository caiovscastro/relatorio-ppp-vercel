export default function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ message: "Método não permitido" });
    }

    const { usuario, senha, loja } = req.body;

    const usuarios = [
        { usuario: "LOJA1", senha: "1234", loja: "ULT 01 - PLANALTINA" },
        { usuario: "LOJA2", senha: "abcd", loja: "ULT 08 - ARAPOANGA" }
    ];

    const autorizado = usuarios.find(
        u => u.usuario === usuario && u.senha === senha && u.loja === loja
    );

    if (!autorizado) {
        return res.status(401).json({
            autorizado: false,
            message: "Credenciais inválidas"
        });
    }

    return res.status(200).json({
        autorizado: true,
        usuario: autorizado.usuario,
        loja: autorizado.loja
    });
}
