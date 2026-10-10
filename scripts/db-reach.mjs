// One-off connectivity diagnostic. Prints no credentials.
import dns from 'node:dns';
import net from 'node:net';

const host = process.argv[2];
const port = Number(process.argv[3] ?? 5432);
if (!host) {
  console.error('usage: node scripts/db-reach.mjs <host> [port]');
  process.exit(2);
}

const t0 = Date.now();
dns.lookup(host, (err, address) => {
  if (err) {
    console.log(`DNS_FAIL: ${err.code} ${err.message}`);
    process.exit(3);
  }
  console.log(`DNS_OK: ${host} -> ${address} (${Date.now() - t0}ms)`);

  const sock = net.connect({ host: address, port });
  const timer = setTimeout(() => {
    sock.destroy();
    console.log(`TCP_TIMEOUT: no SYN-ACK within 10000ms (${Date.now() - t0}ms)`);
    process.exit(4);
  }, 10_000);
  sock.once('connect', () => {
    clearTimeout(timer);
    console.log(`TCP_OK: connected in ${Date.now() - t0}ms`);
    sock.end();
    process.exit(0);
  });
  sock.once('error', (e) => {
    clearTimeout(timer);
    console.log(`TCP_FAIL: ${e.code ?? ''} ${e.message}`);
    process.exit(5);
  });
});
