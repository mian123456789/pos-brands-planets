module.exports = {
  apps: [
    {
      name: "brands-planets-pos",
      script: "server.js",
      env: {
        PORT: 3000,
        NODE_ENV: "production",
        SMS_API_URL: process.env.SMS_API_URL || "",
        SMS_API_TOKEN: process.env.SMS_API_TOKEN || "",
        SMS_API_KEY: process.env.SMS_API_KEY || "",
        SMS_SENDER: process.env.SMS_SENDER || "Brands Planets"
      }
    }
  ]
};
