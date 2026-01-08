import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'capi_secret_key_change_me_in_production';

export const authMiddleware = (req, res, next) => {
    // 1. Check header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN"

    if (!token) {
        return res.status(401).json({
            status: 'error',
            message: 'Acesso negado. Token não fornecido.'
        });
    }

    try {
        // 2. Verify token
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({
            status: 'error',
            message: 'Token inválido ou expirado.'
        });
    }
};

export const generateToken = (user) => {
    return jwt.sign(
        {
            id: user._id,
            email: user.email,
            role: user.role,
            storeId: user.storeId
        },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
};
