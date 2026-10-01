// Minimal Deno globals for type-checking the entry files with tsc in Node tooling.
declare namespace Deno {
  function serve(handler: (req: Request) => Response | Promise<Response>): unknown;
  const env: { get(key: string): string | undefined };
}
