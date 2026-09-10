// Two real frontends and copied-CS HTTP runtime; ERP identity is synthetic.
// No environment files, real accounts, external providers or Shopify calls.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const { default: react } = await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href);
const tenant = '11111111-1111-4111-8111-111111111111', subject = '22222222-2222-4222-8222-222222222222';
let issued = 0, redeemed = 0, validated = 0, revoked = false;
const grants = new Set(), consumed = new Set();
const permissions = ['customer_service.read', 'iam:user:read'];
const session = { tenant:{id:tenant, code:'fixture', name:'本地合成企业 · 非真实账号'}, user:{id:subject, username:'fixture-admin', displayName:'合成审核员'}, permissions, applications:[{code:'CHAT',modules:[]}], expiresAt:new Date(Date.now()+3600000).toISOString() };
const send = (res, status, body) => { res.statusCode=status; res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body)); };
const erp = await createServer({ root:fileURLToPath(new URL('../frontend/',import.meta.url)), configFile:false,envDir:false,cacheDir:'node_modules/.vite-shared-fixture',define:{'import.meta.env.VITE_CUSTOMER_SERVICE_WORKBENCH_URL':JSON.stringify('http://127.0.0.1:19182')},server:{host:'127.0.0.1',port:19181,strictPort:true,proxy:{}},plugins:[react(),{name:'shared-identity-fixture',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
 const path = new URL(req.url,'http://fixture').pathname;
 if(path==='/__fixture/status')return send(res,200,{issued,redeemed,validated,revoked,synthetic:true});
 if(path==='/__fixture/revoke'&&req.method==='POST'){revoked=true;return send(res,200,{revoked});}
 if(path==='/api/v1/auth/me')return send(res,200,session);
 if(path==='/api/v1/customer-service/entry-grants'){
  if(revoked)return send(res,403,{code:'fixture_revoked'});
  const grant=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');grants.add(grant);issued++;
  return send(res,200,{grant,tenantId:tenant,userId:subject,entryUrl:'http://127.0.0.1:19182/api/v1/auth/erp/entry',expiresAt:new Date(Date.now()+60000).toISOString()});
 }
 if(path.startsWith('/api/v1/internal/customer-service/')){
  let raw='';for await(const chunk of req)raw+=chunk;let body;try{body=JSON.parse(raw);}catch{return send(res,400,{});}
  const validation=path.endsWith('/session/validate');
  if(req.headers['x-xz-erp-connector-token']!=='fixture-only-internal'||revoked||body.tenantId!==tenant||body.userId!==subject||body.targetOrigin!=='http://127.0.0.1:19182'||!(validation?consumed:grants).has(body.grant))return send(res,403,{});
  if(validation)validated++;else{redeemed++;grants.delete(body.grant);consumed.add(body.grant);}
  return send(res,200,{tenantId:tenant,tenantCode:'fixture',subjectId:subject,email:'fixture@example.test',displayName:'合成审核员',permissions,systemAdmin:true,shops:[],expiresAt:new Date(Date.now()+900000).toISOString()});
 }
 if(path.startsWith('/api/'))return send(res,404,{code:'fixture_only'});next();
});}}]});
const chat=await createServer({root:fileURLToPath(new URL('../customer-service/frontend/',import.meta.url)),configFile:false,envDir:false,cacheDir:'node_modules/.vite-shared-fixture',server:{host:'127.0.0.1',port:19182,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:18581'},'/ws':{target:'http://127.0.0.1:18581',ws:true}}},plugins:[react()]});
await erp.listen();await chat.listen();console.log('Synthetic ERP http://127.0.0.1:19181/customer-service; copied CS http://127.0.0.1:19182');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await erp.close();await chat.close();process.exit(0);});
