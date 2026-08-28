import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
const secret=process.env.WEBHOOK_SECRET_FILE?fs.readFileSync(process.env.WEBHOOK_SECRET_FILE,'utf8').trim():process.env.WEBHOOK_SECRET
if(!secret)throw new Error('WEBHOOK_SECRET or WEBHOOK_SECRET_FILE is required')
const events=[],idempotency=new Set()
const json=(response,status,body)=>{response.writeHead(status,{'content-type':'application/json'});response.end(JSON.stringify(body))}
const server=http.createServer((request,response)=>{
 if(request.method==='GET'&&request.url==='/health')return json(response,200,{status:'UP'})
 if(request.method==='GET'&&request.url==='/events')return json(response,200,{count:events.length,events})
 if(request.method!=='POST'||request.url!=='/hooks/hr')return json(response,404,{error:'not found'})
 const chunks=[];let size=0;request.on('data',chunk=>{size+=chunk.length;if(size>1024*1024)request.destroy();else chunks.push(chunk)})
 request.on('end',()=>{const body=Buffer.concat(chunks).toString('utf8'),timestamp=request.headers['x-recruitment-timestamp']??'',received=request.headers['x-recruitment-signature']??'',expected='sha256='+crypto.createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex'),receivedBytes=Buffer.from(received),expectedBytes=Buffer.from(expected);if(receivedBytes.length!==expectedBytes.length||!crypto.timingSafeEqual(receivedBytes,expectedBytes))return json(response,401,{error:'invalid signature'});if(Math.abs(Date.now()/1000-Number(timestamp))>300)return json(response,401,{error:'expired timestamp'});const key=request.headers['idempotency-key'];if(!key)return json(response,400,{error:'missing idempotency key'});if(idempotency.has(key))return json(response,200,{accepted:true,replayed:true});const payload=JSON.parse(body);idempotency.add(key);events.push({receivedAt:new Date().toISOString(),payload});return json(response,202,{accepted:true,replayed:false})})
})
server.listen(8080,'0.0.0.0')
