/** Serves the journey's page for the device runs of shyden-labs/playwright-devices#7. */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { serverPort } from './device-fixture.ts';

const pages = new Map([['/journey.html', new URL('journey.html', import.meta.url)]]);

createServer((request, response) => {
  const file = pages.get(request.url ?? '');
  if (file === undefined) {
    response.writeHead(404).end();
    return;
  }
  void readFile(file).then((body) => response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body));
}).listen(serverPort);
