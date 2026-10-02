/** Resolve each dependency independently; Vite can retain different hashes
 * for dependencies discovered in separate optimization passes. */
export async function optimizedImportResolver(origin: string, sourceModules: string[]) {
  const sources = await Promise.all(sourceModules.map(async (module) => {
    const response = await fetch(new URL(module, origin));
    if (!response.ok) throw new Error(`Could not inspect Vite module ${module}: ${response.status}`);
    return response.text();
  }));
  const urls = new Map<string, string>();
  for (const source of sources) {
    for (const match of source.matchAll(/\/node_modules\/\.vite\/deps\/[^'"]+\.js\?v=[^'"]+/g)) {
      const url = match[0];
      urls.set(url.slice(0, url.indexOf("?")), url);
    }
  }
  return (module: string) => {
    const url = urls.get(module);
    if (!url) throw new Error(`Cannot determine the running preview's exact URL for ${module}`);
    return url;
  };
}