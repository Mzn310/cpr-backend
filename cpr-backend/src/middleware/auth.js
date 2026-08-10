// Simple shared-secret auth. n8n and the admin panel both send this
export function requireApiKey(envVarName) {
  return (req, res, next) => {
    const expected = process.env[envVarName];
    const provided = req.header("x-api-key");
    if (!expected || provided !== expected) {
      return res.status(401).json({ error: "unauthorized" });
    }
    next();
  };
}
