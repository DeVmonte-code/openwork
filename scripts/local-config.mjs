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
    // Match both local servers: availability on other interfaces is irrelevant.
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

export function localServerSettings(base) {
  const rawUrl = base.VITE_OPENWORK_URL ?? base.OPENWORK_SERVER_URL;
  const token = base.VITE_OPENWORK_TOKEN ?? base.OPENWORK_SERVER_TOKEN;
  if (!rawUrl && token) throw new Error("An OpenWork server token requires an OpenWork server URL.");
  if (!rawUrl) return null;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("The OpenWork server URL must be a valid http or https URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("The OpenWork server URL must use http or https without embedded credentials.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!local && base.OPENWORK_ALLOW_REMOTE_SERVER !== "1") {
    throw new Error("This OpenWork server is not on this computer. The client token would be placed in the page code. Set OPENWORK_ALLOW_REMOTE_SERVER=1 to allow this deliberately.");
  }
  const secrets = [token, base.OPENWORK_SERVER_TOKEN, base.VITE_OPENWORK_HOST_TOKEN].filter(value => value)
    .flatMap(value => [value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)]);
  const displayUrl = redactTokens(url.href, secrets);
  return {
    url: url.href, token, secrets, displayUrl,
    forceEnvSettings: base.VITE_OPENWORK_FORCE_ENV_SETTINGS ?? "1",
  };
}

export function redactTokens(text, tokens) {
  let result = text;
  for (const token of [...tokens].sort((a, b) => b.length - a.length)) {
    result = result.split(token).join("[redacted]");
  }
  return result;
}

export function serverBanner(server) {
  return server ? `Connected to your local OpenWork server at ${server.displayUrl}` : "";
}

export async function checkLocalServer(server, request = fetch) {
  if (!server) return "";
  try {
    const healthUrl = new URL(server.url);
    healthUrl.pathname = `${healthUrl.pathname.replace(/\/+$/, "")}/health`;
    healthUrl.search = "";
    healthUrl.hash = "";
    const response = await request(healthUrl.href, {
      signal: AbortSignal.timeout(2_000),
      // Do not forward credentials or follow a redirect to another server.
      redirect: "error",
    });
    if (response.ok) return "";
  } catch {
    // Never print fetch errors: they can contain URL credentials or tokens.
  }
  return `Warning: OpenWork server health did not answer at ${server.displayUrl}. Continuing; the server may start later.`;
}

export function localEnvironments(base, webPort, apiPort, server = localServerSettings(base)) {
  const shared = { ...base, NODE_ENV: "development", BASE_PATH: "/", HOST: "127.0.0.1" };
  // These are web-only even when inherited using the explicit variable names.
  for (const key of ["OPENWORK_SERVER_URL", "OPENWORK_SERVER_TOKEN", "OPENWORK_ALLOW_REMOTE_SERVER",
    "VITE_OPENWORK_URL", "VITE_OPENWORK_TOKEN", "VITE_OPENWORK_HOST_TOKEN", "VITE_OPENWORK_FORCE_ENV_SETTINGS"]) {
    delete shared[key];
  }
  return {
    api: { ...shared, PORT: String(apiPort) },
    web: {
      ...shared,
      PORT: String(webPort),
      OPENWORK_LOCAL_API_URL: `http://127.0.0.1:${apiPort}`,
      ...(base.VITE_OPENWORK_HOST_TOKEN !== undefined ? { VITE_OPENWORK_HOST_TOKEN: base.VITE_OPENWORK_HOST_TOKEN } : {}),
      ...(base.VITE_OPENWORK_FORCE_ENV_SETTINGS !== undefined ? { VITE_OPENWORK_FORCE_ENV_SETTINGS: base.VITE_OPENWORK_FORCE_ENV_SETTINGS } : {}),
      ...(server ? {
        VITE_OPENWORK_URL: base.VITE_OPENWORK_URL ?? server.url,
        ...(server.token !== undefined ? { VITE_OPENWORK_TOKEN: server.token } : {}),
        VITE_OPENWORK_FORCE_ENV_SETTINGS: server.forceEnvSettings,
      } : {}),
    },
  };
}