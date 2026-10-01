import net from "node:net";

export function portRequest(value, defaultPort, name) {
  const provided = value !== undefined && value !== "";
  const text = provided ? value : String(defaultPort);
  const port = Number(text);
  if (!/^\d+$/.test(text) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return { port, allowFallback: !provided, name };
}

// Availability is injected so port policy can be tested without live sockets.
export async function choosePort(request, available, excluded = []) {
  for (let port = request.port; port <= 65535; port += 1) {
    if (!excluded.includes(port) && await available(port)) return port;
    if (!request.allowFallback) {
      throw new Error(`${request.name} port ${port} is unavailable. Choose another port.`);
    }
  }
  throw new Error(`No free port at or above ${request.port} for ${request.name}.`);
}

export function portAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") resolve(false);
      else reject(error);
    });
    // Match the API's wildcard listen, including dual-stack systems.
    server.listen(port, () => server.close(() => resolve(true)));
  });
}

export function localEnvironments(base, webPort, apiPort) {
  const shared = { ...base, NODE_ENV: "development", BASE_PATH: "/" };
  return {
    api: { ...shared, PORT: String(apiPort) },
    web: {
      ...shared,
      PORT: String(webPort),
      OPENWORK_LOCAL_API_URL: `http://127.0.0.1:${apiPort}`,
    },
  };
}