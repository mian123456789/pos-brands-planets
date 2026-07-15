module.exports = {
  apps: [
    {
      name: "brands-planets-pos",
      script: "server.js",
      env: {
        PORT: 3000,
        NODE_ENV: "production"
      }
    }
  ]
};
