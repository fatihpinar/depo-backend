module.exports = {
  apps: [
    {
      name: "depo-backend",
      script: "src/server.js", // senin server giriş dosyan
      instances: 1,
      autorestart: true,
      watch: false,

      
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
    },
  ],
};
