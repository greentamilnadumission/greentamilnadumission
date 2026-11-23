import http from 'node:http';
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello World\n');
}).listen(4177, () => {
  console.log('Server running at http://localhost:4177/');
});