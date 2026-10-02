// Relay child output without letting chunk boundaries expose a client token.
export function tokenSafeOutput(write, tokens) {
  const secrets = [...new Set(tokens.filter(value => value))].sort((a, b) => b.length - a.length);
  const retained = Math.max(0, ...secrets.map(value => value.length - 1));
  let buffer = "";
  function drain(final) {
    const limit = final ? buffer.length : buffer.length - retained;
    let cursor = 0;
    let output = "";
    while (cursor < limit) {
      const secret = secrets.find(value => buffer.startsWith(value, cursor));
      if (secret) {
        output += "[redacted]";
        cursor += secret.length;
      } else {
        output += buffer[cursor];
        cursor += 1;
      }
    }
    buffer = buffer.slice(cursor);
    if (output) write(output);
  }
  return {
    data(chunk) { buffer += chunk.toString(); drain(false); },
    end() { drain(true); },
  };
}