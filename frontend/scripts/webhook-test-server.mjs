import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.MEETILY_WEBHOOK_PORT || 8787);
const secret = process.env.MEETILY_WEBHOOK_SECRET;

if (!secret || secret.length < 16) {
  console.error('Set MEETILY_WEBHOOK_SECRET to the same 16+ character secret configured in Meetily.');
  process.exit(1);
}

const server = createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/webhook') {
    response.writeHead(404).end();
    return;
  }

  const chunks = [];
  let receivedBytes = 0;
  request.on('data', chunk => {
    receivedBytes += chunk.length;
    if (receivedBytes > 1024 * 1024) {
      response.writeHead(413).end();
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on('end', () => {
    const body = Buffer.concat(chunks);
    const provided = request.headers['x-meetily-signature'] || '';
    const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const validSignature = provided.length === expected.length
      && timingSafeEqual(Buffer.from(provided), Buffer.from(expected));

    if (!validSignature) {
      console.error('Rejected webhook with an invalid x-meetily-signature header.');
      response.writeHead(401).end();
      return;
    }

    try {
      const event = JSON.parse(body.toString('utf8'));
      console.log('\nVerified Meetily webhook');
      console.log(JSON.stringify(event, null, 2));
      response.writeHead(204).end();
    } catch (error) {
      console.error('Rejected invalid JSON:', error);
      response.writeHead(400).end();
    }
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Meetily webhook receiver listening at http://localhost:${port}/webhook`);
});
