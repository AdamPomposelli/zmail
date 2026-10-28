import { renderToReadableStream } from 'react-dom/server.browser';
import { ServerRouter, type EntryContext } from 'react-router';

// Only used to pre-render the SPA shell (index.html) and serve it in development.
export default async function handleRequest(request: Request, status: number, headers: Headers, context: EntryContext) {
  const stream = await renderToReadableStream(<ServerRouter context={context} url={request.url} />, { signal: request.signal });
  await stream.allReady;
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(stream, { status, headers });
}
