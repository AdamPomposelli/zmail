import { createServer, type Server } from 'node:http';

/** Fake newsletter unsubscribe endpoints: one-click (RFC 8058), a form, and a captcha wall. */
export function startUnsubscribeMock(port = 47900) {
  const unsubscribed = new Set<string>();
  const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`;

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const [, mode, list, step] = url.pathname.split('/');
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const send = (status: number, html: string) => {
        res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
      };
      if (url.pathname === '/state') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify([...unsubscribed]));
      }
      if (mode === 'one-click') {
        if (req.method === 'POST' && body.includes('List-Unsubscribe=One-Click')) {
          unsubscribed.add(list!);
          return send(200, page('OK'));
        }
        return send(200, page(`<form method="post"><button>Confirm</button></form>`));
      }
      if (mode === 'form') {
        if (step === 'submit' && req.method === 'POST') {
          const params = new URLSearchParams(body);
          if (params.get('email') && params.get('scope') === 'all') {
            unsubscribed.add(list!);
            return send(200, page('<h1>C’est fait</h1><p>Vous êtes bien désinscrit de toutes nos communications.</p>'));
          }
          return send(400, page('<p>Adresse manquante.</p>'));
        }
        return send(
          200,
          page(`<h1>Gérer mes préférences</h1>
            <form method="post" action="/form/${list}/submit">
              <input type="hidden" name="token" value="abc123">
              <label>Votre adresse <input type="email" name="email"></label>
              <label><input type="checkbox" name="scope" value="all"> Se désinscrire de toutes les communications</label>
              <button type="submit">Se désinscrire</button>
            </form>`),
        );
      }
      if (mode === 'captcha') {
        return send(200, page('<h1>Vérification</h1><p>Prouvez que vous êtes humain pour continuer.</p><div class="captcha">🧩</div>'));
      }
      send(404, page('not found'));
    });
  });

  return new Promise<{ server: Server; unsubscribed: Set<string>; close: () => Promise<void> }>((resolve) => {
    server.listen(port, '127.0.0.1', () =>
      resolve({ server, unsubscribed, close: () => new Promise((r) => server.close(() => r())) }),
    );
  });
}
