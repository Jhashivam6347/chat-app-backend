import jwt from "jsonwebtoken";

const JWT_SECRET = "7874317332";

export function verifyToken(req, resp, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return resp.status(401).send({
      success: false,
      msg: "No token provided"
    });
  }

  // ✅ Extract token after "Bearer "
  const token = authHeader.split(" ")[1];

  if (!token) {
    return resp.status(401).send({
      success: false,
      msg: "Token format invalid"
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return resp.status(401).send({
      success: false,
      msg: "Invalid token"
    });
  }
}
